#!/usr/bin/env node
/**
 * Signing key of the self-update (see public/js/boot.js and tools/update-release.mjs).
 *
 *   node tools/update-key.mjs                 creates the key pair once and writes the public key into boot.js
 *   node tools/update-key.mjs --print-public  prints the public key of the existing private key
 *
 * The private key (ECDSA P-256, PKCS#8 PEM) lives outside the repository, at ~/.tizenxuper-update-key.pem
 * (XUPER_UPDATE_KEY overrides the path), mode 600. Keep a backup: losing it means every TV reinstalls once;
 * leaking it lets anyone push code to every TV. This script never prints the private key and never replaces one.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BOOT_JS = join(ROOT, 'public/js/boot.js');
export const keyPath = () => process.env.XUPER_UPDATE_KEY || join(homedir(), '.tizenxuper-update-key.pem');

/** SPKI DER of a public key, base64: the format boot.js and WebCrypto importKey('spki') use */
export function publicKeyB64(privatePem) {
  return createPublicKey(createPrivateKey(privatePem)).export({ type: 'spki', format: 'der' }).toString('base64');
}

/** First 16 bytes of the SHA-256 of the SPKI, in groups: enough to tell two keys apart in a log */
export function fingerprint(pubB64) {
  const hex = createHash('sha256').update(Buffer.from(pubB64, 'base64')).digest('hex').slice(0, 32);
  return hex.match(/.{4}/g).join(':');
}

/** boot.js with its PUBKEY line set to `pubB64` */
export function withPublicKey(bootSource, pubB64) {
  const re = /var PUBKEY = "[^"]*";/;
  if (!re.test(bootSource)) throw new Error('public/js/boot.js has no `var PUBKEY = "…";` line');
  return bootSource.replace(re, `var PUBKEY = "${pubB64}";`);
}

function main(args) {
  const path = keyPath();
  if (args.includes('--print-public')) {
    if (!existsSync(path)) throw new Error(`no private key at ${path}`);
    const pub = publicKeyB64(readFileSync(path, 'utf8'));
    console.log(pub);
    console.log(`fingerprint ${fingerprint(pub)}`);
    return;
  }
  if (existsSync(path)) throw new Error(`a private key already exists at ${path}: it is never replaced (use --print-public)`);
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  writeFileSync(path, pem, { mode: 0o600, flag: 'wx' });
  chmodSync(path, 0o600);
  const pub = publicKeyB64(pem);
  writeFileSync(BOOT_JS, withPublicKey(readFileSync(BOOT_JS, 'utf8'), pub));
  console.log(`private key: ${path} (mode 600) — back it up somewhere safe, it is not in the repository`);
  console.log(`public key written to public/js/boot.js, fingerprint ${fingerprint(pub)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`update-key: ${e.message}`);
    process.exit(1);
  }
}
