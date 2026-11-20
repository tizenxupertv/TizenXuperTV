const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const DIRECT_43404_HOSTS = new Set([
  'fuxok.nguvmqhpk.com',
  'ftmrmy.jdfey0cd.com',
  'mptec.dhkrxuzcy.com',
  'eajmnp.hcgv1dt8.com',
  'hinumz.a878kkoyc.com',
  'krdwvd.swcaw7qx.com',
  'osuhk.m3x8o50te.com',
  'oogoy.f30c96w8.com',
  'neqpsx.6dqtl974.com',
  'lvmcmb.6dqtl974.com',
  'dqbvvb.wg5h6vjz.com'
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.xml': 'application/xml'
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(Buffer.alloc(0)));
  });
}

async function handleDirect43404(req, res, subPath) {
  const slash = subPath.indexOf('/');
  const host = slash > 0 ? subPath.slice(0, slash) : '';
  const apiPath = slash > 0 ? subPath.slice(slash + 1) : '';
  if (!DIRECT_43404_HOSTS.has(host) || !apiPath) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('Invalid direct-43404 target');
  }
  const body = await readBody(req);
  try {
    const upHeaders = {
      'Content-Type': 'application/json;charset=utf-8',
      'User-Agent': 'okhttp/3.12.13'
    };
    if (req.headers['x-magis-cookie']) {
      upHeaders['Cookie'] = String(req.headers['x-magis-cookie']);
    } else {
      upHeaders['apk'] = String(req.headers['apk'] || 'com.android.msandroid');
      upHeaders['apkVer'] = String(req.headers['apkver'] || '49920');
      upHeaders['spkgVer'] = String(req.headers['spkgver'] || '2022-06-22 10:06:33_33_13_5.15.137-00001-gfdae1bb0ce90');
      if (req.headers['x-request-trace']) upHeaders['X-Request-Trace'] = String(req.headers['x-request-trace']);
      if (req.headers['x-client-meta']) upHeaders['X-Client-Meta'] = String(req.headers['x-client-meta']);
    }

    const up = await fetch(`https://${host}/api/portalCore/${apiPath}`, {
      method: 'POST',
      headers: upHeaders,
      body
    });
    const text = await up.text();
    res.writeHead(up.status, {
      'Content-Type': up.headers.get('content-type') || 'application/json;charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(text);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
}

async function handleEpicApi(req, res, subPath) {
  const target = `https://epictvparaiphone.top/${subPath}`;
  const body = req.method === 'POST' ? await readBody(req) : undefined;
  try {
    const up = await fetch(target, {
      method: req.method || 'GET',
      headers: {
        'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 13; SM-S918B Build/TP1A.220624.014)',
        'X-Llave': String(req.headers['x-llave'] || '7hA4oMy1vmGSFJjbrAWx-xneFQEY_PAq'),
        'X-Aparato': String(req.headers['x-aparato'] || 'a1b2c3d4'),
        'X-Pulsera': String(req.headers['x-pulsera'] || '1'),
        'Accept': 'application/json, text/plain, */*'
      },
      body
    });
    const buf = Buffer.from(await up.arrayBuffer());
    res.writeHead(up.status, {
      'Content-Type': up.headers.get('content-type') || 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(buf);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Epic API error: ' + String(err));
  }
}

async function handleStreamProxy(req, res, urlObj) {
  const targetUrl = urlObj.searchParams.get('url');
  if (!targetUrl) {
    res.writeHead(400);
    return res.end('Missing url');
  }
  const pulsera = urlObj.searchParams.get('pulsera') || '';
  const referer = urlObj.searchParams.get('referer') || '';
  const ua = urlObj.searchParams.get('ua') || '';
  const auth = urlObj.searchParams.get('auth') || '';
  const license = urlObj.searchParams.get('license') || '';
  const isEpic = !!pulsera || targetUrl.includes('epictvparaiphone.top') || targetUrl.includes('playlatam.site');

  const headers = {};
  if (isEpic) {
    headers['User-Agent'] = 'Dalvik/2.1.0 (Linux; U; Android 13; SM-S918B Build/TP1A.220624.014)';
    headers['X-Llave'] = '7hA4oMy1vmGSFJjbrAWx-xneFQEY_PAq';
    headers['X-Aparato'] = 'a1b2c3d4';
    headers['X-Pulsera'] = pulsera || '1';
  } else {
    headers['User-Agent'] = ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    if (referer) {
      headers['Referer'] = referer;
      try { headers['Origin'] = new URL(referer).origin; } catch {}
    }
    if (auth) headers['Content-Auth'] = auth;
    if (license) headers['Content-License'] = license;
  }

  try {
    const up = await fetch(targetUrl, { headers, redirect: 'follow' });
    const ct = up.headers.get('content-type') || 'application/octet-stream';
    if (up.ok && (targetUrl.includes('.m3u8') || ct.includes('mpegurl'))) {
      const text = await up.text();
      const base = new URL(up.url || targetUrl);
      const rewritten = text.split(/\r?\n/).map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        try {
          const abs = new URL(trimmed, base).toString();
          if (isEpic && (abs.includes('tiktokcdn') || abs.includes('.image'))) return abs;
          return `/stream-proxy?url=${encodeURIComponent(abs)}${pulsera ? `&pulsera=${encodeURIComponent(pulsera)}` : ''}${referer ? `&referer=${encodeURIComponent(referer)}` : ''}${ua ? `&ua=${encodeURIComponent(ua)}` : ''}`;
        } catch {
          return line;
        }
      }).join('\n');
      res.writeHead(up.status, {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      });
      return res.end(rewritten);
    }
    const buf = Buffer.from(await up.arrayBuffer());
    res.writeHead(up.status, { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*' });
    res.end(buf);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Stream proxy error: ' + String(err));
  }
}

function startLocalServer(distDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const urlObj = new URL(req.url || '/', 'http://127.0.0.1');
      const p = urlObj.pathname;

      if (p.startsWith('/direct-43404/')) {
        return handleDirect43404(req, res, p.slice('/direct-43404/'.length));
      }
      if (p.startsWith('/epic-api/')) {
        return handleEpicApi(req, res, p.slice('/epic-api/'.length) + urlObj.search);
      }
      if (p === '/stream-proxy') {
        return handleStreamProxy(req, res, urlObj);
      }

      const rel = decodeURIComponent(p === '/' ? '/index.html' : p).replace(/^\/+/, '');
      let filePath = path.join(distDir, rel);
      if (!filePath.startsWith(distDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(distDir, 'index.html');
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
  });
}

module.exports = { startLocalServer };
