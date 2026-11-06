import SHA256 from 'crypto-js/sha256';
import { isAdultLabel } from '../lib/catalogOrganizer';

const KEY = 'xuper_parental_v1';
const MAX_FAILS = 5;
const COOLDOWN_MS = 30000;

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
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {}
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

  public cooldownSeconds(): number {
    return Math.max(0, Math.ceil((this.cooldownUntil - Date.now()) / 1000));
  }

  public verify(pin: string): VerifyResult {
    if (this.cooldownSeconds() > 0) return 'cooldown';
    const state = this.read();
    if (!state.pinHash) return 'ok';
    if (hashPin(pin) === state.pinHash) {
      this.fails = 0;
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
      return 'cooldown';
    }
    return 'bad';
  }

  public setPin(pin: string) {
    const state = this.read();
    state.pinHash = hashPin(pin);
    this.sessionUnlocked = true;
    this.write(state);
  }

  public clear() {
    this.sessionUnlocked = false;
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
