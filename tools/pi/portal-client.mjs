/**
 * The portal client (public/js/magis-client.js) loaded in Node as on a TV, for the Pi's scripts that ask the portal
 * directly from the home connection. The same setup as tools/generate-static-catalog.mjs, which keeps its own copy.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// On the Pi public/ sits next to the scripts; in the repository it is two folders up
const ROOT_DIR = fs.existsSync(path.join(__dirname, 'public')) ? __dirname : path.resolve(__dirname, '..', '..');

const PORTAL_HOSTS = [
  'neqpsx.6dqtl974.com',
  'lvmcmb.6dqtl974.com',
  'dqbvvb.wg5h6vjz.com',
  'eajmnp.hcgv1dt8.com'
];

export function createPortalClient() {
  const ctx = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    Promise,
    Uint8Array,
    ArrayBuffer,
    encodeURIComponent,
    decodeURIComponent,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    crypto: { getRandomValues: (b) => crypto.randomFillSync(b) },
    localStorage: {
      _d: {},
      getItem(k) { return this._d[k] || null; },
      setItem(k, v) { this._d[k] = String(v); },
      removeItem(k) { delete this._d[k]; }
    },
    sessionStorage: {
      _d: {},
      getItem(k) { return this._d[k] || null; },
      setItem(k, v) { this._d[k] = String(v); },
      removeItem(k) { delete this._d[k]; }
    },
    location: { hostname: 'tizen.tv', protocol: 'file:' },
    navigator: { userAgent: 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 9.0) AppleWebKit/537.36' },
    // Run as a TV so the client opens a direct session: from a residential IP (the Pi) the portal gives the full
    // channel list there, while sessions and requests through the relay get a shorter one. From a datacenter the
    // direct start is refused and the client falls back to the relay and its pool as before.
    tizen: {}
  });
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  ctx.__XUPER_SKIP_STATIC_CATALOG__ = true;

  let hostIdx = 0;
  function XMLHttpRequest() {
    this._headers = {};
  }
  XMLHttpRequest.prototype.open = function (m, u) {
    this._m = m;
    this._u = u;
    this.readyState = 1;
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    this._headers[k] = v;
  };
  XMLHttpRequest.prototype.send = function (body) {
    let u = this._u;
    const h = Object.assign({}, this._headers);
    if (u.includes('/api/portalCore/')) {
      const targetHost = h['X-Target-Host'] || PORTAL_HOSTS[hostIdx++ % PORTAL_HOSTS.length];
      u = u.replace('https://tizenxuper-relay.tizenxupertv.workers.dev', 'https://' + targetHost);
      if (h['X-Cookie']) {
        h['Cookie'] = h['X-Cookie'];
        delete h['X-Cookie'];
      }
      delete h['X-Target-Host'];
      delete h['X-Tizen-Time'];
      delete h['X-Tizen-Duid'];
      delete h['X-Tizen-Sig'];
    } else if (u.includes('/session/fallback')) {
      // Allow relay session acquisition (uses pooled session minted from home)
      // Headers (X-Tizen-Sig, X-Tizen-Time, etc.) will pass cleanly to the Relay
    }
    fetch(u, { method: this._m, headers: h, body: body || undefined })
      .then(async (r) => {
        this.status = r.status;
        this.responseURL = r.url;
        this.responseText = await r.text();
        this._resHeaders = r.headers;
        this.readyState = 4;
        if (this.onload) this.onload();
        if (this.onreadystatechange) this.onreadystatechange();
      })
      .catch((e) => {
        this.status = 0;
        this.readyState = 4;
        if (this.onerror) this.onerror(e);
        if (this.onreadystatechange) this.onreadystatechange();
      });
  };
  XMLHttpRequest.prototype.getResponseHeader = function (k) {
    return this._resHeaders ? this._resHeaders.get(k) : null;
  };
  ctx.XMLHttpRequest = XMLHttpRequest;

  const jsDir = path.join(ROOT_DIR, 'public', 'js');
  vm.runInContext(fs.readFileSync(path.join(jsDir, 'crypto-js.min.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(jsDir, 'magis-client.js'), 'utf8'), ctx);
  return ctx.MagisClient;
}
