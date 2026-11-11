import { kvGet, kvSet } from '../lib/kvStore';
import { isAdultLabel } from '../lib/catalogOrganizer';
import { LiveChannel } from '../types/channel';

/**
 * Free, open IPTV lists for the TV section. Source: iptv-org (github.com/iptv-org/iptv, CC0), which
 * only collects channels their owners publish for free; it stopped listing NSFW channels in 2024.
 * URLs from its PLAYLISTS.md. Each list is downloaded and parsed once, saved in IndexedDB and
 * refreshed in the background when it is older than FRESH_MS.
 */
export interface IptvList {
  id: string;
  name: string;
  url: string;
  /** On until the user changes it */
  defaultOn?: boolean;
}

const BASE = 'https://iptv-org.github.io/iptv/';

export const IPTV_LISTS: IptvList[] = [
  { id: 'co', name: 'Colombia', url: `${BASE}countries/co.m3u`, defaultOn: true },
  { id: 'mx', name: 'México', url: `${BASE}countries/mx.m3u`, defaultOn: true },
  { id: 'es', name: 'España', url: `${BASE}countries/es.m3u`, defaultOn: true },
  { id: 'ar', name: 'Argentina', url: `${BASE}countries/ar.m3u` },
  { id: 'cl', name: 'Chile', url: `${BASE}countries/cl.m3u` },
  { id: 'pe', name: 'Perú', url: `${BASE}countries/pe.m3u` },
  { id: 've', name: 'Venezuela', url: `${BASE}countries/ve.m3u` },
  { id: 'ec', name: 'Ecuador', url: `${BASE}countries/ec.m3u` },
  { id: 'bo', name: 'Bolivia', url: `${BASE}countries/bo.m3u` },
  { id: 'cr', name: 'Costa Rica', url: `${BASE}countries/cr.m3u` },
  { id: 'cu', name: 'Cuba', url: `${BASE}countries/cu.m3u` },
  { id: 'sv', name: 'El Salvador', url: `${BASE}countries/sv.m3u` },
  { id: 'gt', name: 'Guatemala', url: `${BASE}countries/gt.m3u` },
  { id: 'hn', name: 'Honduras', url: `${BASE}countries/hn.m3u` },
  { id: 'ni', name: 'Nicaragua', url: `${BASE}countries/ni.m3u` },
  { id: 'pa', name: 'Panamá', url: `${BASE}countries/pa.m3u` },
  { id: 'py', name: 'Paraguay', url: `${BASE}countries/py.m3u` },
  { id: 'pr', name: 'Puerto Rico', url: `${BASE}countries/pr.m3u` },
  { id: 'do', name: 'República Dominicana', url: `${BASE}countries/do.m3u` },
  { id: 'uy', name: 'Uruguay', url: `${BASE}countries/uy.m3u` },
  // ~2400 channels: the biggest list, off by default
  { id: 'spa', name: 'Todo en español', url: `${BASE}languages/spa.m3u` }
];

/** Live category id of a list */
export const IPTV_CATEGORY_PREFIX = 'iptv:';
export const IPTV_CATEGORY_LABEL = 'TV abierta · ';

const SETTINGS_KEY = 'xuper_iptv_lists_v1';
const CACHE_PREFIX = 'xuper_iptv_list_v1_';
const FRESH_MS = 12 * 60 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 20000;

// iptv-org group titles -> the app's language
const GROUP_LABELS: Record<string, string> = {
  general: 'General', news: 'Noticias', music: 'Música', religious: 'Religioso', entertainment: 'Entretenimiento',
  movies: 'Cine', series: 'Series', sports: 'Deportes', kids: 'Infantil', animation: 'Animación',
  legislative: 'Legislativo', education: 'Educación', culture: 'Cultura', documentary: 'Documentales',
  lifestyle: 'Estilo de vida', outdoor: 'Aire libre', comedy: 'Comedia', travel: 'Viajes', family: 'Familia',
  classic: 'Clásicos', business: 'Negocios', science: 'Ciencia', cooking: 'Cocina', auto: 'Motor',
  weather: 'Clima', shop: 'Compras', relax: 'Relax', public: 'Pública'
};

interface SavedList {
  at: number;
  channels: LiveChannel[];
}

