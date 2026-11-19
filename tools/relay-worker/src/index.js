/**
 * TizenXuper TV - Secure Cloudflare Relay
 * Dedicated to: info.tizenxupertv@gmail.com (tizenxupertv.workers.dev)
 */

import { SESSION_POOL } from "./sessionPool.js";

const SHARED_SECRET = "T1z3nXup3r_S3cur1ty_#2026_T1z3nTV_P0rt4l";
const ALLOWED_HOSTS = new Set([
  "neqpsx.6dqtl974.com",
  "lvmcmb.6dqtl974.com",
  "dqbvvb.wg5h6vjz.com",
  "eajmnp.hcgv1dt8.com",
]);

// Old single shared sessions that caused 409/403 conflicts when multiple TVs played Live TV concurrently.
// Any TV still presenting these SNs is instructed (via aaa100028) to transparently rotate to its own pooled session.
const POISONED_SHARED_SNS = new Set([
  "a28ecfe517d35868a67ab41905f212e3",
  "509cb291ef75b6d8fc5bfaa5d410985c",
]);

function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

const fallbackRotateMap = new Map();

function pickPooledSession(clientIp, userAgent, reqDuid) {
  const cleanDuid = String(reqDuid || "").toLowerCase();
  const hasUniqueDuid =
    cleanDuid &&
    cleanDuid !== "tizen-guest" &&
    cleanDuid !== "tizen-tv-guest" &&
    !POISONED_SHARED_SNS.has(cleanDuid);
  const clientKey = `${clientIp}|${String(userAgent || "").slice(0, 80)}`;
  const now = Date.now();
  let rot = fallbackRotateMap.get(clientKey);
  if (!rot || now - rot.ts > 600000) {
    rot = { count: 0, lastDuid: cleanDuid, ts: now };
    fallbackRotateMap.set(clientKey, rot);
    if (fallbackRotateMap.size > 4000) {
      for (const [k, v] of fallbackRotateMap.entries()) {
        if (now - v.ts > 600000) fallbackRotateMap.delete(k);
      }
    }
  } else {
    rot.ts = now;
    if (cleanDuid !== rot.lastDuid) {
      rot.count++;
      rot.lastDuid = cleanDuid;
    }
  }
  const seed = hasUniqueDuid ? `${clientKey}|${cleanDuid}` : clientKey;
  const idx = (hashString(seed) + rot.count) % SESSION_POOL.length;
  return SESSION_POOL[idx];
}

// In-memory sliding rate limiter per worker isolate
const ipRateMap = new Map();
const MAX_REQ_PER_MINUTE = 240;

function isRateLimited(ip) {
  const now = Date.now();
  let record = ipRateMap.get(ip);
  if (!record || now - record.resetTime > 60000) {
    record = { count: 1, resetTime: now };
    ipRateMap.set(ip, record);
    // Cleanup old records
    if (ipRateMap.size > 2000) {
      for (const [k, v] of ipRateMap.entries()) {
        if (now - v.resetTime > 60000) ipRateMap.delete(k);
      }
    }
    return false;
  }
  record.count++;
  return record.count > MAX_REQ_PER_MINUTE;
}

