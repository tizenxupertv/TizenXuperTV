import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { logTime } from './log-time.mjs';

const PORT = Number(process.env.DASHBOARD_PORT || 8080);
const DIR = path.dirname(fileURLToPath(import.meta.url));
const CLK_TCK = 100;

const JOBS = [
  // The schedule is read from the crontab (scheduleOf), so the panel follows install-cron.sh without edits here
  { id: 'refresh', name: 'Renovar pool de sesiones', script: 'refresh-and-deploy.sh', log: 'relay-refresh.log' },
  { id: 'catalog', name: 'Actualizar catálogo', script: 'update-catalog.sh', log: 'catalog.log' },
];

const SERVICES = [
  { script: 'health-monitor.mjs', name: 'Monitor de salud', log: 'health-monitor.log' },
  { script: 'tg-listener.mjs', name: 'Bot de Telegram', log: 'tg-listener.log' },
  { script: 'session-watcher.mjs', name: 'Vigilante de sesiones', log: 'session-watcher.log', optional: true },
];

const svcPill = (s) => (s.proc ? pill('ok', 'Activo') : s.optional ? pill('idle', 'Apagado') : pill('bad', 'Detenido'));

const running = new Map();

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function tail(file, lines) {
  let fh;
  try {
    fh = await fs.open(path.join(DIR, file), 'r');
    const { size, mtime } = await fh.stat();
    const len = Math.min(size, lines > 50 ? 65536 : 8192);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    const text = buf.toString('utf8').split('\n').filter(Boolean).slice(-lines).join('\n');
    return { text: text || '(vacío)', mtime, size };
  } catch {
    return { text: '(sin log todavía)', mtime: null, size: 0 };
  } finally {
    await fh?.close();
  }
}

async function processes() {
  const scripts = [...SERVICES.map((x) => x.script), ...JOBS.map((x) => x.script)];
  const found = new Map();
  const pids = (await fs.readdir('/proc').catch(() => [])).filter((p) => /^\d+$/.test(p));
  await Promise.all(pids.map(async (pid) => {
    const cmd = await fs.readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '');
    const script = scripts.find((s) => cmd.includes(s));
    if (!script || found.has(script)) return;
    const [status, stat] = await Promise.all([
      fs.readFile(`/proc/${pid}/status`, 'utf8').catch(() => ''),
      fs.readFile(`/proc/${pid}/stat`, 'utf8').catch(() => ''),
    ]);
    const rssKb = Number(status.match(/VmRSS:\s+(\d+)/)?.[1] || 0);
    const startTicks = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] || 0);
    found.set(script, { pid, rssMb: rssKb / 1024, upSec: startTicks ? os.uptime() - startTicks / CLK_TCK : 0 });
  }));
  // Services loaded inside this same process by pi-services.mjs
  for (const script of globalThis.__piServices ?? []) {
    if (!found.has(script)) found.set(script, { pid: process.pid, rssMb: process.memoryUsage().rss / 1048576, upSec: process.uptime(), shared: true });
  }
  return found;
}

let cronCache = { at: 0, text: '' };
function crontab() {
  if (Date.now() - cronCache.at < 60_000) return Promise.resolve(cronCache.text);
  return new Promise((resolve) => {
    execFile('crontab', ['-l'], (err, out) => {
      const text = err ? '(sin crontab)' : out.split('\n').filter((l) => l.trim() && !l.startsWith('#')).join('\n');
      cronCache = { at: Date.now(), text };
      resolve(text);
    });
  });
}

async function cpuTimes() {
  const line = (await fs.readFile('/proc/stat', 'utf8').catch(() => '')).split('\n')[0];
  if (!line.startsWith('cpu ')) return null;
  const v = line.trim().split(/\s+/).slice(1, 9).map(Number);
  return { idle: v[3] + v[4], total: v.reduce((a, b) => a + b, 0) };
}

// CPU % needs two samples, so keep a cheap 5 s rolling measurement.
let cpuPct = null;
let cpuPrev = await cpuTimes();
async function sampleCpu() {
  const cur = await cpuTimes();
  if (cur && cpuPrev && cur.total > cpuPrev.total) {
    cpuPct = (1 - (cur.idle - cpuPrev.idle) / (cur.total - cpuPrev.total)) * 100;
  }
  cpuPrev = cur;
}
setTimeout(sampleCpu, 1000).unref();
setInterval(sampleCpu, 5000).unref();

async function temperature() {
  const raw = await fs.readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8').catch(() => null);
  return raw ? parseInt(raw, 10) / 1000 : null;
}

async function disk() {
  const s = await fs.statfs('/').catch(() => null);
  if (!s) return null;
  const total = s.blocks * s.bsize;
  return { used: total - s.bavail * s.bsize, total };
}

function ipAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    const v4 = list?.find((a) => a.family === 'IPv4' && !a.internal);
    if (v4) return v4.address;
  }
  return '';
}

const OS_NAME = await fs.readFile('/etc/os-release', 'utf8')
  .then((t) => (t.match(/^PRETTY_NAME="?([^"\n]+)/m)?.[1] || os.type()).replace(' GNU/Linux', ''))
  .catch(() => os.type());
