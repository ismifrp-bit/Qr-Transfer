// qr-generator.js — thin wrapper around the QRCode library (js/vendor/qrcode.js).
// Keeps the rest of the app decoupled from the specific library's API.
'use strict';

const QrGenerator = (() => {

  // Raw (pre-base64) bytes per data chunk. Chosen so the resulting QR stays
  // in the "reliably handheld-scannable" range rather than maxing out
  // capacity — a denser code transfers more per frame but scans worse on
  // average phone cameras and lighting.
  const DENSITY_PRESETS = {
    low: 350,      // biggest modules, most reliable in poor conditions
    medium: 700,   // default
    high: 1200     // fewer frames, needs a good camera + steady hands
  };

  let instance = null;
  let currentEl = null;

  function ensureInstance(el, sizePx) {
    if (instance && currentEl === el) return instance;
    el.innerHTML = '';
    instance = new QRCode(el, {
      text: ' ',
      width: sizePx,
      height: sizePx,
      colorDark: '#12141A',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
    currentEl = el;
    return instance;
  }

  function render(el, text, sizePx = 280) {
    const qr = ensureInstance(el, sizePx);
    qr.clear();
    qr.makeCode(text);
  }

  function reset() {
    instance = null;
    currentEl = null;
  }

  return { render, reset, DENSITY_PRESETS };
})();
