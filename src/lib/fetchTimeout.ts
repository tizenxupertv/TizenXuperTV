/**
 * fetch with a time limit for the whole exchange, headers and body. Without one, a request that never answered left
 * its screen loading (or its scores frozen) until the app was restarted.
 */
export interface TimedResponse {
  ok: boolean;
  status: number;
  /** Final address, after redirects */
  url: string;
  text(): Promise<string>;
  json(): Promise<any>;
}

export const FETCH_TIMEOUT_MS = 10000;

export function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  ms: number = FETCH_TIMEOUT_MS,
  fetchFn: typeof fetch = fetch
): Promise<TimedResponse> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      if (ctrl) ctrl.abort();
      reject(new Error(`sin respuesta en ${Math.round(ms / 1000)} s`));
    }, ms);
  });
  // A caller that never reads the body leaves the deadline with nobody waiting on it: that is not an error
  deadline.catch(() => {});
  const done = () => { if (timer) clearTimeout(timer); };
  const limited = <T>(work: Promise<T>): Promise<T> => Promise.race([work, deadline]);

  return limited(fetchFn(url, ctrl ? { ...init, signal: ctrl.signal } : init)).then(
    res => ({
      ok: res.ok,
      status: res.status,
      url: res.url,
      text: () => limited(res.text()).then(v => { done(); return v; }, e => { done(); throw e; }),
      json: () => limited(res.json()).then(v => { done(); return v; }, e => { done(); throw e; })
    }),
    err => { done(); throw err; }
  );
}