/** Reads an M3U playlist into channels; adult channels are left out */
export function parseM3u(text: string): LiveChannel[] {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  const out: LiveChannel[] = [];
  const seen: Record<string, boolean> = {};
  const attrRe = /([\w-]+)="([^"]*)"/g;
  let info: { name: string; logo: string; group: string; tvgId: string } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.indexOf('#EXTINF') === 0) {
      const attrs: Record<string, string> = {};
      attrRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = attrRe.exec(line))) attrs[m[1].toLowerCase()] = m[2];
      // The name follows the first comma outside the quoted attributes
      let name = '';
      let quoted = false;
      for (let j = 0; j < line.length; j++) {
        const ch = line.charAt(j);
        if (ch === '"') quoted = !quoted;
        else if (ch === ',' && !quoted) {
          name = line.slice(j + 1).trim();
          break;
        }
      }
      info = { name: name || attrs['tvg-name'] || '', logo: attrs['tvg-logo'] || '', group: attrs['group-title'] || '', tvgId: attrs['tvg-id'] || '' };
      continue;
    }
    if (line.charAt(0) === '#') continue;
    const url = line;
    const meta = info;
    info = null;
    if (!/^https?:\/\//i.test(url) || seen[url]) continue;
    if (meta && (isAdultLabel(meta.group) || isAdultLabel(meta.name))) continue;
    seen[url] = true;

    const rawName = (meta && meta.name) || 'Canal';
    const geo = /\[geo-blocked\]/i.test(rawName);
    const name = rawName.replace(/\s*\(\d{3,4}[pi]\)/gi, '').replace(/\s*\[[^\]]*\]/g, '').trim() || 'Canal';
    const groups = ((meta && meta.group) || '').split(';').map(g => GROUP_LABELS[g.trim().toLowerCase()]).filter(Boolean);
    const id = `${IPTV_CATEGORY_PREFIX}${(meta && meta.tvgId) || url}`;
    out.push({
      id,
      code: id,
      name,
      url,
      logo: (meta && meta.logo) || '',
      now: [groups.join(' · ') || 'Señal abierta', geo ? 'Puede estar bloqueado en tu región' : ''].filter(Boolean).join(' · '),
      next: 'Programación en directo',
      time: 'EN VIVO'
    });
  }
  return out;
}

function download(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = DOWNLOAD_TIMEOUT_MS;
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.responseText) : reject(new Error(`HTTP ${xhr.status}`)));
    xhr.onerror = () => reject(new Error('network'));
    xhr.ontimeout = () => reject(new Error('timeout'));
    xhr.send();
  });
}

class IptvService {
  private memory: Record<string, LiveChannel[]> = {};
  private inFlight: Record<string, Promise<LiveChannel[]>> = {};
  private listeners: Array<() => void> = [];

  public lists(): IptvList[] {
    return IPTV_LISTS;
  }

  private enabledIds(): string[] {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (saved && Array.isArray(saved.enabled)) return saved.enabled;
    } catch (e) {}
    return IPTV_LISTS.filter(l => l.defaultOn).map(l => l.id);
  }

  public isEnabled(id: string): boolean {
    return this.enabledIds().indexOf(id) !== -1;
  }

  /** Enabled lists, in the order of IPTV_LISTS */
  public enabledLists(): IptvList[] {
    const ids = this.enabledIds();
    return IPTV_LISTS.filter(l => ids.indexOf(l.id) !== -1);
  }

  public setEnabled(id: string, on: boolean): void {
    const ids = this.enabledIds().filter(x => x !== id);
    if (on) ids.push(id);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ enabled: ids }));
    } catch (e) {}
    this.listeners.forEach(cb => {
      try { cb(); } catch (e) {}
    });
  }

  public subscribe(cb: () => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter(l => l !== cb);
    };
  }

  /** Channels already in memory (instant category switch) */
  public peek(id: string): LiveChannel[] | undefined {
    return this.memory[id];
  }

  /** Saved copy only, never the network (fills favorites at start) */
  public async getSaved(id: string): Promise<LiveChannel[] | null> {
    if (this.memory[id]) return this.memory[id];
    const saved = await kvGet<SavedList>(CACHE_PREFIX + id);
    if (saved && Array.isArray(saved.channels) && saved.channels.length) {
      this.memory[id] = saved.channels;
      return saved.channels;
    }
    return null;
  }

  /** Channels of a list: memory, else the saved copy (refreshed in the background when old), else a download */
  public async getChannels(id: string): Promise<LiveChannel[]> {
    if (this.memory[id]) return this.memory[id];
    const saved = await kvGet<SavedList>(CACHE_PREFIX + id);
    if (saved && Array.isArray(saved.channels) && saved.channels.length) {
      this.memory[id] = saved.channels;
      if (Date.now() - saved.at > FRESH_MS) this.fetchList(id).catch(() => {});
      return saved.channels;
    }
    return this.fetchList(id);
  }

  private fetchList(id: string): Promise<LiveChannel[]> {
    if (this.inFlight[id]) return this.inFlight[id];
    const list = IPTV_LISTS.find(l => l.id === id);
    if (!list) return Promise.reject(new Error(`unknown list ${id}`));
    const t0 = Date.now();
    const p = download(list.url).then(text => {
      const channels = parseM3u(text);
      if (!channels.length) throw new Error('empty list');
      console.log(`[iptv] ${id}: ${channels.length} channels in ${Date.now() - t0} ms`);
      this.memory[id] = channels;
      kvSet(CACHE_PREFIX + id, { at: Date.now(), channels } as SavedList);
      return channels;
    });
    this.inFlight[id] = p;
    p.then(() => { delete this.inFlight[id]; }, () => { delete this.inFlight[id]; });
    return p;
  }
}

export const iptvService = new IptvService();