const MODEL = await fs.readFile('/proc/device-tree/model', 'utf8')
  .then((t) => t.replace(/\0/g, '').replace(/^Raspberry Pi\s*/, '').replace(/\s*Rev.*$/, '').replace(/ Plus$/, '+').trim())
  .catch(() => '');

function deviceCard() {
  const rows = [
    ['IP', ipAddress()],
    ['Modelo', [MODEL, os.machine?.() || os.arch()].filter(Boolean).join(' · ')],
    ['Sistema', OS_NAME],
    ['Encendida', dur(os.uptime())],
    ['Node', process.version],
  ];
  return `<div class="device">
    <div class="dev-name">${icon('server')}<span>${esc(os.hostname())}</span></div>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>`;
}

/**
 * A job's schedule from its crontab line: a fixed minute and an hour field of '*', '*\/N', 'H' or 'H1,H2'.
 * Returns { every, hours } (hours: the hours of the day it runs), or null when the job is not in the crontab.
 */
function scheduleOf(job, cronText) {
  const line = cronText.split('\n').find((l) => l.includes(`/${job.script}`));
  const f = line && line.trim().split(/\s+/);
  if (!f || !/^\d+$/.test(f[0]) || f[2] !== '*' || f[3] !== '*' || f[4] !== '*') return line ? { every: f.slice(0, 5).join(' '), hours: null } : null;
  const minute = Number(f[0]);
  const mm = String(minute).padStart(2, '0');
  let hours = null;
  let every = f.slice(0, 5).join(' ');
  if (f[1] === '*') { hours = [...Array(24).keys()]; every = `Cada hora (:${mm})`; }
  else if (/^\*\/\d+$/.test(f[1])) { const n = Number(f[1].slice(2)); hours = [...Array(24).keys()].filter((h) => h % n === 0); every = `Cada ${n} h (:${mm})`; }
  else if (/^\d+(,\d+)*$/.test(f[1])) { hours = f[1].split(',').map(Number); every = hours.length === 1 ? `Diario, ${hours[0]}:${mm}` : `A las ${hours.map((h) => `${h}:${mm}`).join(', ')}`; }
  return { every, hours, minute };
}

function nextRun(sched, now = new Date()) {
  if (!sched || !sched.hours) return null;
  const d = new Date(now);
  d.setSeconds(0, 0);
  for (let i = 0; i < 1500; i++) {
    d.setMinutes(d.getMinutes() + 1);
    if (d.getMinutes() === sched.minute && sched.hours.includes(d.getHours())) return d;
  }
  return null;
}

function runJob(job) {
  if (running.has(job.id)) return;
  fs.open(path.join(DIR, job.log), 'a').then((fh) => {
    fh.write(`\n[${logTime()}] ▶ Ejecutado manualmente desde el dashboard\n`);
    const child = spawn('/bin/bash', [path.join(DIR, job.script)], { cwd: DIR, stdio: ['ignore', fh.fd, fh.fd] });
    running.set(job.id, child.pid);
    child.on('exit', (code) => {
      fh.write(`[${logTime()}] ■ Terminó con código ${code}\n`).finally(() => fh.close());
      running.delete(job.id);
    });
  });
}

