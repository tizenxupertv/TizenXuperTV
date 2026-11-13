import type { Plugin } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { transformSync } from 'esbuild';

/** Own scripts copied as they are from public/js: minified in dist (not boot.js, the root of trust, nor vendor files) */
const MINIFY_PUBLIC = ['js/magis-client.js', 'js/tizen-bridge.js'];

/**
 * Compatibility for older Samsung TVs (Tizen 4.0 = Chromium 56):
 *  - min() / max() / clamp() only exist since Chromium 79. The app renders on a fixed
 *    1920x1080 canvas, so each declaration gets a static px fallback right before it.
 *    Old engines drop the declaration they cannot parse and keep the fallback; modern
 *    engines keep the original.
 *  - <script type="module"> only exists since Chromium 61: the bundle is emitted as a
 *    classic deferred script instead (see build.rollupOptions.output.format = 'iife').
 */

const CANVAS_W = 1920;
const CANVAS_H = 1080;

function toPx(arg: string): number | null {
  const m = /^(-?\d*\.?\d+)(px|vw|vh)?$/.exec(arg.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (m[2] === 'vw') return (n * CANVAS_W) / 100;
  if (m[2] === 'vh') return (n * CANVAS_H) / 100;
  if (!m[2] && n !== 0) return null; // unitless non-zero (e.g. line-height) is not a length
  return n;
}

function round(n: number): string {
  return `${Math.round(n * 100) / 100}px`;
}

/** Resolves every min()/max()/clamp() in a value, or returns null if any cannot be resolved. */
export function resolveCssFunctions(value: string): string | null {
  let out = value;
  const inner = /\b(min|max|clamp)\(([^()]*)\)/;
  let guard = 0;
  while (inner.test(out)) {
    if (guard++ > 20) return null;
    let failed = false;
    out = out.replace(inner, (_all, fn: string, args: string) => {
      const nums = args.split(',').map(toPx);
      if (nums.some(n => n === null)) {
        failed = true;
        return _all;
      }
      const v = nums as number[];
      if (fn === 'min') return round(Math.min(...v));
      if (fn === 'max') return round(Math.max(...v));
      if (v.length !== 3) {
        failed = true;
        return _all;
      }
      return round(Math.min(Math.max(v[1], v[0]), v[2]));
    });
    if (failed) return null;
  }
  return out;
}

/**
 * Viewport units become stage pixels. public/js/tizen-bridge.js scales the fixed 1920x1080 stage to any
 * other window, where vw/vh would still measure the window and leave layers smaller than the stage.
 */
export function toStageUnits(css: string): string {
  return css.replace(/(?<![\w#.-])(-?\d*\.?\d+)(vw|vh)\b/g, (_all, n: string, unit: string) =>
    round((parseFloat(n) * (unit === 'vw' ? CANVAS_W : CANVAS_H)) / 100)
  );
}

export function addCssFallbacks(css: string): string {
  // 1. Math functions min/max/clamp fallback for Chromium < 79
  let out = css.replace(
    /(^[ \t]*|[;{]\s*)([a-z-]+)(\s*:\s*)([^;{}]*\b(?:min|max|clamp)\([^;{}]*?)(\s*!important)?(\s*;)/gm,
    (all, lead: string, prop: string, colon: string, value: string, important = '', end: string) => {
      const resolved = resolveCssFunctions(value);
      if (!resolved || resolved === value) return all;
      return `${lead}${prop}${colon}${resolved}${important}${end} ${prop}${colon}${value}${important}${end}`;
    }
  );

  // 2. Inset fallback for Chromium < 87 (Tizen 3/4/5/5.5/6)
  // Matches "inset: <value>;" but not "inset-inline", "inset-block", etc.
  out = out.replace(
    /(^[ \t]*|[;{]\s*)\binset(\s*:\s*)([^;{}]+?)(\s*!important)?(\s*;)/gm,
    (all, lead: string, colon: string, rawVal: string, important = '', end: string) => {
      const val = rawVal.trim();
      if (!val || val.includes('var(') || val.includes('calc(')) return all;
      const parts = val.split(/\s+/);
      let top: string, right: string, bottom: string, left: string;
      if (parts.length === 1) {
        top = right = bottom = left = parts[0];
      } else if (parts.length === 2) {
        top = bottom = parts[0];
        right = left = parts[1];
      } else if (parts.length === 3) {
        top = parts[0];
        right = left = parts[1];
        bottom = parts[2];
      } else if (parts.length === 4) {
        [top, right, bottom, left] = parts;
      } else {
        return all;
      }
      const imp = important || '';
      return `${lead}top: ${top}${imp}; right: ${right}${imp}; bottom: ${bottom}${imp}; left: ${left}${imp}; inset:${rawVal}${imp}${end}`;
    }
  );

  return out;
}

/**
 * Moves the external scripts out of <head>: public/js/boot.js, at the end of <body>, loads them one after another
 * (or the newer code of a downloaded update, see that file), so the splash screen shows at once instead of a black
 * screen while ~1.3 MB of scripts (portal data, hls, crypto) are parsed. Each script advances the splash bar up to
 * 30% (the app fills the rest, see src/lib/splash.ts). The package's script and style lists and its version are
 * handed to boot.js as globals. webapis.js stays in <head>: it is tiny and the Tizen runtime resolves its $WEBAPIS path.
 */
export function deferHeavyScripts(html: string, appVersion: string): string {
  const local = (src: string) => src.replace(/^\.\//, '');
  const srcs: string[] = [];
  html = html.replace(/<script\b[^>]*\ssrc="([^"]+)"[^>]*><\/script>\s*/g, (tag, src: string) => {
    if (src.indexOf('$WEBAPIS') === 0) return tag;
    srcs.push(local(src));
    return '';
  });
  const styles: string[] = [];
  html.replace(/<link\b[^>]*rel="stylesheet"[^>]*\shref="([^"]+)"[^>]*>/g, (tag, href: string) => {
    styles.push(local(href));
    return tag;
  });
  const lists = `window.__XUPER_SCRIPTS=${JSON.stringify(srcs)};window.__XUPER_STYLES=${JSON.stringify(styles)};window.__XUPER_PACKAGED=${JSON.stringify(appVersion)};`;
  return html.replace('</body>', `<script>${lists}</script>\n<script src="js/boot.js"></script>\n</body>`);
}

export function tvCompatPlugin(appVersion = 'dev'): Plugin {
  return {
    name: 'xuper-tv-compat',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.css')) return null;
      return { code: addCssFallbacks(toStageUnits(code)), map: null };
    },
    closeBundle() {
      // Only after a production build (dist exists with the copied public files)
      for (const rel of MINIFY_PUBLIC) {
        const file = join(process.cwd(), 'dist', rel);
        try {
          const src = readFileSync(file, 'utf8');
          const out = transformSync(src, { minify: true, target: 'chrome56', legalComments: 'none' }).code;
          if (out.length < src.length) writeFileSync(file, out);
        } catch {
          // missing in dev or a syntax esbuild rejects: leave the file as it is
        }
      }
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        html = html.replace(/%APP_VERSION%/g, appVersion);
        if (!ctx.bundle) return html; // dev server keeps ES modules
        html = deferHeavyScripts(html, appVersion);
        return html
          .replace(/<script type="module" crossorigin src=/g, '<script defer src=')
          .replace(/<link rel="modulepreload"[^>]*>\s*/g, '')
          // Packaged app files load from the widget itself: no CORS mode for local assets
          .replace(/(<link rel="stylesheet") crossorigin/g, '$1');
      }
    }
  };
}
