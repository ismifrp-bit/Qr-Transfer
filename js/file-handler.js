// file-handler.js — browser-native File/Blob handling.
'use strict';

const FileHandler = (() => {

  function readFileAsBytes(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result));
      reader.onerror = () => reject(new Error('FILE_READ_FAILED'));
      reader.readAsArrayBuffer(file);
    });
  }

  function bytesToBlob(bytes, mime) {
    return new Blob([bytes], { type: mime || 'application/octet-stream' });
  }

  let lastObjectUrl = null;
  function createDownloadUrl(blob) {
    if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
    lastObjectUrl = URL.createObjectURL(blob);
    return lastObjectUrl;
  }

  function releaseDownloadUrl() {
    if (lastObjectUrl) {
      URL.revokeObjectURL(lastObjectUrl);
      lastObjectUrl = null;
    }
  }

  function triggerDownload(blob, fileName) {
    const url = createDownloadUrl(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'transferred-file';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /** Broad category used to pick a sensible receiver preview / icon. */
  function categoryFor(mime, fileName) {
    if (!mime) mime = '';
    if (mime.startsWith('image/')) return 'image';
    if (mime === 'application/pdf') return 'pdf';
    if (mime.startsWith('text/') || mime === 'application/json') return 'text';
    if (/\.(txt|json|csv|md)$/i.test(fileName || '')) return 'text';
    return 'file';
  }

  return { readFileAsBytes, bytesToBlob, createDownloadUrl, releaseDownloadUrl, triggerDownload, categoryFor };
})();
