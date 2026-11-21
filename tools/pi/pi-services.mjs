#!/usr/bin/env node
/**
 * TizenXuper Pi — one Node process for the dashboard, the health monitor and the Telegram bot.
 * Each Node process costs ~25 MB of the B+'s 426 MB, so the long-running services share one.
 * Run by systemd (tizenxuper-pi.service), which restarts it if it dies.
 */

const loaded = new Set();
globalThis.__piServices = loaded;

// One failing service must not take the others down with it
process.on('unhandledRejection', (err) => console.error(`[${new Date().toISOString()}] [pi-services] unhandled rejection:`, err));

for (const file of ['dashboard.mjs', 'health-monitor.mjs', 'tg-listener.mjs']) {
  try {
    await import(`./${file}`);
    loaded.add(file);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] [pi-services] ${file} failed to start:`, err);
  }
}
