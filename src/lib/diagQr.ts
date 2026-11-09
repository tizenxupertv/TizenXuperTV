/**
 * QR of the sign-in error screen. A TV that cannot reach our servers cannot send a report itself, so the QR opens
 * the support bot on the phone with the TV's details and network diagnostic in the /start payload
 * (TizenXuper Bot, src/diagReport.ts, reads it). At most 64 chars of [A-Za-z0-9_-]:
 *   diag-<version>-<tizen>-<verdict><5 checks>-<model>, e.g. diag-1_13_1-6_5-aooeee-UN50U8000FKXZL
 * No relative imports, so tests can load this file in Node.
 */

export const SUPPORT_BOT_URL = 'https://t.me/TizenXuperSupportBot';

/** The part of a LoginDiagResult (services/diagnosticService.ts) the payload carries */
export interface DiagQrInput {
  verdict: string;
  checks: { id: string; status: string }[];
}

const VERDICT_LETTER: Record<string, string> = {
  ok: 'o',
  'clock-wrong': 'c',
  'no-internet': 'n',
  'workers-blocked': 'w',
  'relay-only': 'r',
  'all-blocked': 'a'
};
const STATE_LETTER: Record<string, string> = { ok: 'o', warn: 'w', error: 'e' };
const CHECK_ORDER = ['network', 'clock', 'doh', 'relay', 'workers'];

/**
 * version: the app version ("1.13.1"); device: accountService.deviceInfo().model ("UN50U8000FKXZL · Tizen 9.0", '' in a browser);
 * diag: null when the diagnostic did not run
 */
export function diagQrPayload(version: string, device: string, diag: DiagQrInput | null): string {
  const ver = (/^\d{1,3}(?:\.\d{1,3}){0,3}/.exec(version) || ['0'])[0].replace(/\./g, '_');
  const tz = /Tizen (\d{1,2})(?:\.(\d{1,2}))?/.exec(device);
  const tizen = tz ? tz[1] + (tz[2] ? '_' + tz[2] : '') : 'x';
  const first = device.split(' · ')[0] || '';
  const model = (/^Tizen /.test(first) ? '' : first).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) || 'x';
  let result = 'x';
  for (let i = 0; i < CHECK_ORDER.length; i++) {
    const check = diag ? diag.checks.filter(c => c.id === CHECK_ORDER[i])[0] : undefined;
    result += (check && STATE_LETTER[check.status]) || 'x';
  }
  if (diag && VERDICT_LETTER[diag.verdict]) result = VERDICT_LETTER[diag.verdict] + result.slice(1);
  return `diag-${ver}-${tizen}-${result}-${model}`;
}

export function diagQrUrl(version: string, device: string, diag: DiagQrInput | null): string {
  return `${SUPPORT_BOT_URL}?start=${diagQrPayload(version, device, diag)}`;
}
