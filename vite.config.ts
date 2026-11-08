import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import { tvCompatPlugin } from './vite-tv-compat';

function streamProxyPlugin() {
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
      const referer = reqUrl.searchParams.get('referer') || '';
      const ua = reqUrl.searchParams.get('ua') || '';

      const headers: Record<string, string> = {};
      if (auth || license) {
        headers['User-Agent'] = 'Ranger/4.9.4-17294ac0';
        headers['App'] = 'com.android.msandroid';
        headers['App-Version'] = '49902';
        headers['X-Buffer'] = '0';
        if (auth) headers['Content-Auth'] = auth;
        if (license) headers['Content-License'] = license;
      } else {
        headers['User-Agent'] = ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
        if (referer) headers['Referer'] = referer;
      }
      if (req.headers.range) headers['Range'] = req.headers.range;

      const fetchWithRedirects = (currentUrl: string, redirectCount = 0) => {
        if (redirectCount > 5) {
          res.statusCode = 502;
          return res.end('Too many redirects');
        }

        const isHttps = currentUrl.startsWith('https:');
        const mod = isHttps ? https : http;

        const targetReq = mod.request(currentUrl, { method: req.method || 'GET', headers }, (targetRes) => {
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
                if (referer) proxyUri += `&referer=${encodeURIComponent(referer)}`;
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

        req.on('close', () => {
          targetReq.destroy();
        });

        targetReq.on('error', (err) => {
          console.error('[StreamProxy] Error fetching:', currentUrl, err.message);
          if (!res.headersSent) {
            res.statusCode = 502;
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
      server.middlewares.use('/stream-proxy', handler);
    },
    configurePreviewServer(server: any) {
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
  plugins: [react(), streamProxyPlugin(), tvCompatPlugin(appVersion)],
  base: './',
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api/portalCore': {
        target: 'https://ftmrmy.jdfey0cd.com',
        changeOrigin: true,
        secure: false,
        headers: {
          'User-Agent': 'okhttp/3.12.12',
          'apk': 'com.android.msandroid',
          'apkVer': '43404',
          'spkgVer': '2024-09-10 06:25:30_33_13_'
        }
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
