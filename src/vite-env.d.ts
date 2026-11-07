/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
/** Update server for test builds (env XUPER_UPDATE_API at build time); empty in releases */
declare const __UPDATE_API__: string;

/** public/js/boot.js */
interface XuperBootApi {
  SHELL: number;
  PUBKEY: string;
  cmp(a: string, b: string): number;
  ok(): void;
  info: { packaged: string; running: string; shell: number; note: string };
  badList(): Record<string, number>;
  store: {
    read(cb: (meta: any, bundle: any) => void): void;
    readMeta(cb: (meta: any) => void): void;
    write(meta: object, bundle: object, cb: (ok: boolean) => void): void;
    clear(cb?: (ok: boolean) => void): void;
  };
}

interface Window {
  XuperBoot?: XuperBootApi;
}
