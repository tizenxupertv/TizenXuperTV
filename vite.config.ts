import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import http from 'http';
import https from 'https';
import zlib from 'zlib';
import { URL } from 'url';
import { tvCompatPlugin } from './vite-tv-compat';

let cachedEpicToken = '9d7f743c.gente.1794262627.6c0ed20caa00f079c6628210b1cc8de81e503acf58ab77bc8bcfb536836b75f3';
function getEpicToken(): Promise<string> {
  if (cachedEpicToken) return Promise.resolve(cachedEpicToken);
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'epictvparaiphone.top',
      port: 443,
      path: '/iphone/pulsera',
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
        'Referer': 'https://epictvparaiphone.top/iphone/',
        'Origin': 'https://epictvparaiphone.top',
        'X-Pulsera': '1'
      },
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
      resolve('01b53ec6.gente.1794262791.5db6ac9d1f51d4d84252ca9939f9e0beaa86a0e399ca3f1dabba6b2c2672ea4c');
    });
    req.on('error', () => resolve('01b53ec6.gente.1794262791.5db6ac9d1f51d4d84252ca9939f9e0beaa86a0e399ca3f1dabba6b2c2672ea4c'));
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
      'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 13; SM-S918B Build/TP1A.220624.014)',
      'X-Llave': '7hA4oMy1vmGSFJjbrAWx-xneFQEY_PAq',
      'X-Aparato': 'a1b2c3d4',
      'X-Pulsera': '1',
      'Accept': 'application/json, text/plain, */*'
    };
    const upstreamReq = https.request({
      hostname: 'epictvparaiphone.top',
      port: 443,
      path: targetPath,
      method: req.method || 'GET',
      headers,
      timeout: 10000
    }, (upstreamRes) => {
      res.statusCode = upstreamRes.statusCode || 200;
      for (const [k, v] of Object.entries(upstreamRes.headers)) {
        const lower = k.toLowerCase();
        if (lower !== 'content-security-policy' && lower !== 'www-authenticate') {
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
        headers['App-Version'] = '49920';
        headers['X-Buffer'] = '0';
        if (auth) headers['Content-Auth'] = auth;
        if (license) headers['Content-License'] = license;
      } else if (isEpic) {
        headers['User-Agent'] = 'Dalvik/2.1.0 (Linux; U; Android 13; SM-S918B Build/TP1A.220624.014)';
        headers['X-Llave'] = '7hA4oMy1vmGSFJjbrAWx-xneFQEY_PAq';
        headers['X-Aparato'] = 'a1b2c3d4';
        headers['X-Pulsera'] = '1';
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
        } else if (targetUrl.includes('teveo.cu')) {
          headers['Referer'] = 'https://teveo.cu/';
          headers['Origin'] = 'https://teveo.cu';
          headers['User-Agent'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
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
              let rawBuf = Buffer.concat(chunks);
              const contentEncoding = String(targetRes.headers['content-encoding'] || '').toLowerCase();
              if (contentEncoding.includes('gzip') || (rawBuf.length >= 2 && rawBuf[0] === 0x1f && rawBuf[1] === 0x8b)) {
                try {
                  rawBuf = zlib.gunzipSync(rawBuf);
                } catch {
                  // Keep raw buffer if decompression fails
                }
              }
              const text = rawBuf.toString('utf8');
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
            if (targetRes.headers['content-encoding']) res.setHeader('Content-Encoding', targetRes.headers['content-encoding']);
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

  const DIRECT_43404_HOSTS = new Set([
    'fuxok.nguvmqhpk.com',
    'ftmrmy.jdfey0cd.com',
    'mptec.dhkrxuzcy.com',
    'eajmnp.hcgv1dt8.com'
  ]);

  const direct43404Handler = (req: any, res: any) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }
    const cleanUrl = String(req.url || '').replace(/^\/+/, '');
    const slashIdx = cleanUrl.indexOf('/');
    const targetHost = slashIdx > 0 ? cleanUrl.slice(0, slashIdx) : '';
    const portalPath = slashIdx > 0 ? cleanUrl.slice(slashIdx + 1) : '';
    if (!DIRECT_43404_HOSTS.has(targetHost) || !portalPath) {
      res.statusCode = 400;
      return res.end('Invalid direct-43404 target');
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json;charset=utf-8',
      'apk': String(req.headers['apk'] || 'com.android.msandroid'),
      'apkVer': String(req.headers['apkver'] || '43404'),
      'spkgVer': String(req.headers['spkgver'] || '2024-09-10 06:25:30_33_13_'),
      'User-Agent': 'okhttp/3.12.12'
    };
    const upstreamReq = https.request({
      hostname: targetHost,
      port: 443,
      path: '/api/portalCore/' + portalPath,
      method: 'POST',
      headers,
      timeout: 15000
    }, (upstreamRes) => {
      res.statusCode = upstreamRes.statusCode || 200;
      res.setHeader('Content-Type', String(upstreamRes.headers['content-type'] || 'application/json'));
      res.setHeader('Access-Control-Allow-Origin', '*');
      upstreamRes.pipe(res);
    });
    upstreamReq.on('error', (err) => {
      res.statusCode = 502;
      res.end(err.message);
    });
    req.pipe(upstreamReq);
  };

  return {
    name: 'magis-stream-proxy',
    configureServer(server: any) {
      server.middlewares.use('/epic-api', epicApiHandler);
      server.middlewares.use('/stream-proxy', handler);
      server.middlewares.use('/direct-43404', direct43404Handler);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use('/epic-api', epicApiHandler);
      server.middlewares.use('/stream-proxy', handler);
      server.middlewares.use('/direct-43404', direct43404Handler);
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
  plugins: [react(), streamProxyPlugin(), tvCompatPlugin(appVersion)],
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
      },
      '/api/portalCore': {
        target: 'https://tizenxuper-relay.tizenxupertv.workers.dev',
        changeOrigin: true,
        secure: true
      }
    }
  },
  preview: {
    port: 5199,
    host: true,
    proxy: {
      '/epic-api': {
        target: 'https://epictvparaiphone.top',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/epic-api/, '')
      },
      '/api/portalCore': {
        target: 'https://tizenxuper-relay.tizenxupertv.workers.dev',
        changeOrigin: true,
        secure: true
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
