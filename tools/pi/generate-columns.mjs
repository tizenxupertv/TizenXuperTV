#!/usr/bin/env node
/**
 * The first two See-all pages (42 titles each) of every row on the home, as the app's columnPage() builds them,
 * written to <out>/<columnId>-<page>.json. pages-site.mjs publishes them at /data/column/ and the app reads them
 * before asking the portal. Measured on 2026-11-21: 30 rows, ~60 pages, ~3.4 MB; deeper pages are left to the
 * portal (almost no one goes past page 2, and all pages would be 107 MB and 1,871 calls per run).
 *
 * Usage: node generate-columns.mjs <portal-catalog.json> <out-dir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { createPortalClient } from './portal-client.mjs';

const ROOT_IDS = { featured: 76176, movies: 76177, series: 76178, kids: 76783, anime: 76180, explorar: 76784 };
const PAGE_SIZE = 42;
const PAGES = 2;
const CALL_TIMEOUT_MS = 30_000;

const log = (msg) => console.log(`[columns] ${msg}`);

function call(fn, ...args) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve(null); } }, CALL_TIMEOUT_MS);
    fn(...args, (err, res) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(err ? null : res);
    });
  });
}

async function main() {
  const [catalogPath, outDir] = process.argv.slice(2);
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const client = createPortalClient();

  let rows = 0;
  let pages = 0;
  let missing = 0;
  for (const [root, rootId] of Object.entries(ROOT_IDS)) {
    const rowNames = new Set((catalog.itemsByRoot?.[root] || []).map((i) => i.row).filter(Boolean));
    const cols = (await call(client.columns, rootId)) || [];
    for (const col of cols) {
      if (col.restricted || !rowNames.has(col.name)) continue;
      rows++;
      for (let page = 1; page <= PAGES; page++) {
        const res = await call(client.columnPage, col.id, page, PAGE_SIZE);
        if (!res || !Array.isArray(res.items) || !res.items.length) { if (page === 1) missing++; break; }
        fs.writeFileSync(path.join(outDir, `${col.id}-${page}.json`), JSON.stringify({ items: res.items, total: res.total }));
        pages++;
        if (res.total <= page * PAGE_SIZE) break;
      }
    }
  }
  log(`${rows} home rows, ${pages} pages written, ${missing} rows without an answer`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[columns] failed:', err.message);
  process.exit(1);
});
