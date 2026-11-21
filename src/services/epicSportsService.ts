import { LiveChannel } from '../types/channel';
import { fetchWithTimeout } from '../lib/fetchTimeout';
import { placeExtraChannels } from '../lib/extraChannels';

const DOMAINS = ['https://epictvparaiphone.top', 'https://playlatam.site', 'https://epicplustv.com'];
// Browser development goes through the Vite proxy: the source does not allow cross-origin requests
const isBrowser = typeof window !== 'undefined' && (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  (typeof (window as any).tizen === 'undefined' && typeof (window as any).webOS === 'undefined')
);
const APARATO_STORAGE_KEY = 'xuper_epic_aparato_id';
function getOrCreateAparatoId(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(APARATO_STORAGE_KEY);
      if (saved && /^[0-9a-f]{8}$/i.test(saved)) return saved.toLowerCase();
    }
  } catch (_) {}
  let hex = '';
  for (let i = 0; i < 8; i++) hex += Math.floor(Math.random() * 16).toString(16);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(APARATO_STORAGE_KEY, hex);
  } catch (_) {}
  return hex || 'a1b2c3d4';
}

export const EPIC_API_BASE = isBrowser ? '/epic-api' : 'https://epictvparaiphone.top';
export const EPIC_LLAVE = '7hA4oMy1vmGSFJjbrAWx-xneFQEY_PAq';
export const EPIC_APARATO = getOrCreateAparatoId();
export const EPIC_AUTH_HEADERS: Record<string, string> = {
  'X-Llave': EPIC_LLAVE,
  'X-Aparato': EPIC_APARATO,
  'X-Pulsera': '1'
};
const PULSERA_URL = `${EPIC_API_BASE}/iphone/pulsera`;
const CANALES_URL = `${EPIC_API_BASE}/canales`;
const STATIC_EPIC_SNAPSHOT_URL = 'https://tizenxuper-tv.pages.dev/data/epic-channels.json';
const LOGO_BASE = 'https://epictvparaiphone.top';

const STORAGE_KEY = 'xuper_epic_pulsera_v2';
const TOKEN_TTL_MS = 20 * 60 * 60 * 1000; // 20 hours

interface PulseraCache {
  token: string;
  timestamp: number;
}

