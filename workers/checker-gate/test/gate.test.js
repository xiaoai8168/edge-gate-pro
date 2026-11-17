import test from "node:test";
import assert from "node:assert/strict";
import worker, { sanitizeExit, validateTarget, verifyHmac } from "../src/index.js";

const SUFFIXES = [".opengw.net", ".vpngate.net"];

test("target validation rejects private, non-VPN, and invalid ports", () => {
  assert.equal(validateTarget("vpn:vpn@public-vpn-1.opengw.net:443", SUFFIXES), null);
  assert.match(validateTarget("vpn:vpn@127.0.0.1:443", SUFFIXES), /允许/);
  assert.match(validateTarget("vpn:vpn@localhost:443", SUFFIXES), /格式|主机/);
  assert.match(validateTarget("vpn:vpn@public-vpn-1.opengw.net:70000", SUFFIXES), /格式|端口/);
  assert.match(validateTarget("admin:admin@public-vpn-1.opengw.net:443", SUFFIXES), /格式/);
});

test("HMAC verifies only the signed target and fresh timestamp", async () => {
  const secret = "a".repeat(32);
  const target = "vpn:vpn@public-vpn-1.opengw.net:443";
  const ts = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ts + "\n" + target)))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  assert.equal(await verifyHmac(secret, target, ts, sig), true);
  assert.equal(await verifyHmac(secret, target + "x", ts, sig), false);
  assert.equal(await verifyHmac(secret, target, String(Number(ts) - 301), sig), false);
});

test("health endpoint never invokes the private checker", async () => {
  const response = await worker.fetch(new Request("https://check.example/healthz"), { EDGE_HMAC_SECRET: "a".repeat(32) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", service: "egp-check", configured: true });
});

test("unsigned requests are rejected before the service binding", async () => {
  const response = await worker.fetch(new Request("https://check.example/check?target=x"), { EDGE_HMAC_SECRET: "a".repeat(32) });
  assert.equal(response.status, 401);
});

test("CheckSocks5 nested location maps to normalized exit metadata", () => {
  const exit = sanitizeExit({
    ip: "203.0.113.10",
    is_datacenter: false,
    asn: { asn: 64500, org: "Example Network" },
    location: { country: "Japan", country_code: "JP", city: "Tokyo" }
  });
  assert.equal(exit.country, "Japan");
  assert.equal(exit.country_code, "JP");
  assert.equal(exit.city, "Tokyo");
  assert.equal(exit.asn.org, "Example Network");
});
