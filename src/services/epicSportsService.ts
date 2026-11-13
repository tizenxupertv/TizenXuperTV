import { LiveChannel } from '../types/channel';
import { fetchWithTimeout } from '../lib/fetchTimeout';
import { placeExtraChannels } from '../lib/extraChannels';

const DOMAINS = ['https://playlatam.site', 'https://epictvparaiphone.top', 'https://epicplustv.com'];
const PULSERA_URL = 'https://playlatam.site/iphone/pulsera';
const CANALES_URL = 'https://playlatam.site/iphone/canales';
const LOGO_BASE = 'https://playlatam.site';

const STORAGE_KEY = 'xuper_epic_pulsera_v1';
const TOKEN_TTL_MS = 20 * 60 * 60 * 1000; // 20 hours

interface PulseraCache {
  token: string;
  timestamp: number;
}

export const STATIC_EPIC_CHANNELS: LiveChannel[] = [
  { id: 'epic-espn', code: 'epic-espn', name: 'ESPN', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/espn.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/ESPN_color.png?v=18' },
  { id: 'epic-espn2', code: 'epic-espn2', name: 'ESPN 2', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/espn2.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/ESPN_2_color.png?v=18' },
  { id: 'epic-espn3', code: 'epic-espn3', name: 'ESPN 3', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/espn3.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/ESPN_3_color.png?v=18' },
  { id: 'epic-espn4', code: 'epic-espn4', name: 'ESPN 4', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/espn4.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/ESPN_4_color.png?v=18' },
  { id: 'epic-espn5', code: 'epic-espn5', name: 'ESPN 5', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/espn5.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/ESPN_5_color.png?v=18' },
  { id: 'epic-espn6', code: 'epic-espn6', name: 'ESPN 6', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/espn6.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/ESPN_6_color.png?v=18' },
  { id: 'epic-espn7', code: 'epic-espn7', name: 'ESPN 7', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/espn7.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/ESPN_7_color.png?v=18' },
  { id: 'epic-dsports', code: 'epic-dsports', name: 'DSports', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/dsportsperu.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/dsports_color.png?v=18' },
  { id: 'epic-dsports2', code: 'epic-dsports2', name: 'DSports 2', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/dsports2.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/dsports_2_color.png?v=18' },
  { id: 'epic-winsportsplus', code: 'epic-winsportsplus', name: 'Win Sports+', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/winsportsplus.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/win_sports_plus_color.png?v=18' },
  { id: 'epic-l1max', code: 'epic-l1max', name: 'L1MAX', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/l1max.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/L1_max_color.png?v=18' },
  { id: 'epic-l1', code: 'epic-l1', name: 'L1', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/l1.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/l1_color.png?v=18' },
  { id: 'epic-zappingsports', code: 'epic-zappingsports', name: 'Zapping Sports', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/zappingsports.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/zapping_sports_color.png?v=18' },
  { id: 'epic-zappingsportsplus', code: 'epic-zappingsportsplus', name: 'Zapping Sports+', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/zappingsportsplus.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/zapping_sports_plus_color.png?v=18' },
  { id: 'epic-dtvcplus', code: 'epic-dtvcplus', name: 'Deportes TVC', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/dtvcplus.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/deportes_tvc_color.png?v=18' },
  { id: 'epic-bicolorpremium', code: 'epic-bicolorpremium', name: 'Bicolor+ Premium', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/bicolorpremium.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/Bicolor_plus_premium_color.png?v=18' },
  { id: 'epic-bicolorpremium2', code: 'epic-bicolorpremium2', name: 'Bicolor+ Premium 2', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/bicolorpremium2.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/Bicolor_plus_premium_2_color.png?v=18' },
  { id: 'epic-bicolorplus', code: 'epic-bicolorplus', name: 'Bicolor+', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/bicolorplus.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/Bicolor_plus_color.png?v=18' },
  { id: 'epic-entelgol', code: 'epic-entelgol', name: 'Entel Gol', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/entelgol.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/entel_gol_color.png?v=18' },
  { id: 'epic-entelgolplus', code: 'epic-entelgolplus', name: 'Entel Gol Plus', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/entelgolplus.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/entel_gol_plus_color_liviano.png?v=18' },
  { id: 'epic-futbolcanal', code: 'epic-futbolcanal', name: 'Fútbol Canal', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/futbolcanal.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/futbol_canal_color.png?v=18' },
  { id: 'epic-unitel', code: 'epic-unitel', name: 'Unitel La Paz', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/unitel.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/unitel_color.png?v=18' },
  { id: 'epic-unitelscz', code: 'epic-unitelscz', name: 'Unitel Santa Cruz', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/unitelscz.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/unitel_color.png?v=18' },
  { id: 'epic-reduno', code: 'epic-reduno', name: 'Red Uno', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/reduno.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/red_uno_color_liviano.png?v=18' },
  { id: 'epic-bolivision', code: 'epic-bolivision', name: 'Bolivisión', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/bolivision.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/bolivision_color.png?v=18' },
  { id: 'epic-atb', code: 'epic-atb', name: 'ATB', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/atb.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/atb_color.png?v=18' },
  { id: 'epic-boliviatv', code: 'epic-boliviatv', name: 'Bolivia TV', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'https://epictvparaiphone.top/perelman/boliviatv.m3u8', logo: 'https://epictvparaiphone.top/logos/canales/bolivia_tv_color.png?v=18' }
];

/**
 * Our own channels in the same category, added by hand. They are kept apart because the list above is only the
 * fallback: the list downloaded from the service replaces it, and these must stay whichever one is shown.
 * A direct address plays as it is (the service's permit is only sent to the service's own hosts).
 *
 * One line per channel, between the brackets. `id` and `code` are the same text, unique, and start with "extra-".
 */
export const EXTRA_CHANNELS: LiveChannel[] = [
  // { id: 'extra-nombre', code: 'extra-nombre', name: 'Nombre del canal', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'http://servidor/ruta/index.m3u8', logo: 'https://servidor/logo.png' },
  { id: 'extra-espnu', code: 'extra-espnu', name: 'ESPN U HD', categoryName: 'Beta · Deportes Latam', time: 'EN VIVO', url: 'http://85.237.89.160:9590/usa-s/ESPN-U-HD/index.m3u8', logo: 'http://schedulesdirect-api20141201-logos.s3.dualstack.us-east-1.amazonaws.com/stationLogos/s45654_dark_360w_270h.png' },
];

const DEFAULT_TOKEN = '14940f62.gente.1794265432.09cc2c3cae6f0ee370aa074bd28b68644471ce22fb58eb9866061b30ec6ae953';

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
      const res = await fetchWithTimeout(PULSERA_URL, {
        method: 'POST',
        headers: {
          'Accept': 'application/json, text/plain, */*'
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
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('localCatalogMock') === '1') {
      return this.getStaticChannels();
    }
    const now = Date.now();
    if (this.cachedChannels && (now - this.channelsCacheTime < 10 * 60 * 1000)) {
      return this.cachedChannels;
    }

    try {
      const token = await this.getPulseraToken();
      const res = await fetchWithTimeout(CANALES_URL, {
        headers: {
          'X-Pulsera': token,
          'Accept': 'application/json'
        }
      });
      if (!res.ok) {
        throw new Error('HTTP ' + res.status);
      }
      const json = await res.json();
      const rawList = json && Array.isArray(json.canales) ? json.canales : [];

      if (rawList.length > 0) {
        const mapped: LiveChannel[] = rawList.map((c: any) => {
          const rawId = String(c.id || '').replace(/^pere-/, '');
          const logoUrl = c.logo && c.logo.startsWith('http') ? c.logo : `${LOGO_BASE}${c.logo || ''}`;

          // Use the URL from the API directly (may be playlatam.site or epictvparaiphone.top)
          // and ensure it ends in .m3u8
          let streamUrl: string;
          if (c.url && c.url.startsWith('http')) {
            streamUrl = c.url.endsWith('.m3u8') ? c.url : `${c.url}.m3u8`;
          } else {
            const rawPath = c.url ? c.url.substring(c.url.lastIndexOf('/') + 1) : rawId;
            streamUrl = `https://epictvparaiphone.top/perelman/${rawPath}.m3u8`;
          }

          return {
            id: `epic-${rawId}`,
            code: `epic-${rawId}`,
            name: c.nombre || rawId,
            categoryName: 'Beta · Deportes Latam',
            time: 'EN VIVO',
            url: streamUrl,
            logo: logoUrl
          };
        });

        this.cachedChannels = placeExtraChannels(mapped, EXTRA_CHANNELS);
        this.channelsCacheTime = now;
        return this.cachedChannels;
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
