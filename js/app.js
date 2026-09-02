// app.js — navigation, theme, and PWA bootstrapping. Feature logic lives
// in sender.js / receiver.js.
'use strict';

const App = (() => {

  const views = document.querySelectorAll('.view');

  function goTo(name) {
    views.forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
    window.scrollTo(0, 0);
    if (name !== 'receive' && window.Receiver) Receiver.stopCamera();
    if (name === 'send') Sender.onEnterSendView();
    document.dispatchEvent(new CustomEvent('view:changed', { detail: { name } }));
  }

  function initNav() {
    document.querySelectorAll('[data-nav]').forEach(el => {
      el.addEventListener('click', () => goTo(el.dataset.nav));
    });
  }

  function initTheme() {
    const stored = localStorage.getItem('qrt-theme');
    const preferred = stored || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', preferred);
    document.getElementById('themeToggle').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('qrt-theme', next);
    });
  }

  function initSendTabs() {
    const tabs = document.querySelectorAll('#view-send .tab-row[aria-label="Data type"] .tab-btn');
    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        tabs.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
        btn.classList.add('active'); btn.setAttribute('aria-selected', 'true');
        document.querySelectorAll('.send-panel').forEach(p => {
          p.classList.toggle('hidden', p.dataset.panel !== btn.dataset.type);
        });
        Sender.setActiveType(btn.dataset.type);
      });
    });

    const densityBtns = document.querySelectorAll('#densityRow .tab-btn');
    densityBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        densityBtns.forEach(b => { b.classList.remove('active'); b.removeAttribute('aria-selected'); });
        btn.classList.add('active'); btn.setAttribute('aria-selected', 'true');
        Sender.setDensity(btn.dataset.density);
      });
    });

    document.getElementById('passwordToggle').addEventListener('change', (e) => {
      document.getElementById('passwordField').classList.toggle('hidden', !e.target.checked);
    });
  }

  async function initServiceWorker() {
    const banner = document.getElementById('offlineBanner');
    const text = document.getElementById('offlineBannerText');
    if (!('serviceWorker' in navigator)) {
      text.textContent = 'This browser does not support offline caching.';
      return;
    }
    try {
      const reg = await navigator.serviceWorker.register('service-worker.js');
      navigator.serviceWorker.addEventListener('controllerchange', () => {});
      if (navigator.serviceWorker.controller) {
        text.textContent = '🟢 Offline ready — this app now works without a connection.';
      } else {
        reg.addEventListener('updatefound', () => {});
        text.textContent = 'Caching app files for offline use…';
        navigator.serviceWorker.ready.then(() => {
          text.textContent = '🟢 Offline ready — this app now works without a connection.';
        });
      }
    } catch (e) {
      text.textContent = 'Offline caching is unavailable in this context (e.g. file:// or private browsing).';
    }
  }

  function checkBrowserSupport() {
    const missing = [];
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) missing.push('camera access');
    if (!window.crypto || !window.crypto.subtle) missing.push('Web Crypto');
    if (!window.Worker) missing.push('Web Workers');
    if (missing.length) {
      const banner = document.createElement('div');
      banner.className = 'banner warn';
      banner.textContent = `Your browser is missing: ${missing.join(', ')}. Some features may not work. Please use a recent version of Chrome, Edge, Firefox, or Safari.`;
      document.getElementById('mainContent').prepend(banner);
    }
  }

  function init() {
    initNav();
    initTheme();
    initSendTabs();
    checkBrowserSupport();
    initServiceWorker();
    Sender.init();
    Receiver.init();
  }

  document.addEventListener('DOMContentLoaded', init);

  return { goTo };
})();
