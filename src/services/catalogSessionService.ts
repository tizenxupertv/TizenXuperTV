const DEVICE_KEY = 'xuper_catalog_device_v1';
const RENEW_WINDOW_MS = 60_000;

export interface CatalogSession {
  expiresAt: number;
}

export interface CatalogSessionGateway {
  acquire(input: { deviceId: string; reason: 'initial' | 'renew' }): Promise<CatalogSession>;
}

export interface CatalogSessionDeps {
  storage: StorageLike;
  randomBytes: (size: number) => Uint8Array;
  now: () => number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Holds only expiry metadata in memory. Any session tokens stay inside the
 * authorized gateway and are never written to the TV's persistent storage.
 */
export function createCatalogSessionService(gateway: CatalogSessionGateway, deps: CatalogSessionDeps) {
  let current: CatalogSession | null = null;
  let pending: Promise<CatalogSession> | null = null;

  const deviceId = (): string => {
    const stored = deps.storage.getItem(DEVICE_KEY);
    if (stored && /^[a-f0-9]{32}$/.test(stored)) return stored;
    const id = Array.from(deps.randomBytes(16), byte => byte.toString(16).padStart(2, '0')).join('');
    deps.storage.setItem(DEVICE_KEY, id);
    return id;
  };

  const isUsable = (session: CatalogSession | null) => Boolean(session && session.expiresAt > deps.now() + RENEW_WINDOW_MS);

  const ensure = (): Promise<CatalogSession> => {
    if (isUsable(current)) return Promise.resolve(current!);
    if (pending) return pending;
    const reason: 'initial' | 'renew' = current ? 'renew' : 'initial';
    pending = gateway.acquire({ deviceId: deviceId(), reason }).then(session => {
      if (!Number.isFinite(session?.expiresAt) || session.expiresAt <= deps.now() + RENEW_WINDOW_MS) {
        throw new Error('invalid catalog session');
      }
      current = { expiresAt: session.expiresAt };
      return current;
    }).finally(() => { pending = null; });
    return pending;
  };

  return {
    deviceId,
    ensure,
    state: () => ({ ready: isUsable(current), expiresAt: current?.expiresAt || 0 })
  };
}

export function browserCatalogSessionDeps(): CatalogSessionDeps {
  return {
    storage: window.localStorage,
    randomBytes: size => {
      const bytes = new Uint8Array(size);
      window.crypto.getRandomValues(bytes);
      return bytes;
    },
    now: () => Date.now()
  };
}