const dur = (sec) => {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h ${m % 60} min`;
  return `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`;
};
const ago = (d) => (d ? `hace ${dur((Date.now() - d.getTime()) / 1000)}` : '—');
const until = (d) => (d ? `en ${dur((d.getTime() - Date.now()) / 1000)}` : '—');
const hhmm = (d) => (d ? d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : '');
const looksFailed = (text) => /error|not found|failed|no such file|código [1-9]/i.test(text.split('\n').slice(-4).join('\n'));
const level = (pct) => (pct >= 85 ? 'bad' : pct >= 65 ? 'warn' : 'ok');

const ICONS = {
  cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  ram: '<rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 11v2M10 11v2M14 11v2M18 11v2"/>',
  disk: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  temp: '<path d="M14 14.8V4a2 2 0 1 0-4 0v10.8a4 4 0 1 0 4 0z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  gauge: '<path d="M12 14l4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>',
  tasks: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  logs: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  cron: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
};
// Raspberry Pi logo from Simple Icons (CC0-1.0)
const RPI_LOGO = '<svg class="rpi" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m19.8955 10.8961-.1726-.3028c.0068-2.1746-1.0022-3.061-2.1788-3.7348.356-.0938.7237-.1711.8245-.6182.6118-.1566.7397-.4398.8011-.7398.16-.1066.6955-.4061.6394-.9211.2998-.2069.4669-.4725.3819-.8487.3222-.3515.407-.6419.2702-.9096.3868-.4805.2152-.7295.05-.9817.2897-.5254.0341-1.0887-.7758-.9944-.3221-.4733-1.0244-.3659-1.133-.3637-.1215-.1519-.2819-.2821-.7755-.219-.3197-.2851-.6771-.2364-1.0458-.0964-.4378-.3403-.7275-.0675-1.0584.0356-.53-.1706-.6513.0631-.9117.1583-.5781-.1203-.7538.1416-1.0309.4182l-.3224-.0063c-.8719.5061-1.305 1.5366-1.4585 2.0664-.1536-.5299-.5858-1.5604-1.4575-2.0664l-.3223.0063C9.942.5014 9.7663.2394 9.1883.3597 8.9279.2646 8.807.0309 8.2766.2015c-.2172-.0677-.417-.2084-.6522-.2012l.0004.0002C7.5017.0041 7.369.049 7.2185.166c-.3688-.1401-.7262-.1887-1.0459.0964-.4936-.0631-.654.0671-.7756.219C5.2887.4791 4.5862.3717 4.264.845c-.8096-.0943-1.0655.4691-.7756.9944-.1653.2521-.3366.5013.05.9819-.1367.2677-.0519.5581.2703.9096-.085.3763.0822.6418.3819.8487-.0561.515.4795.8144.6394.9211.0614.3001.1894.5832.8011.7398.1008.4472.4685.5244.8245.6183-1.1766.6737-2.1856 1.56-2.1788 3.7348l-.1724.3028c-1.3491.8082-2.5629 3.4056-.6648 5.5167.124.6609.3319 1.1355.5171 1.6609.2769 2.117 2.0841 3.1082 2.5608 3.2255.6984.524 1.4423 1.0212 2.449 1.3696.949.964 1.977 1.3314 3.0107 1.3308.0152 0 .0306.0002.0457 0 1.0337.0006 2.0618-.3668 3.0107-1.3308 1.0067-.3483 1.7506-.8456 2.4491-1.3696.4766-.1173 2.2838-1.1085 2.5607-3.2255.1851-.5253.3931-1 .517-1.6609 1.8981-2.1113.6843-4.7089-.6649-5.517zm-1.0386-.3715c-.0704.8759-4.6354-3.0504-3.8472-3.1808 2.1391-.3558 3.9191.896 3.8472 3.1808zm-2.0155 4.3649c-1.1481.7409-2.8025.2626-3.6953-1.0681-.8928-1.3306-.6858-3.0101.4623-3.7509 1.1481-.7409 2.8025-.2627 3.6953 1.068.8927 1.3307.6858 3.0101-.4623 3.751zM13.6591 1.3721c.0396.1967.0843.321.1354.3577.2537-.272.4611-.5506.7878-.8123.0011.1537-.0776.3205.1169.4425.1752-.2356.4119-.4459.7263-.6244-.1514.2611-.026.3404.0554.4486.24-.2059.4681-.4144.9109-.5759-.121.1474-.2902.2914-.1108.4607.2473-.1544.496-.3086 1.0833-.4183-.1323.1475-.4059.295-.2401.4426.3104-.1186.6539-.2047 1.034-.2546-.182.1496-.3337.2963-.1846.4122.3323-.1022.7899-.2398 1.2372-.1212l-.2832.2849c-.0314.0382.6623.0297 1.1202.0364-.167.2321-.3375.4562-.437.8548.0454.0459.2723.0204.4862 0-.2194.4618-.6004.5783-.6893.776.134.1015.32.075.5232.006-.158.3254-.4892.5484-.7509.8123.0662.047.1818.075.4555.0425-.2418.257-.5339.492-.8802.7032.0614.0708.2722.0681.4678.0727-.3136.3069-.7173.466-1.0955.6668.1885.1288.3234.0988.4678.097-.2676.2198-.7225.3342-1.1448.4668.0803.1249.1607.1589.3324.194-.447.2473-1.0873.1343-1.2679.2607.0435.1243.1665.2053.3139.2728-.7197.0418-2.6879-.0262-3.0652-1.5156.7367-.8094 2.0813-1.7593 4.394-2.934-1.7994.6022-3.4229 1.405-4.7817 2.5096-1.5978-.7436-.4965-2.6197.283-3.3645zm-1.6126 5.3718c1.1329-.0123 2.5356.8325 2.53 1.6286-.005.7027-.9851 1.2715-2.5213 1.2607-1.5043-.0177-2.5172-.7148-2.5137-1.3957.003-.5603 1.2282-1.5263 2.505-1.4936zm-5.7646-.6006c.1717-.0351.252-.0692.3323-.194-.4223-.1327-.8772-.247-1.1448-.4668.1444.0018.2792.0318.4678-.097-.3783-.2008-.782-.3599-1.0956-.6668.1955-.0048.4064-.002.4677-.0728-.3462-.2113-.6383-.4463-.8801-.7033.2738.0325.3893.0045.4555-.0425-.2617-.264-.593-.487-.7509-.8123.2032.069.3892.0954.5232-.006-.089-.1977-.47-.3142-.6894-.776.214.0204.4409.0459.4863 0-.0994-.3985-.2698-.6226-.4369-.8547.4579-.0067 1.1516.0018 1.1202-.0364l-.2831-.2849c.4472-.1186.9049.019 1.2371.1213.1492-.1159-.0026-.2626-.1847-.4123.3801.05.7236.1361 1.034.2547.1659-.1476-.1076-.2951-.24-.4426.5872.1097.8361.2639 1.0833.4183.1794-.1694.0103-.3133-.1108-.4607.4428.1615.6709.37.911.5759.0814-.1082.2068-.1875.0554-.4486.3143.1785.5511.3888.7263.6244.1945-.122.1159-.2888.1169-.4426.3267.2618.534.5404.7879.8124.0511-.0366.0959-.161.1354-.3577.7794.7448 1.8807 2.6208.2831 3.3646-1.3589-1.1039-2.9817-1.9064-4.78-2.5086 2.3115 1.174 3.6556 2.1239 4.392 2.9328-.3773 1.4895-2.3455 1.5575-3.0651 1.5157.1473-.0676.2703-.1485.3139-.2728-.1806-.1264-.8209-.0134-1.2679-.2607zm2.8175 1.1334c.7881.1304-3.7769 4.0567-3.8472 3.1809-.0719-2.2846 1.7079-3.5367 3.8472-3.1809zm-4.847 8.7567c-1.1094-.8789-1.4668-3.4529.5901-4.6097 1.2394-.3273.4184 5.051-.5901 4.6097zm4.2656 4.5989c-.6257.3719-2.1452.2187-3.2252-1.3095-.7283-1.2823-.6345-2.5872-.123-2.9705.7648-.4589 1.9464.1609 2.8559 1.2003.7923.9405 1.1536 2.5927.4923 3.0797zm-1.2415-5.6086c-1.1481-.7409-1.3551-2.4203-.4623-3.7511.8928-1.3307 2.5472-1.8089 3.6952-1.068 1.1481.7409 1.3551 2.4203.4623 3.7509-.8926 1.3308-2.5471 1.809-3.6952 1.0682zm4.7948 8.2279c-1.3763.0584-2.7258-1.1105-2.7081-1.5157-.0206-.594 1.6758-1.0578 2.782-1.0306 1.1131-.0479 2.6068.3531 2.6097.8851.0184.5166-1.3547 1.6838-2.6836 1.6612zm2.7584-5.8578c.0081 1.3899-1.226 2.5225-2.7562 2.5299-1.5302.0073-2.7773-1.1135-2.7854-2.5033v-.0265c-.008-1.3899 1.2259-2.5226 2.7562-2.5299 1.5302-.0073 2.7773 1.1134 2.7853 2.5033a.7794.7794 0 0 1 .0001.0265zm3.855 2.0029c-1.186 1.6208-2.7916 1.684-3.3896 1.2325-.6255-.5811-.148-2.3854.7094-3.3747v-.0003c.9812-1.0912 2.0302-1.8037 2.7609-1.2469.4919.4828.7805 2.3008-.0807 3.3894zm1.0724-3.4301c-1.0086.4413-1.8298-4.9372-.5901-4.61 2.0568 1.1569 1.6994 3.731.5901 4.61zm-.0256-8.3279h.2985v-.5304h.2986c.1502 0 .2053.0624.2262.2052.0152.1088.0113.2395.0477.3253h.2984c-.0533-.0763-.0515-.2358-.0571-.3213-.0097-.1373-.0513-.2796-.1977-.3176v-.0037c.1502-.061.2149-.1807.2149-.341 0-.2048-.1539-.3738-.3974-.3738h-.732v1.3573zm.2985-1.1255h.3269c.1333 0 .2054.0573.2054.188 0 .1369-.0721.1942-.2054.1942H20.03v-.3822zm-1.0337.4633c0 .7009.5682 1.2694 1.2695 1.2694s1.2695-.5684 1.2695-1.2694c0-.7013-.5683-1.2697-1.2695-1.2697-.7013 0-1.2695.5684-1.2695 1.2697zm2.3275 0c0 .5845-.4737 1.058-1.058 1.058s-1.058-.4735-1.058-1.058c0-.5849.4737-1.058 1.058-1.058s1.058.4731 1.058 1.058z"/></svg>';
const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

function metric({ ic, label, value, unit, pct, sub }) {
  const lv = level(pct);
  return `<div class="metric">
    <div class="m-head">${icon(ic)}<span>${label}</span></div>
    <div class="m-val">${value}<small>${unit}</small></div>
    <div class="bar"><i class="${lv}" style="width:${Math.min(100, Math.max(2, pct)).toFixed(0)}%"></i></div>
    <div class="m-sub">${sub}</div></div>`;
}

const pill = (kind, text) => `<span class="pill ${kind}"><b></b>${text}</span>`;

const LOGS = [
  ...JOBS.map((j) => ({ id: j.id, title: j.name, file: j.log })),
  ...SERVICES.map((s) => ({ id: s.script.replace('.mjs', ''), title: s.name, file: s.log })),
  { id: 'dashboard', title: 'Dashboard', file: 'dashboard.log' },
];

const PAGES = [
  { path: '/', label: 'Resumen', ic: 'gauge' },
  { path: '/tareas', label: 'Tareas', ic: 'tasks' },
  { path: '/servicios', label: 'Servicios', ic: 'server' },
  { path: '/registros', label: 'Registros', ic: 'logs' },
  { path: '/crontab', label: 'Crontab', ic: 'cron' },
];

async function status() {
  const [procs, jobLogs, cron] = await Promise.all([processes(), Promise.all(JOBS.map((j) => tail(j.log, 6))), crontab()]);
  const jobs = JOBS.map((j, i) => {
    const out = jobLogs[i];
    const isRunning = running.has(j.id) || procs.has(j.script);
    const failed = !isRunning && looksFailed(out.text);
    const state = isRunning ? pill('info', 'Ejecutando') : failed ? pill('bad', 'Falló') : out.mtime ? pill('ok', 'OK') : pill('idle', 'Sin datos');
    const sched = scheduleOf(j, cron);
    return { ...j, out, isRunning, failed, state, every: sched ? sched.every : 'No programada', next: nextRun(sched) };
  });
  const services = SERVICES.map((s) => ({ ...s, proc: procs.get(s.script) }));
  return { jobs, services, jobProblems: jobs.filter((j) => j.failed).length, svcProblems: services.filter((s) => !s.proc && !s.optional).length };
}

function jobTable(jobs) {
  const rows = jobs.map((j) => `<tr>
      <td><div class="name">${esc(j.name)}</div><code>${esc(j.script)}</code></td>
      <td data-l="Estado">${j.state}</td>
      <td data-l="Frecuencia">${esc(j.every)}</td>
      <td data-l="Última">${esc(ago(j.out.mtime))}</td>
      <td data-l="Próxima"><span>${esc(hhmm(j.next))} <span class="muted">${esc(until(j.next))}</span></span></td>
      <td class="act"><a class="btn ghost" href="/registros?log=${j.id}">Ver log</a>
        <form method="post" action="/run/${j.id}" onsubmit="return confirm('¿Ejecutar «${esc(j.name)}» ahora? Hace la operación real.')">
        <button ${j.isRunning ? 'disabled' : ''}>${icon('play', 'sm')}Ejecutar</button></form></td></tr>`).join('');
  return `<div class="card"><table>
    <thead><tr><th>Tarea</th><th>Estado</th><th>Frecuencia</th><th>Última ejecución</th><th>Próxima</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function serviceTable(services) {
  const rows = services.map((s) => `<tr>
      <td><div class="name">${esc(s.name)}</div><code>${esc(s.script)}</code></td>
      <td data-l="Estado">${svcPill(s)}</td>
      <td data-l="PID">${s.proc ? esc(s.proc.pid) : '—'}</td>
      <td data-l="Memoria">${s.proc ? s.proc.rssMb.toFixed(1) + ' MB' + (s.proc.shared ? ' <span class="muted">(compartida)</span>' : '') : '—'}</td>
      <td data-l="Activo desde">${s.proc?.upSec ? esc(dur(s.proc.upSec)) : '—'}</td>
      <td class="act"><a class="btn ghost" href="/registros?log=${esc(s.script.replace('.mjs', ''))}">Ver log</a></td></tr>`).join('');
  return `<div class="card"><table>
    <thead><tr><th>Servicio</th><th>Estado</th><th>PID</th><th>Memoria</th><th>Activo desde</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

async function pageResumen(st) {
  const [temp, dsk] = await Promise.all([temperature(), disk()]);
  const cores = os.cpus().length || 1;
  const [l1, l5, l15] = os.loadavg();
  const memTotal = os.totalmem(), memFree = os.freemem();
  const gb = (b) => (b / 1073741824).toFixed(1);
  const diskPct = dsk ? (dsk.used / dsk.total) * 100 : 0;
  const list = (items) => items.map((x) => `<li><span>${esc(x.name)}</span>${x.pill}</li>`).join('');
  return `<div class="mobile-only">${deviceCard()}</div>
  <div class="metrics">
    ${metric({ ic: 'cpu', label: 'Uso de CPU', value: cpuPct == null ? '—' : Math.round(cpuPct), unit: `% · ${cores} núcleo${cores > 1 ? 's' : ''}`, pct: cpuPct ?? 0, sub: `<span title="Procesos esperando CPU (1 = núcleo lleno)">Carga media ${l1.toFixed(2)} · 5 min ${l5.toFixed(2)} · 15 min ${l15.toFixed(2)}</span>` })}
    ${metric({ ic: 'ram', label: 'Memoria', value: Math.round((memTotal - memFree) / 1048576), unit: `/ ${Math.round(memTotal / 1048576)} MB`, pct: ((memTotal - memFree) / memTotal) * 100, sub: `${Math.round(memFree / 1048576)} MB libres` })}
    ${metric({ ic: 'disk', label: 'Disco', value: dsk ? gb(dsk.used) : '—', unit: dsk ? `/ ${gb(dsk.total)} GB` : '', pct: diskPct, sub: `${diskPct.toFixed(0)} % usado` })}
    ${metric({ ic: 'temp', label: 'Temperatura', value: temp == null ? '—' : temp.toFixed(1), unit: '°C', pct: temp == null ? 0 : (temp / 85) * 100, sub: `Encendida ${esc(dur(os.uptime()))}` })}
  </div>
  <div class="split">
    <div class="card box"><div class="box-head"><h3>${icon('tasks')}Tareas programadas</h3><a href="/tareas">Ver todas →</a></div>
      <ul class="status">${list(st.jobs.map((j) => ({ name: j.name, pill: j.state })))}</ul></div>
    <div class="card box"><div class="box-head"><h3>${icon('server')}Servicios</h3><a href="/servicios">Ver todos →</a></div>
      <ul class="status">${list(st.services.map((s) => ({ name: s.name, pill: svcPill(s) })))}</ul></div>
  </div>`;
}

async function pageRegistros(query) {
  const sel = LOGS.find((l) => l.id === query.get('log')) || LOGS[0];
  const out = await tail(sel.file, 200);
  const tabs = LOGS.map((l) => `<a class="${l === sel ? 'on' : ''}" href="/registros?log=${l.id}">${esc(l.title)}</a>`).join('');
  return `<div class="tabs">${tabs}</div>
  <div class="card"><div class="box-head pad"><h3><code>${esc(sel.file)}</code><span id="live">${pill('idle', 'Conectando…')}</span></h3><span class="muted">últimas 200 líneas · modificado ${esc(ago(out.mtime))}</span></div>
  <pre class="tall" id="log">${esc(out.text)}</pre></div>
  <script>
  (() => {
    const log = document.getElementById('log'), live = document.getElementById('live');
    const badge = (kind, text) => { live.innerHTML = '<span class="pill ' + kind + '"><b></b>' + text + '</span>'; };
    log.scrollTop = log.scrollHeight;
    const es = new EventSource('/registros/stream?log=${sel.id}&from=${out.size}');
    es.onopen = () => badge('ok live', 'En vivo');
    es.onerror = () => badge('idle', 'Reconectando…');
    es.addEventListener('reset', () => { log.textContent = ''; });
    es.onmessage = (e) => {
      const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      if (/^\\((vacío|sin log todavía)\\)$/.test(log.textContent)) log.textContent = '';
      log.textContent += (log.textContent ? '\\n' : '') + JSON.parse(e.data);
      if (log.textContent.length > 400000) log.textContent = log.textContent.slice(-300000);
      if (stick) log.scrollTop = log.scrollHeight;
    };
  })();
  </script>`;
}

function streamLog(req, res, url) {
  const sel = LOGS.find((l) => l.id === url.searchParams.get('log'));
  if (!sel) {
    res.writeHead(404);
    return res.end();
  }
  const file = path.join(DIR, sel.file);
  let pos = Number(req.headers['last-event-id'] ?? url.searchParams.get('from')) || 0;
  let busy = false;
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');

  const tick = async () => {
    if (busy) return;
    busy = true;
    let fh;
    try {
      const { size } = await fs.stat(file);
      if (size < pos) {
        pos = 0;
        res.write(`event: reset\nid: 0\ndata: \n\n`);
      }
      if (size === pos) return;
      fh = await fs.open(file, 'r');
      const buf = Buffer.alloc(Math.min(size - pos, 65536));
      await fh.read(buf, 0, buf.length, pos);
      const end = buf.lastIndexOf(10);
      if (end < 0 && buf.length < 65536) return;
      const chunk = buf.subarray(0, end < 0 ? buf.length : end + 1);
      pos += chunk.length;
      const text = chunk.toString('utf8').replace(/\n$/, '');
      if (text) res.write(`id: ${pos}\ndata: ${JSON.stringify(text)}\n\n`);
    } catch {
      // log file may not exist yet
    } finally {
      busy = false;
      await fh?.close();
    }
  };

  const poll = setInterval(tick, 1000);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(poll);
    clearInterval(ping);
  });
  tick();
}

function layout({ page, title, body, st, live = false }) {
  const badges = { '/tareas': st.jobProblems, '/servicios': st.svcProblems };
  const problems = st.jobProblems + st.svcProblems;
  const overall = problems === 0 ? pill('ok', 'Todo en orden') : pill('bad', `${problems} ${problems === 1 ? 'problema' : 'problemas'}`);
  const nav = PAGES.map((p) => `<a href="${p.path}" class="${p.path === page ? 'on' : ''}">${icon(p.ic)}<span>${p.label}</span>${badges[p.path] ? `<em>${badges[p.path]}</em>` : ''}</a>`).join('');
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Raspberry Pi</title>
<style>${CSS}</style></head>
<body>
<header><div class="top">
  <a class="brand" href="/"><span class="logo">${RPI_LOGO}</span>Raspberry Pi</a>
  <div class="right">${overall}<span>Actualizado ${esc(hhmm(new Date()))}${live ? ' · log en vivo' : ' · cada 60 s'}</span></div>
</div></header>
<div class="layout">
<aside>${deviceCard()}<div class="label">Panel</div>${nav}</aside>
<main><h1>${esc(title)}</h1>${body}</main>
</div>
<script>
document.documentElement.style.setProperty('--hh', document.querySelector('header').offsetHeight + 'px');
${live ? '' : 'setInterval(() => { if (!document.hidden) location.reload(); }, 60000);'}
</script>
</body></html>`;
}

const CSS = `
:root { --bg:#f4f6f9; --panel:#fff; --line:#e3e7ee; --text:#18212f; --muted:#6b7686; --head:#0f1724; --headtext:#e7ecf3; --accent:#2563eb;
  --ok:#16a34a; --okbg:#dcfce7; --warn:#d97706; --bad:#dc2626; --badbg:#fee2e2; --info:#2563eb; --infobg:#dbeafe; --idlebg:#eef1f5; --code:#0f1724; --codetext:#cfe3ff; }
@media (prefers-color-scheme: dark) { :root { --bg:#0b1018; --panel:#121a26; --line:#223044; --text:#e5ebf3; --muted:#8a97aa; --head:#070b11;
  --okbg:#0f2e1c; --badbg:#3a1414; --infobg:#132544; --idlebg:#1b2433; --code:#070b11; } }
:root { color-scheme:light; --thumb:#c3cad5; --thumbhover:#9aa4b2; --codethumb:#2b3a52; }
@media (prefers-color-scheme: dark) { :root { color-scheme:dark; --thumb:#2b3a52; --thumbhover:#3d5070; } }
* { box-sizing:border-box; scrollbar-width:thin; scrollbar-color:var(--thumb) transparent; }
pre { scrollbar-color:var(--codethumb) transparent; }
::-webkit-scrollbar { width:8px; height:8px; }
::-webkit-scrollbar-track { background:transparent; }
::-webkit-scrollbar-thumb { background:var(--thumb); border-radius:8px; border:2px solid transparent; background-clip:padding-box; }
::-webkit-scrollbar-thumb:hover { background:var(--thumbhover); background-clip:padding-box; }
::-webkit-scrollbar-corner { background:transparent; }
pre::-webkit-scrollbar-thumb { background:var(--codethumb); background-clip:padding-box; }
aside a, .tabs a { flex-shrink:0; }
body { margin:0; background:var(--bg); color:var(--text); font:14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
a { color:var(--accent); }
.ic { width:16px; height:16px; flex:none; } .ic.sm { width:12px; height:12px; }
header { background:var(--head); color:var(--headtext); position:sticky; top:0; z-index:10; border-bottom:1px solid #1c2636; }
.top { padding:12px 20px; display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
.brand { display:flex; align-items:center; gap:10px; font-weight:600; font-size:16px; color:inherit; text-decoration:none; }
.brand .logo { width:32px; height:32px; border-radius:8px; background:#a22846; display:grid; place-items:center; color:#fff; }
.brand .logo .rpi { width:20px; height:20px; }
.top .right { margin-left:auto; display:flex; align-items:center; gap:12px; font-size:12px; color:#93a1b5; }
.layout { display:grid; grid-template-columns:300px minmax(0, 1fr); }
aside { position:sticky; top:var(--hh, 57px); align-self:start; height:calc(100vh - var(--hh, 57px)); background:var(--panel); border-right:1px solid var(--line); padding:16px 14px; overflow:auto; }
aside .label { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); padding:0 10px 8px; }
aside a { display:flex; align-items:center; gap:10px; padding:9px 10px; border-radius:6px; color:var(--text); text-decoration:none; font-weight:500; }
aside a:hover { background:var(--idlebg); }
aside a.on { background:var(--infobg); color:var(--accent); }
aside a em { margin-left:auto; font-style:normal; font-size:11px; font-weight:700; color:#fff; background:var(--bad); border-radius:999px; min-width:18px; height:18px; display:grid; place-items:center; padding:0 5px; }
.mobile-only { display:none; }
.device { margin:0 2px 18px; padding:12px; border:1px solid var(--line); border-radius:8px; background:var(--bg); }
.dev-name { display:flex; align-items:center; gap:8px; font-weight:650; margin-bottom:8px; }
.dev-name .ic { color:var(--accent); }
.device dl { display:grid; grid-template-columns:auto minmax(0, 1fr); gap:4px 10px; margin:0; font-size:12px; }
.device dt { color:var(--muted); }
.device dd { margin:0; text-align:right; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-variant-numeric:tabular-nums; }
main { padding:24px 28px 48px; min-width:0; }
h1 { font-size:20px; margin:0 0 18px; font-weight:650; }
h3 { font-size:14px; margin:0; display:flex; align-items:center; gap:8px; }
.metrics { display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px; }
.metric, .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; }

.metric { padding:14px 16px; }
.m-head { display:flex; align-items:center; gap:8px; color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.05em; }
.m-val { font-size:26px; font-weight:650; margin:6px 0 10px; font-variant-numeric:tabular-nums; }
.m-val small { font-size:13px; font-weight:500; color:var(--muted); margin-left:4px; }
.bar { height:6px; background:var(--idlebg); border-radius:3px; overflow:hidden; }
.bar i { display:block; height:100%; border-radius:3px; } .bar .ok { background:var(--ok); } .bar .warn { background:var(--warn); } .bar .bad { background:var(--bad); }
.m-sub { color:var(--muted); font-size:12px; margin-top:8px; }
.split { display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:12px; margin-top:12px; }
.box { padding:0; }
.box-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 16px; border-bottom:1px solid var(--line); }
.box-head a { font-size:13px; text-decoration:none; }
.status { list-style:none; margin:0; padding:0; }
.status li { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:11px 16px; border-bottom:1px solid var(--line); }
.status li:last-child { border-bottom:none; }
table { width:100%; border-collapse:collapse; }
th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); font-weight:600; padding:10px 16px; border-bottom:1px solid var(--line); }
td { padding:12px 16px; border-bottom:1px solid var(--line); vertical-align:middle; }
tr:last-child td { border-bottom:none; }
.name { font-weight:600; } code { font:12px "SF Mono", Menlo, monospace; color:var(--muted); }
.muted { color:var(--muted); font-size:12px; }
.card { overflow-x:auto; }
.act { text-align:right; } .act > * { margin:3px 0 3px 6px; vertical-align:middle; } .act form { display:inline-block; }
td code { white-space:nowrap; }
button, .btn { display:inline-flex; align-items:center; gap:6px; background:var(--accent); color:#fff; border:none; padding:7px 12px; border-radius:6px; font-size:13px; font-weight:500; cursor:pointer; text-decoration:none; }
.btn.ghost { background:transparent; color:var(--text); border:1px solid var(--line); padding:6px 11px; }
button:hover, .btn:hover { filter:brightness(1.1); } button:disabled { background:var(--idlebg); color:var(--muted); cursor:default; }
.pill { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600; padding:3px 10px; border-radius:999px; white-space:nowrap; }
.pill b { width:7px; height:7px; border-radius:50%; background:currentColor; }
.pill.live b { animation:blink 1.6s ease-in-out infinite; }
@keyframes blink { 50% { opacity:.25; } }
#live { margin-left:4px; }
.pill.ok { color:var(--ok); background:var(--okbg); } .pill.bad { color:var(--bad); background:var(--badbg); }
.pill.info { color:var(--info); background:var(--infobg); } .pill.idle { color:var(--muted); background:var(--idlebg); }
header .pill.ok { background:#0f2e1c; } header .pill.bad { background:#3a1414; }
.tabs { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px; }
.tabs a { padding:7px 12px; border-radius:6px; border:1px solid var(--line); background:var(--panel); color:var(--text); text-decoration:none; font-size:13px; }
.tabs a.on { background:var(--accent); border-color:var(--accent); color:#fff; }
pre { margin:0; background:var(--code); color:var(--codetext); padding:14px 16px; font:12px/1.55 "SF Mono", Menlo, monospace; white-space:pre-wrap; word-break:break-word; overflow:auto; }
pre.tall { height:calc(100vh - var(--hh, 57px) - 210px); min-height:300px; }
@media (max-width:1100px) { th, td { padding-left:10px; padding-right:10px; } main { padding-left:20px; padding-right:20px; } }
@media (max-width:720px) {
  thead { display:none; } tr { display:block; border-bottom:1px solid var(--line); padding:8px 0; } tr:last-child { border-bottom:none; }
  td { display:flex; justify-content:space-between; gap:12px; border:none; padding:6px 16px; }
  td[data-l]::before { content:attr(data-l); color:var(--muted); font-size:12px; }
  td.act { justify-content:flex-end; } .top .right { margin-left:0; }
  .box-head.pad { flex-direction:column; align-items:flex-start; gap:4px; }
}
@media (max-width:860px) {
  .layout { display:block; }
  aside { position:sticky; top:var(--hh, 57px); z-index:9; height:auto; display:flex; gap:4px; padding:8px 12px; overflow-x:auto; border-right:none; border-bottom:1px solid var(--line); }
  aside .label, aside .device { display:none; }
  .mobile-only { display:block; } .mobile-only .device { margin:0 0 12px; background:var(--panel); }
  aside a { flex:none; padding:7px 10px; }
  main { padding:16px 16px 40px; }
}`;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://pi');
    const m = req.method === 'POST' && url.pathname.match(/^\/run\/(\w+)$/);
    if (m) {
      const job = JOBS.find((j) => j.id === m[1]);
      if (job) runJob(job);
      res.writeHead(303, { Location: '/tareas' });
      return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/registros/stream') return streamLog(req, res, url);
    const page = PAGES.find((p) => p.path === url.pathname);
    if (req.method !== 'GET' || !page) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('No encontrado');
    }
    const st = await status();
    const body = page.path === '/' ? await pageResumen(st)
      : page.path === '/tareas' ? jobTable(st.jobs)
      : page.path === '/servicios' ? serviceTable(st.services)
      : page.path === '/registros' ? await pageRegistros(url.searchParams)
      : `<div class="card"><pre>${esc(await crontab())}</pre></div>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(layout({ page: page.path, title: page.label, body, st, live: page.path === '/registros' }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Error: ' + e.message);
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Dashboard en http://0.0.0.0:${PORT}`));
