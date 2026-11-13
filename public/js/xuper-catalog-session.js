(function (root) {
  'use strict';

  var grant = null;
  var pending = null;
  var retryAt = 0;
  var DEVICE_KEY = 'xuper_catalog_device_v1';

  function deviceId() {
    var value = root.localStorage.getItem(DEVICE_KEY);
    if (/^[a-f0-9]{32}$/.test(value || '')) return value;

    var bytes = new Uint8Array(16);
    root.crypto.getRandomValues(bytes);
    value = Array.prototype.map.call(bytes, function (byte) {
      return ('0' + byte.toString(16)).slice(-2);
    }).join('');
    root.localStorage.setItem(DEVICE_KEY, value);
    return value;
  }

  root.XuperCatalogSession = {
    acquire: function (rejectedToken) {
      if (grant && rejectedToken && grant.session.userToken !== rejectedToken) {
        return Promise.resolve(grant.session);
      }
      if (!rejectedToken && grant && grant.expiresAt > Date.now() + 15000) {
        return Promise.resolve(grant.session);
      }
      if (pending) return pending;
      if (Date.now() < retryAt) {
        return Promise.reject(new Error('No se pudo actualizar el catálogo. Se conserva la copia local.'));
      }

      console.log('[catalog-session] requesting authorized session');
      pending = root.XuperServer.request('/catalog-session', {
        deviceId: deviceId(),
        rejectedToken: rejectedToken || undefined
      }, { deadline: Date.now() + 12000 }).then(function (value) {
        var session = value && value.session;
        var required = ['sn', 'userId', 'userToken'];
        if (!session || !required.every(function (key) {
          return typeof session[key] === 'string' && session[key].length > 0;
        })) {
          throw new Error('Autorización de catálogo no válida.');
        }
        if (!Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now() + 15000) {
          throw new Error('La sesión de catálogo no tiene una vigencia válida.');
        }
        grant = { session: session, expiresAt: value.expiresAt };
        console.log('[catalog-session] authorized session ready');
        return session;
      }).catch(function (error) {
        retryAt = Date.now() + 30000;
        console.warn('[catalog-session] authorized session failed:', error && error.message ? error.message : error);
        throw error;
      }).then(function (value) {
        pending = null;
        return value;
      }, function (error) {
        pending = null;
        throw error;
      });

      return pending;
    }
  };
})(window);
