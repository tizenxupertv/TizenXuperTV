/**
 * Zero-Build Cloudflare Worker Deployer via REST API
 * Works cleanly on ARMv6 without heavy esbuild/wrangler binaries.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(__dirname, '.env.pi');

function loadEnv() {
  const lines = fs.readFileSync(ENV_FILE, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

async function main() {
  const env = loadEnv();
  const token = env.CLOUDFLARE_API_TOKEN;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID || '0bc7ecd836f7da439e1e953e00df9da3';
  const scriptName = 'tizenxuper-relay';

  const workerDir = path.join(__dirname, 'relay-worker');
  const poolPath = path.join(workerDir, 'src/sessionPool.js');
  const indexPath = path.join(workerDir, 'src/index.js');

  const poolSrc = fs.readFileSync(poolPath, 'utf8');
  const indexSrc = fs.readFileSync(indexPath, 'utf8');

  // Multi-module worker upload
  const form = new FormData();
  form.append('index.js', new Blob([indexSrc], { type: 'application/javascript+module' }), 'index.js');
  form.append('sessionPool.js', new Blob([poolSrc], { type: 'application/javascript+module' }), 'sessionPool.js');

  const metadata = {
    main_module: 'index.js',
    compatibility_date: '2024-04-01'
  };
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }), 'metadata.json');

  console.log('[deploy-api] Uploading worker ' + scriptName + ' directly to Cloudflare API...');
  const res = await fetch(
    'https://api.cloudflare.com/client/v4/accounts/' + accountId + '/workers/scripts/' + scriptName,
    {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer ' + token
      },
      body: form
    }
  );

  const data = await res.json();
  if (data.success) {
    console.log('[deploy-api] SUCCESS: ' + scriptName + ' deployed to Cloudflare! ETag: ' + (data.result?.etag || 'OK'));
  } else {
    console.error('[deploy-api] FAILED:', JSON.stringify(data.errors));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[deploy-api] Fatal:', err);
  process.exit(1);
});
