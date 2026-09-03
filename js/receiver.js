// receiver.js — everything on the "receive data" side of the app.
'use strict';

const Receiver = (() => {

  let session = null;
  let cameraRunning = false;
  let pendingPlainBytes = null; // set once complete, before password/verification finishes

  function $(id) { return document.getElementById(id); }

  function resetSession() {
    session = new ChunkManager.ReceiverSession();
    pendingPlainBytes = null;
    $('receiveProgressFill').style.width = '0%';
    $('receiveCountText').textContent = '0 / 0 chunks';
    $('receiveStatusText').textContent = 'Waiting for the first QR code…';
    $('receiveStatusLine').className = 'status-line';
    $('chunkGrid').innerHTML = '';
    $('passwordPromptCard').classList.add('hidden');
    $('passwordErrorText').textContent = '';
  }

  async function startCamera() {
    resetSession();
    $('cameraErrorBanner').classList.add('hidden');
    try {
      await QrScanner.start($('scanVideo'), $('scanCanvas'), onFrame);
      cameraRunning = true;
      $('viewfinderHint').textContent = "Point the camera at the sender's screen";
    } catch (e) {
      cameraRunning = false;
      const messages = {
        CAMERA_DENIED: 'Camera permission is required to scan QR codes. Allow camera access in your browser settings and try again.',
        CAMERA_UNSUPPORTED: 'Your browser does not support camera access. Please use a modern browser such as Chrome, Edge, or Safari.',
        CAMERA_NOT_FOUND: 'No camera was found on this device.',
        CAMERA_IN_USE: 'The camera seems to be in use by another app. Close other camera/video apps and try again.',
        CAMERA_CONSTRAINTS: 'This device could not satisfy the camera settings requested. Trying a different camera may help.',
        CAMERA_ERROR: 'Could not start the camera.' + (e.detail ? ` (${e.detail})` : '')
      };
      const banner = $('cameraErrorBanner');
      banner.classList.remove('hidden');
      banner.textContent = messages[e.message] || ('Could not access the camera.' + (e.detail ? ` (${e.detail})` : ''));
    }
  }

  function stopCamera() {
    if (cameraRunning) QrScanner.stop();
    cameraRunning = false;
  }

  function onFrame(text) {
    if (session.isComplete()) return; // already done, ignore further frames
    const result = session.ingest(text);
    handleIngestResult(result);
  }

  function handleIngestResult(result) {
    const statusLine = $('receiveStatusLine');
    const statusText = $('receiveStatusText');

    switch (result.status) {
      case 'INVALID':
        return; // not our protocol — likely an unrelated QR code, ignore quietly
      case 'FOREIGN':
        statusLine.className = 'status-line warn';
        statusText.textContent = 'This QR belongs to another transfer.';
        return;
      case 'CORRUPT':
        statusLine.className = 'status-line danger';
        statusText.textContent = 'A frame looked damaged and was skipped — it will be retried automatically.';
        return;
      case 'DUPLICATE':
        return; // normal during animated playback; no UI churn needed
      case 'HEADER':
      case 'CHUNK':
        statusLine.className = 'status-line';
        updateProgressUi();
        if (session.isComplete()) onAllChunksReceived();
        return;
    }
  }

  function updateProgressUi() {
    const total = session.totalChunks || 0;
    const got = session.receivedCount;
    $('receiveCountText').textContent = `${got} / ${total || '?'} chunks`;
    if (total) {
      $('receiveProgressFill').style.width = `${(got / total) * 100}%`;
    }
    $('receiveStatusText').textContent = session.metadata
      ? `Receiving “${session.metadata.name}”…`
      : 'Reading transfer info…';

    // chunk dot grid (data chunks only)
    const grid = $('chunkGrid');
    const dataTotal = session.dataChunkCount;
    if (grid.childElementCount !== dataTotal) {
      grid.innerHTML = '';
      for (let i = 1; i <= dataTotal; i++) {
        const d = document.createElement('span');
        d.className = 'chunk-dot';
        d.id = `dot-${i}`;
        grid.appendChild(d);
      }
    }
    for (let i = 1; i <= dataTotal; i++) {
      const d = document.getElementById(`dot-${i}`);
      if (d) d.classList.toggle('got', session.chunks.has(i));
    }
  }

  async function onAllChunksReceived() {
    stopCamera();
    $('receiveStatusText').textContent = 'All frames received. Verifying…';
    const raw = session.reassemble();
    const meta = session.metadata;

    if (meta.encrypted) {
      $('passwordPromptCard').classList.remove('hidden');
      pendingPlainBytes = { encryptedBytes: raw, meta };
      return;
    }
    await finishProcessing(raw, meta);
  }

  async function onSubmitPassword() {
    const password = $('receivePasswordInput').value;
    if (!pendingPlainBytes) return;
    const { encryptedBytes, meta } = pendingPlainBytes;
    $('passwordErrorText').textContent = '';
    try {
      const salt = Utils.base64ToBytes(meta.salt);
      const iv = Utils.base64ToBytes(meta.iv);
      const decrypted = await CryptoUtil.decrypt(encryptedBytes, password, salt, iv);
      $('passwordPromptCard').classList.add('hidden');
      await finishProcessing(decrypted, meta);
    } catch (e) {
      $('passwordErrorText').textContent = 'Incorrect password. Try again.';
    }
  }

  async function finishProcessing(bytes, meta) {
    try {
      let working = bytes;
      if (meta.compressed) working = await CompressionUtil.gunzip(working);

      const hash = await Utils.sha256Hex(working);
      if (hash !== meta.sha256) {
        showFailure('⚠ Transfer verification failed. Some data may be corrupted. Try the transfer again, or use "Replay listed chunks" on the sender for any chunks reported as missing.');
        return;
      }

      showResult(working, meta);
    } catch (e) {
      showFailure('Something went wrong while reconstructing the file: ' + e.message);
    }
  }

  function showFailure(message) {
    App.goTo('result');
    document.getElementById('resultSuccessBlock').classList.add('hidden');
    document.getElementById('resultFailBlock').classList.remove('hidden');
    document.getElementById('resultFailBanner').textContent = message;
  }

  let lastBlob = null, lastFileName = null;

  function showResult(bytes, meta) {
    document.getElementById('resultSuccessBlock').classList.remove('hidden');
    document.getElementById('resultFailBlock').classList.add('hidden');

    const blob = FileHandler.bytesToBlob(bytes, meta.mime);
    lastBlob = blob;
    lastFileName = meta.name;

    document.getElementById('resultName').textContent = meta.name;
    document.getElementById('resultDetail').textContent = `${Utils.formatBytes(bytes.length)} · ${meta.mime}`;
    document.getElementById('resultSubtitle').textContent = 'Verified with SHA-256 — nothing was lost or altered.';

    const previewWrap = document.getElementById('resultPreviewWrap');
    previewWrap.innerHTML = '';
    const category = FileHandler.categoryFor(meta.mime, meta.name);
    if (meta.dataType === 'text' || meta.dataType === 'url') {
      const box = document.createElement('div');
      box.className = 'card mono';
      box.style.wordBreak = 'break-word';
      box.style.whiteSpace = 'pre-wrap';
      box.textContent = new TextDecoder().decode(bytes);
      previewWrap.appendChild(box);
    } else if (category === 'image') {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(blob);
      img.style.width = '100%';
      img.style.borderRadius = 'var(--radius-l)';
      img.style.marginTop = '14px';
      previewWrap.appendChild(img);
    }

    App.goTo('result');
  }

  function initResultButtons() {
    document.getElementById('resultOpenBtn').addEventListener('click', () => {
      if (!lastBlob) return;
      const url = FileHandler.createDownloadUrl(lastBlob);
      window.open(url, '_blank');
    });
    document.getElementById('resultDownloadBtn').addEventListener('click', () => {
      if (!lastBlob) return;
      FileHandler.triggerDownload(lastBlob, lastFileName);
    });
    document.getElementById('resultShareBtn').addEventListener('click', async () => {
      if (!lastBlob) return;
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([lastBlob], lastFileName)] })) {
        try {
          await navigator.share({ files: [new File([lastBlob], lastFileName, { type: lastBlob.type })] });
        } catch (e) { /* user cancelled */ }
      } else {
        alert('Sharing directly is not supported in this browser. Use Download instead.');
      }
    });
    document.getElementById('resultDoneBtn').addEventListener('click', () => {
      FileHandler.releaseDownloadUrl();
      App.goTo('home');
    });
  }

  function init() {
    document.addEventListener('view:changed', (e) => {
      if (e.detail.name === 'receive') startCamera();
    });
    document.getElementById('switchCameraBtn').addEventListener('click', () => QrScanner.switchCamera());
    document.getElementById('submitPasswordBtn').addEventListener('click', onSubmitPassword);
    document.getElementById('cancelReceiveBtn').addEventListener('click', () => {
      stopCamera();
      resetSession();
      App.goTo('home');
    });
    initResultButtons();
  }

  return { init, stopCamera };
})();
    
