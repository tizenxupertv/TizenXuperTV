import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import { URL } from 'url';
import { tvCompatPlugin } from './vite-tv-compat';

const SEC_KEY_HEX = 'd7a09729603a04efbdebfd4dc5ba37f0';
const SEC_ALPHA = 'jWB7YtC3n9iXbEkUcJl1VxF4STpQoOIaRmh2M-efAgLwPqGr6uyD5vNsdH_Kz0Z8';
const SEC_S = 'QD3j1DsI6uZvjWDW38Oz1tLQawD45VOr4KC4K3Sv8hq-Qj';
const SEC_T = 'Hg6zqHL0i4GivJvSwZcOnoBPAMJJoWuMXkqtQRB5Ctb';
const SEC_META_SALT = '213f24ac-14b7-4c03-a209-383ead1b014f';
const RELAY_SALT = 'EcLex_T1z3n_S3cur1ty_#2026_Xup3r';
const DES3_KEY = Buffer.from('e7af1ed7de1ffddd7bd3fe37ebdffde9ef3fe1ae39edfeb8', 'hex');
const STD_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const RELAY_HOST = 'proud-cherry-3cda.eclecticempire02.workers.dev';
const PORTAL_HOSTS = ['neqpsx.6dqtl974.com', 'lvmcmb.6dqtl974.com', 'dqbvvb.wg5h6vjz.com'];

function b64Map(s: string, from: string, to: string, pad = false): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const idx = from.indexOf(s[i]);
    out += idx >= 0 ? to[idx] : s[i];
  }
  if (pad) {
    while (out.length % 4) out += '=';
  } else {
    out = out.replace(/=+$/, '');
  }
  return out;
}

function secWrap(str: string): string {
  const kb = Buffer.from(SEC_KEY_HEX, 'hex');
  const c = crypto.createCipheriv('aes-128-cbc', kb, kb);
  const b64 = Buffer.concat([c.update(String(str), 'utf8'), c.final()]).toString('base64');
  return b64Map(b64, STD_B64, SEC_ALPHA, false);
}

function secUnwrap(str: string): string {
  const b64 = b64Map(String(str).trim(), SEC_ALPHA, STD_B64, true);
  const kb = Buffer.from(SEC_KEY_HEX, 'hex');
  const dc = crypto.createDecipheriv('aes-128-cbc', kb, kb);
  return Buffer.concat([dc.update(Buffer.from(b64, 'base64')), dc.final()]).toString('utf8');
}

function decrypt3desHex(hex: string): string {
  let b64 = '';
  for (let i = 0; i < hex.length; i += 2) {
    b64 += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  }
  const dc = crypto.createDecipheriv('des-ede3', DES3_KEY, null);
  return Buffer.concat([dc.update(Buffer.from(b64, 'base64')), dc.final()]).toString('utf8');
}

