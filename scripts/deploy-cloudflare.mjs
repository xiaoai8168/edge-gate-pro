#!/usr/bin/env node
/*
 * Edge Gate Pro - independent external Worker deployment.
 * MIT orchestration only. GPL upstream sources are cloned into ignored .build/.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const BUILD = path.join(ROOT, ".build", "external");
const SECRETS_DIR = path.join(ROOT, ".secrets");
const STATE_PATH = path.join(SECRETS_DIR, "deployment.json");
const require = createRequire(import.meta.url);
const WRANGLER_ENTRY = require.resolve("wrangler");
const PINS = {
  checker: { url: "https://github.com/lsh8848/cm-Workers-CheckSocks5.git", commit: "2f31cf9a242444eb22905d888d4d8871b0625b3a" },
  edgetunnel: { url: "https://github.com/cmliu/edgetunnel.git", commit: "5b2aaf0daf7fa1b126170877f64dd8d2e34c2746" }
};

const env = process.env;
const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || "").trim();
if (!accountId) die("缺少 CLOUDFLARE_ACCOUNT_ID");
if (!/^[a-f0-9]{32}$/i.test(accountId)) die("CLOUDFLARE_ACCOUNT_ID 格式错误");

const customDomain = boolEnv("USE_CUSTOM_DOMAIN", true);
const zoneName = env.CF_ZONE_NAME || "aiy.kdns.fr";
const checkHost = env.CHECK_HOST || "egp-check.aiy.kdns.fr";
const proxyHost = env.PROXY_HOST || "egp-gate.aiy.kdns.fr";
const dashboardHost = env.DASHBOARD_HOST || "egp-edge.aiy.kdns.fr";

fs.mkdirSync(BUILD, { recursive: true });
fs.mkdirSync(SECRETS_DIR, { recursive: true });
const state = readJson(STATE_PATH) || {};
state.hmacSecret ||= randomSecret(36);
state.adminPassword ||= randomSecret(24);
state.uuid ||= crypto.randomUUID();

function die(message) { console.error("ERROR: " + message); process.exit(1); }
function boolEnv(name, fallback) {
  const value = String(env[name] || "").trim().toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  die(name + " 必须是布尔值");
}
function randomSecret(bytes) { return crypto.randomBytes(bytes).toString("base64url"); }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function writePrivateJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") fs.chmodSync(file, 0o600);
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId },
    input: options.input,
    encoding: "utf8",
    timeout: options.timeout || 180000,
    stdio: ["pipe", "pipe", "pipe"]
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFail) {
    throw new Error(command + " " + args.join(" ") + "\n" + (result.stdout || "") + (result.stderr || ""));
  }
  return { status: result.status, output: (result.stdout || "") + (result.stderr || "") };
}
function shellQuote(value) {
  const text = String(value);
  return /[\s&|<>^"]/.test(text) ? '"' + text.replaceAll('"', '\\"') + '"' : text;
}
function wrangler(args, options = {}) {
  return run(process.execPath, [WRANGLER_ENTRY, ...args], { ...options, timeout: options.timeout || 240000 });
}
function ensureRepo(name) {
  const spec = PINS[name];
  const dir = path.join(BUILD, name);
  if (!fs.existsSync(path.join(dir, ".git"))) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log("[external] clone " + name);
    run("git", ["clone", "--filter=blob:none", "--no-checkout", spec.url, dir], { timeout: 240000 });
  }
  run("git", ["fetch", "--depth", "1", "origin", spec.commit], { cwd: dir, timeout: 240000 });
  run("git", ["checkout", "--force", spec.commit], { cwd: dir });
  console.log("[external] " + name + " pinned at " + spec.commit.slice(0, 12));
  return dir;
}
function deploymentExists(workerName) {
  const result = wrangler(["deployments", "status", "--name", workerName], { allowFail: true });
  return result.status === 0;
}
function deployWorker(configPath, workerName, fallbackHost = "") {
  let result;
  try {
    result = wrangler(["deploy", "--config", configPath]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("This Worker does not exist on your account") && deploymentExists(workerName)) {
      console.log("[deploy] Cloudflare returned a post-upload false negative; deployment version is present");
      result = { status: 0, output: message };
    } else {
      throw error;
    }
  }
  console.log(result.output.trim());
  if (!fallbackHost) return null;
  const match = result.output.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i);
  return customDomain ? fallbackHost : (match ? new URL(match[0]).host : fallbackHost);
}
function workerRoutes(host) {
  if (!customDomain) return "";
  return "\nroutes = [\n  { pattern = \"" + host + "\", custom_domain = true }\n]\n";
}

try {
  console.log("[auth] verifying Cloudflare account");
  const who = wrangler(["whoami"]);
  console.log(who.output.trim());

  const checkerDir = ensureRepo("checker");
  const privateConfig = path.join(checkerDir, "wrangler.toml");
  fs.writeFileSync(privateConfig, [
    'name = "egp-check-private"',
    'main = "_worker.js"',
    'compatibility_date = "2026-11-17"',
    'workers_dev = false',
    '',
    '[observability]',
    'enabled = true',
    ''
  ].join("\n"), "utf8");
  console.log("[deploy] private checker");
  deployWorker(privateConfig, "egp-check-private");

  const gateDir = path.join(ROOT, "workers", "checker-gate");
  const gateConfigDir = path.join(BUILD, "configs", "checker-gate");
  fs.mkdirSync(path.join(gateConfigDir, "src"), { recursive: true });
  fs.copyFileSync(path.join(gateDir, "src", "index.js"), path.join(gateConfigDir, "src", "index.js"));
  const gateConfig = path.join(gateConfigDir, "wrangler.toml");
  fs.writeFileSync(gateConfig, [
    'name = "egp-check"',
    'main = "src/index.js"',
    'compatibility_date = "2026-11-17"',
    'workers_dev = true',
    workerRoutes(checkHost),
    '[observability]',
    'enabled = true',
    '',
    '[vars]',
    'ALLOWED_TARGET_SUFFIXES = ".opengw.net,.vpngate.net"',
    'CHECK_TIMEOUT_MS = "30000"',
    '',
    '[[services]]',
    'binding = "CHECKER"',
    'service = "egp-check-private"',
    ''
  ].join("\n"), "utf8");
  wrangler(["secret", "put", "EDGE_HMAC_SECRET", "--config", gateConfig], { input: state.hmacSecret + "\n" });
  console.log("[deploy] signed checker gate");
  const checkerPublicHost = deployWorker(gateConfig, "egp-check", checkHost);

  const edgeDir = ensureRepo("edgetunnel");
  let kvNamespaceId = String(state.kvNamespaceId || "").trim();
  if (!kvNamespaceId) {
    console.log("[deploy] creating KV namespace");
    const kvConfig = path.join(edgeDir, "wrangler.toml");
    fs.writeFileSync(kvConfig, [
      'name = "egp-proxy"',
      'main = "_worker.js"',
      'compatibility_date = "2026-11-17"',
      'workers_dev = true',
      ''
    ].join("\n"), "utf8");
    const created = wrangler(["kv", "namespace", "create", "egp-proxy-kv", "--config", kvConfig]);
    console.log(created.output.trim());
    const id = created.output.match(/[a-f0-9]{32}/i);
    if (!id) throw new Error("无法从 Wrangler 输出解析 KV namespace id");
    kvNamespaceId = id[0];
  }

  const proxyConfig = path.join(edgeDir, "wrangler.toml");
  fs.writeFileSync(proxyConfig, [
    'name = "egp-proxy"',
    'main = "_worker.js"',
    'compatibility_date = "2026-11-17"',
    'keep_vars = true',
    'workers_dev = true',
    workerRoutes(proxyHost),
    '[observability]',
    'enabled = true',
    '',
    '[vars]',
    'BEST_SUB = "1"',
    'PRELOAD_RACE_DIAL = "1"',
    'TCP_CONCURRENT_DIAL = "2"',
    'PROXY_CONCURRENT_DIAL = "1"',
    '',
    '[[kv_namespaces]]',
    'binding = "KV"',
    'id = "' + kvNamespaceId + '"',
    ''
  ].join("\n"), "utf8");
  wrangler(["secret", "put", "ADMIN", "--config", proxyConfig], { input: state.adminPassword + "\n" });
  wrangler(["secret", "put", "UUID", "--config", proxyConfig], { input: state.uuid + "\n" });
  console.log("[deploy] independent proxy service");
  const proxyPublicHost = deployWorker(proxyConfig, "egp-proxy", proxyHost);

  state.accountId = accountId;
  state.zoneName = zoneName;
  state.checkerHost = checkerPublicHost;
  state.proxyHost = proxyPublicHost;
  state.dashboardHost = dashboardHost;
  state.kvNamespaceId = kvNamespaceId;
  state.deployedAt = new Date().toISOString();
  writePrivateJson(STATE_PATH, state);

  console.log(JSON.stringify({
    ok: true,
    checkerHost: checkerPublicHost,
    checkerHealth: "https://" + checkerPublicHost + "/healthz",
    proxyAdmin: "https://" + proxyPublicHost + "/admin",
    dashboardHost,
    credentialsFile: STATE_PATH,
    next: "运行 scripts/publish-github.mjs 发布核心仓库和 GitHub Secrets"
  }, null, 2));
} catch (error) {
  die(error instanceof Error ? error.message : String(error));
}
