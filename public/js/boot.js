/*
 * TizenXuper TV boot loader: decides at every launch which code runs — the installed package, or the newest update
 * bundle that src/services/updateService.ts downloaded and verified earlier — and loads it in order.
 *
 * This file is the root of trust of the self-update: the public key below is the only thing that lets this TV run
 * code that was not installed with the package. It is never part of an update bundle: changing it (or anything else
 * of the "shell": index.html, config.xml, hls.min.js, crypto-js, portal.js, the magis worker, images, the proxy
 * service) means bumping SHELL, and TVs on an older shell skip that release and reinstall.
 *
 * The signature is checked when the bundle is downloaded (updateService), not here: the bundle comes from this
 * app's own IndexedDB, and whatever can write there can already run code in this app.
 *
 * A bundle that never reaches the first screen (XuperBoot.ok(), called when the splash hides or the sign-in screen
 * shows) is marked bad at the next launch and the package runs instead. An uncaught error from bundle code before
 * that point reloads once into the package right away.
 *
 * The build (vite-tv-compat.ts) writes the package's script and style lists into window.__XUPER_SCRIPTS /
 * __XUPER_STYLES and its version into __XUPER_PACKAGED. Plain ES5 (Tizen 4.0 = Chromium 56).
 * Modeled on titlog/telegram-tizen app/js/boot.js (MIT).
 */