function magisPortalRelayPlugin() {
  const handler = async (req: any, res: any) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }

    const endpoint = (req.url || '').replace(/^\/?api\/portalCore\/?/, '').replace(/^\/+/, '').split('?')[0];
    if (!endpoint) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ returnCode: '400', errorMessage: 'Missing endpoint' }));
    }

    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      try {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        let payloadObj: any = {};
        if (rawBody && /^[0-9a-fA-F]+$/.test(rawBody.trim())) {
          try {
            const decrypted = decrypt3desHex(rawBody.trim());
            payloadObj = JSON.parse(decrypted);
          } catch {
            payloadObj = {};
          }
        } else if (rawBody) {
          try {
            payloadObj = JSON.parse(rawBody);
          } catch {
            payloadObj = {};
          }
        }

        const trace = crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
        const meta = crypto.createHash('md5').update(trace + SEC_META_SALT).digest('hex');
        const headersMap: Record<string, string> = {
          apk: 'com.android.msandroid',
          apkVer: '49920',
          spkgVer: '2026-10-21 15:40:39_28_9_4.4.146',
          'Content-type': 'application/json;charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Request-Trace': trace,
          'X-Client-Meta': meta
        };
        const hdrLines = Object.keys(headersMap).map(k => `${k}: ${headersMap[k]}`).join('\r\n') + '\r\n';
        const dVal = secWrap(hdrLines);
        const cookieStr = `d=${dVal}; s=${SEC_S}; t=${SEC_T}`;

        const bodySecWrap = secWrap(JSON.stringify(payloadObj));
        const duid = (payloadObj && payloadObj.sn) || 'tizen-tv-guest';

        // Call the portal directly (Cookie:) instead of via Cloudflare relay (X-Cookie:).
        // The relay uses Cloudflare US IPs which get geo-blocked (portal100024).
        // Our local dev/preview server IP is not blocked.
        const forwardToHost = (hostIdx: number) => {
          if (hostIdx >= PORTAL_HOSTS.length) {
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 502;
            return res.end(JSON.stringify({ returnCode: '502', errorMessage: 'All portal hosts failed' }));
          }

          const host = PORTAL_HOSTS[hostIdx];

          const upstreamReq = https.request({
            hostname: host,
            port: 443,
            path: '/api/portalCore/' + endpoint,
            method: 'POST',
            headers: {
              'Accept': '*/*',
              'Content-Type': 'application/x-www-form-urlencoded',
              'Cookie': cookieStr,
              'apk': 'com.android.msandroid',
              'apkVer': '49920',
              'spkgVer': '2026-10-21 15:40:39_28_9_4.4.146',
              'User-Agent': 'okhttp/3.12.12',
              'Content-Length': Buffer.byteLength(bodySecWrap)
            },
            timeout: 20000
          }, (upstreamRes) => {
            const respChunks: Buffer[] = [];
            upstreamRes.on('data', (c: Buffer) => respChunks.push(c));
            upstreamRes.on('end', () => {
              const respStr = Buffer.concat(respChunks).toString('utf8').trim();
              // Decrypt secUnwrap response (custom-alphabet AES-CBC)
              try {
                const decrypted = secUnwrap(respStr);
                res.setHeader('Content-Type', 'application/json;charset=utf-8');
                res.statusCode = 200;
                // Flatten nested .data object so magis-client reads top-level fields
                try {
                  const parsed = JSON.parse(decrypted);
                  if (parsed && parsed.returnCode === '0' && parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)) {
                    const flat = Object.assign({}, parsed.data, { returnCode: parsed.returnCode, errorMessage: parsed.errorMessage });
                    return res.end(JSON.stringify(flat));
                  }
                } catch { /* fall through */ }
                return res.end(decrypted);
              } catch {
                // Response might already be plain JSON (some endpoints) or truly unreadable
                res.setHeader('Content-Type', 'application/json;charset=utf-8');
                res.statusCode = upstreamRes.statusCode || 200;
                return res.end(respStr);
              }
            });
          });

          upstreamReq.on('timeout', () => {
            upstreamReq.destroy();
            forwardToHost(hostIdx + 1);
          });

          upstreamReq.on('error', () => {
            forwardToHost(hostIdx + 1);
          });

          upstreamReq.write(bodySecWrap);
          upstreamReq.end();
        };

        forwardToHost(0);
      } catch (err: any) {
        console.error('[MagisPortalRelay] Handler error:', endpoint, err.message);
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 500;
        res.end(JSON.stringify({ returnCode: '500', errorMessage: err.message }));
      }
    });
  };

  return {
    name: 'magis-portal-relay-proxy',
    configureServer(server: any) {
      server.middlewares.use('/api/portalCore', handler);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use('/api/portalCore', handler);
    }
  };
}

let cachedEpicToken = '';
function getEpicToken(): Promise<string> {
  if (cachedEpicToken) return Promise.resolve(cachedEpicToken);
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'playlatam.site',
      port: 443,
      path: '/iphone/pulsera',
      method: 'POST',
      headers: { 'Accept': 'application/json' },
      timeout: 5000
    }, (res) => {
      const cookies = res.headers['set-cookie'] || [];
      for (const c of cookies) {
        const m = c.match(/__Host-pulsera=([^;]+)/);
        if (m) {
          cachedEpicToken = m[1];
          setTimeout(() => { cachedEpicToken = ''; }, 12 * 3600 * 1000);
          return resolve(cachedEpicToken);
        }
      }
      resolve('');
    });
    req.on('error', () => resolve(''));
    req.end();
  });
}

