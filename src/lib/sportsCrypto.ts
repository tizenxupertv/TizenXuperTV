// Only what is used: importing 'crypto-js' whole put the entire library (70 KB) in the bundle. The `.js` is for Node (tests)
import AES from 'crypto-js/aes.js';
import Utf8 from 'crypto-js/enc-utf8.js';

const KEY_STR = 'RT1zdnBRcVZvSU1t';
const IV_STR = 'bkmlmKnk9i5Khs9n';

export function swapPairs(bytes: Uint8Array): Uint8Array {
  const res = new Uint8Array(bytes);
  for (let i = 0; i + 1 < res.length; i += 2) {
    const tmp = res[i];
    res[i] = res[i + 1];
    res[i + 1] = tmp;
  }
  return res;
}

export function reverseBytes(bytes: Uint8Array): Uint8Array {
  const res = new Uint8Array(bytes);
  res.reverse();
  return res;
}

export function base64ToBytes(b64: string): Uint8Array {
  const cleaned = b64.trim().replace(/\s+/g, '');
  const bin = atob(cleaned);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decrypts WiwySport / GeeSports encrypted payload (events.txt or pro/*.txt streams).
 * 
 * Pipeline:
 * 1. Base64 decode
 * 2. Swap adjacent byte pairs
 * 3. Reverse byte array
 * 4. Decode as UTF-8 string (which yields the inner base64 ciphertext)
 * 5. AES-128-CBC decrypt with static key & IV
 */
export function decryptSportsPayload(encodedStr: string): string {
  if (!encodedStr || typeof encodedStr !== 'string') {
    throw new Error('Invalid sports payload');
  }

  const stage = base64ToBytes(encodedStr);
  const swapped = swapPairs(stage);
  const reversed = reverseBytes(swapped);
  const stageB64 = new TextDecoder().decode(reversed);

  const key = Utf8.parse(KEY_STR);
  const iv = Utf8.parse(IV_STR);

  // CBC with PKCS7 padding: crypto-js's defaults for AES
  const decrypted = AES.decrypt(stageB64, key, { iv: iv });

  const plaintext = decrypted.toString(Utf8);
  if (!plaintext) {
    throw new Error('Sports decryption returned empty plaintext');
  }
  return plaintext;
}