export const STATIC_EPIC_CHANNELS: LiveChannel[] = [
  { id: 'epic-winsports', code: 'epic-winsports', name: 'Win Sports', categoryName: 'Colombia', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/winsports.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/win_sports_color.png?v=18' },
  { id: 'epic-winsportsplus', code: 'epic-winsportsplus', name: 'Win Sports+', categoryName: 'Colombia', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/winsportsplus.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/win_sports_plus_color.png?v=18' },
  { id: 'epic-espn', code: 'epic-espn', name: 'ESPN', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/espn.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/ESPN_color.png?v=18' },
  { id: 'epic-espn2', code: 'epic-espn2', name: 'ESPN 2', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/espn2.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/ESPN_2_color.png?v=18' },
  { id: 'epic-espn3', code: 'epic-espn3', name: 'ESPN 3', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/espn3.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/ESPN_3_color.png?v=18' },
  { id: 'epic-espn4', code: 'epic-espn4', name: 'ESPN 4', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/espn4.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/ESPN_4_color.png?v=18' },
  { id: 'epic-espn5', code: 'epic-espn5', name: 'ESPN 5', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/espn5.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/ESPN_5_color.png?v=18' },
  { id: 'epic-espn6', code: 'epic-espn6', name: 'ESPN 6', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/espn6.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/ESPN_6_color.png?v=18' },
  { id: 'epic-espn7', code: 'epic-espn7', name: 'ESPN 7', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/espn7.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/ESPN_7_color.png?v=18' },
  { id: 'epic-dsports', code: 'epic-dsports', name: 'DSports', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/dsportsperu.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/dsports_color.png?v=18' },
  { id: 'epic-dsports2', code: 'epic-dsports2', name: 'DSports 2', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/dsports2.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/dsports_2_color.png?v=18' },
  { id: 'epic-l1max', code: 'epic-l1max', name: 'L1MAX', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/l1max.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/L1_max_color.png?v=18' },
  { id: 'epic-l1', code: 'epic-l1', name: 'L1', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/l1.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/l1_color.png?v=18' },
  { id: 'epic-zappingsports', code: 'epic-zappingsports', name: 'Zapping Sports', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/zappingsports.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/zapping_sports_color.png?v=18' },
  { id: 'epic-zappingsportsplus', code: 'epic-zappingsportsplus', name: 'Zapping Sports+', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/zappingsportsplus.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/zapping_sports_plus_color.png?v=18' },
  { id: 'epic-dtvcplus', code: 'epic-dtvcplus', name: 'Deportes TVC', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/dtvcplus.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/deportes_tvc_color.png?v=18' },
  { id: 'epic-bicolorpremium', code: 'epic-bicolorpremium', name: 'Bicolor+ Premium', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/bicolorpremium.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/Bicolor_plus_premium_color.png?v=18' },
  { id: 'epic-bicolorpremium2', code: 'epic-bicolorpremium2', name: 'Bicolor+ Premium 2', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/bicolorpremium2.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/Bicolor_plus_premium_2_color.png?v=18' },
  { id: 'epic-bicolorplus', code: 'epic-bicolorplus', name: 'Bicolor+', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/bicolorplus.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/Bicolor_plus_color.png?v=18' },
  { id: 'epic-entelgol', code: 'epic-entelgol', name: 'Entel Gol', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/entelgol.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/entel_gol_color.png?v=18' },
  { id: 'epic-entelgolplus', code: 'epic-entelgolplus', name: 'Entel Gol Plus', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/entelgolplus.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/entel_gol_plus_color_liviano.png?v=18' },
  { id: 'epic-futbolcanal', code: 'epic-futbolcanal', name: 'Fútbol Canal', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/futbolcanal.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/futbol_canal_color.png?v=18' },
  { id: 'epic-unitel', code: 'epic-unitel', name: 'Unitel La Paz', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/unitel.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/unitel_color.png?v=18' },
  { id: 'epic-unitelscz', code: 'epic-unitelscz', name: 'Unitel Santa Cruz', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/unitelscz.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/unitel_color.png?v=18' },
  { id: 'epic-reduno', code: 'epic-reduno', name: 'Red Uno', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/reduno.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/red_uno_color_liviano.png?v=18' },
  { id: 'epic-bolivision', code: 'epic-bolivision', name: 'Bolivisión', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/bolivision.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/bolivision_color.png?v=18' },
  { id: 'epic-atb', code: 'epic-atb', name: 'ATB', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/atb.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/atb_color.png?v=18' },
  { id: 'epic-boliviatv', code: 'epic-boliviatv', name: 'Bolivia TV', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/boliviatv.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/bolivia_tv_color.png?v=18' }
];

/**
 * Our own channels in the same category, added by hand. They are kept apart because the list above is only the
 * fallback: the list downloaded from the service replaces it, and these must stay whichever one is shown.
 * A direct address plays as it is (the service's permit is only sent to the service's own hosts).
 *
 * One line per channel, between the brackets. `id` and `code` are the same text, unique, and start with "extra-".
 */
export const EXTRA_CHANNELS: LiveChannel[] = [
  // { id: 'extra-nombre', code: 'extra-nombre', name: 'Nombre del canal', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'http://servidor/ruta/index.m3u8', logo: 'https://servidor/logo.png' },
  { id: 'extra-espn-ocho', code: 'extra-espn-ocho', name: 'ESPN The Ocho', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'https://d3b6q2ou5kp8ke.cloudfront.net/ESPNTheOcho.m3u8', logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-states/espn-us.png' },
  { id: 'extra-espn-mx', code: 'extra-espn-mx', name: 'ESPN México', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'http://168.228.44.241:9997/play/a06p/index.m3u8', logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-states/espn-us.png' },
  { id: 'extra-espn-usa', code: 'extra-espn-usa', name: 'ESPN USA HD', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'http://85.237.89.160:9590/usa-s/ESPN-HD/index.m3u8', logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-states/espn-us.png' },
  { id: 'extra-espn2-usa', code: 'extra-espn2-usa', name: 'ESPN 2 USA HD', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'http://85.237.89.160:9590/usa-s/ESPN-2-HD/index.m3u8', logo: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-states/espn-2-us.png' },
  { id: 'extra-espnu', code: 'extra-espnu', name: 'ESPN U HD', categoryName: 'Latinoamérica', time: 'EN VIVO', url: 'http://85.237.89.160:9590/usa-s/ESPN-U-HD/index.m3u8', logo: 'http://schedulesdirect-api20141201-logos.s3.dualstack.us-east-1.amazonaws.com/stationLogos/s45654_dark_360w_270h.png' },
];

const DEFAULT_TOKEN = '9d7f743c.gente.1794262627.6c0ed20caa00f079c6628210b1cc8de81e503acf58ab77bc8bcfb536836b75f3';

class EpicSportsService {
  private inMemoryToken: string = DEFAULT_TOKEN;
  private tokenExpiresAt: number = Date.now() + TOKEN_TTL_MS;
  private cachedChannels: LiveChannel[] | null = null;
  private channelsCacheTime: number = 0;
  private pendingTokenPromise: Promise<string> | null = null;

  public async getPulseraToken(): Promise<string> {
    const now = Date.now();
    if (this.inMemoryToken && this.tokenExpiresAt > now) {
      return this.inMemoryToken;
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: PulseraCache = JSON.parse(raw);
        if (parsed.token && parsed.token.includes('.gente.') && parsed.timestamp && (now - parsed.timestamp < TOKEN_TTL_MS)) {
          this.inMemoryToken = parsed.token;
          this.tokenExpiresAt = parsed.timestamp + TOKEN_TTL_MS;
          return this.inMemoryToken;
        }
      }
    } catch (_) {}

    return DEFAULT_TOKEN;
  }

  private async fetchNewToken(): Promise<string> {
    try {
      // On TV (Tizen) the request goes directly to epictvparaiphone.top — must
      // simulate an iPhone browser or the server returns 403.
      const extraHeaders: Record<string, string> = isBrowser ? {} : {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
        'Referer': 'https://epictvparaiphone.top/iphone/',
        'Origin': 'https://epictvparaiphone.top',
        'X-Requested-With': 'XMLHttpRequest',
      };
      const res = await fetchWithTimeout(PULSERA_URL, {
        method: 'POST',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          ...extraHeaders,
        }
      });
      if (!res.ok) {
        throw new Error('HTTP ' + res.status);
      }
      const data = await res.json();
      let token = '';
      if (data && data.token) {
        token = data.token;
      } else if (data && data.numero) {
        token = data.numero;
      }

      if (!token) {
        token = '14940f62.gente.1794265432.09cc2c3cae6f0ee370aa074bd28b68644471ce22fb58eb9866061b30ec6ae953';
      }

      this.inMemoryToken = token;
      this.tokenExpiresAt = Date.now() + TOKEN_TTL_MS;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          token: this.inMemoryToken,
          timestamp: Date.now()
        }));
      } catch (_) {}

      return this.inMemoryToken;
    } catch (err) {
      console.warn('[EpicSportsService] Error fetching pulsera:', err);
      if (this.inMemoryToken) return this.inMemoryToken;
      return '14940f62.gente.1794265432.09cc2c3cae6f0ee370aa074bd28b68644471ce22fb58eb9866061b30ec6ae953';
    }
  }

  public getStaticChannels(): LiveChannel[] {
    return this.cachedChannels || placeExtraChannels(STATIC_EPIC_CHANNELS, EXTRA_CHANNELS);
  }

  public async getChannels(): Promise<LiveChannel[]> {
    // Browser-only catalog fixture: never contact the live-channel source while the local
    // catalog contract is being exercised.
    if (import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('localCatalogMock') === '1') {
      return this.getStaticChannels();
    }
    const now = Date.now();
    if (this.cachedChannels && (now - this.channelsCacheTime < 10 * 60 * 1000)) {
      return this.cachedChannels;
    }

    // 1. Try auto-updated static snapshot on Cloudflare Pages first (instant CDN, zero load on Epic+)
    try {
      const snapRes = await fetchWithTimeout(STATIC_EPIC_SNAPSHOT_URL, { cache: 'no-cache' }, 5000);
      if (snapRes.ok) {
        const snap = await snapRes.json();
        if (snap && Array.isArray(snap.channels) && snap.channels.length > 0) {
          const regionOrder = (r: string) => (r === 'Colombia' ? '0' : r === 'Latinoamérica' ? '1' : '2' + r.toLowerCase());
          const latamOrder = (n: string) => {
            const l = n.toLowerCase();
            return l.startsWith('espn') ? '0' + l : l.startsWith('dsports') ? '1' + l : '2' + l;
          };
          const withExtras = placeExtraChannels(snap.channels as LiveChannel[], EXTRA_CHANNELS);
          withExtras.sort((a, b) => {
            const rA = a.categoryName || 'Latinoamérica';
            const rB = b.categoryName || 'Latinoamérica';
            const ra = regionOrder(rA);
            const rb = regionOrder(rB);
            if (ra !== rb) return ra.localeCompare(rb, 'es');
            if (rA === 'Latinoamérica') return latamOrder(a.name).localeCompare(latamOrder(b.name), 'es');
            return a.name.localeCompare(b.name, 'es');
          });
          this.cachedChannels = withExtras;
          this.channelsCacheTime = now;
          return this.cachedChannels;
        }
      }
    } catch (_) {}

    try {
      const res = await fetchWithTimeout(CANALES_URL, {
        headers: {
          ...EPIC_AUTH_HEADERS,
          'Accept': 'application/json'
        }
      });
      if (!res.ok) {
        throw new Error('HTTP ' + res.status);
      }
      const json = await res.json();
      const rawList = Array.isArray(json)
        ? json
        : (json && Array.isArray(json.canales) ? json.canales : []);

      if (rawList.length > 0) {
        const staticLogoById = new Map<string, string>();
        for (const sc of STATIC_EPIC_CHANNELS) {
          if (sc.logo) staticLogoById.set(String(sc.id), sc.logo);
        }
        // Fallback logos for Perelman IDs whose slug differs from STATIC_EPIC_CHANNELS
        const extraLogos: Record<string, string> = {
          'epic-dsportsperu': `${LOGO_BASE}/logos/canales/dsports_color.png?v=18`,
          'epic-dsportsplus': `${LOGO_BASE}/logos/canales/dsports_plus_color.png?v=18`,
          'epic-winsports': `${LOGO_BASE}/logos/canales/win_sports_color.png?v=18`,
          'epic-teleamazonas': `${LOGO_BASE}/logos/canales/teleamazonas_color.png?v=18`,
          'epic-antena3': `${LOGO_BASE}/logos/canales/antena_3_color.png?v=18`,
          'epic-cuatro': `${LOGO_BASE}/logos/canales/cuatro_color.png?v=18`,
          'epic-americatv': `${LOGO_BASE}/logos/canales/america_tv_color.png?v=18`,
          'epic-lasexta': `${LOGO_BASE}/logos/canales/lasexta_color.png?v=18`,
          'epic-telecinco': `${LOGO_BASE}/logos/canales/telecinco_color.png?v=18`
        };
        for (const [k, v] of Object.entries(extraLogos)) {
          if (!staticLogoById.has(k)) staticLogoById.set(k, v);
        }

        const normalizeEpicRegion = (c: any): string => {
          const folder = String(c.pais || c.folder || '').trim();
          if (!folder || folder.includes(',') || folder.toLowerCase() === 'otros') {
            return 'Latinoamérica';
          }
          return folder;
        };

        // Match Epic+ PWA Canales tab: stable Perelman channels, grouped by region
        // (Latinoamérica first, then Colombia, then remaining countries alphabetically)
        const playable = rawList.filter((c: any) =>
          c && (c.fuente === 'perelman' || String(c.id || '').startsWith('pere-') || String(c.url || '').includes('/perelman/')) && typeof c.url === 'string'
        );

        const regionOrder = (r: string) => {
          if (r === 'Colombia') return '0';
          if (r === 'Latinoamérica') return '1';
          return '2' + r.toLowerCase();
        };
        const latamChannelOrder = (name: string): string => {
          const low = name.toLowerCase();
          if (low.startsWith('espn')) return '0' + low;
          if (low.startsWith('dsports')) return '1' + low;
          return '2' + low;
        };
        playable.sort((a: any, b: any) => {
          const rA = normalizeEpicRegion(a);
          const rB = normalizeEpicRegion(b);
          const ra = regionOrder(rA);
          const rb = regionOrder(rB);
          if (ra !== rb) return ra.localeCompare(rb, 'es');
          const na = String(a.name || a.nombre || '');
          const nb = String(b.name || b.nombre || '');
          if (rA === 'Latinoamérica') return latamChannelOrder(na).localeCompare(latamChannelOrder(nb), 'es');
          return na.localeCompare(nb, 'es');
        });

        const seen = new Set<string>();
        const mapped: LiveChannel[] = [];
        for (const c of playable) {
          const rawId = String(c.id || '').replace(/^pere-/, '');
          const id = `epic-${rawId}`;
          if (!rawId || seen.has(id)) continue;
          seen.add(id);

          let streamUrl: string;
          if (c.url && c.url.startsWith('http')) {
            streamUrl = !c.url.endsWith('.m3u8') ? `${c.url}.m3u8` : c.url;
          } else {
            const rawPath = c.url ? c.url.substring(c.url.lastIndexOf('/') + 1) : rawId;
            streamUrl = `https://epictvparaiphone.top/perelman/${rawPath}.m3u8`;
          }

          const logoUrl = c.logo
            ? (c.logo.startsWith('http') ? c.logo : `${LOGO_BASE}${c.logo}`)
            : (staticLogoById.get(id) || '');

          const rawName = String(c.name || c.nombre || rawId).replace(/\s*·\s*[^·]+$/, '').trim();
          const nameOverrides: Record<string, string> = {
            'epic-espn': 'ESPN',
            'epic-dsportsperu': 'DSports',
            'epic-dsports2': 'DSports 2',
            'epic-dsportsplus': 'DSports+'
          };
          const displayName = nameOverrides[id] || rawName;

          mapped.push({
            id,
            code: id,
            name: displayName,
            categoryName: normalizeEpicRegion(c),
            time: 'EN VIVO',
            url: streamUrl,
            logo: logoUrl
          });
        }

        if (mapped.length > 0) {
          const withExtras = placeExtraChannels(mapped, EXTRA_CHANNELS);
          withExtras.sort((a, b) => {
            const rA = a.categoryName || 'Latinoamérica';
            const rB = b.categoryName || 'Latinoamérica';
            const ra = regionOrder(rA);
            const rb = regionOrder(rB);
            if (ra !== rb) return ra.localeCompare(rb, 'es');
            if (rA === 'Latinoamérica') return latamChannelOrder(a.name).localeCompare(latamChannelOrder(b.name), 'es');
            return a.name.localeCompare(b.name, 'es');
          });
          this.cachedChannels = withExtras;
          this.channelsCacheTime = now;
          return this.cachedChannels;
        }
      }
    } catch (err) {
      console.warn('[EpicSportsService] Falling back to static channels list:', err);
    }

    this.cachedChannels = placeExtraChannels(STATIC_EPIC_CHANNELS, EXTRA_CHANNELS);
    this.channelsCacheTime = now;
    return this.cachedChannels;
  }
}

export const epicSportsService = new EpicSportsService();
