import { test } from 'node:test';
import assert from 'node:assert/strict';
import CryptoJS from 'crypto-js';
import { swapPairs, reverseBytes, decryptSportsPayload } from '../src/lib/sportsCrypto.ts';

const KEY_STR = 'RT1zdnBRcVZvSU1t';
const IV_STR = 'bkmlmKnk9i5Khs9n';

function encryptSportsPayload(plaintext: string): string {
  const key = CryptoJS.enc.Utf8.parse(KEY_STR);
  const iv = CryptoJS.enc.Utf8.parse(IV_STR);
  const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
    iv: iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
  });
  const ciphertextB64 = encrypted.toString(); // standard base64

  // Reverse of decrypt pipeline:
  // 1. Convert ciphertextB64 to UTF-8 bytes
  // 2. reverse
  // 3. swapPairs
  // 4. base64 encode
  const bytes = new TextEncoder().encode(ciphertextB64);
  const reversed = reverseBytes(bytes);
  const swapped = swapPairs(reversed);

  let bin = '';
  for (let i = 0; i < swapped.length; i++) {
    bin += String.fromCharCode(swapped[i]);
  }
  return btoa(bin);
}

test('swapPairs and reverseBytes roundtrip', () => {
  const original = new Uint8Array([10, 20, 30, 40, 50, 60]);
  const swapped = swapPairs(original);
  assert.deepEqual(Array.from(swapped), [20, 10, 40, 30, 60, 50]);
  const restored = swapPairs(swapped);
  assert.deepEqual(Array.from(restored), Array.from(original));

  const reversed = reverseBytes(original);
  assert.deepEqual(Array.from(reversed), [60, 50, 40, 30, 20, 10]);
  assert.deepEqual(Array.from(reverseBytes(reversed)), Array.from(original));
});

test('encrypt and decrypt roundtrip matches plaintext JSON', () => {
  const sampleJson = JSON.stringify([
    {
      eventName: 'UEFA Champions League',
      teamAName: 'Real Madrid',
      teamBName: 'Manchester City',
      time: '21:00:00',
      date: '07/11/2026'
    }
  ]);

  const encrypted = encryptSportsPayload(sampleJson);
  const decrypted = decryptSportsPayload(encrypted);

  assert.equal(decrypted, sampleJson);
  const parsed = JSON.parse(decrypted);
  assert.equal(parsed[0].teamAName, 'Real Madrid');
  assert.equal(parsed[0].teamBName, 'Manchester City');
});

