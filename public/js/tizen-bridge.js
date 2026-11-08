/**
 * Tizen bridge for XuperTV port
 * Connects Samsung Tizen TV environment with XuperTV web app,
 * handles remote control mapping, local Luna service emulation (MagisClient + M3U),
 * and native AVPlay hardware acceleration for MPEG-TS / VOD playback.
 */
(function (window) {
  'use strict';

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
  window.XuperPlatform.setScreenSaver = function (enable) {
    if (!isTizen || !window.webapis || !webapis.appcommon || !webapis.appcommon.setScreenSaver) return;
    try {
      var state = enable
        ? webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_ON
        : webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF;
      webapis.appcommon.setScreenSaver(state);
      console.log('[TizenBridge] ScreenSaver set to:', enable ? 'ON' : 'OFF');
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
        console.log('[resolveLive]', code, err ? ('ERR ' + (err.message || err)) : (stream && stream.url), 'hls=' + !!(window.Hls && Hls.isSupported()));
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
          var pEl = this.previewVideoEl || document.getElementById('live-preview-video');
          if (pEl) {
            var r = pEl.getBoundingClientRect();
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
        var cfg = JSON.parse(localStorage.getItem('xuper_global_playback_v1') || '{}');
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
          console.log('[XuperAVPlay] Retrying with backup CDN:', nextUrl);
          return self._openAndPrepareStream(nextUrl, nextHeaders, self.videoEl);
        }
      }
      return false;
    },

    _recoverLive: function () {
      var self = this;
      if (self.kind !== 'live' || self._recoveringLive || (self._liveRecoveryAttempts || 0) >= 2) return false;
      self._recoveringLive = true;
      self._liveRecoveryAttempts = (self._liveRecoveryAttempts || 0) + 1;
      console.log('[XuperAVPlay] Auto-recovering live stream, attempt #' + self._liveRecoveryAttempts);
      var meta = window.__xuperCurrentStreamMeta;
      var code = meta && (meta.code || meta.id || meta.channelCode);
      if (code && window.MagisClient && typeof window.MagisClient.resolveLive === 'function') {
        window.MagisClient.resolveLive(code, function (err, newMeta) {
          self._recoveringLive = false;
          if (!err && newMeta && newMeta.url && self.videoEl) {
            window.__xuperCurrentStreamMeta = newMeta;
            self._openAndPrepareStream(newMeta.url, newMeta.headers, self.videoEl);
            return;
          }
          self.isActive = false;
          if (self.videoEl && self.videoEl.onerror) self.videoEl.onerror();
        });
        return true;
      }
      self._recoveringLive = false;
      return false;
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
      self._liveRecoveryAttempts = 0;
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

        var isSecureRequired = String(url).indexOf(':443') !== -1 || !!(headers && (headers['Referer'] || headers['referer'] || headers['Origin']));
        var cleanUrl = isSecureRequired ? String(url) : String(url).replace(/^https:\/\//i, 'http://');
        self._lastUrl = cleanUrl;
        webapis.avplay.open(cleanUrl);
        self.syncDisplayRect();
        webapis.avplay.setDisplayMethod(self._displayMethod());
        self._applyHeaders(headers);

        var isLive = self.kind === 'live';
        try {
          // Buffer before playing and after a stall. AVPlay only applies these in the IDLE state (before
          // prepare), so they are the values in effect for the whole session. Live uses 5s / 7s: a little
          // slower to tune in, but network hiccups no longer freeze the picture.
          webapis.avplay.setBufferingParam("PLAYER_BUFFER_FOR_PLAY", "PLAYER_BUFFER_SIZE_IN_SECOND", isLive ? 5 : 3);
          webapis.avplay.setBufferingParam("PLAYER_BUFFER_FOR_RESUME", "PLAYER_BUFFER_SIZE_IN_SECOND", isLive ? 7 : 5);
        } catch (bufErr) {}

        webapis.avplay.setListener({
          onbufferingstart: function () {
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
            // Expand buffer dynamically after playback starts for resilience against network jitter
            try {
              webapis.avplay.setBufferingParam("PLAYER_BUFFER_FOR_RESUME", "PLAYER_BUFFER_SIZE_IN_SECOND", 8);
            } catch (bufExpandErr) {}
            // If initial seek hasn't completed yet, execute it now that buffering is complete
            if (self._initialSeekSec > 0) {
              var retryMs = Math.floor(self._initialSeekSec * 1000);
              self._initialSeekSec = 0;
              console.log('[XuperAVPlay] onbufferingcomplete: executing initial seek to ' + retryMs + 'ms');
              try {
                webapis.avplay.seekTo(retryMs, function () {
                  console.log('[XuperAVPlay] onbufferingcomplete seekTo success:', retryMs);
                }, function (err) {
                  console.warn('[XuperAVPlay] onbufferingcomplete seekTo failed:', err);
                });
              } catch (e) {
                console.warn('[XuperAVPlay] onbufferingcomplete seekTo error:', e);
              }
            }
            if (self.videoEl && self.videoEl.oncanplay) self.videoEl.oncanplay();
            if (self.videoEl && self.videoEl.onplaying) self.videoEl.onplaying();
          },
          oncurrentplaytime: function (ms) {
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
            if (self.kind === 'live' && self._recoverLive()) return;
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
          webapis.avplay.play();
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

          // If there is an initial resume position, perform seek immediately
          if (self._initialSeekSec > 0) {
            var initMs = Math.floor(self._initialSeekSec * 1000);
            console.log('[XuperAVPlay] Executing initial resume seek to ' + self._initialSeekSec + 's (' + initMs + 'ms)');
            try {
              webapis.avplay.seekTo(initMs, function () {
                console.log('[XuperAVPlay] Initial seekTo success:', initMs);
                self._initialSeekSec = 0;
              }, function (seekErr) {
                console.log('[XuperAVPlay] Initial seekTo immediate failed, will retry on buffering complete:', seekErr);
              });
            } catch (seekEx) {
              console.log('[XuperAVPlay] Initial seekTo immediate exception, will retry on buffering complete:', seekEx);
            }
          }

          if (self.videoEl && self.videoEl.onplay) self.videoEl.onplay();
          if (self.videoEl && self.videoEl.onplaying) self.videoEl.onplaying();
        }, function (e) {
          console.error('[XuperAVPlay] prepareAsync error:', e);
          reportPlayback('error', 'prepare ' + ((e && (e.name || e.message)) || e) + (self.kind === 'vod' ? ' (vod)' : ''), self._lastUrl);
          if (window.XuperPlatform && window.XuperPlatform.setScreenSaver) {
            window.XuperPlatform.setScreenSaver(true);
          }
          if (self._tryNextBackup()) return;
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

    seekTo: function (sec, successCb, errorCb) {
      var self = this;
      var ms = Math.floor(sec * 1000);
      if (ms < 100) ms = 100;
      var state = '';
      try { state = webapis.avplay.getState(); } catch (e) {}

      // If the player is not yet fully active, queue as initial seek
      if (!this.isActive || state === 'NONE' || state === 'IDLE' || state === 'READY') {
        console.log('[XuperAVPlay] Player not yet active, queuing initial seek to ' + sec + 's');
        this._initialSeekSec = sec;
        return;
      }

      // If already seeking, queue the latest target so we don't bombard AVPlay with concurrent seeks
      if (this._isSeeking) {
        console.log('[XuperAVPlay] Seek already in progress, queuing target ' + sec + 's');
        this._pendingSeekSec = sec;
        this._pendingSeekCallbacks = { success: successCb, error: errorCb };
        return;
      }

      this._isSeeking = true;

      var executeSeek = function (targetMs, retriesLeft) {
        try {
          webapis.avplay.seekTo(targetMs, function () {
            console.log('[XuperAVPlay] seekTo ' + targetMs + 'ms succeeded');
            self._isSeeking = false;
            if (typeof successCb === 'function') successCb();
            if (self._pendingSeekSec !== null) {
              var nextSec = self._pendingSeekSec;
              var nextCbs = self._pendingSeekCallbacks || {};
              self._pendingSeekSec = null;
              self._pendingSeekCallbacks = null;
              self.seekTo(nextSec, nextCbs.success, nextCbs.error);
            }
          }, function (err) {
            console.warn('[XuperAVPlay] seekTo ' + targetMs + 'ms attempt failed:', err);
            // If AVPlay failed due to transient state transition, retry once after 120ms
            if (retriesLeft > 0) {
              setTimeout(function () {
                if (self.isActive) {
                  executeSeek(targetMs, retriesLeft - 1);
                } else {
                  self._isSeeking = false;
                }
              }, 120);
              return;
            }
            self._isSeeking = false;
            self._pendingSeekSec = null;
            self._pendingSeekCallbacks = null;
            if (typeof errorCb === 'function') errorCb(err);
          });
        } catch (e) {
          console.warn('[XuperAVPlay] seekTo exception:', e);
          if (retriesLeft > 0) {
            setTimeout(function () {
              if (self.isActive) {
                executeSeek(targetMs, retriesLeft - 1);
              } else {
                self._isSeeking = false;
              }
            }, 120);
            return;
          }
          self._isSeeking = false;
          self._pendingSeekSec = null;
          self._pendingSeekCallbacks = null;
          if (typeof errorCb === 'function') errorCb(e);
        }
      };

      executeSeek(ms, 1);
    },

    stop: function () {
      this._isSeeking = false;
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
      if (obj) obj.remove();
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
        webapis.avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_FULL_SCREEN');

        var meta = window.__xuperCurrentStreamMeta || {};
        self._applyHeaders(meta.headers);

        try {
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
              console.log('[XuperAVPlay] Preview retrying backup CDN:', nextUrl);
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

  // `extra` adds or replaces options (the player passes its playlist loader)
  window.__xuperCreateHls = function (extra) {
    if (!window.Hls || !Hls.isSupported()) return null;
    var config = {
      enableWorker: false,
      lowLatencyMode: false,
      backBufferLength: 15,
      maxBufferLength: 15,
      maxMaxBufferLength: 30,
      manifestLoadingTimeOut: 8000,
      manifestLoadingMaxRetry: 2,
      levelLoadingTimeOut: 8000,
      fragLoadingTimeOut: 10000,
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
    return new Hls(config);
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
