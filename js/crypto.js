// crypto.js — password-based AES-GCM encryption via Web Crypto API.
// The password itself is never stored, transmitted, or logged.
'use strict';

const CryptoUtil = (() => {

  const PBKDF2_ITERATIONS = 250000;
  const SALT_LEN = 16;   // bytes
  const IV_LEN = 12;     // bytes, standard for AES-GCM

  async function deriveKey(password, salt) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256'
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypts bytes with a password.
   * Returns { ciphertext: Uint8Array, salt: Uint8Array, iv: Uint8Array }
   */
  async function encrypt(bytes, password) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
    const key = await deriveKey(password, salt);
    const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
    return { ciphertext: new Uint8Array(cipherBuf), salt, iv };
  }

  /**
   * Decrypts bytes with a password. Throws if the password is wrong
   * or the data was tampered with (AES-GCM auth tag fails).
   */
  async function decrypt(ciphertext, password, salt, iv) {
    const key = await deriveKey(password, salt);
    try {
      const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
      return new Uint8Array(plainBuf);
    } catch (e) {
      throw new Error('WRONG_PASSWORD');
    }
  }

  return { encrypt, decrypt, SALT_LEN, IV_LEN };
})();
