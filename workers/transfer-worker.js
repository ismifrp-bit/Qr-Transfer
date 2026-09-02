// transfer-worker.js — keeps the UI thread responsive while we compress,
// encrypt, hash, and chunk potentially large files.
'use strict';

importScripts('../js/utils.js', '../js/crypto.js', '../js/compression.js', '../js/chunk-manager.js');

self.onmessage = async (e) => {
  const { cmd } = e.data;
  if (cmd !== 'PREPARE') return;

  const { bytes, fileName, mime, dataType, password, useCompression, chunkPayloadBytes } = e.data;

  try {
    const transferId = Utils.uuid();
    let working = new Uint8Array(bytes);
    const originalSize = working.length;

    self.postMessage({ type: 'PROGRESS', stage: 'hash', pct: 5 });
    const sha256 = await Utils.sha256Hex(working);

    let compressed = false;
    if (useCompression && CompressionUtil.supported) {
      self.postMessage({ type: 'PROGRESS', stage: 'compress', pct: 20 });
      const gz = await CompressionUtil.gzip(working);
      if (gz.length < working.length) {
        working = gz;
        compressed = true;
      }
    }

    let encrypted = false, salt = null, iv = null;
    if (password) {
      self.postMessage({ type: 'PROGRESS', stage: 'encrypt', pct: 45 });
      const result = await CryptoUtil.encrypt(working, password);
      working = result.ciphertext;
      salt = Utils.bytesToBase64(result.salt);
      iv = Utils.bytesToBase64(result.iv);
      encrypted = true;
    }

    self.postMessage({ type: 'PROGRESS', stage: 'chunk', pct: 70 });

    const metadata = {
      transferId,
      name: Utils.sanitizeFileName(fileName),
      mime: mime || 'application/octet-stream',
      dataType: dataType || 'file',
      originalSize,
      payloadSize: working.length,
      sha256,
      compressed,
      encrypted,
      salt,
      iv
    };

    const packets = ChunkManager.buildPackets(working, metadata, chunkPayloadBytes);

    self.postMessage({
      type: 'DONE',
      transferId,
      totalChunks: packets.length,
      packets,
      metadata
    });
  } catch (err) {
    self.postMessage({ type: 'ERROR', message: err && err.message ? err.message : String(err) });
  }
};
