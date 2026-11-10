import SHA256 from 'crypto-js/sha256';
import { isAdultLabel } from '../lib/catalogOrganizer.ts';
import { saveItem } from '../lib/safeStorage.ts';

const KEY = 'xuper_parental_v1';
const LOCK_KEY = 'xuper_parental_lock_v1';
const MAX_FAILS = 5;
const COOLDOWN_MS = 60000;

/** The PIN only guards adult content: the +18 section and the adult live category */
interface ParentalState {
  pinHash?: string;
  /** "Sección para adultos (+18)": off unless enabled with the PIN in Perfil › Bloqueo */
  adultEnabled?: boolean;
}

export type VerifyResult = 'ok' | 'bad' | 'cooldown';

function hashPin(pin: string): string {
  return SHA256('xuper-parental:' + pin).toString();
}

class ParentalService {
  private listeners: Array<() => void> = [];
  private sessionUnlocked = false;
  private fails = 0;
  private cooldownUntil = 0;

  constructor() {
    this.readLockState();
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.lockSession();
      });
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', () => this.lockSession());
    }
  }

  private readLockState() {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(LOCK_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.fails = Math.max(0, Number(parsed?.fails) || 0);
        this.cooldownUntil = Math.max(0, Number(parsed?.cooldownUntil) || 0);
      }
    } catch (e) {}
  }

  private writeLockState() {
    try {
      if (typeof localStorage === 'undefined') return;
      saveItem(LOCK_KEY, JSON.stringify({
        fails: this.fails,
        cooldownUntil: this.cooldownUntil
      }));
    } catch (e) {}
  }

  private read(): ParentalState {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw);
        return { pinHash: p.pinHash, adultEnabled: !!p.adultEnabled && !!p.pinHash };
      }
    } catch (e) {}
    return {};
  }

  private emit() {
    this.listeners.forEach(cb => {
      try { cb(); } catch (e) {}
    });
  }

  private write(state: ParentalState) {
    saveItem(KEY, JSON.stringify(state));
    this.emit();
  }

  public hasPin(): boolean {
    return !!this.read().pinHash;
  }

  /** The +18 section exists only with a PIN (removing the PIN turns it off) */
  public isAdultEnabled(): boolean {
    const state = this.read();
    return !!state.pinHash && !!state.adultEnabled;
  }

  public setAdultEnabled(on: boolean) {
    const state = this.read();
    state.adultEnabled = on && !!state.pinHash;
    this.write(state);
  }

  public isSessionUnlocked(): boolean {
    return this.sessionUnlocked;
  }

  /** Locks the current adult session (e.g. when app goes to background or profile switches) */
  public lockSession(): void {
    if (this.sessionUnlocked) {
      this.sessionUnlocked = false;
      this.emit();
    }
  }

  public failedAttempts(): number {
    this.readLockState();
    return this.fails;
  }

  public maxAttempts(): number {
    return MAX_FAILS;
  }

  public cooldownSeconds(): number {
    this.readLockState();
    return Math.max(0, Math.ceil((this.cooldownUntil - Date.now()) / 1000));
  }

  public verify(pin: string): VerifyResult {
    if (this.cooldownSeconds() > 0) return 'cooldown';
    const state = this.read();
    if (!state.pinHash) return 'ok';
    if (hashPin(pin) === state.pinHash) {
      this.fails = 0;
      this.cooldownUntil = 0;
      this.writeLockState();
      if (!this.sessionUnlocked) {
        this.sessionUnlocked = true;
        this.emit();
      }
      return 'ok';
    }
    this.fails++;
    if (this.fails >= MAX_FAILS) {
      this.fails = 0;
      this.cooldownUntil = Date.now() + COOLDOWN_MS;
      this.writeLockState();
      return 'cooldown';
    }
    this.writeLockState();
    return 'bad';
  }

  public setPin(pin: string) {
    const state = this.read();
    state.pinHash = hashPin(pin);
    this.fails = 0;
    this.cooldownUntil = 0;
    this.writeLockState();
    this.sessionUnlocked = true;
    this.write(state);
  }

  public clear() {
    this.sessionUnlocked = false;
    this.fails = 0;
    this.cooldownUntil = 0;
    this.writeLockState();
    this.write({});
  }

  /** Adult live category ("18+"): hidden while the +18 section is off, behind the PIN while on */
  public isAdultCategory(name: string | undefined): boolean {
    return isAdultLabel(name);
  }

  public subscribe(cb: () => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter(l => l !== cb);
    };
  }
}

export const parentalService = new ParentalService();