(function () {
  'use strict';

  /* What this loader expects from a bundle; bump it when that changes or any shell file changes */
  var SHELL = 1;
  /* ECDSA P-256 public key, SPKI DER in base64. Written by tools/update-key.mjs; the private key is never in the repo */
  var PUBKEY = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEYXqGdkwl3txnDhXk3ZOC2H6yG+uxGc3kb6vOL3sHcFSg/6twFw3I5sw0+nKzdwXJRGc/FJuPfflQbkJ3xr7WWQ==";

  var DB_NAME = 'xuper-update';
  var STORE = 'files';
  var K_BOOTING = 'xuper_update_booting';
  var K_BAD = 'xuper_update_bad';
  var K_FALLBACK = 'xuper_boot_fallback';
  /* Never hold the start-up longer than this waiting for IndexedDB (the splash is showing meanwhile) */
  var READ_TIMEOUT_MS = 4000;
  /* Launches of one bundle that never reached the first screen before it counts as broken: a single one can be the
     user leaving during the splash */
  var MAX_UNFINISHED_BOOTS = 2;

  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsPut(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { window.localStorage.removeItem(k); } catch (e) {} }
  function parse(s) { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } }

  /* Dotted numbers compared part by part; a missing or non-numeric part counts as 0 */
  function cmp(a, b) {
    var x = String(a || '').split('.'), y = String(b || '').split('.');
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var p = parseInt(x[i] || '0', 10) || 0, q = parseInt(y[i] || '0', 10) || 0;
      if (p !== q) return p > q ? 1 : -1;
    }
    return 0;
  }

  function badList() { return parse(lsGet(K_BAD)) || {}; }
  function markBad(version) {
    var bad = badList();
    bad[version] = new Date().getTime();
    lsPut(K_BAD, JSON.stringify(bad));
  }

  /*
   * Which stored bundle runs, if any. Pure: { bundle } to run it, or { drop: true, note, markBad? } to forget it.
   * ctx = { packaged, shell, bad, booting: { version, count } of launches that never reached the first screen }.
   */
  function choose(meta, bundle, ctx) {
    if (!meta || !meta.version) return { bundle: null, drop: false, note: '' };
    if (cmp(meta.version, ctx.packaged) <= 0) {
      return { bundle: null, drop: true, note: 'downloaded ' + meta.version + ' is not newer than the installed ' + ctx.packaged };
    }
    if ((meta.shell || 1) > ctx.shell) {
      return { bundle: null, drop: true, note: meta.version + ' needs shell ' + meta.shell + ', this package is shell ' + ctx.shell };
    }
    if (ctx.bad[meta.version]) {
      return { bundle: null, drop: true, note: meta.version + ' failed to start on this TV before' };
    }
    if (ctx.booting && ctx.booting.version === meta.version && ctx.booting.count >= MAX_UNFINISHED_BOOTS) {
      return { bundle: null, drop: true, markBad: meta.version, note: meta.version + ' did not reach the first screen last time: back to the installed ' + ctx.packaged };
    }
    if (!bundle || bundle.version !== meta.version || !bundle.files || !bundle.scripts || !bundle.scripts.length) {
      return { bundle: null, drop: true, note: 'stored ' + meta.version + ' bundle is unreadable' };
    }
    return { bundle: bundle, drop: false, note: '' };
  }

  /* ---- IndexedDB: meta and bundle are written together in one transaction (all or nothing) ---- */
  function openDb(cb) {
    var idb;
    try { idb = window.indexedDB; } catch (e) { idb = null; }
    if (!idb) { cb(null); return; }
    try {
      var rq = idb.open(DB_NAME, 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore(STORE); };
      rq.onsuccess = function () { cb(rq.result); };
      rq.onerror = function () { cb(null); };
    } catch (e) { cb(null); }
  }
  /* cb(meta, bundle); both null when nothing is stored or the database cannot be read */
  function readStored(cb, withBundle) {
    openDb(function (db) {
      if (!db) { cb(null, null); return; }
      try {
        var st = db.transaction(STORE, 'readonly').objectStore(STORE);
        var gm = st.get('meta');
        gm.onsuccess = function () {
          var meta = gm.result || null;
          if (!meta || !withBundle) { db.close(); cb(meta, null); return; }
          var gb = st.get('bundle');
          gb.onsuccess = function () { db.close(); cb(meta, gb.result || null); };
          gb.onerror = function () { db.close(); cb(meta, null); };
        };
        gm.onerror = function () { db.close(); cb(null, null); };
      } catch (e) { cb(null, null); }
    });
  }
  function writeStored(meta, bundle, cb) {
    openDb(function (db) {
      if (!db) { cb(false); return; }
      try {
        var tx = db.transaction(STORE, 'readwrite');
        var st = tx.objectStore(STORE);
        st.put(bundle, 'bundle');
        st.put(meta, 'meta');
        tx.oncomplete = function () { db.close(); cb(true); };
        tx.onerror = tx.onabort = function () { db.close(); cb(false); };
      } catch (e) { cb(false); }
    });
  }
  function clearStored(cb) {
    openDb(function (db) {
      if (!db) { if (cb) cb(false); return; }
      try {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = function () { db.close(); if (cb) cb(true); };
        tx.onerror = tx.onabort = function () { db.close(); if (cb) cb(false); };
      } catch (e) { if (cb) cb(false); }
    });
  }

  function packagedVersion() {
    try {
      var v = window.tizen.application.getCurrentApplication().appInfo.version;
      if (v) return String(v);
    } catch (e) {}
    return String(window.__XUPER_PACKAGED || 'dev');
  }

  var info = { packaged: packagedVersion(), running: '', shell: SHELL, note: '' };
  var startedBundle = '';
  var reachedFirstScreen = false;

  /* An uncaught error from bundle code before the first screen: the bundle is broken, run the package now */
  function onEarlyError(e) {
    if (reachedFirstScreen || !startedBundle) return;
    var file = e && e.filename ? String(e.filename) : '';
    if (file.indexOf('blob:') !== 0) return;
    try {
      if (window.sessionStorage.getItem(K_FALLBACK)) return;
      window.sessionStorage.setItem(K_FALLBACK, startedBundle);
    } catch (err) { return; }
    markBad(startedBundle);
    lsDel(K_BOOTING);
    clearStored(function () { window.location.reload(); });
  }

  function ok() {
    if (reachedFirstScreen) return;
    reachedFirstScreen = true;
    lsDel(K_BOOTING);
    window.removeEventListener('error', onEarlyError);
  }

  function blobUrl(text, type) {
    return window.URL.createObjectURL(new window.Blob([text], { type: type }));
  }

  function fill(pct) {
    var f = window.document.querySelector('#xuper-splash .xs-fill');
    if (f) f.style.width = pct + '%';
  }

  /* Same order and splash progress (4 → 30 %) as the package loader always had; each script waits for the previous one */
  function loadScripts(list, files) {
    var doc = window.document;
    function next(i) {
      if (i >= list.length) return;
      var name = list[i];
      var el = doc.createElement('script');
      el.src = files && files[name] != null ? blobUrl(files[name], 'application/javascript') : name;
      el.async = false;
      el.onload = el.onerror = function () {
        fill(Math.round(4 + 26 * (i + 1) / list.length));
        next(i + 1);
      };
      doc.body.appendChild(el);
    }
    next(0);
  }

  /* The bundle's stylesheets replace the package's <link> tags */
  function swapStyles(bundle) {
    var doc = window.document;
    var styles = bundle.styles || [];
    if (!styles.length) return;
    var links = doc.querySelectorAll('link[rel="stylesheet"]');
    for (var i = 0; i < links.length; i++) links[i].parentNode.removeChild(links[i]);
    for (var j = 0; j < styles.length; j++) {
      var css = bundle.files[styles[j]];
      var node = doc.createElement('link');
      node.rel = 'stylesheet';
      node.href = css != null ? blobUrl(css, 'text/css') : styles[j];
      doc.head.appendChild(node);
    }
  }

  function start(meta, bundle) {
    var booting = parse(lsGet(K_BOOTING));
    var pick = choose(meta, bundle, { packaged: info.packaged, shell: SHELL, bad: badList(), booting: booting });
    if (pick.markBad) markBad(pick.markBad);
    if (pick.drop) { lsDel(K_BOOTING); clearStored(); }
    info.note = pick.note;
    if (pick.bundle) {
      info.running = pick.bundle.version;
      startedBundle = pick.bundle.version;
      var count = booting && booting.version === startedBundle ? (booting.count || 0) + 1 : 1;
      lsPut(K_BOOTING, JSON.stringify({ version: startedBundle, count: count }));
      window.addEventListener('error', onEarlyError);
      try {
        swapStyles(pick.bundle);
        loadScripts(pick.bundle.scripts, pick.bundle.files);
        return;
      } catch (e) {
        info.note = 'could not start ' + startedBundle + ': ' + (e && e.message);
        markBad(startedBundle);
        startedBundle = '';
        info.running = '';
        lsDel(K_BOOTING);
        clearStored();
      }
    }
    info.running = info.packaged;
    loadScripts(window.__XUPER_SCRIPTS || [], null);
  }

  window.XuperBoot = {
    SHELL: SHELL,
    PUBKEY: PUBKEY,
    cmp: cmp,
    ok: ok,
    info: info,
    badList: badList,
    store: {
      read: function (cb) { readStored(cb, true); },
      readMeta: function (cb) { readStored(function (meta) { cb(meta); }, false); },
      write: writeStored,
      clear: clearStored
    },
    _test: { choose: choose, cmp: cmp }
  };

  if (window.document && window.__XUPER_SCRIPTS) {
    var started = false;
    var go = function (meta, bundle) {
      if (started) return;
      started = true;
      start(meta, bundle);
    };
    setTimeout(function () { go(null, null); }, READ_TIMEOUT_MS);
    readStored(go, true);
  }
})();
