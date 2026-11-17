(function (root) {
  'use strict';

  var BASE = 'https://vps-cbe3e5a0.vps.ovh.ca/api';
  var RELAY_BASE = 'https://proud-cherry-3cda.eclecticempire02.workers.dev';
  var RELAY_SALT = 'EcLex_T1z3n_S3cur1ty_#2026_Xup3r';
  var KEY = 'xuper_server_device_key_v1';

  function fetchFromRelay() {
    return new Promise(function (resolve, reject) {
      var ts = String(Date.now());
      var duid = 'tizen-tv-guest';
      var sig = '';
      try {
        if (root.CryptoJS && root.CryptoJS.MD5) {
          sig = root.CryptoJS.MD5('eclex:' + ts + ':session.eclex:' + duid + ':' + RELAY_SALT).toString();
        }
      } catch (e) {}

      var xhr = new XMLHttpRequest();
      xhr.open('GET', RELAY_BASE + '/session/fallback', true);
      xhr.timeout = 8000;
      if (sig) {
        xhr.setRequestHeader('X-Eclex-Time', ts);
        xhr.setRequestHeader('X-Eclex-Duid', duid);
        xhr.setRequestHeader('X-Eclex-Sig', sig);
      }
      xhr.onload = function () {
        try {
          var res = JSON.parse(xhr.responseText);
          if (res && res.ok && res.session && res.session.userId && res.session.userToken) {
            resolve({
              returnValue: true,
              session: {
                sn: res.session.sn || '',
                userId: String(res.session.userId),
                userToken: String(res.session.userToken)
              },
              expiresAt: Date.now() + 28800000
            });
            return;
          }
        } catch (e) {}
        reject(new Error('Relay no entregó sesión válida'));
      };
      xhr.onerror = xhr.ontimeout = function () {
        reject(new Error('Relay inaccesible'));
      };
      xhr.send();
    });
  }

  function deviceToken() {
    var value = root.localStorage.getItem(KEY);
    if (/^[a-f0-9]{64}$/.test(value || '')) return value;

    var bytes = new Uint8Array(32);
    root.crypto.getRandomValues(bytes);
    value = Array.prototype.map.call(bytes, function (byte) {
      return ('0' + byte.toString(16)).slice(-2);
    }).join('');
    root.localStorage.setItem(KEY, value);

    if (root.localStorage.getItem(KEY) !== value) {
      throw new Error('No se pudo guardar la identificación de este televisor.');
    }
    return value;
  }

  function request(path, body, options) {
    return new Promise(function (resolve, reject) {
      if (path !== '/catalog-session') {
        reject(new Error('Solicitud de catálogo no permitida.'));
        return;
      }

      var deadline = options && options.deadline;
      var remaining = deadline ? deadline - Date.now() : 12000;
      if (remaining <= 0) {
        reject(new Error('La solicitud tardó demasiado. Vuelve a intentarlo.'));
        return;
      }

      var xhr = new XMLHttpRequest();
      xhr.open('POST', BASE + path, true);
      xhr.timeout = Math.max(1, Math.min(12000, remaining));
      xhr.setRequestHeader('Content-Type', 'application/json');

      try {
        xhr.setRequestHeader('Authorization', 'Bearer ' + deviceToken());
      } catch (error) {
        reject(error);
        return;
      }

      xhr.onload = function () {
        var data;
        try {
          data = JSON.parse(xhr.responseText);
        } catch (error) {
          reject(new Error('El servidor devolvió una respuesta no válida.'));
          return;
        }

        if (xhr.status < 200 || xhr.status >= 300 || data.returnValue === false) {
          return fetchFromRelay().then(resolve, function () {
            var failure = new Error(data.message || 'No se pudo actualizar el catálogo.');
            failure.code = data.errorCode || 'server_unavailable';
            reject(failure);
          });
        }
        resolve(data);
      };

      xhr.onerror = xhr.ontimeout = function () {
        fetchFromRelay().then(resolve, function () {
          reject(new Error('No se pudo contactar con el servidor del catálogo.'));
        });
      };
      xhr.send(JSON.stringify(body));
    });
  }

  root.XuperServer = { request: request };
})(window);
