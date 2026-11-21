/**
 * How much room the TV had when a check or a report was made: system memory, the app's own memory, CPU load and free
 * storage. Support reads it to tell a TV that was short of resources from a fault in the app.
 * Tizen's systeminfo needs no extra privilege for these; a browser gives what it can. Every read is optional.
 * No relative imports, so tests can load this file in Node.
 */

export interface DeviceResources {
  /** System memory (Tizen), MB */
  memTotalMb?: number;
  memAvailMb?: number;
  /** Tizen's own verdict on memory: NORMAL, WARNING… */
  memStatus?: string;
  /** JavaScript memory of the app and its ceiling, MB */
  appMb?: number;
  appLimitMb?: number;
  /** CPU load, 0-100 */
  cpuPct?: number;
  storageFreeMb?: number;
  storageTotalMb?: number;
  /** Minutes since the app started */
  uptimeMin: number;
}

const MB = 1024 * 1024;
const mb = (bytes: unknown) => (typeof bytes === 'number' && isFinite(bytes) && bytes > 0 ? Math.round(bytes / MB) : undefined);

/** A systeminfo property, or null when it is missing, refused or slow */
function property(si: any, name: string, timeoutMs = 2000): Promise<any> {
  return new Promise(resolve => {
    let done = false;
    const finish = (v: any) => { if (!done) { done = true; resolve(v); } };
    setTimeout(() => finish(null), timeoutMs);
    try {
      si.getPropertyValue(name, (v: any) => finish(v), () => finish(null));
    } catch {
      finish(null);
    }
  });
}

export async function readDeviceResources(w: any = typeof window !== 'undefined' ? window : {}): Promise<DeviceResources> {
  const perf = w.performance || {};
  const r: DeviceResources = { uptimeMin: Math.round((typeof perf.now === 'function' ? perf.now() : 0) / 60000) };

  const heap = perf.memory;
  if (heap) {
    r.appMb = mb(heap.usedJSHeapSize);
    r.appLimitMb = mb(heap.jsHeapSizeLimit);
  }

  const si = w.tizen && w.tizen.systeminfo;
  if (si) {
    try { r.memTotalMb = mb(si.getTotalMemory()); } catch {}
    try { r.memAvailMb = mb(si.getAvailableMemory()); } catch {}
    const [memory, cpu, storage] = await Promise.all([property(si, 'MEMORY'), property(si, 'CPU'), property(si, 'STORAGE')]);
    if (memory && memory.status) r.memStatus = String(memory.status);
    if (cpu && typeof cpu.load === 'number') r.cpuPct = Math.round(cpu.load * 100);
    const internal = storage && Array.isArray(storage.units)
      ? storage.units.find((u: any) => u && u.type === 'INTERNAL') || storage.units[0]
      : null;
    if (internal) {
      r.storageFreeMb = mb(internal.availableCapacity);
      r.storageTotalMb = mb(internal.capacity);
    }
  } else if (w.navigator && typeof w.navigator.deviceMemory === 'number') {
    r.memTotalMb = Math.round(w.navigator.deviceMemory * 1024);
  }
  return r;
}

/** 'bad' when the TV was clearly short of memory or CPU, 'warn' when close, '' when nothing was measured */
export function resourcesLevel(r: DeviceResources | null): 'ok' | 'warn' | 'bad' | '' {
  if (!r) return '';
  const appShare = r.appMb && r.appLimitMb ? r.appMb / r.appLimitMb : 0;
  if ((r.memAvailMb !== undefined && r.memAvailMb < 100) || r.memStatus === 'CRITICAL' || appShare > 0.9) return 'bad';
  if ((r.memAvailMb !== undefined && r.memAvailMb < 250) || r.memStatus === 'WARNING' || (r.cpuPct ?? 0) > 85 || appShare > 0.75) return 'warn';
  return r.memAvailMb !== undefined || r.appMb !== undefined ? 'ok' : '';
}

const gb = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1).replace('.', ',')} GB` : `${n} MB`);

/** One line for the support report */
export function resourcesLine(r: DeviceResources): string {
  const parts: string[] = [];
  if (r.memAvailMb !== undefined) parts.push(`RAM libre ${gb(r.memAvailMb)}${r.memTotalMb ? ` de ${gb(r.memTotalMb)}` : ''}${r.memStatus ? ` (${r.memStatus})` : ''}`);
  else if (r.memTotalMb) parts.push(`RAM ${gb(r.memTotalMb)}`);
  if (r.appMb !== undefined) parts.push(`app ${r.appMb}${r.appLimitMb ? `/${r.appLimitMb}` : ''} MB`);
  if (r.cpuPct !== undefined) parts.push(`CPU ${r.cpuPct} %`);
  if (r.storageFreeMb !== undefined) parts.push(`almacenamiento libre ${gb(r.storageFreeMb)}${r.storageTotalMb ? ` de ${gb(r.storageTotalMb)}` : ''}`);
  parts.push(`abierta hace ${r.uptimeMin} min`);
  return parts.join(' · ');
}
