/*
 * Edge Gate Pro checker gate
 * MIT License. This Worker contains no third-party GPL source code.
 */
const TEXT = new TextEncoder();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

function noStore404() {
  return new Response("Not Found", { status: 404, headers: { "cache-control": "no-store" } });
}

function hexToBytes(value) {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function validateTarget(target, allowedSuffixes) {
  const match = /^vpn:vpn@([a-z0-9.-]+):(\d{1,5})$/i.exec(target || "");
  if (!match) return "target 格式必须为 vpn:vpn@host:port";
  const host = match[1].toLowerCase().replace(/\.$/, "");
  if (host.length > 253 || host.includes("..") || !host.includes(".")) return "非法主机名";
  if (!host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
    return "非法主机名";
  }
  if (!allowedSuffixes.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix))) {
    return "目标不在允许的 VPN Gate 域名范围内";
  }
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return "非法端口";
  return null;
}

async function verifyHmac(secret, target, timestamp, signature) {
  if (!secret || secret.length < 24) return false;
  const now = Math.floor(Date.now() / 1000);
  const ts = Number(timestamp);
  if (!Number.isSafeInteger(ts) || Math.abs(now - ts) > 300) return false;
  const sigBytes = hexToBytes(signature || "");
  if (!sigBytes) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    TEXT.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  return crypto.subtle.verify("HMAC", key, sigBytes, TEXT.encode(String(ts) + "\n" + target));
}

function sanitizeExit(exit) {
  if (!exit || typeof exit !== "object") return null;
  const asn = exit.asn && typeof exit.asn === "object" ? exit.asn : {};
  const location = exit.location && typeof exit.location === "object" ? exit.location : {};
  return {
    ip: String(exit.ip || "").slice(0, 64),
    country: String(location.country || exit.country || "").slice(0, 128),
    country_code: String(location.country_code || exit.country_code || "").slice(0, 8),
    city: String(location.city || exit.city || "").slice(0, 128),
    continent: String(location.continent || exit.continent || "").slice(0, 64),
    asn: {
      asn: String(asn.asn || "").slice(0, 32),
      org: String(asn.org || asn.name || "").slice(0, 256)
    },
    is_datacenter: typeof exit.is_datacenter === "boolean" ? exit.is_datacenter : null
  };
}

async function handle(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/healthz" && request.method === "GET") {
    return json({ status: "ok", service: "egp-check", configured: Boolean(env.EDGE_HMAC_SECRET) });
  }
  if (url.pathname !== "/check") {
    if (env.PROXY_URL) {
      const upstream = new URL(request.url);
      const base = new URL(env.PROXY_URL);
      upstream.protocol = base.protocol;
      upstream.host = base.host;
      return fetch(new Request(upstream, request));
    }
    if (!env.PROXY || typeof env.PROXY.fetch !== "function") return noStore404();
    return env.PROXY.fetch(request);
  }
  if (request.method !== "GET") return noStore404();

  if (env.RATE_LIMITER) {
    const limited = await env.RATE_LIMITER.limit({ key: request.headers.get("cf-connecting-ip") || "pipeline" });
    if (!limited.success) return json({ success: false, error: "rate limited" }, 429);
  }

  const target = url.searchParams.get("target") || "";
  const timestamp = url.searchParams.get("ts") || "";
  const signature = url.searchParams.get("sig") || "";
  if (!(await verifyHmac(env.EDGE_HMAC_SECRET, target, timestamp, signature))) {
    return json({ success: false, error: "unauthorized" }, 401);
  }

  const suffixes = String(env.ALLOWED_TARGET_SUFFIXES || ".opengw.net,.vpngate.net")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => /^\.[a-z0-9.-]+$/.test(item));
  const validationError = validateTarget(target, suffixes);
  if (validationError) return json({ success: false, error: validationError }, 400);

  if (!env.CHECKER || typeof env.CHECKER.fetch !== "function") {
    return json({ success: false, error: "checker service binding missing" }, 503);
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(5000, Math.min(45000, Number(env.CHECK_TIMEOUT_MS) || 30000));
  const timer = setTimeout(() => controller.abort("checker timeout"), timeoutMs);
  try {
    const upstreamUrl = new URL("https://checker.internal/check");
    upstreamUrl.searchParams.set("sstp", target);
    const response = await env.CHECKER.fetch(new Request(upstreamUrl, { method: "GET", signal: controller.signal }));
    if (!response.ok) {
      return json({ success: false, error: "checker HTTP " + response.status }, response.status === 429 ? 429 : 502);
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      return json({ success: false, error: "checker returned invalid JSON" }, 502);
    }
    const success = payload && payload.success === true;
    return json({
      success,
      responseTime: typeof payload?.responseTime === "number" ? payload.responseTime : null,
      colo: String(payload?.colo || "").slice(0, 32) || null,
      error: success ? null : String(payload?.error || payload?.message || "check failed").slice(0, 256),
      exit: success ? sanitizeExit(payload?.exit) : null
    });
  } catch (error) {
    return json({ success: false, error: error?.name === "AbortError" ? "checker timeout" : "checker request failed" }, 504);
  } finally {
    clearTimeout(timer);
  }
}

export { handle, sanitizeExit, validateTarget, verifyHmac };
export default { fetch: handle };
