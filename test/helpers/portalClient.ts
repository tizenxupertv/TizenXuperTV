import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const JS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/js');

export interface FakeRequest {
  url: string;
  aborted: boolean;
  /** Answers as a network error */
  fail(): void;
  /** Some bytes arrived */
  progress(): void;
}

/**
 * The portal client (public/js/magis-client.js) loaded as on a TV, with a clock the test moves and requests the test
 * answers. `onRequest` is called for each request the client sends.
 */
export function loadPortalClient(onRequest: (req: FakeRequest) => void) {
  let now = 1_800_000_000_000;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const requests: FakeRequest[] = [];

  class FakeDate extends Date {
    static now() { return now; }
  }

  class FakeXhr {
    readyState = 0;
    status = 0;
    responseText = '';
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    onprogress: null | (() => void) = null;
    onreadystatechange: null | (() => void) = null;
    private req: FakeRequest | null = null;
    open(_method: string, url: string) {
      this.req = {
        url,
        aborted: false,
        fail: () => { if (!this.req!.aborted && this.onerror) this.onerror(); },
        progress: () => {
          if (this.req!.aborted) return;
          this.readyState = 3;
          if (this.onprogress) this.onprogress();
        }
      };
    }
    setRequestHeader() {}
    send() {
      requests.push(this.req!);
      onRequest(this.req!);
    }
    abort() { this.req!.aborted = true; }
  }

  const stored: Record<string, string> = {};
  const sandbox: any = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout: (fn: () => void, ms = 0) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
    Date: FakeDate,
    XMLHttpRequest: FakeXhr,
    tizen: {},
    location: { hostname: 'tv.invalid' },
    localStorage: {
      getItem: (k: string) => (k in stored ? stored[k] : null),
      setItem: (k: string, v: string) => { stored[k] = String(v); },
      removeItem: (k: string) => { delete stored[k]; }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(JS_DIR, 'crypto-js.min.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(JS_DIR, 'magis-client.js'), 'utf8'), sandbox);
  if (!sandbox.MagisClient) throw new Error('the portal client did not load');

  /** Moves the clock, running the timers that come due in order */
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      let dueId = 0;
      let due: { at: number; fn: () => void } | null = null;
      timers.forEach((t, id) => { if (t.at <= end && (!due || t.at < due.at)) { due = t; dueId = id; } });
      if (!due) break;
      timers.delete(dueId);
      now = Math.max(now, (due as { at: number }).at);
      (due as { fn: () => void }).fn();
    }
    now = end;
  };

  return { client: sandbox.MagisClient, requests, advance };
}
