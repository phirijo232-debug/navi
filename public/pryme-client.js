(function () {
  var KEY = 'prymeInstallId';
  var MESSAGE_KEY = 'prymeLicenseMessage';

  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (symbol) {
      var random = Math.random() * 16 | 0;
      var value = symbol === 'x' ? random : (random & 0x3 | 0x8);
      return value.toString(16);
    });
  }

  function installId() {
    try {
      var existing = localStorage.getItem(KEY);
      if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(existing)) {
        return existing.toLowerCase();
      }
      var id = String(newId()).toLowerCase();
      localStorage.setItem(KEY, id);
      return id;
    } catch (err) {
      return '';
    }
  }

  function deviceLabel() {
    var platform = (navigator && navigator.platform) || 'browser';
    return String(platform).replace(/[^\x20-\x7E]/g, '').slice(0, 80);
  }

  function safeLogo(url) {
    try {
      var parsed = new URL(url, window.location.origin);
      if (parsed.origin !== window.location.origin) return '';
      if (parsed.pathname !== '/branding/logo') return '';
      return parsed.pathname;
    } catch (err) {
      return '';
    }
  }

  function applyBranding(data) {
    var name = data && data.name ? String(data.name) : 'PRYME LOAN';
    var footer = data && data.footer ? String(data.footer) : 'Powered by PRYME LOAN';
    document.querySelectorAll('[data-brand-name]').forEach(function (el) {
      el.textContent = name;
    });
    document.querySelectorAll('[data-brand-footer]').forEach(function (el) {
      el.textContent = footer;
    });
    var logo = safeLogo(data && data.logoUrl);
    document.querySelectorAll('[data-brand-logo]').forEach(function (img) {
      if (!logo) {
        img.removeAttribute('src');
        img.hidden = true;
        img.classList.add('hidden');
        return;
      }
      img.src = logo;
      img.alt = name;
      img.hidden = false;
      img.classList.remove('hidden');
    });
  }

  function loadBranding() {
    if (!document.querySelector('[data-brand-name], [data-brand-footer], [data-brand-logo]')) return;
    fetch('/branding').then(function (response) {
      return response.json();
    }).then(applyBranding).catch(function () {});
  }

  window.prymeInstallId = installId;
  window.prymeDeviceLabel = deviceLabel;
  window.prymeTakeLicenseMessage = function () {
    try {
      var message = sessionStorage.getItem(MESSAGE_KEY) || '';
      sessionStorage.removeItem(MESSAGE_KEY);
      return message;
    } catch (err) {
      return '';
    }
  };

  if (typeof window.fetch === 'function') {
    var originalFetch = window.fetch;
    window.fetch = function (input, init) {
      var id = installId();
      var next = init ? Object.assign({}, init) : {};
      var headers = new Headers(next.headers || {});
      if (id && !headers.has('x-install-id')) headers.set('x-install-id', id);
      if (!headers.has('x-device-label')) headers.set('x-device-label', deviceLabel());
      next.headers = headers;
      return originalFetch.call(this, input, next).then(function (response) {
        if (response.status === 403) {
          response.clone().json().then(function (data) {
            if (!data || !data.license || !data.error || window.__prymeLicenseRedirecting) return;
            try { sessionStorage.setItem(MESSAGE_KEY, data.error); } catch (err) {}
            if (location.pathname === '/login') return;
            window.__prymeLicenseRedirecting = true;
            localStorage.removeItem('deviceToken');
            if (location.pathname === '/admin') location.reload();
            else location.href = '/login';
          }).catch(function () {});
        }
        return response;
      });
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadBranding);
  } else {
    loadBranding();
  }
})();
