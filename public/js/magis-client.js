/**
 * MagisClient - Client-side resolver for XuperTV on Samsung Tizen
 * Connects directly to Magis portal APIs, manages anonymous session,
 * resolves streaming links (VOD & Live TV) and catalog metadata.
 */
(function (window) {
  'use strict';

  var CryptoJS = window.CryptoJS;
  if (!CryptoJS) {
    console.error('[MagisClient] CryptoJS not found! Make sure crypto-js is loaded first.');
    return;
  }

  var KEY_HEX = 'e7af1ed7de1ffddd7bd3fe37ebdffde9ef3fe1ae39edfeb8';
  var HOSTS = [
    'ftmrmy.jdfey0cd.com',
    'fuxok.nguvmqhpk.com',
    'eajmnp.hcgv1dt8.com',
    'mptec.dhkrxuzcy.com',
    'hinumz.a878kkoyc.com',
    'krdwvd.swcaw7qx.com',
    'osuhk.m3x8o50te.com',
    'oogoy.f30c96w8.com'
  ];

  var PORTAL_CODE = 'masnew';
  var APP_ID = 'com.android.msandroid';
  var APK_VERSION = '49902';
  var SPKG_VER = '2024-09-10 06:25:30_33_13_';
  var APK_VER_HEADER = '43404';
  var USER_AGENT = 'okhttp/3.12.12';
  var CONTENT_TYPE = 'application/json;charset=utf-8';
  var SNTOKEN_SALT = 'ntFT65w6itH!lHCPw7D=@qnsFC5adD28';
  var FIXED_RESERVE1 = '583442714b345572434a4d5769637461545a735936413d3d';
  var FIXED_DRM_ID = '0iSGEyv2EqiS/nqI/I3hqdu12irw5Q3/uqrWvRFx9bM=';
  var UA_CDN = 'Ranger/4.9.4-17294ac0';
  var SESSION_STORAGE_KEY = 'xuper_magis_session_v1';
  // This TV's identity for the portal (MACs and device ids), made up once and kept. Every install used to activate
  // with the same MAC, so to the portal they all looked like one device.
  var DEVICE_IDENTITY_KEY = 'xuper_magis_device_v1';
  var isBrowserEnv = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    (typeof tizen === 'undefined' && typeof webOS === 'undefined')
  );

  var RATE_MS = 250;
  // One host may go this long without sending a byte, and this long in all; a whole request, over every host, this long
  var HOST_IDLE_MS = 8000;
  var HOST_MAX_MS = 30000;
  var REQUEST_MAX_MS = 64000;
  // Starting a session (two requests) that gives no answer at all is given up after this long
  var SESSION_START_MAX_MS = 180000;
  var SLB_TTL = 300000;
  var PLAY_TTL = 60000;
  var SEARCH_TTL = 180000;
  var TREE_TTL = 600000;
  var LIVE_RESOLVE_CACHE_MS = 120000;

  var ROOT_CODES = {
    featured: 'masnew_featured',
    movies: 'masnew_movies',
    series: 'masnew_series',
    anime: 'masnew_anime',
    kids: 'masnew_kids',
    free: 'masnew_free',
    explorar: 'masnew_explorar'
  };

  var ROOT_CATEGORY = {
    featured: 'destacado',
    movies: 'pelicula',
    series: 'serie',
    anime: 'anime',
    kids: 'infantil',
    free: 'gratis',
    explorar: 'explorar'
  };

  var DEVICE_FIXED = {
    loginType: '2',
    appLanguage: 'en',
    hardwareInfo: 'ranchu',
    model: 'sdk_gphone64_arm64',
    product: 'sdk_gphone64_arm64',
    cpu: 'arm64-v8a',
    B29: '',
    reserve1: FIXED_RESERVE1,
    deviceToken: '',
    drmId: FIXED_DRM_ID,
    sdkVer: 33
  };

  var FINGERPRINT_FIXED = {
    board: 'goldfish_arm64',
    brand: 'google',
    cpuAbi: 'arm64-v8a',
    device: 'emu64a',
    diskInfo: '8GB',
    display: 'sdk_gphone64_arm64',
    fingerprint: 'google/sdk_gphone64_arm64/emu64a:14/UE1A.230829.036/11228894:user/release-keys',
    hardware: 'ranchu',
    host: 'abfarm',
    manufacturer: 'Google',
    ramSize: '4GB',
    romSize: '8GB',
    tags: 'release-keys',
    verId: ''
  };

  var keyHexParsed = null;
  function getKey() {
    if (!keyHexParsed) keyHexParsed = CryptoJS.enc.Hex.parse(KEY_HEX);
    return keyHexParsed;
  }

  function encryptBody(str) {
    var enc = CryptoJS.TripleDES.encrypt(CryptoJS.enc.Utf8.parse(str), getKey(), {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7
    });
    var b64 = enc.toString();
    var hex = '';
    for (var i = 0; i < b64.length; i++) {
      var h = b64.charCodeAt(i).toString(16);
      hex += (h.length === 1 ? '0' : '') + h;
    }
    return hex;
  }

  function decryptBlob(hex) {
    var b64 = '';
    for (var i = 0; i < hex.length; i += 2) {
      b64 += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
    var dec = CryptoJS.TripleDES.decrypt(b64, getKey(), {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7
    });
    return dec.toString(CryptoJS.enc.Utf8);
  }

  // Decrypt in workers (js/magis-worker.js). TripleDES-ECB blocks are independent, so a big answer
  // is cut into slices that several workers decrypt in parallel (the TV takes ~13 s for 400 KB in
  // one piece); the main thread only joins the bytes and parses. Two pools: foreground (what the
  // user waits for, up to 4 workers) and background (1 worker, so it leaves CPU to the foreground).
  var CORES = Math.max(2, Math.min(4, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2));
  var decPools = [[], []]; // [foreground, background]
  var decPoolSize = [CORES, 1];
  var decWorkerBroken = false;
  var decJobs = {};
  var decSeq = 0;
  var MIN_SLICE_HEX = 64 * 128; // slices are multiples of 64 hex chars (24 bytes); below this, no split

  function decryptSync(hex, cb) {
    var data;
    try {
      data = JSON.parse(decryptBlob(hex));
    } catch (e) {
      return cb(e);
    }
    cb(null, data);
  }

  function failDecWorker(why) {
    if (decWorkerBroken) return;
    decWorkerBroken = true;
    var jobs = decJobs;
    decJobs = {};
    for (var p = 0; p < decPools.length; p++) {
      for (var w = 0; w < decPools[p].length; w++) {
        try { decPools[p][w].terminate(); } catch (e) {}
      }
      decPools[p] = [];
    }
    console.log('[MagisClient] decrypt workers off, using main thread:', why);
    for (var id in jobs) {
      if (Object.prototype.hasOwnProperty.call(jobs, id)) {
        (function (job) { setTimeout(function () { decryptSync(job.hex, job.cb); }, 0); })(jobs[id]);
      }
    }
  }

  function onDecMessage(e) {
    var m = e.data;
    var job = decJobs[m.id];
    if (!job) return;
    if (m.error) {
      delete decJobs[m.id];
      return job.cb(new Error(m.error));
    }
    job.parts[m.part] = new Uint8Array(m.bytes);
    if (--job.pending > 0) return;
    delete decJobs[m.id];
    var total = 0, k;
    for (k = 0; k < job.parts.length; k++) total += job.parts[k].length;
    var all = new Uint8Array(total);
    var at = 0;
    for (k = 0; k < job.parts.length; k++) {
      all.set(job.parts[k], at);
      at += job.parts[k].length;
    }
    var data;
    try {
      data = JSON.parse(new TextDecoder('utf-8').decode(all));
    } catch (err) {
      return job.cb(err);
    }
    job.cb(null, data);
  }

  function getDecWorker(pool, idx) {
    if (!decPools[pool][idx]) {
      var wk = new Worker('js/magis-worker.js');
      wk.onmessage = onDecMessage;
      wk.onerror = function (ev) { failDecWorker(ev && ev.message); };
      decPools[pool][idx] = wk;
    }
    return decPools[pool][idx];
  }

  function decryptData(hex, cb, low) {
    if (decWorkerBroken || typeof Worker === 'undefined' || typeof TextDecoder === 'undefined') {
      return decryptSync(hex, cb);
    }
    var pool = low ? 1 : 0;
    var n = decPoolSize[pool];
    var slices = Math.max(1, Math.min(n, Math.floor(hex.length / MIN_SLICE_HEX)));
    // Slice length: a multiple of 64 hex chars, so each slice starts on a 24-byte boundary
    var len = Math.ceil(hex.length / slices / 64) * 64;
    var id = ++decSeq;
    var count = Math.ceil(hex.length / len);
    decJobs[id] = { hex: hex, cb: cb, pending: count, parts: new Array(count) };
    try {
      for (var p = 0; p < count; p++) {
        getDecWorker(pool, p).postMessage({
          id: id,
          part: p,
          keyHex: KEY_HEX,
          hex: hex.substr(p * len, len),
          last: p === count - 1
        });
      }
    } catch (e) {
      failDecWorker(e && e.message);
    }
  }

  function randomHex(bytesCount) {
    var out = '';
    for (var i = 0; i < bytesCount * 2; i++) {
      out += Math.floor(Math.random() * 16).toString(16);
    }
    return out;
  }

  /** Random MAC, locally administered and unicast (first byte xxxxxx10), like a virtual network card */
  function randomMac() {
    var hex = randomHex(6);
    var first = (parseInt(hex.slice(0, 2), 16) & 0xfc) | 0x02;
    return (('0' + first.toString(16)).slice(-2) + hex.slice(2)).replace(/(..)(?=.)/g, '$1:');
  }

  function deviceIdentity(fresh) {
    var saved = null;
    if (!fresh) {
      try { saved = JSON.parse((window.localStorage && localStorage.getItem(DEVICE_IDENTITY_KEY)) || 'null'); } catch (e) {}
    }
    if (saved && saved.androidId && saved.etheMac) return saved;
    var id = {
      androidId: randomHex(8),
      cpuId: randomHex(8),
      serialNumber: randomHex(8),
      etheMac: randomMac(),
      gatewayMac: randomMac(),
      wifiMac: randomMac()
    };
    storeSet(DEVICE_IDENTITY_KEY, JSON.stringify(id));
    return id;
  }

  function md5(val) {
    return CryptoJS.MD5(val).toString();
  }

  function text(val) {
    return val == null ? '' : String(val);
  }

  function trim(val) {
    return text(val).replace(/^\s+|\s+$/g, '');
  }

  function genresOf(item) {
    var r = text(item && item.tags);
    if (!r) return [];
    var parts = r.split(',');
    var res = [];
    for (var i = 0; i < parts.length; i++) {
      var g = trim(parts[i]);
      if (g) res.push(g);
    }
    return res;
  }

  function imageOf(item, fileType) {
    var list = item && item.posterList;
    if (!list || !list.length) return '';
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].fileType === fileType && trim(list[i].fileUrl) !== '') {
        return trim(list[i].fileUrl);
      }
    }
    return '';
  }

  var session = {
    sn: '',
    userId: '',
    userToken: '',
    snToken: '',
    ready: false,
    busy: false
  };

  // Restore cached session if available
  try {
    var savedSess = window.localStorage && localStorage.getItem(SESSION_STORAGE_KEY);
    if (savedSess) {
      var parsedSess = JSON.parse(savedSess);
      // A session without snToken was borrowed from the old third-party seeds list, not created by
      // this device: drop it so the device registers its own
      if (parsedSess && parsedSess.userId && parsedSess.userToken && !parsedSess.snToken) {
        localStorage.removeItem(SESSION_STORAGE_KEY);
        parsedSess = null;
      }
      if (parsedSess && parsedSess.userId && parsedSess.userToken) {
        session.sn = parsedSess.sn || '';
        session.userId = parsedSess.userId;
        session.userToken = parsedSess.userToken;
        session.snToken = parsedSess.snToken || '';
        session.ready = true;
      }
    }
  } catch (e) {}

  var LIVE_PAGE_PREFIX = 'xuper_magis_page_v1_';
  // Channel pages of categories that are not visited any more (or that the portal renamed) stayed for ever
  var LIVE_PAGE_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

  /** Removes the saved channel pages older than `maxAgeMs` (0: all of them); returns how many */
  function dropLivePages(maxAgeMs) {
    var doomed = [];
    try {
      if (!window.localStorage) return 0;
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key || key.indexOf(LIVE_PAGE_PREFIX) !== 0) continue;
        if (maxAgeMs > 0) {
          var m = /^\{"at":(\d+)/.exec(localStorage.getItem(key) || '');
          if (m && Date.now() - parseInt(m[1], 10) < maxAgeMs) continue;
        }
        doomed.push(key);
      }
      for (var d = 0; d < doomed.length; d++) localStorage.removeItem(doomed[d]);
    } catch (e) {}
    return doomed.length;
  }

  /** Saves what must not be lost (session, device identity): when the store is full the channel pages make room */
  function storeSet(key, value) {
    try {
      if (!window.localStorage) return false;
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      if (!dropLivePages(0)) return false;
      try {
        localStorage.setItem(key, value);
        return true;
      } catch (e2) {
        return false;
      }
    }
  }

  function saveSession() {
    if (session.ready && session.userId && session.userToken) {
      storeSet(SESSION_STORAGE_KEY, JSON.stringify({
        sn: session.sn,
        userId: session.userId,
        userToken: session.userToken,
        snToken: session.snToken
      }));
    }
  }

  function clearSession() {
    session.ready = false;
    session.userId = '';
    session.userToken = '';
    session.snToken = '';
    try {
      if (window.localStorage) localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch (e) {}
  }

  var queue = [];
  var lowQueue = []; // background work (catalog refresh): runs only when nothing else waits
  var lastCallAt = 0;

  function enqueue(fn, low) {
    (low ? lowQueue : queue).push(fn);
    drain();
  }

  function drain() {
    if (!session.busy && (queue.length || lowQueue.length)) {
      var delay = lastCallAt + RATE_MS - Date.now();
      if (delay > 0) {
        session.busy = true;
        setTimeout(function () {
          session.busy = false;
          drain();
        }, delay);
        return;
      }
      var task = queue.length ? queue.shift() : lowQueue.shift();
      session.busy = true;
      lastCallAt = Date.now();
      try {
        task(function () {
          session.busy = false;
          drain();
        });
      } catch (e) {
        // A task that throws must not leave the queue marked busy for good
        console.error('[MagisClient] queued task failed:', e);
        session.busy = false;
        setTimeout(drain, 0);
      }
    }
  }

  function deviceDict() {
    var dict = {};
    for (var k in DEVICE_FIXED) {
      if (Object.prototype.hasOwnProperty.call(DEVICE_FIXED, k)) {
        dict[k] = DEVICE_FIXED[k];
      }
    }
    dict.apkVersion = APK_VERSION;
    dict.sysVersion = SPKG_VER;
    dict.appId = APP_ID;
    dict.sn = session.sn;
    return dict;
  }

  var preferredHost = '';
  function hostOrder() {
    var list = [];
    if (preferredHost) list.push(preferredHost);
    for (var i = 0; i < HOSTS.length; i++) {
      if (HOSTS[i] !== preferredHost) list.push(HOSTS[i]);
    }
    return list;
  }

  // opts.onNet: called once the answer has arrived (before it is decrypted), so the request queue
  // moves on while the worker decrypts; opts.low: decrypt in the background worker
  function postHttp(path, payload, done, opts) {
    opts = opts || {};
    var bodyHex;
    try {
      bodyHex = encryptBody(JSON.stringify(payload));
    } catch (e) {
      return done(new Error(path + ': error cifrando cuerpo: ' + e.message));
    }

    var hosts = hostOrder();
    var idx = 0;
    var finished = false;
    var tStart = Date.now();

    function tryHost() {
      if (finished) return;
      if (idx >= hosts.length || Date.now() - tStart >= REQUEST_MAX_MS) {
        finished = true;
        return done(new Error(path + ': el portal no respondió'));
      }
      var host = hosts[idx++];
      var url = isBrowserEnv ? ('/api/portalCore/' + path) : ('https://' + host + '/api/portalCore/' + path);

      var xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      // The limit is 8 s without receiving anything, not 8 s for the whole answer: a ~1 MB answer on a slow
      // connection was cut at 8 s and asked again from the next host, eight times over, with the queue waiting
      var settled = false;
      var idleTimer = null;
      var hardTimer = null;
      var disarm = function () {
        clearTimeout(idleTimer);
        clearTimeout(hardTimer);
      };
      var expire = function () {
        if (settled || finished) return;
        settled = true;
        disarm();
        try { xhr.abort(); } catch (e) {}
        if (isBrowserEnv) {
          finished = true;
          return done(new Error(path + ': timeout en navegador local.'));
        }
        tryHost();
      };
      var arm = function () {
        if (settled) return;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(expire, HOST_IDLE_MS);
      };
      hardTimer = setTimeout(expire, HOST_MAX_MS);
      arm();
      xhr.onprogress = arm;
      xhr.onreadystatechange = function () { if (xhr.readyState >= 2) arm(); };
      try { xhr.setRequestHeader('apk', APP_ID); } catch (e) {}
      try { xhr.setRequestHeader('apkVer', APK_VER_HEADER); } catch (e) {}
      try { xhr.setRequestHeader('spkgVer', SPKG_VER); } catch (e) {}
      try { xhr.setRequestHeader('User-Agent', USER_AGENT); } catch (e) {}
      try { xhr.setRequestHeader('Content-Type', CONTENT_TYPE); } catch (e) {}

      xhr.onload = function () {
        if (settled || finished) return;
        settled = true;
        disarm();
        if (xhr.status >= 200 && xhr.status < 300) {
          var resp;
          try {
            resp = JSON.parse(xhr.responseText);
          } catch (e) {
            return tryHost();
          }
          preferredHost = host;
          var pos = HOSTS.indexOf(host);
          if (pos > 0) {
            HOSTS.splice(pos, 1);
            HOSTS.unshift(host);
          }

          var code = (resp.returnCode === undefined || resp.returnCode === null) ? '' : String(resp.returnCode);
          if (code !== '' && code !== '0') {
            var pErr = new Error(path + ' -> ' + code + ' ' + text(resp.errorMessage));
            pErr.portalCode = code;
            pErr.portalText = text(resp.errorMessage);
            finished = true;
            return done(pErr);
          }

          if (typeof resp.data === 'string' && resp.data !== '') {
            if (opts.onNet) { var netDone = opts.onNet; opts.onNet = null; netDone(); }
            var tNet = Date.now();
            var kb = Math.round(resp.data.length / 2048);
            decryptData(resp.data, function (dErr, decData) {
              if (finished) return;
              if (dErr) return tryHost();
              finished = true;
              // Timing per request (red = until the answer arrived, descifrado = worker), debug log
              console.log('[portal] ' + path + ' ' + kb + 'KB red=' + (tNet - tStart) + 'ms descifrado=' + (Date.now() - tNet) + 'ms' + (opts.low ? ' (fondo)' : ''));
              done(null, decData);
            }, !!opts.low);
            return;
          }

          finished = true;
          return done(null, resp.data !== undefined && resp.data !== null ? resp.data : resp);
        } else {
          if (isBrowserEnv) {
            finished = true;
            return done(new Error(path + ': respuesta HTTP ' + xhr.status + ' en navegador local'));
          }
          tryHost();
        }
      };

      xhr.onerror = function () {
        if (settled || finished) return;
        settled = true;
        disarm();
        if (isBrowserEnv) {
          finished = true;
          return done(new Error(path + ': CORS restringido en navegador de escritorio. Usando catálogo local.'));
        }
        tryHost();
      };
      xhr.send(bodyHex);
    }

    tryHost();
  }

  /**
   * The portal answered that the session is not valid any more (its codes, or its words). Only what the portal said
   * counts: a network failure of 'v3/snToken' carries "token" in its message (the path) and used to pass for an
   * expired session
   */
  function isSessionError(err) {
    if (!err || !err.portalCode) return false;
    if (err.portalCode === 'aaa100028' || err.portalCode === 'aaa100027') return true;
    return /aaa10002[0-9]|未登录|sesi[oó]n|login|token/i.test(err.portalCode + ' ' + (err.portalText || ''));
  }

  function call(endpoint, payload, opts, callback) {
    if (typeof opts === 'function') {
      callback = opts;
      opts = {};
    }
    opts = opts || {};

    enqueue(function (release) {
      var fullPayload = {};
      if (opts.baseFields !== false) {
        fullPayload.portalCode = PORTAL_CODE;
        fullPayload.userId = session.userId;
        fullPayload.userToken = session.userToken;
      }
      if (opts.deviceFields !== false) {
        var dev = deviceDict();
        for (var k in dev) {
          if (Object.prototype.hasOwnProperty.call(dev, k)) fullPayload[k] = dev[k];
        }
      }
      for (var p in payload) {
        if (Object.prototype.hasOwnProperty.call(payload, p)) fullPayload[p] = payload[p];
      }

      var released = false;
      function releaseOnce() {
        if (released) return;
        released = true;
        release();
      }
      postHttp(endpoint, fullPayload, function (err, res) {
        releaseOnce();
        // Not for the two requests that start the session: their retry would wait for the very session start that
        // is waiting for them, and every later portal call hung until the app was restarted
        if (isSessionError(err) && !opts._retried && !opts.sessionStart) {
          clearSession();
          return ensureSession(function (sErr) {
            if (sErr) return callback(err);
            opts._retried = true;
            call(endpoint, payload, opts, callback);
          });
        }
        callback(err, res);
      }, { onNet: releaseOnce, low: !!opts.low });
    }, !!opts.low);
  }

  var sessionStarting = false;
  var sessionWaiters = [];
  var sessionAttempt = 0;

  function ensureSession(callback) {
    callback = callback || function () {};
    if (session.ready && session.userId && session.userToken) {
      return callback(null, session);
    }
    startSession(false, callback);
  }

  function startSession(freshIdentity, callback) {
    sessionWaiters.push(callback);
    if (sessionStarting) return;

    sessionStarting = true;
    session.ready = false;
    // An attempt that gives no answer at all (a decrypt worker that died) is given up, so the next call can start
    // another one; its late answers are ignored
    var attempt = ++sessionAttempt;
    var watchdog = setTimeout(function () {
      if (attempt !== sessionAttempt || !sessionStarting) return;
      console.warn('[MagisClient] session start gave no answer, giving up');
      sessionAttempt++;
      notifyWaiters(new Error('inicio de sesión: el portal no respondió'));
    }, SESSION_START_MAX_MS);

    var fp = {};
    for (var k in FINGERPRINT_FIXED) {
      if (Object.prototype.hasOwnProperty.call(FINGERPRINT_FIXED, k)) fp[k] = FINGERPRINT_FIXED[k];
    }
    var identity = deviceIdentity(freshIdentity);
    fp.androidId = identity.androidId;
    fp.cpuId = identity.cpuId;
    fp.serialNumber = identity.serialNumber;
    fp.etheMac = identity.etheMac;
    fp.gatewayMac = identity.gatewayMac;
    fp.wifiMac = identity.wifiMac;

    function notifyWaiters(err, res) {
      clearTimeout(watchdog);
      sessionStarting = false;
      var list = sessionWaiters.slice(0);
      sessionWaiters = [];
      for (var i = 0; i < list.length; i++) {
        try { list[i](err, res); } catch (e) {}
      }
    }

    call('v3/snToken', fp, { baseFields: false, sessionStart: true }, function (err, res) {
      if (attempt !== sessionAttempt) return;
      if (err) return notifyWaiters(err);
      var snToken = trim(res && res.snToken);
      if (!snToken) return notifyWaiters(new Error('No snToken returned'));
      var sn = (res && trim(res.sn)) || md5(snToken + SNTOKEN_SALT);
      session.snToken = snToken;
      session.sn = String(sn).toLowerCase();

      var activePayload = {
        snToken: snToken,
        authVersion: '',
        authCode: '',
        preCode: '',
        macAddr: identity.etheMac,
        reserve1: '',
        openNum: 4,
        channel: 'default',
        matadata: '',
        signdata: ''
      };

      call('v8/active', activePayload, { baseFields: false, sessionStart: true }, function (aErr, aRes) {
        if (attempt !== sessionAttempt) return;
        // Activation refused for this identity (seen as code 100024): try once more as a new device
        if (aErr && !freshIdentity && /100024$/.test(String(aErr.portalCode || ''))) {
          console.warn('[MagisClient] v8/active refused (' + aErr.portalCode + '), retrying with a new device identity');
          clearTimeout(watchdog);
          sessionStarting = false;
          var waiting = sessionWaiters.slice(0);
          sessionWaiters = [];
          return startSession(true, function (rErr, rRes) {
            for (var w = 0; w < waiting.length; w++) {
              try { waiting[w](rErr, rRes); } catch (e) {}
            }
          });
        }
        if (aErr) return notifyWaiters(aErr);
        var uId = trim(aRes && (aRes.userId || aRes.id || (aRes.userInfo && aRes.userInfo.userId)));
        var uTok = trim(aRes && (aRes.userToken || aRes.token || (aRes.userInfo && aRes.userInfo.userToken)));
        if (!uId || !uTok) return notifyWaiters(new Error('Active did not return userId/userToken'));

        session.userId = uId;
        session.userToken = uTok;
        session.ready = true;
        saveSession();
        console.log('[MagisClient] Session established! UserId:', uId);
        notifyWaiters(null, session);
      });
    });
  }

  function slbBean() {
    return {
      hasPay: '0',
      userIdentity: '1',
      type: 'merge',
      appVer: APK_VERSION,
      lang: 'es',
      encMediaSupported: 1,
      liveCodeList: ['masnew_live'],
      appParams: '',
      reserve1: FIXED_RESERVE1,
      pipFlag: '0'
    };
  }

  function isCfl(url) {
    var qs = url.slice(url.lastIndexOf('?') + 1).split('&');
    for (var i = 0; i < qs.length; i++) {
      if (trim(qs[i]) === 'sign_type=cfl') return true;
    }
    return false;
  }

  function withScheme(addr) {
    var s = trim(addr).replace(/\/+$/, '');
    s = s.replace(/^https:\/\//i, 'http://');
    return /^http:\/\//.test(s) ? s : 'http://' + s;
  }

  function vodCdns(slb) {
    var result = [];
    var list = slb && slb.cdn_list;
    if (!list || !list.length) return result;
    for (var i = 0; i < list.length; i++) {
      var cdn = list[i];
      if (cdn && trim(cdn.tag) === 'vod') {
        var uList = cdn.url_list || [];
        for (var j = 0; j < uList.length; j++) {
          var u = uList[j];
          var authUrl = trim(u && u.url);
          if ((isCfl(authUrl) || trim(u && u.sign_type) === 'cfl') && trim(u && u.tag) === 'free') {
            var bases = [withScheme(cdn.main_addr)];
            var sp = trim(cdn.spared_addr);
            if (sp && bases.indexOf(withScheme(sp)) === -1) bases.push(withScheme(sp));
            result.push({ bases: bases, auth: authUrl });
            break;
          }
        }
      }
    }
    if (!result.length) {
      for (var d = 0; d < list.length; d++) {
        var c = list[d];
        if (c && trim(c.tag) === 'vod') {
          var mList = c.url_list || [];
          for (var p = 0; p < mList.length; p++) {
            var m = mList[p];
            var aUrl = trim(m && m.url);
            if (aUrl && (trim(m && m.tag) === 'free' || aUrl.indexOf('tag=free') !== -1)) {
              var b = [withScheme(c.main_addr)];
              var s2 = trim(c.spared_addr);
              if (s2 && b.indexOf(withScheme(s2)) === -1) b.push(withScheme(s2));
              result.push({ bases: b, auth: aUrl });
              break;
            }
          }
        }
      }
    }
    // v15 fallback: accept any signed VOD CDN
    if (!result.length) {
      for (var f = 0; f < list.length; f++) {
        var c3 = list[f];
        if (c3 && trim(c3.tag) === 'vod') {
          var list3 = c3.url_list || [];
          for (var q = 0; q < list3.length; q++) {
            var u3 = list3[q];
            var url3 = trim(u3 && u3.url);
            if (isCfl(url3) || trim(u3 && u3.sign_type) === 'cfl') {
              var b3 = [withScheme(c3.main_addr)];
              var sp3 = trim(c3.spared_addr);
              if (sp3 && b3.indexOf(withScheme(sp3)) === -1) b3.push(withScheme(sp3));
              result.push({ bases: b3, auth: url3 });
              break;
            }
          }
        }
      }
    }
    return result;
  }

  var slbCache = null;
  var slbWaiters = null;
  function getSlb(callback) {
    if (slbCache && Date.now() < slbCache.at + SLB_TTL) {
      return callback(null, slbCache.slb);
    }
    // A request already on its way (warmSlb, or resolve asking early): wait for it instead of asking again
    if (slbWaiters) return slbWaiters.push(callback);
    slbWaiters = [callback];
    function done(err, slb) {
      var waiters = slbWaiters || [];
      slbWaiters = null;
      for (var i = 0; i < waiters.length; i++) waiters[i](err, slb);
    }
    call('v15/getSlbInfo', slbBean(), function (err1, res1) {
      if (!err1 && vodCdns(res1).length) {
        slbCache = { at: Date.now(), slb: res1 };
        return done(null, res1);
      }
      call('v14/getSlbInfo', slbBean(), function (err2, res2) {
        if (err2) return done(err2);
        if (!vodCdns(res2).length) return done(new Error('No free VOD CDN found'));
        slbCache = { at: Date.now(), slb: res2 };
        done(null, res2);
      });
    });
  }

  /** Asks the CDN token ahead (on a title's page), so pressing Play waits only for the title itself */
  function warmSlb() {
    getSlb(function () {});
  }

  function collectTracks(episode) {
    var tracks = [];
    var totalList = episode && episode.totalMovieList || [];
    for (var i = 0; i < totalList.length; i++) {
      var mList = totalList[i] && totalList[i].movieList || [];
      for (var j = 0; j < mList.length; j++) {
        if (mList[j] && trim(mList[j].contentId)) tracks.push(mList[j]);
      }
    }
    return tracks;
  }

  function subtitleList(episode) {
    var subs = [];
    var list = episode && episode.subtitleList || [];
    for (var i = 0; i < list.length && subs.length < 30; i++) {
      var f = list[i] && list[i].file && list[i].file[0];
      if (f && trim(f.url)) {
        subs.push({
          lang: trim(list[i].language),
          url: trim(f.url),
          format: trim(f.fileType) || 'srt'
        });
      }
    }
    return subs;
  }

  function durationSeconds(val) {
    var s = trim(val);
    if (!s) return 0;
    if (/^\d{1,2}:\d{2}:\d{2}$/.test(s)) {
      var p = s.split(':');
      return parseInt(p[0], 10) * 3600 + parseInt(p[1], 10) * 60 + parseInt(p[2], 10);
    }
    var m = s.match(/(\d+(?:\.\d+)?)/);
    var num = parseFloat(m ? m[1] : 0);
    return num > 100000 ? num / 1000 : num;
  }

  var playCache = {};
  var playWaiters = {};
  function loadPlay(contentId, seriesContentId, callback) {
    var cid = trim(contentId);
    if (!cid) return callback(new Error('Missing contentId'));
    var key = cid + ':' + trim(seriesContentId);
    if (playCache[key] && Date.now() < playCache[key].at + PLAY_TTL) {
      return callback(null, playCache[key].data);
    }

    function doneAll(err, data) {
      var list = playWaiters[key] || [];
      delete playWaiters[key];
      for (var i = 0; i < list.length; i++) {
        try { list[i](err, data); } catch (e) {}
      }
    }

    if (playWaiters[key]) {
      playWaiters[key].push(callback);
      return;
    }
    playWaiters[key] = [callback];

    ensureSession(function (err) {
      if (err) return doneAll(err);
      var payload = {
        contentId: cid,
        seriesContentId: trim(seriesContentId),
        startTime: 0,
        type: '1',
        columnId: 0,
        authType: ''
      };
      call('v10/startPlayVOD', payload, function (pErr, pRes) {
        if (pErr) return doneAll(pErr);
        var ep = pRes && pRes.episodeList && pRes.episodeList[0];
        if (!ep) return doneAll(new Error('No video episode returned'));
        var tracks = collectTracks(ep);
        if (!tracks.length) return doneAll(new Error('No video tracks returned'));
        var data = { play: pRes, episode: ep, tracks: tracks };
        playCache[key] = { at: Date.now(), data: data };
        doneAll(null, data);
      });
    });
  }

  function mediaInfo(contentId, seriesContentId, callback) {
    loadPlay(contentId, seriesContentId, function (err, res) {
      if (err) return callback(err);
      var tr = res.tracks[0];
      callback(null, {
        name: text(res.play && res.play.name),
        audio: trim(tr.audioInfo),
        subtitles: subtitleList(res.episode),
        duration: durationSeconds(tr.duration || res.episode.duration || (res.play && res.play.duration))
      });
    });
  }

  /*
   * What a title offers, without resolving a stream: the audio languages and qualities of its tracks and the
   * languages of its subtitles. Shares loadPlay's cache with resolve(), so the player finds it already loaded.
   */
  function mediaOptions(contentId, seriesContentId, callback) {
    loadPlay(contentId, seriesContentId, function (err, res) {
      if (err) return callback(err);
      var audios = [], qualities = [], subs = [], i;
      for (i = 0; i < res.tracks.length; i++) {
        var a = trim(res.tracks[i].audioInfo), q = trim(res.tracks[i].quality).toLowerCase();
        if (a && audios.indexOf(a) === -1) audios.push(a);
        if (q && qualities.indexOf(q) === -1) qualities.push(q);
      }
      var list = subtitleList(res.episode);
      for (i = 0; i < list.length; i++) {
        if (list[i].lang && subs.indexOf(list[i].lang) === -1) subs.push(list[i].lang);
      }

      var qOrder = ['4k', '2160p', '1080p', '720p', '480p', '360p'];
      function sortQualities(arr) {
        arr.sort(function (x, y) {
          var ix = qOrder.indexOf(x.toLowerCase());
          var iy = qOrder.indexOf(y.toLowerCase());
          if (ix === -1) ix = 99;
          if (iy === -1) iy = 99;
          return ix - iy;
        });
      }

      var cid = trim(contentId);
      var cachedItem = itemCache[cid] || (seriesContentId && itemCache[trim(seriesContentId)]);
      var declared = (cachedItem && cachedItem.qualities) || [];
      if (!declared.length && cachedItem && cachedItem.quality) {
        declared = String(cachedItem.quality).split(',');
      }

      if ((!declared || !declared.length) && cid) {
        detail(cid, function (dErr, dData) {
          if (!dErr && dData && dData.item && dData.item.qualities) {
            for (var k = 0; k < dData.item.qualities.length; k++) {
              var qk = trim(dData.item.qualities[k]).toLowerCase();
              if (qk && qualities.indexOf(qk) === -1) qualities.push(qk);
            }
            sortQualities(qualities);
          }
          callback(null, { audios: audios, qualities: qualities, subtitles: subs });
        });
        return;
      }

      for (var d = 0; d < declared.length; d++) {
        var dq = trim(declared[d]).toLowerCase();
        if (dq && qualities.indexOf(dq) === -1) qualities.push(dq);
      }
      sortQualities(qualities);
      callback(null, { audios: audios, qualities: qualities, subtitles: subs });
    });
  }

  function resolve(contentId, seriesContentId, opts, callback) {
    if (typeof opts === 'function') {
      callback = opts;
      opts = {};
    }
    opts = opts || {};

    // The CDN token does not depend on the title: ask it now, while the title loads
    warmSlb();
    loadPlay(contentId, seriesContentId, function (err, res) {
      if (err) return callback(err);
      var play = res.play;
      var episode = res.episode;
      var tracks = res.tracks;
      var trackIdx = parseInt(opts.trackIndex, 10);
      if (isNaN(trackIdx) || trackIdx < 0 || trackIdx >= tracks.length) trackIdx = 0;
      var chosen = tracks[trackIdx];

      var license = trim(chosen.licenseList && chosen.licenseList[0] && chosen.licenseList[0].license || '');
      if (!license) return callback(new Error('No playback license returned by portal'));

      getSlb(function (sErr, slb) {
        if (sErr) return callback(sErr);
        var cdns = vodCdns(slb);
        if (!cdns.length) return callback(new Error('No free VOD CDN available'));
        var mainCdn = cdns[0];
        var format = trim(chosen.videoFormat).toLowerCase() === 'ts' ? 'ts' : 'mp4';
        var path = '/vod/' + trim(chosen.contentId) + '_media.' + format;

        function makeHeaders(auth) {
          return {
            'Content-Auth': auth,
            'Content-License': license,
            'User-Agent': UA_CDN,
            'App': APP_ID,
            'App-Version': APK_VERSION
          };
        }

        var streamUrl = mainCdn.bases[0] + path;
        var idxUrl = mainCdn.bases[0] + '/vod/' + trim(chosen.contentId) + '_idx.idxg';
        var backupUrls = [];
        for (var h = 0; h < cdns.length; h++) {
          for (var g = 0; g < cdns[h].bases.length; g++) {
            if (h !== 0 || g !== 0) {
              backupUrls.push({
                url: cdns[h].bases[g] + path,
                idxUrl: cdns[h].bases[g] + '/vod/' + trim(chosen.contentId) + '_idx.idxg',
                headers: makeHeaders(cdns[h].auth)
              });
            }
          }
        }

        var mime = format === 'ts' ? 'video/mp2t' : 'video/mp4';
        var codec = trim(chosen.encodeFormat).toUpperCase();
        var dur = durationSeconds(chosen.duration || episode.duration || (play && play.duration));

        callback(null, {
          url: streamUrl,
          proxyPath: streamUrl,
          idxUrl: idxUrl,
          mime: mime,
          codec: codec,
          quality: trim(chosen.quality),
          duration: dur,
          audio: trim(chosen.audioInfo),
          headers: makeHeaders(mainCdn.auth),
          backupUrls: backupUrls,
          subtitles: subtitleList(episode),
          name: text(play && play.name),
          isHls: false,
          // All audio/quality variants of this title; resolve again with opts.trackIndex to switch
          trackIndex: trackIdx,
          tracks: tracks.map(function (t, i) {
            return {
              index: i,
              audio: trim(t.audioInfo),
              quality: trim(t.quality),
              language: trim(t.language || t.languageName || t.audioLanguage || ''),
              raw: Object.keys(t).join(',')
            };
          })
        });
      });
    });
  }

  // ---- Live TV Signing & Resolution (exact port from original magis.js) ----
  var LIVE_K = [
    3614090360, 3905402710, 606105819, 3250441966, 4118548399, 1200080426, 2821735955, 4249261313,
    1770035416, 2336552879, 4294925233, 2304563134, 1804603682, 4254626195, 2792965006, 1236535329,
    4129170786, 3225465664, 643717713, 3921069994, 3593408605, 38016083, 3634488961, 3889429448,
    568446438, 3275163606, 4107603335, 1163531501, 2850285829, 4243563512, 1735328473, 2368359562,
    4294588738, 2272392833, 1839030562, 4259657740, 2763975236, 1272893353, 4139469664, 3200236656,
    681279174, 3936430074, 3564056709, 76029189, 3654602809, 3871185381, 530742520, 3299628645,
    4096336452, 1126891415, 2878612391, 4237533241, 1700485571, 2399980690, 4293706877, 2240044497,
    1873313359, 4264355552, 2734768916, 1309151649, 4149444226, 3174756917, 765973179, 3951481745
  ];
  var LIVE_S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];
  var LIVE_ROUND1 = [10, 11, 12, 13, 14, 15, 6, 7, 8, 9, 0, 1, 2, 3, 4, 5];
  var LIVE_G = [];
  for (var iG = 0; iG < 64; iG++) {
    LIVE_G.push(iG < 16 ? LIVE_ROUND1[iG] : iG < 32 ? (5 * iG + 1) % 16 : iG < 48 ? (3 * iG + 5) % 16 : (7 * iG) % 16);
  }
  var LIVE_SALT = [115, 97, 108, 116, 51, 51, 51, 51, 61, 52, 152, 13, 10, 21, 50, 201, 195, 130, 23, 8, 192];

  function rotl(x, n) {
    return ((x << n) | (x >>> (32 - n))) >>> 0;
  }

  function liveCompress(state, bytes, offset) {
    var m = new Array(16);
    for (var i = 0; i < 16; i++) {
      var k = offset + 4 * i;
      m[i] = (bytes[k] | (bytes[k + 1] << 8) | (bytes[k + 2] << 16) | (bytes[k + 3] << 24)) >>> 0;
    }
    var a = state[0], b = state[1], c = state[2], d = state[3];
    for (var r = 0; r < 64; r++) {
      var f = (r < 16 ? ((b & c) | (~b & d)) : r < 32 ? ((d & b) | (~d & c)) : r < 48 ? (b ^ c ^ d) : (c ^ (b | ~d)));
      var temp = (f + a + LIVE_K[r] + m[LIVE_G[r]]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotl(temp, LIVE_S[r])) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
  }

  function liveDigestHex(bytes) {
    var state = [1732584193, 4023233417, 2562383102, 271733878];
    var len = bytes.length;
    var padLen = (56 - (len + 1) % 64 + 64) % 64;
    var total = len + 1 + padLen + 8;
    var buf = new Array(total);
    for (var p = 0; p < total; p++) buf[p] = 0;
    for (var j = 0; j < len; j++) buf[j] = bytes[j];
    buf[len] = 128;
    var lowBits = (len % 536870912) * 8;
    var highBits = Math.floor(len / 536870912);
    for (var s = 0; s < 4; s++) {
      buf[len + 1 + padLen + s] = (lowBits >>> (8 * s)) & 255;
      buf[len + 5 + padLen + s] = (highBits >>> (8 * s)) & 255;
    }
    for (var u = 0; u < buf.length; u += 64) {
      liveCompress(state, buf, u);
    }
    var out = '';
    for (var c = 0; c < 4; c++) {
      for (var d = 0; d < 4; d++) {
        var hx = ((state[c] >>> (8 * d)) & 255).toString(16);
        if (hx.length < 2) hx = '0' + hx;
        out += hx;
      }
    }
    return out;
  }

  function signO3(token, startMoment) {
    var prefix = 'token=' + token + '&sign2_method=sign_o3&instance=0&start_moment=' + startMoment;
    var bytes = [];
    for (var i = 0; i < prefix.length; i++) {
      bytes.push(prefix.charCodeAt(i) & 255);
    }
    for (var j = 0; j < LIVE_SALT.length; j++) {
      bytes.push(LIVE_SALT[j]);
    }
    return liveDigestHex(bytes);
  }

  function bareHost(addr) {
    var s = typeof addr === 'string' ? addr : '';
    if (s.indexOf('https://') === 0) s = s.slice(8);
    if (s.indexOf('http://') === 0) s = s.slice(7);
    var slash = s.indexOf('/');
    return slash >= 0 ? s.slice(0, slash) : s;
  }

  var liveChannelCache = {};
  var livePageCache = {};
  var emptyLiveRetryDone = false;
  var liveCategoriesCache = null;
  var LIVE_PAGE_TTL = 2 * 60 * 60 * 1000; // 2 hours
  var LIVE_CATS_TTL = 12 * 60 * 60 * 1000; // 12 hours

  var FALLBACK_39_CATEGORIES = [
    { id: 76182, name: 'Todos los canales' },
    { id: 76206, name: 'Deportes en Vivo' },
    { id: 76205, name: 'Cine & Series 24/7' },
    { id: 76188, name: 'Colombia' },
    { id: 76191, name: 'España' },
    { id: 76197, name: 'México' },
    { id: 76190, name: 'Argentina' },
    { id: 76195, name: 'Chile & Perú' },
    { id: 76189, name: 'Venezuela' },
    { id: 76192, name: 'Ecuador' },
    { id: 76193, name: 'Bolivia' },
    { id: 76194, name: 'Uruguay' },
    { id: 76196, name: 'Paraguay' },
    { id: 76198, name: 'Panamá' },
    { id: 76199, name: 'Puerto Rico' },
    { id: 76200, name: 'Costa Rica' },
    { id: 76201, name: 'Estados Unidos' },
    { id: 76202, name: 'República Dominicana' },
    { id: 76203, name: 'Guatemala' },
    { id: 76204, name: 'Honduras' },
    { id: 76207, name: 'El Salvador' },
    { id: 76208, name: 'Nicaragua' },
    { id: 76209, name: 'Brasil' },
    { id: 76210, name: 'Infantiles' },
    { id: 76211, name: 'Noticias' },
    { id: 76212, name: 'Música' },
    { id: 76213, name: 'Documentales' },
    { id: 76214, name: 'Religiosos' },
    { id: 76215, name: 'Canales Premium' },
    { id: 76216, name: 'Variedades' },
    { id: 76217, name: 'Cultura y Ciencia' },
    { id: 76218, name: 'Anime 24/7' },
    { id: 76219, name: 'Retro TV' },
    { id: 76220, name: 'Series Retro' },
    { id: 76221, name: 'Cine Acción' },
    { id: 76222, name: 'Cine Comedia' },
    { id: 76223, name: 'Cine Terror' },
    { id: 76224, name: 'Eventos PPV' },
    { id: 'addons', name: '➕ Addons M3U', isAddon: true }
  ];

  function getLiveCategories(callback) {
    if (liveCategoriesCache && liveCategoriesCache.length) {
      return callback(null, liveCategoriesCache);
    }
    try {
      var rawCats = window.localStorage && localStorage.getItem('xuper_magis_cats_v1');
      if (rawCats) {
        var parsedCats = JSON.parse(rawCats);
        if (parsedCats && parsedCats.cats && parsedCats.cats.length && (Date.now() - (parsedCats.at || 0) < LIVE_CATS_TTL)) {
          liveCategoriesCache = parsedCats.cats;
          return callback(null, liveCategoriesCache);
        }
      }
    } catch (e) {}
    ensureSession(function (err) {
      if (err) return callback(null, FALLBACK_39_CATEGORIES);
      call('getNextColumns', {
        columnCode: 'masnew_live',
        pageNum: 1,
        pageSize: 50,
        version: ''
      }, function (cErr, cRes) {
        if (cErr) return callback(null, FALLBACK_39_CATEGORIES);
        var recList = cRes && cRes.recommendList || [];
        var cats = [];
        for (var i = 0; i < recList.length; i++) {
          var col = recList[i];
          if (col && col.columnId) {
            cats.push({
              id: col.columnId,
              name: text(col.name || col.title || col.alias || ('Categoría ' + (i + 1))),
              code: col.code || ''
            });
          }
        }
        if (cats.length) {
          liveCategoriesCache = cats;
          try {
            if (window.localStorage) {
              localStorage.setItem('xuper_magis_cats_v1', JSON.stringify({ at: Date.now(), cats: cats }));
            }
          } catch (e) {}
        }
        callback(null, cats.length ? cats : FALLBACK_39_CATEGORIES);
      });
    });
  }

  function getLiveChannels(columnId, pageNum, pageSize, callback) {
    if (typeof columnId === 'function') {
      callback = columnId;
      columnId = null;
      pageNum = 1;
      pageSize = 50;
    } else if (typeof pageNum === 'function') {
      callback = pageNum;
      pageNum = 1;
      pageSize = 50;
    } else if (typeof pageSize === 'function') {
      callback = pageSize;
      pageSize = 50;
    }
    var colKey = columnId || 76182;
    var pNum = Math.max(1, parseInt(pageNum, 10) || 1);
    var pSize = Math.max(1, Math.min(50, parseInt(pageSize, 10) || 50));
    var pageKey = String(colKey) + '_' + pNum + '_' + pSize;

    var memPage = livePageCache[pageKey];
    if (memPage && (Date.now() - memPage.at < LIVE_PAGE_TTL)) {
      return callback(null, memPage.channels, memPage.hasMore);
    }
    try {
      var rawPage = window.localStorage && localStorage.getItem(LIVE_PAGE_PREFIX + pageKey);
      if (rawPage) {
        var parsedPage = JSON.parse(rawPage);
        if (parsedPage && parsedPage.channels && parsedPage.channels.length && (Date.now() - (parsedPage.at || 0) < LIVE_PAGE_TTL)) {
          for (var k = 0; k < parsedPage.channels.length; k++) {
            var cItem = parsedPage.channels[k];
            if (cItem && cItem.channelCode) {
              liveChannelCache[cItem.channelCode] = { at: parsedPage.at, channel: cItem };
            }
          }
          livePageCache[pageKey] = parsedPage;
          return callback(null, parsedPage.channels, !!parsedPage.hasMore);
        }
      }
    } catch (e) {}

    function runGetLiveData(retried) {
      ensureSession(function (err) {
        if (err) return callback(err);
        enqueue(function (release) {
          var livePayload = {
            userToken: session.userToken,
            userId: session.userId,
            portalCode: PORTAL_CODE,
            columnId: colKey,
            dataVersion: '',
            pageSize: pSize,
            pageNum: pNum,
            expireTimeStr: ''
          };

          function handleLiveResponse(lErr, lRes) {
            release();
            if (lErr) {
              if (!retried && isSessionError(lErr)) {
                clearSession();
                return runGetLiveData(true);
              }
              return callback(lErr);
            }
            var rawList = lRes && lRes.channelList || [];
            // An empty first page may mean a session the portal no longer accepts: one retry with a new session,
            // once per start. Every empty category used to register the device again, on every start
            if (!rawList.length && pNum === 1 && !retried && !emptyLiveRetryDone) {
              emptyLiveRetryDone = true;
              clearSession();
              return runGetLiveData(true);
            }
            var channels = [];
            var seen = {};
            for (var i = 0; i < rawList.length; i++) {
              var ch = rawList[i];
              if (ch && ch.channelCode && !seen[ch.channelCode]) {
                seen[ch.channelCode] = true;
                var logo = text(ch.posterUrl);
                if (!logo && ch.posterList && ch.posterList.length) {
                  logo = text(ch.posterList[0].fileUrl);
                }
                var mapped = {
                  channelCode: ch.channelCode,
                  index: ch.channelNumber || (channels.length + 1),
                  name: text(ch.name || ch.alias || ('Canal ' + (channels.length + 1))),
                  logo: logo,
                  uhd: ch.quality === '3',
                  fav: ch.isFav || false,
                  now: 'En vivo',
                  next: '',
                  time: ''
                };
                channels.push(mapped);
                liveChannelCache[ch.channelCode] = { at: Date.now(), channel: mapped };
              }
            }
            var hasMore = rawList.length >= pSize;
            if (channels.length) {
              var entry = { at: Date.now(), channels: channels, hasMore: hasMore };
              livePageCache[pageKey] = entry;
              // Only the first page is saved (the list a category opens with): a category of 1000 channels would
              // otherwise put twenty pages in localStorage. The whole list is kept by the app in IndexedDB
              try {
                if (window.localStorage && pNum === 1) {
                  localStorage.setItem(LIVE_PAGE_PREFIX + pageKey, JSON.stringify(entry));
                }
              } catch (e) {}
            }
            callback(null, channels, hasMore);
          }

          // Try modern v7/getLiveData first (Hydra 6.8.1), fallback to v6/getLiveData
          postHttp('v7/getLiveData', livePayload, function (err7, res7) {
            if (!err7 && res7 && res7.channelList) {
              return handleLiveResponse(null, res7);
            }
            postHttp('v6/getLiveData', livePayload, handleLiveResponse);
          });
        });
      });
    }

    runGetLiveData(false);
  }

  function liveCdnsOf(slb) {
    var list = slb && slb.cdn_list || [];
    var cdns = [];
    var seen = {};
    function addCdn(addr, authUrl) {
      var h = bareHost(addr);
      if (h && !seen[h]) {
        seen[h] = true;
        cdns.push({ cflHost: h, authBase: authUrl });
      }
    }
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c && c.tag === 'live' && (String(c.cdn_type) === '4' || String(c.cdn_id || '').indexOf('cloud') !== -1 || String(c.cdn_id || '').indexOf('akamai') !== -1)) {
        var uList = c.url_list || [];
        for (var j = 0; j < uList.length; j++) {
          var u = uList[j];
          var urlStr = u && u.url || '';
          if (u.sign_type === 'cfl' || urlStr.indexOf('sign_type=cfl') !== -1) {
            addCdn(c.main_addr, urlStr);
            if (c.spared_addr) addCdn(c.spared_addr, urlStr);
          }
        }
      }
    }
    for (var d = 0; d < list.length; d++) {
      var f = list[d];
      if (f && f.tag === 'live') {
        var mList = f.url_list || [];
        for (var p = 0; p < mList.length; p++) {
          var v = mList[p];
          var hUrl = v && v.url || '';
          if (hUrl && hUrl.indexOf('token=') !== -1) {
            addCdn(f.main_addr, hUrl);
            if (f.spared_addr) addCdn(f.spared_addr, hUrl);
          }
        }
      }
    }
    // Fallback: accept any live CDN with CFL sign_type (v15/getSlbInfo)
    if (!cdns.length) {
      for (var k = 0; k < list.length; k++) {
        var anyCdn = list[k];
        if (anyCdn && anyCdn.tag === 'live') {
          var aList = anyCdn.url_list || [];
          for (var m = 0; m < aList.length; m++) {
            var au = aList[m];
            var aStr = au && au.url || '';
            if (au.sign_type === 'cfl' || aStr.indexOf('sign_type=cfl') !== -1) {
              addCdn(anyCdn.main_addr, aStr);
              if (anyCdn.spared_addr) addCdn(anyCdn.spared_addr, aStr);
            }
          }
        }
      }
    }
    return cdns;
  }

  var liveResolveCache = {};
  // A category can hold more channels than one page (50): the rest used to be left out without a word
  var LIVE_MAX_PAGES = 20;

  /**
   * Every channel of a category: its pages one after another, up to LIVE_MAX_PAGES. callback(err, channels).
   * With opts.progressive the callback is also called after the first page when more follow, so the list shows at
   * once while the rest downloads; the last call always carries the whole list.
   */
  function getAllLiveChannels(columnId, callback, opts) {
    var progressive = !!(opts && opts.progressive);
    var all = [];
    var seen = {};
    var page = 1;
    function next() {
      getLiveChannels(columnId, page, 50, function (err, list, hasMore) {
        if (err) return page === 1 ? callback(err) : callback(null, all);
        list = list || [];
        for (var i = 0; i < list.length; i++) {
          var code = list[i] && list[i].channelCode;
          if (code && !seen[code]) {
            seen[code] = true;
            all.push(list[i]);
          }
        }
        if (hasMore && list.length && page < LIVE_MAX_PAGES) {
          if (progressive && page === 1) callback(null, all.slice(0));
          page++;
          return next();
        }
        callback(null, all);
      });
    }
    next();
  }

  // opts.fresh: the link just handed out stopped working (401/403, stream dropped): ask the portal again. Without it
  // the "new" link came from this cache and was the same dead one for up to two minutes
  function resolveLive(channelCode, callback, opts) {
    var code = trim(channelCode);
    if (!code) return callback(new Error('channelCode required'));

    if (opts && opts.fresh) {
      delete liveResolveCache[code];
      slbCache = null;
    }
    var cached = liveResolveCache[code];
    if (cached && Date.now() - cached.at < LIVE_RESOLVE_CACHE_MS) {
      return setTimeout(function () { callback(null, cached.stream); }, 0);
    }

    ensureSession(function (err) {
      if (err) return callback(err);

      var attempts = [
        { path: 'v5/startPlayLive', bean: { channelCode: code, type: '1' } },
        { path: 'v4/startPlayLive', bean: { channelCode: code, type: '1' } },
        { path: 'v4/startPlayLive', bean: { channelCode: code, columnId: '76182', type: '1' } },
        { path: 'v4/startPlayLive', bean: { channelCode: code, columnId: 0, type: '1' } }
      ];
      var aIdx = 0;

      function tryStartLive(lastErr) {
        if (aIdx >= attempts.length) return callback(lastErr || new Error('startPlayLive failed'));
        var att = attempts[aIdx++];
        call(att.path, att.bean, function (sErr, sRes) {
          if (sErr) return tryStartLive(sErr);
          var addrList = sRes && sRes.liveAddressList || [];
          var validAddrs = addrList.filter(function (a) { return a && a.playCode && a.license; });
          var chosen = null;
          // Prefer FHD / 1080p definition if available (smart TV selection)
          for (var i = 0; i < validAddrs.length; i++) {
            var def = String(validAddrs[i].definition || validAddrs[i].quality || validAddrs[i].name || '').toUpperCase();
            if (def.indexOf('FHD') !== -1 || def.indexOf('1080') !== -1) {
              chosen = validAddrs[i];
              break;
            }
          }
          if (!chosen) {
            for (var j = 0; j < validAddrs.length; j++) {
              var def2 = String(validAddrs[j].definition || validAddrs[j].quality || validAddrs[j].name || '').toUpperCase();
              if (def2.indexOf('HD') !== -1 || def2.indexOf('720') !== -1) {
                chosen = validAddrs[j];
                break;
              }
            }
          }
          if (!chosen && validAddrs[0]) chosen = validAddrs[0];
          if (!chosen && addrList[0]) chosen = addrList[0];
          if (!chosen || !chosen.license) {
            return callback(new Error('Portal did not return live channel license'));
          }
          buildLiveStream(chosen, sRes);
        });
      }

      function buildLiveStream(chosenAddr, playResp) {
        var playCode = chosenAddr.playCode || code;
        var license = chosenAddr.license;

        getSlb(function (slbErr, slbData) {
          if (slbErr) return callback(slbErr);
          var cdns = liveCdnsOf(slbData);
          if (!cdns.length) return callback(new Error('No live CDN available'));

          function signCdnAuth(authBase) {
            var m = String(authBase || '').match(/token=([0-9a-fA-F]{32})/);
            var tk = m ? m[1] : '';
            var nowMs = Math.floor(Date.now());
            var sg = signO3(tk, nowMs);
            return authBase + '&sign2_method=sign_o3&instance=0&start_moment=' + nowMs + '&sign2=' + sg;
          }

          var primary = cdns[0];
          var streamUrl = 'http://' + primary.cflHost + '/live/' + playCode + '.m3u8';
          var contentAuth = signCdnAuth(primary.authBase);
          var authByHost = {};
          authByHost[primary.cflHost] = contentAuth;

          var backups = [];
          for (var p = 1; p < cdns.length; p++) {
            var bUrl = 'http://' + cdns[p].cflHost + '/live/' + playCode + '.m3u8';
            backups.push(bUrl);
            authByHost[cdns[p].cflHost] = signCdnAuth(cdns[p].authBase);
          }

          var chName = text((playResp && playResp.name) || (liveChannelCache[code] && liveChannelCache[code].channel && liveChannelCache[code].channel.name) || code);
          var streamObj = {
            url: streamUrl,
            proxyPath: streamUrl,
            backupUrls: backups,
            authByHost: authByHost,
            mime: 'application/x-mpegurl',
            isHls: true,
            headers: {
              'Content-Auth': contentAuth,
              'Content-License': license,
              'User-Agent': UA_CDN,
              'App': APP_ID,
              'App-Version': APK_VERSION,
              'X-Buffer': '0'
            },
            name: chName
          };
          liveResolveCache[code] = { at: Date.now(), stream: streamObj };
          callback(null, streamObj);
        });
      }

      tryStartLive(null);
    });
  }

  var itemCache = {};
  function hasUsableArt(url) {
    var s = trim(url);
    return !!s && !/(?:^|\/)placeholder_(?:vertical|horizontal)\.png(?:\?|$)/i.test(s);
  }
  function collectAssetAlternates(asset, extraItem) {
    var seen = {};
    var out = [];
    function pushUrl(u) {
      var s = trim(u);
      if (!hasUsableArt(s) || seen[s]) return;
      seen[s] = true;
      out.push(s);
    }
    var list = asset && asset.posterList;
    if (list && list.length) {
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].fileUrl) pushUrl(list[i].fileUrl);
      }
    }
    if (asset) {
      pushUrl(asset.picture);
      pushUrl(asset.cover);
      pushUrl(asset.posterUrl);
      pushUrl(asset.poster);
    }
    if (extraItem) {
      pushUrl(extraItem.poster);
      if (extraItem.posterAlternates && extraItem.posterAlternates.length) {
        for (var j = 0; j < extraItem.posterAlternates.length; j++) {
          pushUrl(extraItem.posterAlternates[j]);
        }
      }
      pushUrl(extraItem.landscape);
      pushUrl(extraItem.backdrop);
    }
    return out;
  }
  function remember(item) {
    if (!item || !item.id) return;
    var prev = itemCache[item.id] || findItemInLocalCatalogs(item.id);
    if (prev) {
      if (!hasUsableArt(item.poster) && hasUsableArt(prev.poster)) item.poster = prev.poster;
      if (!hasUsableArt(item.landscape) && hasUsableArt(prev.landscape)) item.landscape = prev.landscape;
      if (!hasUsableArt(item.backdrop) && hasUsableArt(prev.backdrop)) item.backdrop = prev.backdrop;
      if (prev.restricted) item.restricted = true;
      if (prev.privateContent) item.privateContent = true;
    }
    item.posterAlternates = collectAssetAlternates(null, item);
    if (prev) {
      var mergedAlts = collectAssetAlternates(null, prev);
      for (var k = 0; k < mergedAlts.length; k++) {
        if (item.posterAlternates.indexOf(mergedAlts[k]) === -1) {
          item.posterAlternates.push(mergedAlts[k]);
        }
      }
    }
    itemCache[item.id] = item;
  }

  // Row name for the aggregation tiles (the portal sends that row without a name)
  var COLLECTIONS_ROW = 'Colecciones';

  // One tile of an aggregation row: a column of the root, not a title
  function collectionFromColumn(column, cat) {
    var colId = parseInt(column && (column.columnId || column.id), 10);
    if (!colId) return null;
    var art = imageOf(column, 'poster') || imageOf(column, 'banner');
    return {
      id: 'collection:' + colId,
      title: text(column.name || column.alias),
      category: cat || '',
      kind: 'coleccion',
      collectionId: colId,
      score: '',
      year: '',
      genres: ['Colección'],
      poster: art,
      landscape: art,
      backdrop: art,
      row: COLLECTIONS_ROW,
      streamUrl: '',
      portal: true
    };
  }

  function itemFromAsset(asset, cat, defaultKind) {
    if (!asset || !trim(asset.contentId)) return null;
    var pType = trim(asset.programType) || 'movie';
    var isSeries = pType === 'teleplay' || pType === 'series' || (asset.volumnCount && parseInt(asset.volumnCount, 10) > 1);
    var posterUrl = imageOf(asset, 'icon') || imageOf(asset, 'poster') || imageOf(asset, '1') || trim(asset.picture || asset.cover || asset.posterUrl);
    var landscapeUrl = imageOf(asset, 'poster') || imageOf(asset, 'stage') || imageOf(asset, '2') || posterUrl;
    var backdropUrl = imageOf(asset, 'stage') || imageOf(asset, 'poster') || imageOf(asset, '4') || imageOf(asset, '3') || landscapeUrl;
    var posterAlternates = collectAssetAlternates(asset, null);

    var item = {
      id: trim(asset.contentId),
      title: text(asset.name || asset.title),
      category: cat || '',
      kind: defaultKind || (isSeries ? 'serie' : 'película'),
      score: (asset.score === undefined || asset.score === null || asset.score === '') ? '—' : text(asset.score),
      year: trim(asset.releaseTime || asset.releaseDate) ? trim(asset.releaseTime || asset.releaseDate).slice(0, 4) : '—',
      duration: text(asset.duration),
      genres: genresOf(asset),
      director: text(asset.director),
      actors: text(asset.actorDisplay || asset.actors),
      synopsis: text(asset.description || asset.synopsis),
      poster: posterUrl || posterAlternates[0] || '',
      posterAlternates: posterAlternates,
      landscape: landscapeUrl,
      backdrop: backdropUrl,
      type: isSeries ? 'teleplay' : pType,
      alias: text(asset.alias || asset.enName || asset.name),
      country: trim(asset.originalCountry || asset.country),
      releaseDate: trim(asset.releaseTime || asset.releaseDate),
      tagline: trim(asset.viewPoint || asset.tagline),
      volumeCount: (asset.volumnCount === undefined || asset.volumnCount === null) ? (parseInt(asset.volumeCount, 10) || 0) : (parseInt(asset.volumnCount, 10) || 0),
      updateCount: (asset.updateCount === undefined || asset.updateCount === null) ? 0 : (parseInt(asset.updateCount, 10) || 0),
      moreAudio: asset.moreAudio !== undefined ? asset.moreAudio : 0,
      moreSubtitle: asset.moreSubtitle !== undefined ? asset.moreSubtitle : 0,
      row: '',
      streamUrl: '',
      portal: true
    };
    remember(item);
    return item;
  }

  function findItemInLocalCatalogs(contentId) {
    if (itemCache[contentId]) return itemCache[contentId];
    var p = window.XUPERTV_PORTAL;
    if (p && p.items) {
      for (var i = 0; i < p.items.length; i++) {
        if (p.items[i] && p.items[i].id === contentId) return p.items[i];
      }
    }
    var c = window.XUPERTV_CATALOG;
    if (c && c.items) {
      for (var j = 0; j < c.items.length; j++) {
        if (c.items[j] && c.items[j].id === contentId) return c.items[j];
      }
    }
    return null;
  }

  function detail(contentId, callback) {
    var cid = trim(contentId);
    if (!cid) return callback(new Error('Missing contentId'));
    ensureSession(function (err) {
      if (err) return callback(err);
      var local = findItemInLocalCatalogs(cid) || itemCache[cid];
      var initialType = (local && (local.kind === 'película' || local.type === 'movie' || local.programType === 'movie')) ? '1' : '0';

      function requestItem(reqType, onDone) {
        call('v4/getItemData', {
          contentId: cid,
          type: reqType,
          sortType: '0',
          language: 'en',
          macAddr: deviceIdentity(false).etheMac
        }, function (dErr, dRes) {
          if (dErr && dErr.portalCode === 'portal100006' && reqType !== '1') {
            return requestItem('1', onDone);
          }
          if (dErr && dErr.portalCode === 'portal100006' && reqType === '1' && initialType === '1') {
            return requestItem('0', onDone);
          }
          onDone(dErr, dRes);
        });
      }

      requestItem(initialType, function (dErr, dRes) {
        if (dErr) {
          if (dErr.portalCode === 'portal100006' && local) {
            return callback(null, { item: local, episodes: [], seasons: [] });
          }
          return callback(dErr);
        }
        var asset = dRes && dRes.assetData;
        if (!asset) {
          if (local) return callback(null, { item: local, episodes: [], seasons: [] });
          return callback(new Error('No item data returned'));
        }
        var item = itemFromAsset(asset, local ? local.category : '', null);
        if (local) {
          item.row = local.row;
          item.category = local.category;
        }

        var isSeriesAsset = item.kind === 'serie' || item.type === 'teleplay' || (asset.volumnCount && parseInt(asset.volumnCount, 10) > 1);
        var episodes = [];
        var progList = asset.simpleProgramList || [];
        var allQualities = [];
        for (var i = 0; i < progList.length; i++) {
          var p = progList[i];
          if (p) {
            var qStr = text(p.quality);
            if (qStr) {
              var qParts = qStr.split(',');
              for (var k = 0; k < qParts.length; k++) {
                var qClean = trim(qParts[k]).toLowerCase();
                if (qClean && allQualities.indexOf(qClean) === -1) allQualities.push(qClean);
              }
            }
            if (isSeriesAsset) {
              var epObj = {
                id: trim(p.contentId),
                title: text(p.name),
                name: text(p.name),
                number: p.seriesNumber === undefined || p.seriesNumber === null ? i + 1 : p.seriesNumber,
                duration: text(p.duration),
                quality: qStr,
                qualities: qStr ? qStr.split(',').map(function (s) { return trim(s).toLowerCase(); }) : allQualities,
                picture: text(p.picture || p.pic || p.image || p.cover || p.posterUrl || p.poster),
                description: text(p.description || p.desc || p.synopsis || p.shortDescription || p.introduce)
              };
              episodes.push(epObj);
              if (epObj.id) {
                itemCache[epObj.id] = {
                  id: epObj.id,
                  quality: qStr,
                  qualities: epObj.qualities
                };
              }
            } else if (p.contentId) {
              itemCache[trim(p.contentId)] = {
                id: trim(p.contentId),
                quality: qStr,
                qualities: allQualities
              };
            }
          }
        }

        item.qualities = allQualities;
        if (allQualities.length && !item.quality) {
          item.quality = allQualities.join(',');
        }
        remember(item);

        var seasons = [];
        if (isSeriesAsset) {
          var sList = asset.sameSeasonSeriesList || [];
          for (var m = 0; m < sList.length; m++) {
            if (sList[m] && trim(sList[m].contentId)) {
              var sNum = sList[m].seasonNumber;
              var sName = text(sList[m].name || sList[m].title || sList[m].seriesName || sList[m].alias);
              seasons.push({
                id: trim(sList[m].contentId),
                name: sName,
                number: sNum !== undefined && sNum !== null && !isNaN(Number(sNum)) ? Number(sNum) : undefined
              });
            }
          }
        }
        callback(null, { item: item, episodes: episodes, seasons: seasons });
      });
    });
  }

  /* Size of a ranked row from its name ("Películas TOP15 clasificadas" → 15), 0 for any other row */
  function rankedSize(name) {
    var m = /\btop\s?(\d{1,2})(?!\d)/i.exec(String(name || ''));
    return m ? parseInt(m[1], 10) : 0;
  }

  var treeCache = {};
  // opts.low: background refresh, waits behind every other request
  function home(root, pageNum, callback, opts) {
    if (typeof pageNum === 'function') {
      opts = callback;
      callback = pageNum;
      pageNum = 1;
    }
    opts = opts || {};
    root = ROOT_CODES[root] ? root : 'movies';
    pageNum = Math.max(1, parseInt(pageNum, 10) || 1);
    var cacheKey = root + ':' + pageNum;
    if (treeCache[cacheKey] && Date.now() - treeCache[cacheKey].at < TREE_TTL) {
      return callback(null, { root: root, pageNum: pageNum, items: treeCache[cacheKey].items, cached: true });
    }

    ensureSession(function (err) {
      if (err) return callback(err);
      call('getNextColumns', {
        columnCode: ROOT_CODES[root],
        pageNum: pageNum,
        pageSize: 60,
        version: ''
      }, { low: !!opts.low }, function (cErr, cRes) {
        if (cErr) return callback(cErr);
        var recList = cRes && cRes.recommendList || [];
        var cat = ROOT_CATEGORY[root] || '';
        function rowTitles(assets, rowName) {
          var out = [];
          for (var j = 0; j < assets.length; j++) {
            var it = itemFromAsset(assets[j], cat, null);
            if (it) {
              it.row = rowName;
              if (root === 'free' && /free\.kids/i.test(it.row) && it.category.indexOf('infantil') === -1) {
                it.category += ',infantil';
              }
              out.push(it);
            }
          }
          return out;
        }
        var rows = [];
        for (var i = 0; i < recList.length; i++) {
          var col = recList[i];
          var name = text(col && col.name);
          var row = { col: col, name: name, titles: rowTitles(col && col.assetList || [], name), tiles: [] };
          // Aggregation row (e.g. Kids: Minions, Toy Story…): tiles that open a column of the root
          var agg = col && col.aggregationList || [];
          for (var g = 0; g < agg.length; g++) {
            var tile = collectionFromColumn(agg[g], cat);
            if (tile) row.tiles.push(tile);
          }
          rows.push(row);
        }

        function done() {
          var items = [];
          for (var r = 0; r < rows.length; r++) items = items.concat(rows[r].titles, rows[r].tiles);
          treeCache[cacheKey] = { at: Date.now(), items: items };
          callback(null, { root: root, pageNum: pageNum, items: items, cached: false });
        }

        // The home sends at most 10 titles per row, also for its ranked rows ("Películas TOP15 clasificadas"):
        // those get their whole list from the row's column (the column id must be a number, or the portal
        // answers "request parameters error"). If that fails, the row keeps the 10 it has.
        var pending = 0;
        for (var k = 0; k < rows.length; k++) {
          (function (row) {
            var want = rankedSize(row.name);
            var id = parseInt(row.col && (row.col.columnId || row.col.id), 10);
            if (!want || !id || row.titles.length >= want) return;
            pending++;
            call('v3/getShelveData', { columnId: id, columnType: '2', pageNum: 1, pageSize: Math.max(20, want) }, { low: !!opts.low }, function (sErr, sRes) {
              var full = sErr ? [] : rowTitles(sRes && sRes.assetList || [], row.name);
              if (full.length > row.titles.length) row.titles = full.slice(0, want);
              if (--pending === 0) done();
            });
          })(rows[k]);
        }
        if (pending === 0) done();
      });
    });
  }

  // Root column ids for the full listings (v3/getColumnContents of the portal tree)
  var ROOT_IDS = {
    featured: 76176,
    movies: 76177,
    series: 76178,
    kids: 76783,
    anime: 76180,
    explorar: 76784,
    // "Hot Search-Ranking": its child "Busca popular" holds the titles of the search screen
    search: 76301,
    // Adult (restricted): its children only come with specialFlag "1"; the app opens it after the PIN
    adult: 76300
  };

  // Category tree (v3/getColumnContents): children of a column, as the official app's sidebar.
  // Sorted by the portal's `sequence`; restricted (adult) columns are left out unless opts.special
  // (specialFlag "1", the adult section opened after the PIN).
  var columnCache = {};
  var restrictedColumns = { '76300': true };
  function columns(columnId, callback, opts) {
    var special = !!(opts && opts.special) || String(columnId) === String(ROOT_IDS.adult);
    if (special) restrictedColumns[String(columnId)] = true;
    var key = String(columnId) + (special ? ':s' : '');
    var hit = columnCache[key];
    if (hit && Date.now() - hit.at < TREE_TTL) return callback(null, hit.list);
    ensureSession(function (err) {
      if (err) return callback(err);
      var body = { columnId: columnId, pageNum: 1, pageSize: 1000 };
      if (special) body.specialFlag = '1';
      call('v3/getColumnContents', body, { low: !!(opts && opts.low) }, function (cErr, cRes) {
        if (cErr) return callback(cErr);
        var raw = cRes && cRes.childColumnList || [];
        var list = [];
        for (var i = 0; i < raw.length; i++) {
          var c = raw[i];
          if (!c || !c.id || (!special && String(c.restricted) === '1')) continue;
          var isColRestricted = special || String(c.restricted) === '1';
          if (isColRestricted) restrictedColumns[String(c.id)] = true;
          list.push({ id: c.id, code: text(c.code), name: text(c.name), free: String(c.free) === '1', restricted: isColRestricted, sequence: parseInt(c.sequence, 10) || 0 });
        }
        list.sort(function (a, b) { return a.sequence - b.sequence; });
        columnCache[key] = { at: Date.now(), list: list };
        callback(null, list);
      });
    });
  }

  // Titles of one column, page by page (v3/getShelveData). Kept for the `freshTime` the portal sends.
  var shelfCache = {};
  var shelfCount = 0;
  function columnPage(columnId, pageNum, pageSize, callback, opts) {
    pageNum = Math.max(1, parseInt(pageNum, 10) || 1);
    pageSize = pageSize || 42;
    var isRestrictedCol = !!(restrictedColumns[String(columnId)] || (opts && opts.restricted));
    if (isRestrictedCol) restrictedColumns[String(columnId)] = true;
    var key = columnId + ':' + pageNum + ':' + pageSize;
    var hit = shelfCache[key];
    if (hit && Date.now() < hit.until) return callback(null, { items: hit.items, total: hit.total, cached: true });
    ensureSession(function (err) {
      if (err) return callback(err);
      call('v3/getShelveData', { columnId: columnId, columnType: '2', pageNum: pageNum, pageSize: pageSize }, { low: !!(opts && opts.low) }, function (sErr, sRes) {
        if (sErr) return callback(sErr);
        var list = sRes && sRes.assetList || [];
        var items = [];
        for (var i = 0; i < list.length; i++) {
          var it = itemFromAsset(list[i], isRestrictedCol ? 'adult' : '', null);
          if (it) {
            if (isRestrictedCol) {
              it.restricted = true;
              it.privateContent = true;
              it.category = 'adult';
              remember(it);
            }
            items.push(it);
          }
        }
        var total = parseInt(sRes && sRes.assetListTotalSize, 10) || items.length;
        var fresh = parseInt(sRes && sRes.freshTime, 10) || 600;
        if (++shelfCount > 120) {
          shelfCache = {};
          shelfCount = 0;
        }
        shelfCache[key] = { until: Date.now() + fresh * 1000, items: items, total: total };
        callback(null, { items: items, total: total, cached: false });
      });
    });
  }

  // Full catalog of a root, page by page; filters: { tags, year, originalCountry, audio } (portal values: English names, audio key)
  // opts.low: prefetch, waits behind every other request
  function browse(root, filters, pageNum, pageSize, callback, opts) {
    var columnId = ROOT_IDS[root];
    if (!columnId) return callback(new Error('unknown root ' + root));
    var body = { columnId: columnId, pageNum: Math.max(1, pageNum || 1), pageSize: pageSize || 42 };
    filters = filters || {};
    if (filters.tags) body.tags = filters.tags;
    if (filters.year) body.year = filters.year;
    if (filters.originalCountry) body.originalCountry = filters.originalCountry;
    if (filters.audio) body.audio = filters.audio;
    ensureSession(function (err) {
      if (err) return callback(err);
      call('v3/filterByContent', body, { low: !!(opts && opts.low) }, function (fErr, fRes) {
        if (fErr) return callback(fErr);
        var list = fRes && fRes.assetList || [];
        var items = [];
        for (var i = 0; i < list.length; i++) {
          var it = itemFromAsset(list[i], ROOT_CATEGORY[root] || '', null);
          if (it) items.push(it);
        }
        callback(null, { items: items, total: parseInt(fRes && fRes.totalSize, 10) || 0 });
      });
    });
  }

  var filterCache = {};
  // Filter values of a root: { tags: [...], year: [...], originalCountry: [...], audio: [{ key, value }] }
  function browseFilters(root, callback) {
    var columnId = ROOT_IDS[root];
    if (!columnId) return callback(new Error('unknown root ' + root));
    if (filterCache[root]) return callback(null, filterCache[root]);
    ensureSession(function (err) {
      if (err) return callback(err);
      call('v3/filterGenre', { columnId: columnId }, function (gErr, gRes) {
        if (gErr) return callback(gErr);
        filterCache[root] = {
          tags: gRes && gRes.tags || [],
          year: gRes && gRes.year || [],
          originalCountry: gRes && gRes.originalCountry || [],
          audio: gRes && gRes.audio || []
        };
        callback(null, filterCache[root]);
      });
    });
  }

  function normSearchTitle(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\b(?:temporada|season)\s*\d+\b/gi, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function supplementSearchArtwork(items) {
    if (!items || !items.length) return items;
    var needTitleMatch = false;
    for (var i = 0; i < items.length; i++) {
      if (!hasUsableArt(items[i].poster)) {
        needTitleMatch = true;
        break;
      }
    }
    if (!needTitleMatch) return items;
    var byTitle = {};
    function indexPool(pool) {
      if (!pool) return;
      for (var k = 0; k < pool.length; k++) {
        var c = pool[k];
        if (!c || !hasUsableArt(c.poster)) continue;
        var nt = normSearchTitle(c.title);
        if (!nt) continue;
        var kind = (c.type === 'teleplay' || c.kind === 'serie') ? 's' : 'm';
        var yr = trim(c.year);
        if (yr && yr !== '—') byTitle[nt + '|' + kind + '|' + yr] = c;
        if (!byTitle[nt + '|' + kind]) byTitle[nt + '|' + kind] = c;
        if (!byTitle[nt]) byTitle[nt] = c;
      }
    }
    var cachedList = [];
    for (var cid in itemCache) {
      if (Object.prototype.hasOwnProperty.call(itemCache, cid)) cachedList.push(itemCache[cid]);
    }
    indexPool(cachedList);
    if (window.XUPERTV_PORTAL && window.XUPERTV_PORTAL.items) indexPool(window.XUPERTV_PORTAL.items);
    if (window.XUPERTV_CATALOG && window.XUPERTV_CATALOG.items) indexPool(window.XUPERTV_CATALOG.items);

    for (var m = 0; m < items.length; m++) {
      var it = items[m];
      if (!it || hasUsableArt(it.poster)) continue;
      var t = normSearchTitle(it.title);
      if (!t) continue;
      var knd = (it.type === 'teleplay' || it.kind === 'serie') ? 's' : 'm';
      var y = trim(it.year);
      var match = (y && y !== '—' && byTitle[t + '|' + knd + '|' + y]) || byTitle[t + '|' + knd] || byTitle[t];
      if (match && hasUsableArt(match.poster)) {
        it.poster = match.poster;
        if (!hasUsableArt(it.landscape) && hasUsableArt(match.landscape)) it.landscape = match.landscape;
        if (!hasUsableArt(it.backdrop) && hasUsableArt(match.backdrop)) it.backdrop = match.backdrop;
        it.posterAlternates = collectAssetAlternates(null, it);
        remember(it);
      }
    }
    return items;
  }

  var searchCache = {};
  // opts.pageSize: results wanted (default 20)
  function search(value, callback, opts) {
    var val = trim(value);
    if (!val) return callback(null, { items: [] });
    var size = (opts && opts.pageSize) || 20;
    var key = val.toLowerCase() + '|' + size;
    if (searchCache[key] && Date.now() - searchCache[key].at < SEARCH_TTL) {
      return callback(null, { items: supplementSearchArtwork(searchCache[key].items), cached: true });
    }
    ensureSession(function (err) {
      if (err) return callback(err);
      call('v3/searchByName', {
        value: val,
        type: '0',
        columnId: '',
        filter: '',
        pageNum: 1,
        pageSize: size
      }, function (sErr, sRes) {
        if (sErr) return callback(sErr);
        var list = sRes && sRes.searchItemList || [];
        var items = [];
        var seen = {};
        for (var i = 0; i < list.length; i++) {
          var iList = list[i] && list[i].itemList || [];
          for (var j = 0; j < iList.length; j++) {
            var it = itemFromAsset(iList[j], '', null);
            if (it && !seen[it.id]) {
              seen[it.id] = true;
              items.push(it);
            }
          }
        }
        supplementSearchArtwork(items);
        searchCache[key] = { at: Date.now(), items: items };
        callback(null, { items: items, total: sRes && sRes.totalSize, cached: false });
      });
    });
  }

  function getHome(callback) {
    ensureSession(function (err) {
      if (err) return callback(err);
      call('getHome', { homePageCode: 'home' }, function (pErr, pRes) {
        if (pErr) return callback(pErr);
        callback(null, pRes);
      });
    });
  }

  function getShelveData(shelveId, pageNum, pageSize, callback) {
    ensureSession(function (err) {
      if (err) return callback(err);
      var pNum = Math.max(1, parseInt(pageNum, 10) || 1);
      var pSize = Math.max(1, Math.min(50, parseInt(pageSize, 10) || 20));
      call('v3/getShelveData', {
        shelveId: String(shelveId || ''),
        pageNum: pNum,
        pageSize: pSize
      }, function (sErr, sRes) {
        if (sErr) return callback(sErr);
        callback(null, sRes);
      });
    });
  }

  function getShortVideo(pageNum, pageSize, callback) {
    ensureSession(function (err) {
      if (err) return callback(err);
      var pNum = Math.max(1, parseInt(pageNum, 10) || 1);
      var pSize = Math.max(1, Math.min(50, parseInt(pageSize, 10) || 20));
      call('getShortVideo', {
        homePageCode: 'home',
        pageNum: pNum,
        pageSize: pSize
      }, function (vErr, vRes) {
        if (vErr) return callback(vErr);
        callback(null, vRes);
      });
    });
  }

  function getPerson(contentId, callback) {
    ensureSession(function (err) {
      if (err) return callback(err);
      call('getPerson', {
        contentId: String(contentId || ''),
        imdb: '',
        type: '0',
        macAddr: deviceIdentity(false).etheMac
      }, function (pErr, pRes) {
        if (pErr) return callback(pErr);
        var data = pRes && pRes.data ? pRes.data : pRes;
        callback(null, data || {});
      });
    });
  }

  function getItemByPerson(puId, pageNum, pageSize, callback) {
    ensureSession(function (err) {
      if (err) return callback(err);
      var pNum = Math.max(1, parseInt(pageNum, 10) || 1);
      var pSize = Math.max(1, Math.min(50, parseInt(pageSize, 10) || 24));
      call('getItemByPerson', {
        puId: String(puId || ''),
        type: '0',
        pageNum: pNum,
        pageSize: pSize
      }, function (wErr, wRes) {
        if (wErr) return callback(wErr);
        var data = wRes && wRes.data ? wRes.data : wRes;
        var list = (data && (data.assetList || data.list)) || [];
        var total = (data && (data.totalSize || data.total)) || list.length;
        var items = [];
        for (var i = 0; i < list.length; i++) {
          var it = itemFromAsset(list[i]);
          if (it) items.push(it);
        }
        callback(null, { items: items, total: total });
      });
    });
  }

  function getAllbackProgram(channelCode, columnId, pageNum, pageSize, callback) {
    ensureSession(function (err) {
      if (err) return callback(err);
      var pNum = Math.max(1, parseInt(pageNum, 10) || 1);
      var pSize = Math.max(1, Math.min(100, parseInt(pageSize, 10) || 50));
      call('getAllbackProgram', {
        channelCode: String(channelCode || ''),
        columnId: parseInt(columnId, 10) || 0,
        pageNum: pNum,
        pageSize: pSize
      }, function (cErr, cRes) {
        if (cErr) return callback(cErr);
        var data = cRes && cRes.data ? cRes.data : cRes;
        var list = (data && (data.channelList || data.programList || data.list)) || [];
        var total = (data && (data.totalSize || data.total)) || list.length;
        callback(null, { programs: list, total: total });
      });
    });
  }

  function startPlayBTV(channelCode, contentId, columnId, callback) {
    ensureSession(function (err) {
      if (err) return callback(err);
      call('v6/startPlayBTV', {
        channelCode: String(channelCode || ''),
        contentId: String(contentId || ''),
        columnId: parseInt(columnId, 10) || 0,
        type: '0'
      }, function (bErr, bRes) {
        if (bErr) return callback(bErr);
        var data = bRes && bRes.data ? bRes.data : bRes;
        var urls = (data && data.totalPlayUrlList) || [];
        var playUrl = urls.length > 0 ? (urls[0].playUrl || urls[0].url || urls[0]) : (data && data.playUrl);
        callback(null, { url: playUrl, raw: data });
      });
    });
  }

  // Once the app has started: old channel pages go
  setTimeout(function () { dropLivePages(LIVE_PAGE_KEEP_MS); }, 20000);

  window.MagisClient = {
    ensureSession: ensureSession,
    resolve: resolve,
    warmSlb: warmSlb,
    mediaInfo: mediaInfo,
    mediaOptions: mediaOptions,
    detail: detail,
    getPerson: getPerson,
    getItemByPerson: getItemByPerson,
    getAllbackProgram: getAllbackProgram,
    startPlayBTV: startPlayBTV,
    home: home,
    getHome: getHome,
    getShelveData: getShelveData,
    getShortVideo: getShortVideo,
    browse: browse,
    browseFilters: browseFilters,
    columns: columns,
    columnPage: columnPage,
    rootIds: ROOT_IDS,
    search: search,
    getLiveCategories: getLiveCategories,
    getLiveChannels: getLiveChannels,
    getAllLiveChannels: getAllLiveChannels,
    resolveLive: resolveLive,
    hosts: HOSTS,
    diag: function (callback) {
      ensureSession(function (err) {
        if (err) return callback(err);
        getSlb(function (sErr, slb) {
          if (sErr) return callback(sErr);
          callback(null, { cdns: vodCdns(slb).length });
        });
      });
    },
    call: call
  };

  console.log('[MagisClient] Initialized successfully.');
})(window);
