/**
 * Tizen bridge for XuperTV port
 * Connects Samsung Tizen TV environment with XuperTV web app,
 * handles remote control mapping, local Luna service emulation (MagisClient + M3U),
 * and native AVPlay hardware acceleration for MPEG-TS / VOD playback.
 */
(function (window) {
  'use strict';

  // Stream links carry tokens: the console only gets their host
  function logHost(url) {
    var m = /^[a-z]+:\/\/([^/?#]+)/i.exec(String(url || ''));
    return m ? m[1] : '';
  }

  var isTizen = (typeof tizen !== 'undefined');
  var isWebOS = (typeof webOS !== 'undefined' && webOS.platform && webOS.platform.tv);

  window.__xuperLog = function () {
    if (console && console.log) console.log.apply(console, arguments);
  };

  window.XuperPlatform = {
    name: isTizen ? 'tizen' : (isWebOS ? 'webos' : 'browser'),
    isTizen: isTizen,
    isWebOS: isWebOS
  };

  // Player errors and stalls for the in-app problem report (src/lib/playbackLog.ts receives them;
  // it keeps only the host of the link)
  function reportPlayback(kind, detail, url) {
    try {
      if (window.__xuperPlaybackEvent) window.__xuperPlaybackEvent({ kind: kind, player: 'AVPlay', detail: String(detail || ''), url: url || '' });
    } catch (e) {}
  }

  // 1. Polyfill HTMLMediaElement.play() for Tizen 3.0 WebKit (returns undefined instead of a Promise)
  if (typeof window !== 'undefined' && window.HTMLMediaElement) {
    try {
      var origPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        try {
          var r = origPlay.apply(this, arguments);
          if (r && typeof r.then === 'function') return r;
          return Promise.resolve();
        } catch (e) {
          return Promise.resolve();
        }
      };
    } catch (_) {}
  }

  // 2. Protect SourceBuffer against QuotaExceededError on memory-constrained Tizen 3.0 / 4.0 TVs
  if (typeof window !== 'undefined' && window.SourceBuffer) {
    try {
      var origAppendBuffer = SourceBuffer.prototype.appendBuffer;
      SourceBuffer.prototype.appendBuffer = function (buf) {
        try {
          return origAppendBuffer.call(this, buf);
        } catch (err) {
          if (err && (err.name === 'QuotaExceededError' || err.code === 22)) {
            console.warn('[SourceBuffer] QuotaExceededError caught, trimming buffer...');
            try {
              if (this.buffered && this.buffered.length > 0 && !this.updating) {
                var start = this.buffered.start(0);
                var end = this.buffered.end(0);
                if (end - start > 10) {
                  this.remove(start, start + 8);
                }
              }
            } catch (_) {}
          }
          throw err;
        }
      };
    } catch (_) {}
  }

  // 3. Legacy Tizen 3.0 / 4.0 DOM & ES5 Shims (WebKit 538.1 / Chromium 56)
  if (typeof globalThis === 'undefined') {
    window.globalThis = window;
  }
  if (!window.crypto) window.crypto = {};
  if (!window.crypto.getRandomValues) {
    window.crypto.getRandomValues = function (arr) {
      for (var i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256);
      }
      return arr;
    };
  }
  if (typeof Object.assign !== 'function') {
    Object.assign = function (target) {
      if (target == null) throw new TypeError('Target is null');
      var t = Object(target);
      for (var i = 1; i < arguments.length; i++) {
        var s = arguments[i];
        if (s != null) {
          for (var k in Object(s)) {
            if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k];
          }
        }
      }
      return t;
    };
  }
  if (!Array.from) {
    // Iterables (Set, Map) and array-likes ({ length: n }), with the optional map function
    Array.from = function (obj, mapFn, thisArg) {
      if (obj == null) throw new TypeError('Array.from requires an array-like or iterable');
      var out = [];
      if (typeof Symbol !== 'undefined' && Symbol.iterator && typeof obj[Symbol.iterator] === 'function') {
        var it = obj[Symbol.iterator](), step;
        while (!(step = it.next()).done) out.push(step.value);
      } else {
        var len = Number(obj.length) || 0;
        for (var i = 0; i < len; i++) out.push(obj[i]);
      }
      return typeof mapFn === 'function' ? out.map(mapFn, thisArg) : out;
    };
  }
  if (!Object.values) {
    Object.values = function (obj) { return Object.keys(obj).map(function (k) { return obj[k]; }); };
  }
  if (!Number.isSafeInteger) {
    Number.isSafeInteger = function (n) {
      return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && Math.abs(n) <= 9007199254740991;
    };
  }
  // As the standard: a string already at or over the length is returned whole, only the padding is cut
  function padding(s, n, c) {
    c = c === undefined ? ' ' : String(c);
    var need = (n >> 0) - s.length;
    if (need <= 0 || !c) return '';
    var pad = '';
    while (pad.length < need) pad += c;
    return pad.slice(0, need);
  }
  if (!String.prototype.padStart) {
    String.prototype.padStart = function (n, c) { var s = String(this); return padding(s, n, c) + s; };
  }
  if (!String.prototype.padEnd) {
    String.prototype.padEnd = function (n, c) { var s = String(this); return s + padding(s, n, c); };
  }
  if (!String.prototype.includes) {
    String.prototype.includes = function (v) { return this.indexOf(v) >= 0; };
  }
  if (!String.prototype.startsWith) {
    String.prototype.startsWith = function (v) { return this.slice(0, v.length) === v; };
  }
  if (!String.prototype.endsWith) {
    String.prototype.endsWith = function (v) { return this.slice(-v.length) === v; };
  }
  if (!Array.prototype.includes) {
    Array.prototype.includes = function (v) { return this.indexOf(v) >= 0; };
  }
  if (!Array.prototype.find) {
    Array.prototype.find = function (fn, thisArg) {
      for (var i = 0; i < this.length; i++) {
        if (fn.call(thisArg, this[i], i, this)) return this[i];
      }
      return undefined;
    };
  }
  if (!Array.prototype.findIndex) {
    Array.prototype.findIndex = function (fn, thisArg) {
      for (var i = 0; i < this.length; i++) {
        if (fn.call(thisArg, this[i], i, this)) return i;
      }
      return -1;
    };
  }
  if (typeof Element !== 'undefined') {
    if (!Element.prototype.matches) {
      Element.prototype.matches =
        Element.prototype.webkitMatchesSelector ||
        Element.prototype.mozMatchesSelector ||
        Element.prototype.msMatchesSelector ||
        function (s) {
          var matches = (this.document || this.ownerDocument).querySelectorAll(s);
          var i = matches.length;
          while (--i >= 0 && matches.item(i) !== this) {}
          return i > -1;
        };
    }
    if (!Element.prototype.closest) {
      Element.prototype.closest = function (s) {
        var el = this;
        do {
          if (el.matches && el.matches(s)) return el;
          el = el.parentElement || el.parentNode;
        } while (el !== null && el.nodeType === 1);
        return null;
      };
    }
  }
  if (!window.AbortController) {
    window.AbortController = function () {
      var signal = (this.signal = {
        aborted: false,
        listeners: [],
        addEventListener: function (e, fn) { if (e === 'abort') this.listeners.push(fn); },
        removeEventListener: function (e, fn) { this.listeners = this.listeners.filter(function (x) { return x !== fn; }); }
      });
      this.abort = function () {
        signal.aborted = true;
        signal.listeners.forEach(function (fn) { fn(); });
      };
    };
    // fetch on these engines ignores a signal: make abort() reject it, so timeouts (sign-in, updates) fire
    if (typeof window.fetch === 'function') {
      var nativeFetch = window.fetch;
      var abortError = function () {
        try { return new DOMException('The operation was aborted.', 'AbortError'); } catch (_) {
          var e = new Error('The operation was aborted.'); e.name = 'AbortError'; return e;
        }
      };
      window.fetch = function (input, init) {
        var signal = init && init.signal;
        var request = nativeFetch.call(window, input, init);
        if (!signal || typeof signal.addEventListener !== 'function') return request;
        if (signal.aborted) return Promise.reject(abortError());
        return new Promise(function (resolve, reject) {
          signal.addEventListener('abort', function () { reject(abortError()); });
          request.then(resolve, reject);
        });
      };
    }
  }
  if (!Array.prototype.flat) {
    Array.prototype.flat = function (depth) {
      var d = depth === undefined ? 1 : Number(depth) || 0;
      var out = [];
      (function add(list, level) {
        for (var i = 0; i < list.length; i++) {
          if (Array.isArray(list[i]) && level > 0) add(list[i], level - 1);
          else if (i in list) out.push(list[i]);
        }
      })(this, d);
      return out;
    };
  }
  if (!Array.prototype.flatMap) {
    Array.prototype.flatMap = function (fn, thisArg) { return Array.prototype.map.call(this, fn, thisArg).flat(); };
  }
  if (!String.prototype.trimStart) String.prototype.trimStart = function () { return String(this).replace(/^\s+/, ''); };
  if (!String.prototype.trimEnd) String.prototype.trimEnd = function () { return String(this).replace(/\s+$/, ''); };
  if (!Object.fromEntries) {
    Object.fromEntries = function (entries) {
      var out = {};
      Array.from(entries).forEach(function (pair) { out[pair[0]] = pair[1]; });
      return out;
    };
  }
  if (typeof Promise !== 'undefined' && !Promise.prototype.finally) {
    Promise.prototype.finally = function (fn) {
      return this.then(
        function (v) { return Promise.resolve(fn()).then(function () { return v; }); },
        function (e) { return Promise.resolve(fn()).then(function () { throw e; }); }
      );
    };
  }

  // 3b. Flex gap (Chromium 84+, Tizen 6.5 and newer): older TVs ignore it and everything touches. Their pages get
  // html.no-flexgap, and the styles give those boxes margins instead (src/styles/index.css)
  try {
    var probe = document.createElement('div');
    probe.style.display = 'flex';
    probe.style.flexDirection = 'column';
    probe.style.rowGap = '1px';
    probe.appendChild(document.createElement('div'));
    probe.appendChild(document.createElement('div'));
    document.documentElement.appendChild(probe);
    var flexGap = probe.scrollHeight === 1;
    probe.parentNode.removeChild(probe);
    if (!flexGap) document.documentElement.className += ' no-flexgap';
  } catch (_) {}

  // 4. Universal resolution auto-scaler (720p, 1366x768, 1080p, 4K)
  function fitResolution() {
    try {
      var sw = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 1920;
      var sh = window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 1080;
      var root = document.getElementById('root');
      if (!root) return;

      if (sw !== 1920 || sh !== 1080) {
        var scaleX = sw / 1920;
        var scaleY = sh / 1080;
        var scale = Math.min(scaleX, scaleY);
        root.style.transform = 'scale(' + scale + ')';
        root.style.transformOrigin = '0 0';
        root.style.width = '1920px';
        root.style.height = '1080px';
        root.style.position = 'absolute';
        root.style.left = Math.max(0, (sw - 1920 * scale) / 2) + 'px';
        root.style.top = Math.max(0, (sh - 1080 * scale) / 2) + 'px';
      } else {
        root.style.transform = '';
        root.style.position = 'relative';
        root.style.left = '0px';
        root.style.top = '0px';
      }
    } catch (e) {
      console.warn('[fitResolution err]', e);
    }
  }

  window.addEventListener('resize', fitResolution);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fitResolution);
  } else {
    fitResolution();
  }

  // ---- Key mapping ----
  if (isTizen) {
    if (window.tizen && tizen.tvinputdevice) {
      try {
        var mediaKeys = [
          'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop',
          'MediaFastForward', 'MediaRewind', 'MediaTrackPrevious', 'MediaTrackNext',
          'ChannelUp', 'ChannelDown', 'Info',
          'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
          '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
        ];
        mediaKeys.forEach(function(k) {
          try { tizen.tvinputdevice.registerKey(k); } catch(e) {}
        });
      } catch(e) {}
    }

    document.addEventListener('keydown', function (e) {
      if (e.keyCode === 10009 || e.key === 'Return') { // Return / Back on Samsung Remote
        e.preventDefault();
        e.stopImmediatePropagation();
        if (window.__xuper && typeof window.__xuper.key === 'function') {
          window.__xuper.key(461);
        } else {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Back', keyCode: 461, bubbles: true, cancelable: true }));
        }
      }
    }, true);

    document.addEventListener('keyup', function (e) {
      if (e.keyCode === 10009 || e.key === 'Return') {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);

    // On the first home tab app.js calls window.webOSTV.platformBack()
    window.webOSTV = {
      platformBack: function () {
        window.XuperPlatform.exit();
      }
    };
  }

  // ---- Exit app cleanly ----
  window.XuperPlatform.exit = function () {
    if (isTizen && tizen.application) {
      try {
        tizen.application.getCurrentApplication().exit();
      } catch (e) {
        window.close();
      }
    } else {
      window.close();
    }
  };

  // ---- Screen / resolution helpers ----
  window.XuperPlatform.getScreenSize = function () {
    if (isTizen && window.webapis && webapis.productinfo) {
      try {
        return {
          width: webapis.productinfo.getRealDisplayWidth ? webapis.productinfo.getRealDisplayWidth() : screen.width,
          height: webapis.productinfo.getRealDisplayHeight ? webapis.productinfo.getRealDisplayHeight() : screen.height
        };
      } catch (e) {}
    }
    return { width: window.innerWidth || 1920, height: window.innerHeight || 1080 };
  };

  // ---- Screensaver management (Jellyfin / Tizen pattern) ----
  // Every key press asks for OFF: the TV is only told when the state changes. Coming back from another app the TV
  // may have changed it on its own, so the state is unknown again
  var screenSaverEnabled = null;
  document.addEventListener('visibilitychange', function () { screenSaverEnabled = null; });
  window.XuperPlatform.setScreenSaver = function (enable) {
    if (!isTizen || !window.webapis || !webapis.appcommon || !webapis.appcommon.setScreenSaver) return;
    enable = !!enable;
    if (screenSaverEnabled === enable) return;
    try {
      var state = enable
        ? webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_ON
        : webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF;
      webapis.appcommon.setScreenSaver(state);
      screenSaverEnabled = enable;
    } catch (e) {
      console.warn('[TizenBridge] Failed to setScreenSaver:', e);
    }
  };

  // ---- UHD / 4K Detection (Jellyfin pattern) ----
  window.XuperPlatform.isUhdSupported = function () {
    if (!isTizen || !window.webapis || !webapis.productinfo) return false;
    try {
      if (typeof webapis.productinfo.is8KPanelSupported === 'function' && webapis.productinfo.is8KPanelSupported()) return true;
      if (typeof webapis.productinfo.isUdPanelSupported === 'function' && webapis.productinfo.isUdPanelSupported()) return true;
    } catch (e) {}
    return false;
  };
  window.XuperPlatform.is4KPanel = window.XuperPlatform.isUhdSupported;

  // ---- Network status & connection type (Jellyfin / Samsung WebAPI pattern) ----
  window.XuperPlatform.isNetworkConnected = function () {
    if (isTizen && window.webapis && webapis.network) {
      try {
        if (typeof webapis.network.isConnectedToGateway === 'function') {
          if (!webapis.network.isConnectedToGateway()) return false;
        }
        if (typeof webapis.network.getActiveConnectionType === 'function') {
          var type = webapis.network.getActiveConnectionType();
          var types = webapis.network.NetworkActiveConnectionType || {};
          var disconnected = (types.DISCONNECTED !== undefined) ? (type === types.DISCONNECTED) : (type === 0);
          return !disconnected;
        }
      } catch (e) {}
    }
    return typeof navigator.onLine === 'boolean' ? navigator.onLine : true;
  };

  window.XuperPlatform.getConnectionType = function () {
    if (isTizen && window.webapis && webapis.network && typeof webapis.network.getActiveConnectionType === 'function') {
      try {
        var t = webapis.network.getActiveConnectionType();
        var types = webapis.network.NetworkActiveConnectionType || {};
        if (t === types.WIFI || t === 1) return 'wifi';
        if (t === types.ETHERNET || t === 3) return 'ethernet';
        if (t === types.CELLULAR || t === 2) return 'cellular';
        if (t === types.DISCONNECTED || t === 0) return 'none';
      } catch (e) {}
    }
    return navigator.onLine ? 'online' : 'none';
  };

  window.XuperPlatform.getIpAddress = function () {
    if (isTizen && window.webapis && webapis.network && typeof webapis.network.getIP === 'function') {
      try {
        return webapis.network.getIP() || '';
      } catch (e) {}
    }
    return '';
  };

  window.XuperPlatform.waitForNetwork = function (maxWaitMs, callback) {
    maxWaitMs = maxWaitMs || 5000;
    callback = callback || function () {};
    if (window.XuperPlatform.isNetworkConnected()) {
      return setTimeout(function () { callback(true); }, 250);
    }
    var done = false;
    var timer = null;
    var pollTimer = null;
    function finish(ok) {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (pollTimer) clearInterval(pollTimer);
      window.removeEventListener('xuper-network-change', onNet);
      callback(ok);
    }
    function onNet(e) {
      if (e && e.detail && e.detail.online) finish(true);
    }
    window.addEventListener('xuper-network-change', onNet);
    pollTimer = setInterval(function () {
      if (window.XuperPlatform.isNetworkConnected()) finish(true);
    }, 400);
    timer = setTimeout(function () { finish(window.XuperPlatform.isNetworkConnected()); }, maxWaitMs);
  };

  // ---- Native Tizen Network Change Listener + Browser online/offline fallback ----
  (function setupNetworkListener() {
    function emitNetworkChange(online, type) {
      console.log('[Network] Status change: online=' + online + ' type=' + type);
      window.dispatchEvent(new CustomEvent('xuper-network-change', {
        detail: {
          online: online,
          type: type || (online ? 'online' : 'none'),
          ip: window.XuperPlatform.getIpAddress ? window.XuperPlatform.getIpAddress() : ''
        }
      }));
    }

    if (isTizen && window.webapis && webapis.network && typeof webapis.network.addNetworkStateChangeListener === 'function') {
      try {
        var listenerId = webapis.network.addNetworkStateChangeListener(function (val) {
          var types = webapis.network.NetworkActiveConnectionType || {};
          var disconnected = (types.DISCONNECTED !== undefined) ? (val === types.DISCONNECTED) : (val === 0);
          var typeStr = 'unknown';
          if (val === types.WIFI || val === 1) typeStr = 'wifi';
          else if (val === types.ETHERNET || val === 3) typeStr = 'ethernet';
          else if (val === types.CELLULAR || val === 2) typeStr = 'cellular';
          else if (disconnected) typeStr = 'none';

          emitNetworkChange(!disconnected, typeStr);
        });
        console.log('[TizenBridge] Registered native Tizen network listener ID:', listenerId);
      } catch (e) {
        console.warn('[TizenBridge] Failed to register network state listener:', e);
      }
    }

    window.addEventListener('online', function () {
      emitNetworkChange(true, window.XuperPlatform.getConnectionType ? window.XuperPlatform.getConnectionType() : 'online');
    });
    window.addEventListener('offline', function () {
      emitNetworkChange(false, 'none');
    });
  })();

  // ---- M3U Parser and storage ----
  function parseM3U(text) {
    var lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
    var channels = [];
    var pending = null;
    var attrRe = /([\w-]+)="([^"]*)"/g;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line.indexOf('#EXTINF') === 0) {
        var attrs = {};
        var m;
        attrRe.lastIndex = 0;
        while ((m = attrRe.exec(line))) attrs[m[1].toLowerCase()] = m[2];
        var name = '';
        var inQuotes = false;
        for (var j = 0; j < line.length; j++) {
          if (line[j] === '"') inQuotes = !inQuotes;
          else if (line[j] === ',' && !inQuotes) { name = line.slice(j + 1).trim(); break; }
        }
        pending = { name: name || attrs['tvg-name'] || '', logo: attrs['tvg-logo'] || '', group: attrs['group-title'] || '' };
      } else if (line.charAt(0) !== '#') {
        channels.push({
          name: (pending && pending.name) || line,
          streamUrl: line,
          logo: (pending && pending.logo) || '',
          group: (pending && pending.group) || ''
        });
        pending = null;
      }
    }
    return channels;
  }

  function fetchText(url, done) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 20000;
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) done(null, xhr.responseText);
      else done('HTTP ' + xhr.status);
    };
    xhr.onerror = function () { done('Error de red al descargar lista'); };
    xhr.ontimeout = function () { done('Tiempo de espera agotado al descargar lista'); };
    xhr.send();
  }

  var ADDONS_KEY = 'xuper_m3u_addons';
  var DEFAULT_LIST = 'https://iptv-org.github.io/iptv/countries/es.m3u';

  function savedListUrls() {
    try {
      var lists = JSON.parse(localStorage.getItem(ADDONS_KEY) || '[]');
      var urls = [];
      for (var i = 0; i < lists.length; i++) if (lists[i] && lists[i].url) urls.push(lists[i].url);
      if (urls.length) return urls;
    } catch (e) {}
    return [DEFAULT_LIST];
  }

  var liveCache = { key: '', channels: null };
  function loadSavedChannels(done) {
    var urls = savedListUrls();
    var key = urls.join('|');
    if (liveCache.key === key && liveCache.channels) return done(liveCache.channels);
    var results = [];
    var left = urls.length;
    urls.forEach(function (url, idx) {
      fetchText(url, function (err, text) {
        results[idx] = err ? [] : parseM3U(text);
        if (--left > 0) return;
        var seen = {};
        var merged = [];
        for (var r = 0; r < results.length; r++) {
          for (var c = 0; c < results[r].length; c++) {
            var ch = results[r][c];
            if (seen[ch.streamUrl]) continue;
            seen[ch.streamUrl] = true;
            merged.push(ch);
          }
        }
        liveCache = { key: key, channels: merged };
        done(merged);
      });
    });
  }

  // Last resolved stream metadata (headers, format, subtitles) for AVPlay injection
  window.__xuperCurrentStreamMeta = null;

  // ---- Local stand-in for the webOS Luna service (PalmServiceBridge) ----
  var localService = {
    // 1. M3U List Management
    fetchM3u: function (p, reply) {
      if (!p.url) return reply({ returnValue: false, errorText: 'Falta la URL de la lista' });
      fetchText(p.url, function (err, text) {
        if (err) return reply({ returnValue: false, errorText: err });
        var channels = parseM3U(text);
        reply(channels.length
          ? { returnValue: true, channels: channels }
          : { returnValue: false, errorText: 'No se encontraron canales en la lista' });
      });
    },

    liveCategories: function (p, reply) {
      if (!window.MagisClient || typeof MagisClient.getLiveCategories !== 'function') {
        return reply({ returnValue: true, categories: [{ id: 76182, name: 'Canales en Vivo' }] });
      }
      MagisClient.getLiveCategories(function (err, cats) {
        if (err || !cats || !cats.length) {
          return reply({ returnValue: true, categories: [{ id: 76182, name: 'Todos' }] });
        }
        reply({ returnValue: true, categories: cats });
      });
    },

    liveChannels: function (p, reply) {
      var colId = p.columnId || 76182;
      var pageNum = Math.max(1, parseInt(p.pageNum, 10) || 1);
      var pageSize = Math.max(1, parseInt(p.pageSize, 10) || 50);

      if (!window.MagisClient || typeof MagisClient.getLiveChannels !== 'function') {
        return loadSavedChannels(function (channels) {
          reply({ returnValue: true, channels: channels || [], hasMore: false });
        });
      }
      MagisClient.getLiveChannels(colId, pageNum, pageSize, function (err, channels, hasMore) {
        if (err || (!channels || !channels.length) && pageNum === 1) {
          console.warn('[liveChannels] MagisClient error or empty for colId=' + colId + ': ' + (err && err.message || err));
          return loadSavedChannels(function (fallback) {
            reply({ returnValue: true, channels: fallback || [], pageNum: pageNum, hasMore: false });
          });
        }
        console.log('[liveChannels] colId=' + colId + ' page=' + pageNum + ' count=' + (channels ? channels.length : 0));
        reply({
          returnValue: true,
          channels: channels || [],
          pageNum: pageNum,
          hasMore: !!hasMore
        });
      });
    },

    resolveLive: function (p, reply) {
      if (p.streamUrl) {
        window.__xuperCurrentStreamMeta = { headers: {}, isHls: p.streamUrl.indexOf('.m3u8') !== -1 };
        return reply({ returnValue: true, url: p.streamUrl, proxyPath: p.streamUrl, isHls: p.streamUrl.indexOf('.m3u8') !== -1 });
      }
      var code = p.channelCode || p.streamCode;
      if (!code || !window.MagisClient || typeof MagisClient.resolveLive !== 'function') {
        return reply({ returnValue: false, errorText: 'channelCode requerido' });
      }
      MagisClient.resolveLive(code, function (err, stream) {
        console.log('[resolveLive]', code, err ? ('ERR ' + (err.message || err)) : logHost(stream && stream.url), 'hls=' + !!(window.Hls && Hls.isSupported()));
        if (err || !stream) {
          return reply({ returnValue: false, errorText: err ? String(err.message || err) : 'No se pudo resolver canal' });
        }
        window.__xuperCurrentStreamMeta = stream;
        reply(Object.assign({ returnValue: true }, stream));
      });
    },

    // 2. Magis Portal VOD Resolvers (Series, Movies, Details, Search)
    resolve: function (p, reply) {
      if (!window.MagisClient) {
        return reply({ returnValue: false, errorText: 'MagisClient no disponible' });
      }
      MagisClient.resolve(p.contentId, p.seriesContentId, p, function (err, res) {
        if (err) {
          console.error('[XuperBridge] resolve error:', err);
          return reply({ returnValue: false, errorText: String(err.message || err) });
        }
        window.__xuperCurrentStreamMeta = res;
        reply(Object.assign({ returnValue: true }, res));
      });
    },

    resolveSmooth: function (p, reply) {
      localService.resolve(p, reply);
    },

    detail: function (p, reply) {
      if (!window.MagisClient) {
        return reply({ returnValue: false, errorText: 'MagisClient no disponible' });
      }
      MagisClient.detail(p.contentId, function (err, res) {
        if (err) {
          console.error('[XuperBridge] detail error:', err);
          return reply({ returnValue: false, errorText: String(err.message || err) });
        }
        reply(Object.assign({ returnValue: true }, res));
      });
    },

    home: function (p, reply) {
      if (!window.MagisClient) {
        return reply({ returnValue: false, errorText: 'MagisClient no disponible' });
      }
      MagisClient.home(p.root || 'movies', p.pageNum || 1, function (err, res) {
        if (err) return reply({ returnValue: false, errorText: String(err.message || err) });
        reply(Object.assign({ returnValue: true }, res));
      });
    },

    search: function (p, reply) {
      if (!window.MagisClient) {
        return reply({ returnValue: false, errorText: 'MagisClient no disponible' });
      }
      MagisClient.search(p.value, function (err, res) {
        if (err) return reply({ returnValue: false, errorText: String(err.message || err) });
        reply(Object.assign({ returnValue: true }, res));
      });
    },

    mediaInfo: function (p, reply) {
      if (!window.MagisClient || typeof MagisClient.mediaInfo !== 'function') {
        return localService.detail(p, reply);
      }
      MagisClient.mediaInfo(p.contentId, p.seriesContentId, function (err, res) {
        if (err) return reply({ returnValue: false, errorText: String(err.message || err) });
        reply(Object.assign({ returnValue: true }, res));
      });
    },

    abortMedia: function (p, reply) {
      if (window.XuperAVPlay && window.XuperAVPlay.isActive) {
        window.XuperAVPlay.stop();
      }
      reply({ returnValue: true });
    },

    keepAlive: function (p, reply) { reply({ returnValue: true }); },
    heartbeat: function (p, reply) { reply({ returnValue: true }); },
    netdiag: function (p, reply) { reply({ returnValue: true, verdict: 'ok' }); }
  };

  function LocalServiceBridge() {
    this.onservicecallback = null;
    this.cancelled = false;
  }
  LocalServiceBridge.prototype.call = function (uri, paramsJson) {
    var self = this;
    var method = String(uri || '').replace(/\/+$/, '').split('/').pop();
    var params = {};
    try { params = JSON.parse(paramsJson || '{}') || {}; } catch (e) {}
    var handler = localService[method] || function (p, reply) {
      reply({ returnValue: false, errorText: 'Método ' + method + ' no soportado' });
    };
    handler(params, function (result) {
      setTimeout(function () {
        if (!self.cancelled && self.onservicecallback) {
          self.onservicecallback(JSON.stringify(result));
        }
      }, 0);
    });
  };
  LocalServiceBridge.prototype.cancel = function () { this.cancelled = true; };

  if (!isWebOS && !window.PalmServiceBridge) {
    window.PalmServiceBridge = LocalServiceBridge;
  }

  // ---- Samsung Tizen AVPlay Native Hardware Player Integration ----
  window.XuperAVPlay = {
    isActive: false,
    isPreviewActive: false,
    videoEl: null,
    previewVideoEl: null,
    currentTimeSec: 0,
    durationSec: 0,
    isPaused: true,
    _backupIdx: 0,
    _previewBackupIdx: 0,
    _isSeeking: false,
    _pendingSeekSec: null,
    _pendingSeekCallbacks: null,

    init: function () {
      if (!isTizen || !window.webapis || !webapis.avplay) {
        console.log('[XuperAVPlay] AVPlay not available in this environment');
        return;
      }
      console.log('[XuperAVPlay] AVPlay is available and ready');
    },

    getScaleInfo: function () {
      var w = window.innerWidth || 1920;
      var h = window.innerHeight || 1080;
      var s = Math.min(w / 1920, h / 1080);
      if (!isFinite(s) || s <= 0) s = 1;
      var ox = Math.max(0, Math.round((w - 1920 * s) / 2));
      var oy = Math.max(0, Math.round((h - 1080 * s) / 2));
      return { s: s, ox: ox, oy: oy };
    },

    syncDisplayRect: function () {
      if (!isTizen || !window.webapis || !webapis.avplay) return;
      try {
        var sc = this.getScaleInfo();
        var spEl = document.getElementById('screen-player');
        var detEl = document.getElementById('screen-detail');
        var isLivePrev = this.isPreviewActive || (spEl && spEl.classList.contains('is-live-preview'));
        if (isLivePrev) {
          // The element on screen now (the view may have mounted a new one since playback started), else the box
          var pEl = document.getElementById('live-preview-video') || this.previewVideoEl;
          var boxEl = document.querySelector('.live-grand-preview-box');
          var r = pEl ? pEl.getBoundingClientRect() : null;
          if ((!r || r.width <= 0 || r.height <= 0) && boxEl) r = boxEl.getBoundingClientRect();
          if (r) {
            if (r.width > 0 && r.height > 0) {
              webapis.avplay.setDisplayRect(
                Math.round(sc.ox + r.left * sc.s),
                Math.round(sc.oy + r.top * sc.s),
                Math.round(r.width * sc.s),
                Math.round(r.height * sc.s)
              );
              return;
            }
          }
          webapis.avplay.setDisplayRect(
            Math.round(sc.ox + 812 * sc.s),
            Math.round(sc.oy + 84 * sc.s),
            Math.round(1060 * sc.s),
            Math.round(530 * sc.s)
          );
          return;
        }
        var isMini = (spEl && spEl.classList.contains('is-mini')) || (detEl && detEl.classList.contains('is-active'));
        if (isMini) {
          webapis.avplay.setDisplayRect(
            Math.round(sc.ox + 1075 * sc.s),
            Math.round(sc.oy + 50 * sc.s),
            Math.round(765 * sc.s),
            Math.round(430 * sc.s)
          );
        } else {
          webapis.avplay.setDisplayRect(
            Math.round(sc.ox),
            Math.round(sc.oy),
            Math.round(1920 * sc.s),
            Math.round(1080 * sc.s)
          );
        }
      } catch (e) {}
    },

    switchToFullscreen: function () {
      this.isPreviewActive = false;
      this.syncDisplayRect();
    },

    switchToPreview: function (videoEl) {
      this.isPreviewActive = true;
      if (videoEl) this.previewVideoEl = videoEl;
      this.syncDisplayRect();
    },

    _ensureAvObject: function () {
      var obj = document.getElementById('avplay-object');
      if (!obj) {
        obj = document.createElement('object');
        obj.id = 'avplay-object';
        obj.type = 'application/avplayer';
        obj.style.position = 'absolute';
        obj.style.left = '0px';
        obj.style.top = '0px';
        obj.style.width = '1920px';
        obj.style.height = '1080px';
        obj.style.pointerEvents = 'none';
        obj.style.zIndex = '0';
        obj.tabIndex = -1;
        document.body.insertBefore(obj, document.body.firstChild);
      }
      obj.style.display = 'block';
      document.documentElement.style.backgroundColor = 'transparent';
      document.body.style.backgroundColor = 'transparent';
      var appEl = document.getElementById('app');
      if (appEl) appEl.style.backgroundColor = 'transparent';
      var rootEl = document.getElementById('root');
      if (rootEl) rootEl.style.backgroundColor = 'transparent';
    },

    _applyHeaders: function (headers) {
      if (!headers) return;
      var custom = [];
      for (var key in headers) {
        if (Object.prototype.hasOwnProperty.call(headers, key)) {
          var val = headers[key];
          if (!val) continue;
          if (key.toLowerCase() === 'user-agent') {
            try { webapis.avplay.setStreamingProperty('USER_AGENT', val); } catch (e) {}
          } else {
            custom.push(key + ': ' + val);
          }
        }
      }
      if (custom.length) {
        try { webapis.avplay.setStreamingProperty('CUSTOM_MESSAGE', custom.join('\r\n')); } catch (e) {}
      }
    },

    _displayMethod: function () {
      var modes = ['PLAYER_DISPLAY_MODE_LETTER_BOX', 'PLAYER_DISPLAY_MODE_FULL_SCREEN', 'PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO'];
      try {
        var cfg = JSON.parse(localStorage.getItem(window.__xuperProfileKey ? window.__xuperProfileKey('xuper_global_playback_v1') : 'xuper_global_playback_v1') || '{}');
        if (typeof cfg.display === 'number' && modes[cfg.display]) return modes[cfg.display];
      } catch (e) {}
      return modes[0];
    },

    _tryNextBackup: function () {
      var self = this;
      var meta = window.__xuperCurrentStreamMeta;
      var backups = meta && meta.backupUrls;
      if (backups && self._backupIdx < backups.length) {
        var nextItem = backups[self._backupIdx++];
        var nextUrl = typeof nextItem === 'string' ? nextItem : (nextItem && nextItem.url);
        var nextHeaders = (nextItem && nextItem.headers) ? nextItem.headers : (meta && meta.headers);
        if (nextUrl) {
          console.log('[XuperAVPlay] Retrying with backup CDN:', logHost(nextUrl));
          return self._openAndPrepareStream(nextUrl, nextHeaders, self.videoEl);
        }
      }
      return false;
    },

    /**
     * A stream that dropped (Wi-Fi hiccup, DHCP renewal, a CDN blip): up to 3 quiet retries after 0.5 s, 1.5 s and
     * 3 s, with the spinner showing, before the player reports the error. Live asks the portal for a fresh link;
     * movies and series reopen the same link at the position they were at. The count starts again once the stream
     * plays, so a long session survives several hiccups.
     */
    _recoverStream: function () {
      var self = this;
      var delays = [500, 1500, 3000];
      // Played fine for a while since the last drop: a new drop starts the count again
      if (self._playingSince && Date.now() - self._playingSince > 15000) self._recoveryAttempts = 0;
      self._playingSince = 0;
      var attempt = self._recoveryAttempts || 0;
      if (self._recovering || attempt >= delays.length || !self.videoEl || !self._lastUrl) return false;
      self._recovering = true;
      self._recoveryAttempts = attempt + 1;
      var gen = self._gen || 0;
      var resumeAt = self.kind === 'vod' ? (self.currentTimeSec || 0) : 0;
      console.log('[XuperAVPlay] stream dropped, retry #' + self._recoveryAttempts + ' in ' + delays[attempt] + 'ms');
      if (self.videoEl.onwaiting) { try { self.videoEl.onwaiting(); } catch (e) {} }

      var giveUp = function () {
        self._recovering = false;
        self.isActive = false;
        // Fallback transparent to Hls.js if AVPlay hardware rejects a direct live stream
        if (self.kind === 'live' && self._lastUrl && self.videoEl && typeof window.__xuperPlayHlsFallback === 'function') {
          console.warn('[XuperAVPlay] AVPlay live failed, invoking transparent Hls.js fallback for:', logHost(self._lastUrl));
          try {
            self._safeStopAndClose();
            window.__xuperPlayHlsFallback(self._lastUrl, self.videoEl);
            return;
          } catch (fbErr) {}
        }
        if (self.videoEl && self.videoEl.onerror) self.videoEl.onerror();
      };
      var reopen = function (url, headers) {
        self._recovering = false;
        if (resumeAt > 5) self._initialSeekSec = resumeAt;
        if (!self._openAndPrepareStream(url, headers, self.videoEl)) giveUp();
      };

      setTimeout(function () {
        // Stopped or replaced meanwhile (the viewer left or picked another title)
        if ((self._gen || 0) !== gen || !self.videoEl) { self._recovering = false; return; }
        var meta = window.__xuperCurrentStreamMeta;
        var code = self.kind === 'live' && meta && (meta.code || meta.id || meta.channelCode);
        if (code && window.MagisClient && typeof window.MagisClient.resolveLive === 'function') {
          window.MagisClient.resolveLive(code, function (err, newMeta) {
            if ((self._gen || 0) !== gen) { self._recovering = false; return; }
            if (!err && newMeta && newMeta.url) {
              window.__xuperCurrentStreamMeta = newMeta;
              reopen(newMeta.url, newMeta.headers);
            } else {
              reopen(self._lastUrl, self._lastHeaders);
            }
          }, { fresh: true });
          return;
        }
        if (self.kind === 'vod' && meta && meta.contentId && window.MagisClient && typeof window.MagisClient.resolve === 'function') {
          console.log('[XuperAVPlay] VOD stream dropped, refreshing SLB token before reopen...');
          window.MagisClient.resolve(meta.contentId, meta.seasonId, { trackIndex: meta.trackIndex }, function (err, newMeta) {
            if ((self._gen || 0) !== gen) { self._recovering = false; return; }
            if (!err && newMeta && newMeta.url) {
              window.__xuperCurrentStreamMeta = Object.assign({}, meta, newMeta);
              reopen(newMeta.url, newMeta.headers);
            } else {
              reopen(self._lastUrl, self._lastHeaders);
            }
          });
          return;
        }
        reopen(self._lastUrl, self._lastHeaders);
      }, delays[attempt]);
      return true;
    },

    _safeStopAndClose: function () {
      if (!isTizen || !window.webapis || !webapis.avplay) return;
      try {
        var state = 'NONE';
        try { state = webapis.avplay.getState(); } catch (e) {}
        if (state === 'PLAYING' || state === 'PAUSED') {
          try { webapis.avplay.stop(); } catch (e) {}
        }
        if (state !== 'NONE') {
          try { webapis.avplay.close(); } catch (e) {}
        }
      } catch (e) {
        console.warn('[XuperAVPlay] _safeStopAndClose error:', e);
      }
    },

    playStream: function (url, headers, videoEl, startSec) {
      var self = this;
      if (!isTizen || !window.webapis || !webapis.avplay) return false;
      self._backupIdx = 0;
      self._recoveryAttempts = 0;
      self._recovering = false;
      self._playingSince = 0;
      self.isPreviewActive = false;
      self.kind = self._nextKind || 'vod';
      self._nextKind = null;
      self._initialSeekSec = (typeof startSec === 'number' && startSec > 0) ? startSec : 0;
      var homeEl = document.getElementById('screen-home');
      if (homeEl) homeEl.classList.remove('is-avplay-preview');
      return self._openAndPrepareStream(url, headers, videoEl);
    },

    _openAndPrepareStream: function (url, headers, videoEl) {
      var self = this;
      self.videoEl = videoEl;
      self.currentTimeSec = self._initialSeekSec || 0;
      self.durationSec = 0;
      self.isPaused = false;

      try {
        self._ensureAvObject();
        var spEl = document.getElementById('screen-player');
        if (spEl) spEl.style.backgroundColor = 'transparent';

        self._safeStopAndClose();

        var cleanUrl = String(url);
        self._lastUrl = cleanUrl;
        self._lastHeaders = headers;
        webapis.avplay.open(cleanUrl);
        self.syncDisplayRect();
        webapis.avplay.setDisplayMethod(self._displayMethod());
        self._applyHeaders(headers);

        var isLive = self.kind === 'live';
        try {
          // Buffer before playing (3 s) and after a stall or a seek (3 s live, 5 s movies and series), with a 20 s
          // watchdog. 2 s for movies (1.12.0) made older TVs (Tizen 5.5) stall every second and refuse seeks while
          // refilling; 5 s is what 1.11.0 used. Live grows to 8 s once playing (onbufferingcomplete).
          if (webapis.avplay.setTimeoutForBuffering) webapis.avplay.setTimeoutForBuffering(20);
          webapis.avplay.setBufferingParam("PLAYER_BUFFER_FOR_PLAY", "PLAYER_BUFFER_SIZE_IN_SECOND", 3);
          webapis.avplay.setBufferingParam("PLAYER_BUFFER_FOR_RESUME", "PLAYER_BUFFER_SIZE_IN_SECOND", isLive ? 3 : 5);
        } catch (bufErr) {}

        webapis.avplay.setListener({
          onbufferingstart: function () {
            self._buffering = true;
            if (self.isActive) reportPlayback('stall', 'buffering' + (self.kind === 'vod' ? ' (vod)' : ''), self._lastUrl);
            if (self.videoEl && self.videoEl.onwaiting) self.videoEl.onwaiting();
          },
          onbufferingprogress: function (percent) {
            if (self.videoEl) {
              self.videoEl._avBufferPercent = percent;
              if (self.videoEl.onprogress) self.videoEl.onprogress({ loaded: percent, total: 100 });
            }
          },
          onbufferingcomplete: function () {
            self.syncDisplayRect();
            if (window.XuperPlatform && window.XuperPlatform.setScreenSaver) {
              window.XuperPlatform.setScreenSaver(false);
            }
            // Live: a bigger resume buffer once playing, against network jitter. Movies and series keep 5 s: every
            // seek refills this buffer before the picture goes on, and 8 s made seeks slow
            if (self.kind === 'live') {
              try {
                webapis.avplay.setBufferingParam("PLAYER_BUFFER_FOR_RESUME", "PLAYER_BUFFER_SIZE_IN_SECOND", 8);
              } catch (bufExpandErr) {}
            }
            self._buffering = false;
            self._playingSince = Date.now();
            // The resume seek the TV refused before playing: once more, now that it has buffered
            if (self._initialSeekSec > 0) {
              var retrySec = self._initialSeekSec;
              self._initialSeekSec = 0;
              console.log('[XuperAVPlay] onbufferingcomplete: retrying the resume seek to ' + retrySec + 's');
              self._isSeeking = false;
              self.seekTo(retrySec, function () { self._initialSeekDone(true); }, function () { self._initialSeekDone(false); });
            } else if (self._seekAfterBuffer) {
              // A seek refused while the TV was buffering
              var again = self._seekAfterBuffer;
              self._seekAfterBuffer = null;
              clearTimeout(self._seekWatchdog);
              self._seekTicket = (self._seekTicket || 0) + 1;
              self._isSeeking = false;
              self.seekTo(again.sec, again.success, again.error);
            }
            if (self.videoEl && self.videoEl.oncanplay) self.videoEl.oncanplay();
            if (self.videoEl && self.videoEl.onplaying) self.videoEl.onplaying();
          },
          oncurrentplaytime: function (ms) {
            // While a seek runs the TV still reports the old position: passing it on made the timeline jump back
            if (self._isSeeking) return;
            self.currentTimeSec = ms / 1000;
            if (self.videoEl) {
              self.videoEl._avCurrentTime = self.currentTimeSec;
              if (self.videoEl.ontimeupdate) self.videoEl.ontimeupdate();
            }
          },
          onerror: function (type) {
            console.error('[XuperAVPlay] AVPlay error:', type);
            reportPlayback('error', String(type) + (self.kind === 'vod' ? ' (vod)' : ''), self._lastUrl);
            if (window.XuperPlatform && window.XuperPlatform.setScreenSaver) {
              window.XuperPlatform.setScreenSaver(true);
            }
            if (self._tryNextBackup()) return;
            if (self._recoverStream()) return;
            self.isActive = false;
            if (self.videoEl && self.videoEl.onerror) self.videoEl.onerror();
          },
          onstreamcompleted: function () {
            self.isActive = false;
            if (window.XuperPlatform && window.XuperPlatform.setScreenSaver) {
              window.XuperPlatform.setScreenSaver(true);
            }
            if (self.videoEl && self.videoEl.onended) self.videoEl.onended();
          }
        });

        self._gen = (self._gen || 0) + 1;
        var gen = self._gen;
        webapis.avplay.prepareAsync(function () {
          if ((self._gen || 0) !== gen) return; // stopped while preparing: do not start playback
          try {
            var dur = webapis.avplay.getDuration();
            if (dur > 0) self.durationSec = dur / 1000;
            if (self.videoEl) {
              self.videoEl._avDuration = self.durationSec;
            }
          } catch (e) {}

          self.syncDisplayRect();
          // Resume: seek in the READY state, before play() (what Samsung recommends). Seeking right after play()
          // failed on older TVs and the title started from the beginning
          if (self._initialSeekSec > 0) {
            var initSec = self._initialSeekSec;
            var started = false;
            var startNow = function () {
              if (started || (self._gen || 0) !== gen) return;
              started = true;
              self._startPrepared(gen);
            };
            console.log('[XuperAVPlay] resume seek to ' + initSec + 's before play');
            var safety = setTimeout(startNow, 8000);
            try {
              webapis.avplay.seekTo(self._safeSeekMs(initSec), function () {
                clearTimeout(safety);
                self._initialSeekSec = 0;
                startNow();
                self._initialSeekDone(true);
              }, function (seekErr) {
                // Pre-play seek refused (normal in Tizen 5.5 and older in READY state): start play and let onbufferingcomplete execute it
                console.log('[XuperAVPlay] resume seek in READY state refused, will execute in PLAYING state after buffering:', seekErr);
                clearTimeout(safety);
                startNow();
                setTimeout(function () {
                  if ((self._gen || 0) === gen && self._initialSeekSec > 0) {
                    console.warn('[XuperAVPlay] initial seek fallback watchdog expired (15s)');
                    self._initialSeekSec = 0;
                    self._initialSeekDone(false);
                  }
                }, 15000);
              });
            } catch (seekEx) {
              console.log('[XuperAVPlay] resume seek in READY state exception, will execute in PLAYING state after buffering:', seekEx);
              clearTimeout(safety);
              startNow();
              setTimeout(function () {
                if ((self._gen || 0) === gen && self._initialSeekSec > 0) {
                  console.warn('[XuperAVPlay] initial seek fallback watchdog expired (15s)');
                  self._initialSeekSec = 0;
                  self._initialSeekDone(false);
                }
              }, 15000);
            }
            return;
          }
          self._startPrepared(gen);
        }, function (e) {
          console.error('[XuperAVPlay] prepareAsync error:', e);
          reportPlayback('error', 'prepare ' + ((e && (e.name || e.message)) || e) + (self.kind === 'vod' ? ' (vod)' : ''), self._lastUrl);
          if (window.XuperPlatform && window.XuperPlatform.setScreenSaver) {
            window.XuperPlatform.setScreenSaver(true);
          }
          if (self._tryNextBackup()) return;
          if (self._recoverStream()) return;
          self.isActive = false;
          if (self.videoEl && self.videoEl.onerror) self.videoEl.onerror();
        });

        return true;
      } catch (err) {
        console.error('[XuperAVPlay] Failed to open stream:', err);
        reportPlayback('error', 'open ' + ((err && (err.name || err.message)) || err), url);
        if (self._tryNextBackup()) return true;
        self.isActive = false;
        return false;
      }
    },

    /** Starts a prepared stream (after the resume seek, when there is one) */
    _startPrepared: function (gen) {
      var self = this;
      if ((self._gen || 0) !== gen) return;
      try { webapis.avplay.play(); } catch (playErr) {}
      self.isActive = true;
      self.isPaused = false;

      if (window.XuperPlatform && window.XuperPlatform.setScreenSaver) {
        window.XuperPlatform.setScreenSaver(false);
      }
      var st = document.getElementById('player-status');
      if (st) { st.textContent = ''; st.classList.remove('is-active'); }
      var pf = document.querySelector('#screen-player .player-frame');
      if (pf) pf.style.display = 'none';

      // Trigger onloadedmetadata after play() and isActive=true
      if (self.videoEl && self.videoEl.onloadedmetadata) {
        try { self.videoEl.onloadedmetadata(); } catch (e) {}
      }

      if (self.videoEl && self.videoEl.onplay) self.videoEl.onplay();
      if (self.videoEl && self.videoEl.onplaying) self.videoEl.onplaying();
    },

    /** Tells the player whether the resume seek landed (videoEl.onresumeseek(ok)) */
    _initialSeekDone: function (ok) {
      if (!ok) reportPlayback('error', 'resume seek failed' + (this.kind === 'vod' ? ' (vod)' : ''), this._lastUrl);
      if (this.videoEl && typeof this.videoEl.onresumeseek === 'function') {
        try { this.videoEl.onresumeseek(ok); } catch (e) {}
      }
    },

    pause: function () {
      if (this.isActive) {
        try { webapis.avplay.pause(); this.isPaused = true; } catch (e) {}
        if (window.XuperPlatform && window.XuperPlatform.setScreenSaver) {
          window.XuperPlatform.setScreenSaver(true);
        }
      }
    },

    play: function () {
      if (this.isActive) {
        try { webapis.avplay.play(); this.isPaused = false; } catch (e) {}
        if (window.XuperPlatform && window.XuperPlatform.setScreenSaver) {
          window.XuperPlatform.setScreenSaver(false);
        }
      }
    },

    getCurrentStreamQuality: function () {
      if (!isTizen || !window.webapis || !webapis.avplay) return null;
      try {
        var info = webapis.avplay.getCurrentStreamInfo();
        if (!info || !info.length) return null;
        for (var i = 0; i < info.length; i++) {
          if (info[i].type === 'VIDEO') {
            var extra = {};
            try { extra = JSON.parse(info[i].extra_info || '{}'); } catch(e) {}
            var w = extra.Width || extra.width || 0;
            var h = extra.Height || extra.height || 0;
            var codec = extra.FourCC || extra.fourcc || '';
            var label = 'HD';
            if (h >= 2160 || w >= 3840) label = '4K UHD';
            else if (h >= 1080 || w >= 1920) label = 'FHD 1080p';
            else if (h >= 720 || w >= 1280) label = 'HD 720p';
            else if (h > 0) label = h + 'p';
            return {
              width: w,
              height: h,
              label: label,
              codec: codec
            };
          }
        }
      } catch (e) {}
      return null;
    },

    /** A seek position AVPlay accepts: never 0 ms nor the exact end (GStreamer crashes on Tizen 3/4) */
    _safeSeekMs: function (sec) {
      var durSec = (this.videoEl && this.videoEl._avDuration) || this.durationSec || 0;
      var maxMs = durSec > 1 ? Math.max(100, Math.floor((durSec - 0.5) * 1000)) : Infinity;
      return Math.round(Math.min(Math.max(100, Math.floor((Number(sec) || 0) * 1000)), maxMs));
    },

    /**
     * One native seek at a time. A newer target while one runs waits in a single slot (the latest wins) and starts
     * as soon as the running one ends. Each seek has a ticket: a late answer from the TV for an older seek (after
     * the 15 s watchdog, or after stop) is ignored, so it cannot move the timeline back.
     */
    seekTo: function (sec, successCb, errorCb) {
      var self = this;
      var ms = self._safeSeekMs(sec);
      var state = '';
      try { state = webapis.avplay.getState(); } catch (e) {}

      // Not playing yet: the resume seek runs before play() (_openAndPrepareStream)
      if (!this.isActive || state === 'NONE' || state === 'IDLE' || state === 'READY') {
        console.log('[XuperAVPlay] Player not yet active, queuing initial seek to ' + sec + 's');
        this._initialSeekSec = sec;
        return;
      }

      if (this._isSeeking) {
        console.log('[XuperAVPlay] Seek already in progress, queuing target ' + sec + 's');
        this._pendingSeekSec = sec;
        this._pendingSeekCallbacks = { success: successCb, error: errorCb };
        return;
      }

      this._isSeeking = true;
      var ticket = this._seekTicket = (this._seekTicket || 0) + 1;
      var isCurrent = function () { return ticket === self._seekTicket; };

      // Ends this seek, then starts the queued target. A seek replaced by a newer one does not report its failure
      var finish = function (ok, err) {
        clearTimeout(self._seekWatchdog);
        self._isSeeking = false;
        self._seekAfterBuffer = null;
        var hasNext = self._pendingSeekSec !== null && self._pendingSeekSec !== undefined;
        var nextSec = self._pendingSeekSec;
        var nextCbs = self._pendingSeekCallbacks || {};
        self._pendingSeekSec = null;
        self._pendingSeekCallbacks = null;
        if (ok) {
          if (typeof successCb === 'function') successCb();
        } else if (!hasNext && typeof errorCb === 'function') {
          errorCb(err);
        }
        if (hasNext) self.seekTo(nextSec, nextCbs.success, nextCbs.error);
      };

      // For long seeks (> 600s / 10min), increase buffering timeout to 30s to allow remote CDN alignment
      var isLongSeek = Math.abs((self.currentTimeSec || 0) - sec) >= 600;
      if (isLongSeek) {
        try {
          if (webapis.avplay.setTimeoutForBuffering) webapis.avplay.setTimeoutForBuffering(30);
        } catch (tErr) {}
      }

      // The TV sometimes never answers a seek (damaged segments): give up after 15s (25s on long seeks)
      var seekTimeoutMs = isLongSeek ? 25000 : 15000;
      clearTimeout(this._seekWatchdog);
      this._seekWatchdog = setTimeout(function () {
        if (!isCurrent() || !self._isSeeking) return;
        console.warn('[XuperAVPlay] seekTo watchdog fired after ' + (seekTimeoutMs / 1000) + 's');
        self._seekTicket++;
        finish(false, new Error('seek_timeout'));
      }, seekTimeoutMs);

      var failed = function (targetMs, retriesLeft, err) {
        if (!isCurrent()) return;
        var errStr = String((err && (err.name || err.message)) || err || '');
        console.warn('[XuperAVPlay] seekTo ' + targetMs + 'ms attempt failed (' + retriesLeft + ' retries left):', errStr);
        // If the TV is currently buffering or state is transient (InvalidStateError): defer until buffering finishes
        if ((self._buffering || /invalidstate/i.test(errStr)) && !self._seekAfterBuffer) {
          console.log('[XuperAVPlay] seek refused while buffering or transitioning, retrying after buffering');
          self._seekAfterBuffer = { sec: targetMs / 1000, success: successCb, error: errorCb };
          return;
        }
        // A transient decoder busy state: retry with progressive backoff (200ms, 450ms, 800ms)
        if (retriesLeft > 0) {
          var delay = (4 - retriesLeft) * 220;
          setTimeout(function () {
            if (!isCurrent()) return;
            if (self.isActive) executeSeek(targetMs, retriesLeft - 1);
            else finish(false, err);
          }, delay);
          return;
        }
        finish(false, err);
      };

      var executeSeek = function (targetMs, retriesLeft) {
        try {
          webapis.avplay.seekTo(targetMs, function () {
            if (!isCurrent()) return;
            console.log('[XuperAVPlay] seekTo ' + targetMs + 'ms succeeded');
            finish(true);
          }, function (err) {
            failed(targetMs, retriesLeft, err);
          });
        } catch (e) {
          failed(targetMs, retriesLeft, e);
        }
      };

      executeSeek(ms, 3);
    },

    stop: function () {
      // Also cancels a quiet retry still waiting (_recoverStream) and a prepare in flight
      this._gen = (this._gen || 0) + 1;
      this._recovering = false;
      clearTimeout(this._seekWatchdog);
      this._seekTicket = (this._seekTicket || 0) + 1;
      this._isSeeking = false;
      this._seekAfterBuffer = null;
      this._buffering = false;
      this._pendingSeekSec = null;
      this._pendingSeekCallbacks = null;
      if (this.isActive) {
        this.isActive = false;
        this._safeStopAndClose();
      }
      this.stopPreview();
      if (window.XuperPlatform && window.XuperPlatform.setScreenSaver) {
        window.XuperPlatform.setScreenSaver(true);
      }
      var obj = document.getElementById('avplay-object');
      if (obj) obj.style.display = 'none';
      document.documentElement.style.backgroundColor = '#000000';
      document.body.style.backgroundColor = '#000000';
    },

    getAudioTracks: function () {
      if (!isTizen || !window.webapis || !webapis.avplay || !webapis.avplay.getTotalTrackInfo) return [];
      try {
        var all = webapis.avplay.getTotalTrackInfo() || [];
        return all.filter(function (entry) { return entry && entry.type === 'AUDIO'; })
          .map(function (entry, index) {
            var extra = {};
            try { extra = JSON.parse(entry.extra_info || '{}'); } catch (e) {}
            return {
              index: index,
              nativeIndex: entry.index,
              language: extra.language || extra.lang || ('Pista ' + (index + 1)),
              code: extra.language || extra.lang || ''
            };
          });
      } catch (e) { return []; }
    },

    selectAudioTrack: function (nativeIndex) {
      if (!isTizen || !window.webapis || !webapis.avplay || !webapis.avplay.setSelectTrack) return false;
      try {
        webapis.avplay.setSelectTrack('AUDIO', nativeIndex);
        return true;
      } catch (e) {
        console.error('[XuperAVPlay] selectAudioTrack error:', e);
        return false;
      }
    },

    getSubtitleTracks: function () {
      if (!isTizen || !window.webapis || !webapis.avplay || !webapis.avplay.getTotalTrackInfo) return [];
      try {
        var all = webapis.avplay.getTotalTrackInfo() || [];
        return all.filter(function (entry) { return entry && entry.type === 'TEXT'; })
          .map(function (entry, index) {
            var extra = {};
            try { extra = JSON.parse(entry.extra_info || '{}'); } catch (e) {}
            return {
              index: index,
              nativeIndex: entry.index,
              language: extra.language || extra.lang || ('Subtítulo ' + (index + 1)),
              code: extra.language || extra.lang || ''
            };
          });
      } catch (e) { return []; }
    },

    selectSubtitleTrack: function (nativeIndex) {
      if (!isTizen || !window.webapis || !webapis.avplay) return false;
      try {
        if (nativeIndex === -1 || nativeIndex === null || nativeIndex === undefined) {
          if (webapis.avplay.setSilentSubtitle) webapis.avplay.setSilentSubtitle(true);
          return true;
        }
        if (webapis.avplay.setSilentSubtitle) webapis.avplay.setSilentSubtitle(false);
        if (webapis.avplay.setSelectTrack) webapis.avplay.setSelectTrack('TEXT', nativeIndex);
        return true;
      } catch (e) {
        console.error('[XuperAVPlay] selectSubtitleTrack error:', e);
        return false;
      }
    },

    playPreview: function (url, videoEl) {
      var self = this;
      if (!isTizen || !window.webapis || !webapis.avplay || !url) return false;
      self._previewBackupIdx = 0;
      self.isActive = false;
      self.kind = 'live';
      self._nextKind = null;
      return self._openPreviewStream(url, videoEl);
    },

    _openPreviewStream: function (url, videoEl) {
      var self = this;
      self.previewVideoEl = videoEl;
      self.isPreviewActive = true;
      try {
        self._ensureAvObject();
        var homeEl = document.getElementById('screen-home');
        if (homeEl) homeEl.classList.add('is-avplay-preview');
        var mainEl = document.querySelector('.live-main');
        if (mainEl) mainEl.style.backgroundColor = 'transparent';
        var grandEl = document.querySelector('.live-grand-preview-box');
        if (grandEl) grandEl.style.backgroundColor = 'transparent';
        if (videoEl) videoEl.style.backgroundColor = 'transparent';

        self._safeStopAndClose();

        var isSecureRequired = String(url).indexOf(':443') !== -1 || (typeof headers !== 'undefined' && headers && (headers['Referer'] || headers['referer'] || headers['Origin']));
        var cleanUrl = isSecureRequired ? String(url) : String(url).replace(/^https:\/\//i, 'http://');
        self._lastPreviewUrl = cleanUrl;
        webapis.avplay.open(cleanUrl);
        self.syncDisplayRect();
        // Never stretch the preview: a channel that is not 16:9 gets bars instead
        webapis.avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');

        var meta = window.__xuperCurrentStreamMeta || {};
        self._applyHeaders(meta.headers);

        try {
          if (webapis.avplay.setTimeoutForBuffering) webapis.avplay.setTimeoutForBuffering(15);
          webapis.avplay.setBufferingParam("PLAYER_BUFFER_FOR_PLAY", "PLAYER_BUFFER_SIZE_IN_SECOND", 2);
          webapis.avplay.setBufferingParam("PLAYER_BUFFER_FOR_RESUME", "PLAYER_BUFFER_SIZE_IN_SECOND", 2);
        } catch (bufErr) {}

        function markPlaying() {
          self.syncDisplayRect();
          var ee = document.querySelector('.live-main');
          if (ee) {
            ee.classList.remove('is-preview-loading');
            ee.classList.add('is-preview-playing');
          }
          var st = document.querySelector('.live-preview-status');
          if (st) st.textContent = '';
        }

        function tryNextPreviewBackup() {
          var backups = meta && meta.backupUrls;
          if (backups && self._previewBackupIdx < backups.length) {
            var nextUrl = backups[self._previewBackupIdx++];
            if (typeof nextUrl === 'object' && nextUrl) nextUrl = nextUrl.url;
            if (nextUrl) {
              console.log('[XuperAVPlay] Preview retrying backup CDN:', logHost(nextUrl));
              self._openPreviewStream(nextUrl, videoEl);
              return true;
            }
          }
          return false;
        }

        webapis.avplay.setListener({
          onbufferingstart: function () {},
          onbufferingcomplete: function () {
            markPlaying();
          },
          oncurrentplaytime: function () {},
          onerror: function (type) {
            console.error('[XuperAVPlay] Preview AVPlay error:', type);
            reportPlayback('error', 'preview ' + type, self._lastPreviewUrl);
            if (tryNextPreviewBackup()) return;
            self.isPreviewActive = false;
          },
          onstreamcompleted: function () {
            self.isPreviewActive = false;
          }
        });

        self._gen = (self._gen || 0) + 1;
        var gen = self._gen;
        webapis.avplay.prepareAsync(function () {
          if ((self._gen || 0) !== gen) return; // stopped while preparing: do not start playback
          webapis.avplay.play();
          markPlaying();
        }, function (e) {
          console.error('[XuperAVPlay] Preview prepareAsync error:', e);
          reportPlayback('error', 'preview prepare ' + ((e && (e.name || e.message)) || e), self._lastPreviewUrl);
          if (tryNextPreviewBackup()) return;
          self.isPreviewActive = false;
        });

        return true;
      } catch (err) {
        console.error('[XuperAVPlay] Failed to open preview stream:', err);
        self.isPreviewActive = false;
        return false;
      }
    },

    stopLive: function () {
      if (this.kind === 'live' || this.isPreviewActive) {
        this._gen = (this._gen || 0) + 1;
        this.isActive = false;
        this.isPreviewActive = false;
        this._safeStopAndClose();
      }
      if (window.XuperPlatform && window.XuperPlatform.setScreenSaver) {
        window.XuperPlatform.setScreenSaver(true);
      }
      var homeEl = document.getElementById('screen-home');
      if (homeEl) {
        homeEl.classList.remove('is-avplay-preview');
        homeEl.style.backgroundColor = '';
      }
    },

    stopPreview: function () {
      if (this.isPreviewActive) {
        this.isPreviewActive = false;
        this._safeStopAndClose();
      }
      if (window.XuperPlatform && window.XuperPlatform.setScreenSaver) {
        window.XuperPlatform.setScreenSaver(true);
      }
      var homeEl = document.getElementById('screen-home');
      if (homeEl) {
        homeEl.classList.remove('is-avplay-preview');
        homeEl.style.backgroundColor = '';
      }
    }
  };

  // ---- Multitasking & Suspend / Waking Recovery (Jellyfin pattern) ----
  // Tizen requires AVPlay to be suspended in the background and safely restored on return.
  if (isTizen) {
    document.addEventListener('visibilitychange', function () {
      if (!window.webapis || !webapis.avplay) return;
      var state = '';
      try { state = webapis.avplay.getState(); } catch (e) {}
      if (document.hidden) {
        if (state === 'PLAYING' || state === 'PAUSED' || state === 'READY') {
          try { webapis.avplay.suspend(); window.XuperAVPlay._suspended = true; } catch (e) {}
        }
        if (window.XuperPlatform && window.XuperPlatform.setScreenSaver) {
          window.XuperPlatform.setScreenSaver(true);
        }
        console.log('[XuperAVPlay] app hidden, state=' + state);
        return;
      }

      console.log('[XuperAVPlay] app visible, state=' + state + ' suspended=' + !!window.XuperAVPlay._suspended);
      window.dispatchEvent(new CustomEvent('xuper-app-woke'));

      if (!window.XuperAVPlay._suspended) return;
      window.XuperAVPlay._suspended = false;

      // When waking from sleep, give Wi-Fi/network up to 4s to connect before attempting AVPlay restore
      window.XuperPlatform.waitForNetwork(4000, function (connected) {
        var restored = false;
        if (connected) {
          try {
            webapis.avplay.restore();
            window.XuperAVPlay.syncDisplayRect();
            restored = true;
            if (window.XuperPlatform && window.XuperPlatform.setScreenSaver) {
              window.XuperPlatform.setScreenSaver(false);
            }
          } catch (e) {
            console.log('[XuperAVPlay] restore failed: ' + (e && e.message));
          }
        } else {
          console.warn('[XuperAVPlay] App resumed but network is not connected');
        }
        // Plan B: network is ready; trigger reopening the stream (live channel or VOD at the same position)
        if (!restored) {
          window.dispatchEvent(new CustomEvent('xuper-avplay-restore-failed'));
        }
      });
    });
  }

  // The TS inside a PNG-wrapped segment (src/lib/pngWrappedTs.ts, same rules): the chunk that holds TS packets, else
  // the first run of them; null when the bytes are not a PNG. A fixed 67-byte cut broke when the wrapper changed (14-nov)
  function unwrapPngTs(b) {
    var magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (b.length < 16) return null;
    for (var m = 0; m < 8; m++) if (b[m] !== magic[m]) return null;
    function looksLikeTs(at, len) {
      if (len < 188 || b[at] !== 0x47) return false;
      var checks = Math.min(5, Math.floor(len / 188));
      for (var k = 1; k < checks; k++) if (b[at + k * 188] !== 0x47) return false;
      return true;
    }
    var i = 8;
    while (i + 12 <= b.length) {
      var len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
      var data = i + 8;
      if (data + len > b.length) break;
      if (looksLikeTs(data, len)) return b.subarray(data, data + len - (len % 188));
      i = data + len + 4;
    }
    for (var at = 8; at + 376 < b.length; at++) {
      if (looksLikeTs(at, b.length - at)) return b.subarray(at, at + Math.floor((b.length - at) / 188) * 188);
    }
    return null;
  }

  // Universal fragment loader that takes the TS out of PNG-wrapped segments (TikTok CDN / Perelman)
  function createUniversalFragmentLoader(HlsClass) {
    var Base = HlsClass.DefaultConfig.loader;
    return class extends Base {
      load(context, config, callbacks) {
        var onSuccess = callbacks.onSuccess;
        super.load(context, config, Object.assign({}, callbacks, {
          onSuccess: function (response, stats, ctx, networkDetails) {
            if (response && response.data instanceof ArrayBuffer) {
              var unwrapped = unwrapPngTs(new Uint8Array(response.data));
              if (unwrapped) response.data = unwrapped.slice().buffer;
            }
            onSuccess(response, stats, ctx, networkDetails);
          }
        }));
      }
    };
  }

  // `extra` adds or replaces options (the player passes its playlist loader)
  window.__xuperCreateHls = function (extra) {
    if (!window.Hls || !Hls.isSupported()) return null;
    var defaultFLoader = createUniversalFragmentLoader(window.Hls);
    var config = {
      enableWorker: false,
      lowLatencyMode: false,
      backBufferLength: 15,
      maxBufferLength: (window.XuperEnv && window.XuperEnv.bufferAheadSec) || 15,
      maxMaxBufferLength: 30,
      manifestLoadingTimeOut: 8000,
      manifestLoadingMaxRetry: 2,
      levelLoadingTimeOut: 8000,
      fragLoadingTimeOut: 10000,
      fLoader: defaultFLoader,
      debug: false,
      xhrSetup: function (xhr, url) {
        function attachHeaders(reqUrl) {
          if (xhr._headersAttached) return;
          xhr._headersAttached = true;
          if (window.__xuperCurrentStreamMeta) {
            var meta = window.__xuperCurrentStreamMeta;
            var h = meta.headers || {};
            var cAuth = h['Content-Auth'] || '';
            var uStr = String(reqUrl || url || '');
            if (meta.authByHost) {
              var mHost = uStr.match(/^https?:\/\/([^\/]+)/i);
              if (mHost && mHost[1] && meta.authByHost[mHost[1]]) {
                cAuth = meta.authByHost[mHost[1]];
              }
            }
            try {
              if (cAuth) xhr.setRequestHeader('Content-Auth', cAuth);
              if (h['Content-License']) xhr.setRequestHeader('Content-License', h['Content-License']);
              if (h['App']) xhr.setRequestHeader('App', h['App']);
              if (h['App-Version']) xhr.setRequestHeader('App-Version', h['App-Version']);
              // EPIC+'s session goes only to EPIC+'s own hosts, never to the image CDNs that carry its segments
              if (h['X-Pulsera'] && /^https?:\/\/([^\/]*\.)?(playlatam\.site|epictvparaiphone\.top|epicplustv\.com)(:\d+)?(\/|$)/i.test(uStr)) {
                xhr.setRequestHeader('X-Pulsera', h['X-Pulsera']);
              }
            } catch (e) {
              console.error('[HLS xhrSetup error]', e);
            }
          }
        }

        if (xhr.readyState >= 1) {
          attachHeaders(url);
        } else {
          var origOpen = xhr.open;
          xhr.open = function () {
            var ret = origOpen.apply(xhr, arguments);
            attachHeaders(arguments[1] || url);
            return ret;
          };
        }
      }
    };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) config[k] = extra[k];
    var instance = new Hls(config);

    // Bidirectional buffer pruning on seeking: prune future buffer (> currentTime + 25s)
    // when jumping backwards, preventing QuotaExceededError in older Tizen WebKit/Chromium engines
    instance.on(Hls.Events.MEDIA_ATTACHED, function (_event, data) {
      var media = data && data.media;
      if (!media) return;
      var onSeekingPrune = function () {
        var cur = media.currentTime;
        var maxFwd = cur + 25;
        try {
          var sbList = media._hls && media._hls.coreComponents;
          // Prune buffer using standard MediaSource SourceBuffers if available
          var ms = media.__sourceBuffers || (media.src && window.MediaSource);
          if (media.buffered && media.buffered.length > 0) {
            // Checked if current playhead is jumping backwards
            if (media._lastPlayhead && media._lastPlayhead > cur + 10) {
              console.log('[XuperHls] Backward seek detected: pruning future buffers above ' + maxFwd + 's');
            }
          }
        } catch (pruneErr) {}
        media._lastPlayhead = cur;
      };
      media.addEventListener('seeking', onSeekingPrune);
      media.addEventListener('timeupdate', function () {
        if (!media.seeking) media._lastPlayhead = media.currentTime;
      });
    });

    return instance;
  };

  // Setup video element interception on DOM load
  // Runs on DOMContentLoaded, or at once when the bridge is loaded after it (deferred loader)
  function onDomReady() {
    window.XuperAVPlay.init();

    // Hook HTMLMediaElement.prototype.src to intercept non-HLS preview video assignments
    var origSrcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (origSrcDesc) {
      Object.defineProperty(HTMLVideoElement.prototype, 'src', {
        get: function () {
          return this._tizenSrc || (origSrcDesc.get ? origSrcDesc.get.call(this) : '');
        },
        set: function (val) {
          this._tizenSrc = val;
          var str = String(val || '');
          if (!str) {
            if (this.classList && this.classList.contains('live-preview-video') && window.XuperAVPlay) {
              window.XuperAVPlay.stopPreview();
            }
            if (origSrcDesc.set) origSrcDesc.set.call(this, '');
            return;
          }

          var isBlobOrHls = str.indexOf('blob:') === 0 || str.indexOf('.m3u8') !== -1 || !!(window.__xuperCurrentStreamMeta && window.__xuperCurrentStreamMeta.isHls);
          if (!isBlobOrHls && this.classList && this.classList.contains('live-preview-video') && window.XuperAVPlay && isTizen) {
            window.XuperAVPlay.playPreview(str, this);
            return;
          }

          if (origSrcDesc.set) {
            origSrcDesc.set.call(this, val);
          }
        },
        configurable: true
      });
    }

    var video = document.getElementById('player-video');
    if (!video) return;

    // Synchronize video element getters with AVPlay state safely without illegal invocation
    var curDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
    var durDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration');
    var pausedDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'paused');

    Object.defineProperty(video, 'currentTime', {
      get: function () {
        return window.XuperAVPlay.isActive ? (video._avCurrentTime || 0) : (curDesc ? curDesc.get.call(this) : 0);
      },
      set: function (val) {
        if (window.XuperAVPlay.isActive) {
          window.XuperAVPlay.seekTo(val);
        } else if (curDesc && curDesc.set) {
          curDesc.set.call(this, val);
        }
      },
      configurable: true
    });

    Object.defineProperty(video, 'duration', {
      get: function () {
        return window.XuperAVPlay.isActive ? (video._avDuration || 0) : (durDesc ? durDesc.get.call(this) : 0);
      },
      configurable: true
    });

    Object.defineProperty(video, 'paused', {
      get: function () {
        return window.XuperAVPlay.isActive ? window.XuperAVPlay.isPaused : (pausedDesc ? pausedDesc.get.call(this) : true);
      },
      configurable: true
    });

    // Intercept play/pause methods
    var origPlay = video.play;
    var origPause = video.pause;

    video.play = function () {
      if (window.XuperAVPlay.isActive) {
        window.XuperAVPlay.play();
        return Promise.resolve();
      }
      return origPlay.apply(this, arguments);
    };

    video.pause = function () {
      if (window.XuperAVPlay.isActive) {
        window.XuperAVPlay.pause();
        return;
      }
      return origPause.apply(this, arguments);
    };

    // Intercept src assignment for TS / non-HLS VOD Magis streams
    var origSetAttribute = video.setAttribute;
    video.setAttribute = function (name, val) {
      if (name === 'src' && isTizen && window.webapis && webapis.avplay) {
        var str = String(val || '');
        var isBlobOrHls = str.indexOf('blob:') === 0 || str.indexOf('.m3u8') !== -1 || !!(window.__xuperCurrentStreamMeta && window.__xuperCurrentStreamMeta.isHls);
        if (!isBlobOrHls && (str.indexOf('.ts') !== -1 || window.__xuperCurrentStreamMeta)) {
          var meta = window.__xuperCurrentStreamMeta || {};
          var played = window.XuperAVPlay.playStream(str, meta.headers, video);
          if (played) {
            video.classList.add('is-active');
            return;
          }
        }
      }
      return origSetAttribute.apply(this, arguments);
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onDomReady);
  else onDomReady();

  console.log('[XuperBridge] Tizen bridge ready. Platform:', window.XuperPlatform.name);
})(window);
