// Session calls stay on this page's origin unless BMF_API_BASE (from
// /client-config.js) is a different HTTPS host, such as the configured ngrok URL.
// Auth is the x-device-token header. This file does not set cookies.
(function () {
  function apiUrl(path) {
    const target = String(path || '').charAt(0) === '/' ? String(path) : `/${path}`;
    const configured = String(window.BMF_API_BASE || '').trim().replace(/\/+$/, '');
    if (!configured) return target;
    try {
      if (location.protocol !== 'file:' && new URL(configured).origin === location.origin) return target;
    } catch (err) {
      return target;
    }
    return configured + target;
  }

  window.bmfApi = apiUrl;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (typeof input === 'string' && input.charAt(0) === '/') {
      return nativeFetch(apiUrl(input), init);
    }
    return nativeFetch(input, init);
  };

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  }
})();