function streamProxyPlugin() {
  const epicApiHandler = async (req: any, res: any) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }
    const token = await getEpicToken();
    const targetPath = req.url || '';
    if (targetPath.includes('/iphone/pulsera')) {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, numero: token.split('.')[0], token }));
    }
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
      'Referer': 'https://playlatam.site/',
      'Accept': 'application/json, text/plain, */*'
    };
    if (token) {
      headers['X-Pulsera'] = token;
      headers['Cookie'] = `__Host-pulsera=${token}`;
    }
    const upstreamReq = https.request({
      hostname: 'playlatam.site',
      port: 443,
      path: targetPath,
      method: req.method || 'GET',
      headers,
      timeout: 10000
    }, (upstreamRes) => {
      res.statusCode = upstreamRes.statusCode || 200;
      for (const [k, v] of Object.entries(upstreamRes.headers)) {
        if (k.toLowerCase() !== 'content-security-policy') {
          if (v) res.setHeader(k, v);
        }
      }
      res.setHeader('Access-Control-Allow-Origin', '*');
      upstreamRes.pipe(res);
    });
    upstreamReq.on('error', (err) => {
      res.statusCode = 502;
      res.end(err.message);
    });
    req.pipe(upstreamReq);
  };

  const handler = async (req: any, res: any) => {
    // Handle CORS Preflight
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }

    try {
      const reqUrl = new URL(req.url, 'http://localhost');
      const targetUrl = reqUrl.searchParams.get('url');
      if (!targetUrl) {
        res.statusCode = 400;
        return res.end('Missing url param');
      }

      const auth = reqUrl.searchParams.get('auth') || '';
      const license = reqUrl.searchParams.get('license') || '';
      const pulsera = reqUrl.searchParams.get('pulsera') || '';
      const referer = reqUrl.searchParams.get('referer') || '';
      const ua = reqUrl.searchParams.get('ua') || '';

      const isEpic = !!pulsera || targetUrl.includes('epictvparaiphone.top') || targetUrl.includes('playlatam.site') || targetUrl.includes('tiktokcdn');
      let resolvedPulsera = pulsera;
      if (isEpic && !resolvedPulsera) {
        resolvedPulsera = await getEpicToken();
      }

      const headers: Record<string, string> = {};
      if (auth || license) {
        headers['User-Agent'] = 'Ranger/4.9.4-17294ac0';
        headers['App'] = 'com.android.msandroid';
        headers['App-Version'] = '49902';
        headers['X-Buffer'] = '0';
        if (auth) headers['Content-Auth'] = auth;
        if (license) headers['Content-License'] = license;
      } else if (isEpic) {
        headers['User-Agent'] = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)';
        headers['Referer'] = 'https://epictvparaiphone.top/';
        if (resolvedPulsera) headers['X-Pulsera'] = resolvedPulsera;
      } else {
        headers['User-Agent'] = ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
        if (referer) {
          headers['Referer'] = referer;
          try {
            headers['Origin'] = new URL(referer).origin;
          } catch {
            // ignore malformed referer url
          }
        } else if (targetUrl.includes('wedd48c') || targetUrl.includes('daddylive') || targetUrl.includes('premium')) {
          headers['Referer'] = 'https://daddylive.sx/';
          headers['Origin'] = 'https://daddylive.sx';
        }
      }
      if (req.headers.range) headers['Range'] = req.headers.range;

      const fetchWithRedirects = (currentUrl: string, redirectCount = 0) => {
        if (redirectCount > 5) {
          res.statusCode = 502;
          return res.end('Too many redirects');
        }

        const isHttps = currentUrl.startsWith('https:');
        const mod = isHttps ? https : http;

        const targetReq = mod.request(currentUrl, { method: req.method || 'GET', headers, timeout: 10000 }, (targetRes) => {
          const status = targetRes.statusCode || 200;

          // Follow redirects automatically
          if ([301, 302, 303, 307, 308].includes(status) && targetRes.headers.location) {
            const nextUrl = new URL(targetRes.headers.location, currentUrl).toString();
            targetRes.resume();
            return fetchWithRedirects(nextUrl, redirectCount + 1);
          }

          const contentType = targetRes.headers['content-type'] || '';
          const isM3u8 = currentUrl.includes('.m3u8') || contentType.includes('mpegurl');

          if (isM3u8 && status === 200 && req.method !== 'HEAD') {
            const chunks: Buffer[] = [];
            targetRes.on('data', (c) => chunks.push(c));
            targetRes.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf8');
              const lines = text.split('\n');
              const rewritten = lines.map((line) => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) return line;
                const absoluteUrl = new URL(trimmed, currentUrl).toString();
                let proxyUri = `/stream-proxy?url=${encodeURIComponent(absoluteUrl)}`;
                if (auth) proxyUri += `&auth=${encodeURIComponent(auth)}`;
                if (license) proxyUri += `&license=${encodeURIComponent(license)}`;
                if (resolvedPulsera) proxyUri += `&pulsera=${encodeURIComponent(resolvedPulsera)}`;
                if (referer) proxyUri += `&referer=${encodeURIComponent(referer)}`;
                if (ua) proxyUri += `&ua=${encodeURIComponent(ua)}`;
                return proxyUri;
              }).join('\n');

              res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
              res.setHeader('Content-Length', Buffer.byteLength(rewritten));
              res.statusCode = 200;
              res.end(rewritten);
            });
          } else {
            res.statusCode = status;
            if (contentType) res.setHeader('Content-Type', contentType);
            if (targetRes.headers['content-length']) res.setHeader('Content-Length', targetRes.headers['content-length']);
            if (targetRes.headers['content-range']) res.setHeader('Content-Range', targetRes.headers['content-range']);
            if (targetRes.headers['accept-ranges']) res.setHeader('Accept-Ranges', targetRes.headers['accept-ranges']);
            targetRes.pipe(res);
          }
        });

        targetReq.on('timeout', () => {
          targetReq.destroy(new Error('Gateway Timeout (10s)'));
        });

        req.on('close', () => {
          targetReq.destroy();
        });

        targetReq.on('error', (err) => {
          console.error('[StreamProxy] Error fetching:', currentUrl, err.message);
          if (!res.headersSent) {
            res.statusCode = err.message.includes('Timeout') ? 504 : 502;
            res.end(err.message);
          }
        });

        targetReq.end();
      };

      fetchWithRedirects(targetUrl);
    } catch (err: any) {
      console.error('[StreamProxy] Request error:', err);
      res.statusCode = 500;
      res.end(err.message);
    }
  };

  return {
    name: 'magis-stream-proxy',
    configureServer(server: any) {
      server.middlewares.use('/epic-api', epicApiHandler);
      server.middlewares.use('/stream-proxy', handler);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use('/epic-api', epicApiHandler);
      server.middlewares.use('/stream-proxy', handler);
    }
  };
}

