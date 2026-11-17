#!/usr/bin/env node
/*
 * Edge Gate Pro - create/push the MIT repository and configure Actions secrets.
 * Requires GH_TOKEN or GITHUB_TOKEN with repository Administration, Contents and Actions permissions.
 */
import fs from "node:fs";
import path from "node:path";
import { sealGitHubSecret } from "./lib/github-secrets.mjs";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const STATE_PATH = path.join(ROOT, ".secrets", "deployment.json");
const GITHUB_STATE = path.join(ROOT, ".secrets", "github.json");
const owner = process.env.GITHUB_OWNER || "xiaoai8168";
const repo = process.env.GITHUB_REPO || "edge-gate-pro";
const isPrivate = String(process.env.GITHUB_PRIVATE || "false").toLowerCase() === "true";
let token = String(process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "").trim();
if (!token) {
  const ghCandidates = [
    path.join(process.env.ProgramFiles || "C:\\Program Files", "GitHub CLI", "gh.exe"),
    "gh"
  ];
  for (const gh of ghCandidates) {
    const result = spawnSync(gh, ["auth", "token"], { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] });
    if (result.status === 0 && result.stdout.trim()) { token = result.stdout.trim(); break; }
  }
}
if (!token) die("缺少 GH_TOKEN 或 GITHUB_TOKEN，且未检测到 gh 登录态");
if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) die("GitHub owner/repo 格式错误");

const deployment = readJson(STATE_PATH);
if (!deployment?.hmacSecret || !deployment?.checkerHost) {
  die("缺少 .secrets/deployment.json，请先运行 scripts/deploy-cloudflare.mjs");
}

function die(message) { console.error("ERROR: " + message); process.exit(1); }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
}
function redact(value) { return String(value).replaceAll(token, "***").replace(/https:\/\/[^@\s]+@github\.com/g, "https://***@github.com"); }
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    encoding: "utf8",
    input: options.input,
    timeout: options.timeout || 180000,
    stdio: ["pipe", "pipe", "pipe"]
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFail) {
    throw new Error(redact([command, ...args].join(" ") + "\n" + (result.stdout || "") + (result.stderr || "")));
  }
  return { status: result.status, output: redact((result.stdout || "") + (result.stderr || "")) };
}
async function api(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "edge-gate-pro-deployer",
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    throw new Error("GitHub API " + response.status + " " + url + "\n" + JSON.stringify(body));
  }
  return body;
}
async function setSecret(name, value) {
  const publicKey = await api("https://api.github.com/repos/" + owner + "/" + repo + "/actions/secrets/public-key");
  const encrypted = sealGitHubSecret(value, publicKey.key);
  await api("https://api.github.com/repos/" + owner + "/" + repo + "/actions/secrets/" + encodeURIComponent(name), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ encrypted_value: Buffer.from(encrypted).toString("base64"), key_id: publicKey.key_id })
  });
  console.log("[secret] " + name + " updated");
}

try {
  console.log("[github] checking repository " + owner + "/" + repo);
  let repoInfo = null;
  try {
    repoInfo = await api("https://api.github.com/repos/" + owner + "/" + repo);
  } catch (error) {
    if (!String(error.message).includes("GitHub API 404")) throw error;
  }
  if (!repoInfo) {
    repoInfo = await api("https://api.github.com/user/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: repo,
        private: isPrivate,
        has_issues: true,
        has_projects: false,
        has_wiki: false,
        auto_init: false
      })
    });
    console.log("[github] repository created");
  }

  run("git", ["add", "-A"]);
  const diff = run("git", ["diff", "--cached", "--quiet"], { allowFail: true });
  if (diff.status !== 0) {
    run("git", ["-c", "user.name=Edge Gate Pro", "-c", "user.email=edge-gate-pro@users.noreply.github.com", "commit", "-m", "Release Edge Gate Pro 0.2.0"]);
  }
  run("git", ["branch", "-M", "main"]);
  const pushUrl = "https://x-access-token:" + token + "@github.com/" + owner + "/" + repo + ".git";
  run("git", ["push", "-u", pushUrl, "HEAD:main"], { timeout: 240000 });
  run("git", ["remote", "remove", "origin"], { allowFail: true });
  run("git", ["remote", "add", "origin", "https://github.com/" + owner + "/" + repo + ".git"]);
  console.log("[github] main branch pushed");

  await setSecret("DOMAIN", deployment.checkerHost);
  await setSecret("CHECK_HMAC_SECRET", deployment.hmacSecret);
  await api("https://api.github.com/repos/" + owner + "/" + repo + "/actions/workflows/check.yml/dispatches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "main" })
  });

  writeJson(GITHUB_STATE, {
    repository: owner + "/" + repo,
    htmlUrl: repoInfo.html_url,
    actionsUrl: repoInfo.html_url + "/actions",
    pagesUrl: "https://" + owner + ".github.io/" + repo + "/",
    nodesUrl: "https://" + owner + ".github.io/" + repo + "/nodes.txt",
    publishedAt: new Date().toISOString()
  });
  console.log(JSON.stringify({
    ok: true,
    repository: owner + "/" + repo,
    actions: repoInfo.html_url + "/actions",
    dashboard: "https://" + owner + ".github.io/" + repo + "/",
    subscription: "https://" + owner + ".github.io/" + repo + "/nodes.txt"
  }, null, 2));
} catch (error) {
  die(error instanceof Error ? error.message : String(error));
}