async function hmacSha256(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

const CATALOG_BROWSE_RE = /\/(getColumnContents|getShelveData|getRecommends|filterByContent|filterGenre|getHome|getShortVideo)$/i;
const CACHEABLE_PATH_RE = /\/(getColumnContents|getShelveData|getRecommends|filterByContent|filterGenre|getProgramDetail|getLiveData)$/i;
const CACHE_TTL_SECONDS = 1800;

function normalizeRelayMode(env) {
  const mode = String((env && env.RELAY_MODE) || "full").trim().toLowerCase();
  return mode === "off" || mode === "play-only" ? mode : "full";
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const clientIp = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
    const relayMode = normalizeRelayMode(env);

    // 1. CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Expose-Headers": "X-Server-Time, X-Relay-Mode, X-Relay-Cache",
      "X-Server-Time": String(Date.now()),
      "X-Relay-Mode": relayMode,
    };

    // 2. Rate Limiting Check (Anti-Abuse / Anti-Scraping)
    if (isRateLimited(clientIp)) {
      return new Response(
        JSON.stringify({ error: "Too Many Requests", code: 429 }),
        { status: 429, headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders) }
      );
    }

    // 3. /time endpoint for TV clock sync (open for legitimate time checks)
    if (url.pathname === "/time") {
      return new Response(JSON.stringify({ ok: true, serverTime: Date.now(), relayMode }), {
        status: 200,
        headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders),
      });
    }

    // 4. Validate HMAC Signature & Time Window (Prevents unauthorized scrapers & replay attacks)
    const reqTime = request.headers.get("X-Tizen-Time") || request.headers.get("X-Eclex-Time");
    const reqSig = request.headers.get("X-Tizen-Sig") || request.headers.get("X-Eclex-Sig");
    const reqDuid = request.headers.get("X-Tizen-Duid") || request.headers.get("X-Eclex-Duid") || "tizen-guest";

    if (!reqTime || !reqSig) {
      return new Response(
        JSON.stringify({ error: "Unauthorized access", code: 401 }),
        { status: 401, headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders) }
      );
    }

    const now = Date.now();
    const reqTs = Number(reqTime);
    // Allow maximum 4 minutes clock drift
    if (!isFinite(reqTs) || Math.abs(now - reqTs) > 240000) {
      return new Response(
        JSON.stringify({ error: "Signature expired or clock skewed", code: 403 }),
        { status: 403, headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders) }
      );
    }

    // Verify cryptographic signature
    const targetHost = request.headers.get("X-Target-Host") || "neqpsx.6dqtl974.com";
    
    // Support modern HMAC-SHA256 and compatible MD5 signature
    const hmacExpected = await hmacSha256(SHARED_SECRET, `${reqTime}:${targetHost}:${reqDuid}`);
    
    // Also compute MD5 fallback for seamless compatibility with X-Eclectic style
    const md5Raw = `eclex:${reqTime}:${targetHost}:${reqDuid}:${SHARED_SECRET}`;
    const md5Buf = await crypto.subtle.digest("MD5", new TextEncoder().encode(md5Raw));
    const md5Expected = Array.from(new Uint8Array(md5Buf)).map(b => b.toString(16).padStart(2, "0")).join("");

    if (reqSig !== hmacExpected && reqSig !== md5Expected) {
      return new Response(
        JSON.stringify({ error: "Invalid signature", code: 403 }),
        { status: 403, headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders) }
      );
    }

    // 4b. Cost-control kill switch & play-only mode
    if (relayMode === "off") {
      return new Response(
        JSON.stringify({ error: "Relay disabled", code: 503, relayMode: "off" }),
        { status: 503, headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders) }
      );
    }

    if (relayMode === "play-only" && CATALOG_BROWSE_RE.test(url.pathname)) {
      return new Response(
        JSON.stringify({ error: "Relay in play-only mode", code: 503, relayMode: "play-only" }),
        { status: 503, headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders) }
      );
    }

    // 5. /session/fallback endpoint (authenticated)
    if (url.pathname === "/session/fallback") {
      const chosen = pickPooledSession(clientIp, request.headers.get("User-Agent"), reqDuid);
      const fallbackSession = {
        ok: true,
        poolSize: SESSION_POOL.length,
        session: {
          sn: chosen.sn,
          snToken: chosen.snToken,
          userId: chosen.userId,
          userToken: chosen.userToken,
          ts: Date.now(),
        },
      };
      return new Response(JSON.stringify(fallbackSession), {
        status: 200,
        headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders),
      });
    }

    // 5b. Force immediate transparent migration for existing v1.19.5/v1.19.6 TVs still caching the old single shared SNs
    if (
      POISONED_SHARED_SNS.has(String(reqDuid || "").toLowerCase()) &&
      !(/\/(snToken|active)$/i.test(url.pathname))
    ) {
      return new Response(
        JSON.stringify({ returnCode: "aaa100028", errorMessage: "session expired" }),
        { status: 200, headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders) }
      );
    }

    // 6. Security Check: Only allow whitelisted Magis target hosts (Prevents Open Proxy abuse)
    if (!ALLOWED_HOSTS.has(targetHost)) {
      return new Response(
        JSON.stringify({ error: "Target host not permitted", code: 400 }),
        { status: 400, headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders) }
      );
    }

    // 6b. Cloudflare Edge Cache (caches.default) for shared read-only catalog/detail paths
    const isCacheable = CACHEABLE_PATH_RE.test(url.pathname);
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const bodyBytes = (isCacheable && hasBody) ? await request.arrayBuffer() : null;
    let cacheKey = null;

    if (isCacheable && typeof caches !== "undefined" && caches.default) {
      const bodyStr = bodyBytes ? new TextDecoder().decode(bodyBytes) : "";
      const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${url.pathname}:${bodyStr}`));
      const bodyHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
      cacheKey = new Request(`https://tizenxuper-relay.internal/edge-cache-v2${url.pathname}/${bodyHash}`, { method: "GET" });

      const cached = await caches.default.match(cacheKey);
      if (cached) {
        const hitHeaders = new Headers(cached.headers);
        Object.entries(corsHeaders).forEach(([k, v]) => hitHeaders.set(k, v));
        hitHeaders.set("X-Relay-Cache", "HIT");
        return new Response(cached.body, {
          status: cached.status,
          statusText: cached.statusText,
          headers: hitHeaders,
        });
      }
    }

    // 7. Forward request to Magis Portal
    const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;

    const outgoingHeaders = new Headers();
    for (const [key, value] of request.headers.entries()) {
      const lower = key.toLowerCase();
      if (
        lower === "host" ||
        lower === "content-length" ||
        lower === "origin" ||
        lower === "referer" ||
        lower === "user-agent" ||
        lower === "x-target-host" ||
        lower === "cf-connecting-ip" ||
        lower === "cf-ipcountry" ||
        lower === "cf-ray" ||
        lower === "cf-visitor" ||
        lower === "x-forwarded-for" ||
        lower === "x-forwarded-proto" ||
        lower === "x-real-ip" ||
        lower.startsWith("sec-") ||
        lower.startsWith("x-tizen-") ||
        lower.startsWith("x-eclex-")
      ) {
        continue;
      }
      outgoingHeaders.set(key, value);
    }

    // Transform X-Cookie -> Cookie
    const xCookie = request.headers.get("X-Cookie") || request.headers.get("x-cookie");
    if (xCookie) {
      outgoingHeaders.set("Cookie", xCookie);
      outgoingHeaders.delete("X-Cookie");
      outgoingHeaders.delete("x-cookie");
    }

    outgoingHeaders.set("Host", targetHost);
    outgoingHeaders.set("User-Agent", "okhttp/3.12.13");

    const init = {
      method: request.method,
      headers: outgoingHeaders,
      redirect: "follow",
    };

    if (hasBody) {
      init.body = bodyBytes !== null ? bodyBytes : request.body;
    }

    try {
      const upstreamRes = await fetch(targetUrl, init);
      const resHeaders = new Headers(upstreamRes.headers);
      Object.entries(corsHeaders).forEach(([k, v]) => resHeaders.set(k, v));

      if (cacheKey && upstreamRes.status === 200) {
        const respText = await upstreamRes.text();
        resHeaders.set("X-Relay-Cache", "MISS");
        if (respText.length > 350 && ctx && typeof ctx.waitUntil === "function") {
          const cacheHeaders = new Headers();
          cacheHeaders.set("Content-Type", resHeaders.get("Content-Type") || "text/plain; charset=utf-8");
          cacheHeaders.set("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`);
          ctx.waitUntil(caches.default.put(cacheKey, new Response(respText, { status: 200, headers: cacheHeaders })));
        }
        return new Response(respText, {
          status: 200,
          statusText: upstreamRes.statusText,
          headers: resHeaders,
        });
      }

      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        statusText: upstreamRes.statusText,
        headers: resHeaders,
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err && err.message || err) }), {
        status: 502,
        headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders),
      });
    }
  },
};