// https://vitejs.dev/config/
// App version from the Tizen widget manifest (shown in the TV diagnostic logs)
// XUPER_APP_VERSION overrides it for self-update test builds only (never for releases)
const appVersion = process.env.XUPER_APP_VERSION ||
  (fs.readFileSync(path.resolve(__dirname, 'public/config.xml'), 'utf8').match(/<widget[^>]*\sversion="([^"]+)"/) || [])[1] || 'dev';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    // Self-update server for test builds only (tools/update-serve.mjs); releases use the bot Worker
    __UPDATE_API__: JSON.stringify(process.env.XUPER_UPDATE_API || '')
  },
  plugins: [react(), streamProxyPlugin(), magisPortalRelayPlugin(), tvCompatPlugin(appVersion)],
  base: './',
  server: {
    port: 5174,
    strictPort: true,
    host: true,
    proxy: {
      // Sports channel list: same-origin in the browser, see epicSportsService.ts
      '/epic-api': {
        target: 'https://playlatam.site',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/epic-api/, '')
      }
    }
  },
  preview: {
    port: 5199,
    host: true,
    proxy: {
      '/epic-api': {
        target: 'https://playlatam.site',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/epic-api/, '')
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Tizen 4.0 (2018 TVs) ships Chromium 56: lower JS syntax so older models parse the bundle
    target: 'chrome56',
    cssTarget: 'chrome56',
    // Keep a real stylesheet (iife output would otherwise inject CSS from JS)
    cssCodeSplit: false,
    rollupOptions: {
      // Classic script instead of an ES module: Chromium < 61 cannot run type="module"
      output: { format: 'iife' }
    },
    assetsDir: 'assets',
    sourcemap: false
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
