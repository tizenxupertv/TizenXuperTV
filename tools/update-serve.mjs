#!/usr/bin/env node
/**
 * Local stand-in for the bot's update endpoints, to test the self-update on a TV:
 *
 *   node tools/update-serve.mjs [port=8098]
 *
 * Serves build/update/ (written by tools/update-release.mjs) as GET /tv/update and GET /tv/update/bundle/<version>,
 * with CORS. Only test builds talk to it: build with XUPER_UPDATE_API=http://<this Mac's IP>:<port>.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../build/update');
const port = Number(process.argv[2]) || 8098;

createServer((req, res) => {
  const path = new URL(req.url || '/', 'http://local').pathname;
  const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };
  let file = '';
  if (path === '/tv/update') file = join(DIR, 'update-manifest.json');
  const m = path.match(/^\/tv\/update\/bundle\/(\d+(?:\.\d+){1,3})$/);
  if (m) file = join(DIR, `update-bundle-${m[1]}.json`);
  const ok = req.method === 'GET' && file && existsSync(file);
  console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${path} ${ok ? 200 : 404}`);
  if (!ok) {
    res.writeHead(404, headers);
    return res.end('{"error":"no_update"}');
  }
  res.writeHead(200, headers);
  res.end(readFileSync(file));
}).listen(port, '0.0.0.0', () => console.log(`update server on :${port}, serving ${DIR}`));
