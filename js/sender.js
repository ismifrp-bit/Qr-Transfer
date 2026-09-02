// sender.js — everything on the "send data" side of the app.
'use strict';

const Sender = (() => {

  let activeType = 'text';
  let density = 'medium';
  let selectedFile = null;
  let worker = null;

  let packets = [];          // full ordered packet strings, [0] = header
  let playlist = [];         // indices into `packets` currently being cycled
  let playlistPos = 0;
  let playTimer = null;
  let isPlaying = false;
  let frameMs = 450;
  let transferMeta = null;

  function $(id) { return document.getElementById(id); }

  // ---------- type tabs / density ----------
  function setActiveType(type) { activeType = type; updateEstimate(); }
  function setDensity(d) { density = d; updateEstimate(); }

  // ---------- file selection ----------
  function initFileUi() {
    const dropZone = $('dropZone');
    const fileInput = $('fileInput');

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) handleFile(fileInput.files[0]);
    });
  }

  function handleFile(file) {
    selectedFile = file;
    $('fileSummaryCard').classList.remove('hidden');
    $('fileName').textContent = file.name;
    $('fileDetail').textContent = `${Utils.formatBytes(file.size)} · ${file.type || 'unknown type'}`;

    const sizeBanner = $('fileSizeBanner');
    const LARGE = 5 * 1024 * 1024;
    const VERY_LARGE = 20 * 1024 * 1024;
    if (file.size > VERY_LARGE) {
      sizeBanner.classList.remove('hidden');
      $('fileSizeBannerText').textContent = `This file is ${Utils.formatBytes(file.size)}. QR transfer works, but at this size it can take a long time and many frames. Consider a smaller file if possible.`;
    } else if (file.size > LARGE) {
      sizeBanner.classList.remove('hidden');
      $('fileSizeBannerText').textContent = `This file is ${Utils.formatBytes(file.size)} — expect a noticeable number of QR frames.`;
    } else {
      sizeBanner.classList.add('hidden');
    }
    updateEstimate();
  }

  // ---------- size estimate ----------
  function currentPayloadSize() {
    if (activeType === 'file' && selectedFile) return selectedFile.size;
    if (activeType === 'text') return new Blob([$('textInput').value]).size;
    if (activeType === 'url') return new Blob([$('urlInput').value]).size;
    if (activeType === 'contact') return new Blob([buildVCard()]).size;
    return 0;
  }

  const updateEstimate = Utils.debounce(() => {
    const box = $('sendEstimate');
    const size = currentPayloadSize();
    if (!size) { box.classList.add('hidden'); return; }
    const chunkBytes = QrGenerator.DENSITY_PRESETS[density];
    const compress = $('compressToggle').checked;
    const estSize = compress ? size * 0.8 : size; // rough, real value known after actual processing
    const totalChunks = Math.max(1, Math.ceil(estSize / chunkBytes)) + 1;
    const seconds = totalChunks * (frameMs / 1000);
    box.classList.remove('hidden');
    box.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 8v5M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
      + `<span>~${totalChunks} QR frame${totalChunks === 1 ? '' : 's'} · about ${Utils.formatDuration(seconds)} to display once</span>`;
  }, 200);

  // ---------- content builders ----------
  function buildVCard() {
    const name = $('contactName').value.trim();
    const phone = $('contactPhone').value.trim();
    const email = $('contactEmail').value.trim();
    return `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL:${phone}\nEMAIL:${email}\nEND:VCARD`;
  }

  async function collectPayload() {
    if (activeType === 'text') {
      const text = $('textInput').value;
      if (!text.trim()) throw new Error('Type something to send first.');
      return { bytes: new TextEncoder().encode(text), fileName: 'note.txt', mime: 'text/plain', dataType: 'text' };
    }
    if (activeType === 'url') {
      const url = $('urlInput').value.trim();
      if (!url) throw new Error('Enter a link to send first.');
      return { bytes: new TextEncoder().encode(url), fileName: 'link.txt', mime: 'text/plain', dataType: 'url' };
    }
    if (activeType === 'contact') {
      if (!$('contactName').value.trim()) throw new Error('Enter at least a name for the contact.');
      const vcard = buildVCard();
      return { bytes: new TextEncoder().encode(vcard), fileName: 'contact.vcf', mime: 'text/vcard', dataType: 'contact' };
    }
    if (activeType === 'file') {
      if (!selectedFile) throw new Error('Choose a file to send first.');
      const bytes = await FileHandler.readFileAsBytes(selectedFile);
      return { bytes, fileName: selectedFile.name, mime: selectedFile.type || 'application/octet-stream', dataType: FileHandler.categoryFor(selectedFile.type, selectedFile.name) };
    }
    throw new Error('Unknown data type.');
  }

  // ---------- generate ----------
  async function onGenerate() {
    const btn = $('generateBtn');
    try {
      btn.disabled = true;
      btn.textContent = 'Preparing…';

      const { bytes, fileName, mime, dataType } = await collectPayload();
      const password = $('passwordToggle').checked ? $('passwordInput').value : null;
      if ($('passwordToggle').checked && !password) throw new Error('Enter a password, or turn password protection off.');

      const chunkPayloadBytes = QrGenerator.DENSITY_PRESETS[density];

      if (!worker) worker = new Worker('workers/transfer-worker.js');
      worker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'PROGRESS') {
          btn.textContent = { hash: 'Checking data…', compress: 'Compressing…', encrypt: 'Encrypting…', chunk: 'Splitting into QR frames…' }[msg.stage] || 'Preparing…';
        } else if (msg.type === 'DONE') {
          packets = msg.packets;
          transferMeta = msg.metadata;
          btn.disabled = false;
          btn.textContent = 'Generate QR codes';
          enterQrView();
        } else if (msg.type === 'ERROR') {
          btn.disabled = false;
          btn.textContent = 'Generate QR codes';
          alert('Could not prepare the transfer: ' + msg.message);
        }
      };
      worker.postMessage({
        cmd: 'PREPARE', bytes, fileName, mime, dataType, password,
        useCompression: $('compressToggle').checked,
        chunkPayloadBytes
      });
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Generate QR codes';
      alert(err.message);
    }
  }

  // ---------- QR playback view ----------
  function enterQrView() {
    playlist = packets.map((_, i) => i);
    playlistPos = 0;
    App.goTo('qr');
    $('transferIdLabel').textContent = transferMeta.transferId.slice(0, 8);
    const kb = Utils.formatBytes(transferMeta.payloadSize);
    $('qrMetaLine').textContent = `${transferMeta.name} · ${kb} · ${packets.length} frames`;
    renderCurrentFrame();
    play();
  }

  function renderCurrentFrame() {
    const idx = playlist[playlistPos];
    QrGenerator.render($('qrCanvasHost'), packets[idx], 240);
    $('qrIndexLabel').innerHTML = `Frame <strong>${idx + 1}</strong> / ${packets.length}`;
    const pct = ((playlistPos + 1) / playlist.length) * 100;
    $('sendProgressFill').style.width = pct + '%';
  }

  function step(delta) {
    pause();
    playlistPos = (playlistPos + delta + playlist.length) % playlist.length;
    renderCurrentFrame();
  }

  function play() {
    isPlaying = true;
    $('playIcon').classList.add('hidden');
    $('pauseIcon').classList.remove('hidden');
    clearInterval(playTimer);
    playTimer = setInterval(() => {
      playlistPos = (playlistPos + 1) % playlist.length;
      renderCurrentFrame();
    }, frameMs);
  }

  function pause() {
    isPlaying = false;
    $('playIcon').classList.remove('hidden');
    $('pauseIcon').classList.add('hidden');
    clearInterval(playTimer);
  }

  function togglePlay() { isPlaying ? pause() : play(); }

  function replayMissing() {
    const raw = $('jumpToChunk').value.trim();
    if (!raw) return;
    const indices = raw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n >= 1 && n < packets.length);
    if (!indices.length) { alert('Enter chunk numbers separated by commas, e.g. 4, 7, 12'); return; }
    playlist = [0, ...indices]; // always resend header so a fresh receiver session can still parse
    playlistPos = 0;
    renderCurrentFrame();
    play();
  }

  function resetToFullSequence() {
    playlist = packets.map((_, i) => i);
    playlistPos = 0;
    renderCurrentFrame();
  }

  function newTransfer() {
    pause();
    packets = [];
    transferMeta = null;
    selectedFile = null;
    $('fileSummaryCard').classList.add('hidden');
    $('textInput').value = '';
    $('urlInput').value = '';
    App.goTo('send');
  }

  function onEnterSendView() { updateEstimate(); }

  function initEvents() {
    initFileUi();
    $('textInput').addEventListener('input', () => {
      $('textCount').textContent = $('textInput').value.length;
      updateEstimate();
    });
    $('urlInput').addEventListener('input', updateEstimate);
    $('compressToggle').addEventListener('change', updateEstimate);
    $('generateBtn').addEventListener('click', onGenerate);

    $('playPauseBtn').addEventListener('click', togglePlay);
    $('prevFrameBtn').addEventListener('click', () => step(-1));
    $('nextFrameBtn').addEventListener('click', () => step(1));
    $('speedRange').addEventListener('input', (e) => {
      frameMs = parseInt(e.target.value, 10);
      $('speedLabel').textContent = `${frameMs} ms`;
      if (isPlaying) play();
    });
    $('replayMissingBtn').addEventListener('click', replayMissing);
    $('newTransferBtn').addEventListener('click', newTransfer);
  }

  function init() { initEvents(); }

  return { init, setActiveType, setDensity, onEnterSendView };
})();
