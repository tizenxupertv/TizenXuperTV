#!/usr/bin/env node
/**
 * Tidies the output of the Pi's jobs before it reaches their log: `node job.mjs 2>&1 | node log-filter.mjs`.
 *
 * - Every line gets the time it was written (lines that already carry one are left as they are).
 * - Portal calls that went well ([MagisClient:…] ✓) are counted, not written: a catalog run made ~180 of them.
 *   Failed calls are still written, and a summary line closes the run.
 * - Per-category and per-row counts, Node's ExperimentalWarning and the pool's per-session lines (with user ids)
 *   are dropped or folded; the pool's progress is kept every 50 sessions.
 */
import readline from 'node:readline';
import { logTime } from './log-time.mjs';

const STAMPED = /^\[(?:Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Oct|Nov|Dic) \d+, \d{4} /;
let calls = 0;
let failed = 0;
let totalMs = 0;
let homeItems = 0;

// Lines that already carry a time, and the rules between runs (─), are written as they come
const out = (line) => console.log(STAMPED.test(line) || line.startsWith('─') ? line : `[${logTime()}] ${line.trim()}`);

const rules = [
  // Portal calls: the good ones are only counted
  [/^\[MagisClient:[^\]]+\] \S+ ([✓✗]) (\d+) ms/, (m, line) => {
    calls++;
    totalMs += Number(m[2]);
    if (m[1] === '✗') { failed++; out(line); }
  }],
  [/^\s+\[\d+\] .+: \d+ channels$/, () => {}],
  [/^\s+home\(\w+\): (\d+) items$/, (m) => { homeItems += Number(m[1]); }],
  [/^\s+recommends\(\w+\): \d+ items$/, () => {}],
  [/^\d\. /, () => {}],
  [/^\(node:\d+\) ExperimentalWarning|^\(Use `node --trace-warnings/, () => {}],
  // Pool minting: one line per session, with its user id; keep every 50th, without the id
  [/^\[mint-worker\] (\d+)\/(\d+) sessions \(\+\d+ user \d+\) \[(\d+)s\]/, (m) => {
    const n = Number(m[1]);
    if (n % 50 === 0 || n === Number(m[2])) out(`[mint-worker] ${n}/${m[2]} sesiones (${Math.round(Number(m[3]) / 60)} min)`);
  }],
  [/^\[deploy-api\] SUCCESS: (\S+) deployed/, (m) => out(`[deploy-api] Worker ${m[1]} desplegado`)],
];

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  for (const [re, fn] of rules) {
    const m = line.match(re);
    if (m) return fn(m, line);
  }
  out(line);
});
rl.on('close', () => {
  if (homeItems) out(`Inicio: ${homeItems} títulos en las filas`);
  if (calls) out(`Portal: ${calls} llamadas · ${failed} fallidas · media ${Math.round(totalMs / calls)} ms`);
});
