import type { VodItem, VodSeason } from '../types/vod';

/** Strips accents, lowercases, and removes non-alphanumeric chars for robust matching */
export function normalizeCatalogText(value: string | undefined | null): string {
  let s = String(value || '').toLowerCase();
  if (s.normalize) {
    s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  return s.replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Identifies adult/18+/XXX labels and tags */
export function isAdultLabel(value: string | undefined | null): boolean {
  const label = normalizeCatalogText(value);
  if (!label) return false;
  return (
    /(^| )(adult|adulto|adultos|adulta|adultas|xxx|porn|porno|pornografia|erotic|erotico|erotica|eroticos|eroticas|hentai|only adults|18 plus|r18)( |$)/.test(label) ||
    /(^| )18( |$)/.test(label)
  );
}

/** Detects if a VOD item contains adult/restricted content */
export function isAdultItem(item: VodItem | undefined | null): boolean {
  if (!item) return false;
  const raw = item as any;
  if (
    raw.restricted === true ||
    raw.restricted === '1' ||
    raw.privateContent === true ||
    raw.isAdult === true ||
    String(raw.columnId || '') === '76300'
  ) {
    return true;
  }

  const rating = normalizeCatalogText(raw.contentRating || raw.ageRating || raw.classification || item.score || '');
  if (/(^| )(18|18 plus|r18|nc 17)( |$)/.test(rating)) return true;

  const labels = [item.category, item.row, item.kind, ...(item.genres || [])];
  for (const label of labels) {
    if (isAdultLabel(label)) return true;
  }

  const title = normalizeCatalogText(item.title);
  return /(^| )(xxx|porn|porno|pornografia|erotic|erotico|erotica|hentai|onlyfans)( |$)/.test(title);
}

/** Extracts base title and season number from title strings like "The Boys Temporada 2" */
export function parseSeason(value: string | undefined | null): { title: string; number: number | null } {
  const name = String(value || '').trim();
  const match = /^(.*?)(?:\s*[-–:|]?\s*(?:temporada|temp\.?|season|[st])\s*0*(\d{1,3}))\s*$/i.exec(name);
  if (match && match[1]) {
    const num = parseInt(match[2], 10);
    return { title: match[1].trim(), number: isNaN(num) ? null : num };
  }
  return { title: name, number: null };
}

/** Merges seasons lists avoiding duplicate season numbers */
export function mergeSeasons(a?: VodSeason[], b?: VodSeason[]): VodSeason[] {
  const result: VodSeason[] = [];
  const ids = new Set<string>();
  const numbers = new Set<number>();

  const all = [...(a || []), ...(b || [])];
  for (const s of all) {
    if (!s || !s.id || ids.has(String(s.id))) continue;
    const num = Number(s.number) || 0;
    if (num && numbers.has(num)) continue;
    ids.add(String(s.id));
    if (num) numbers.add(num);
    result.push(s);
  }

  return result.sort((x, y) => (Number(x.number) || 0) - (Number(y.number) || 0));
}

/** Checks if an item is a series or episodic show */
export function isSeriesItem(item: VodItem): boolean {
  if (item.isSeries) return true;
  const kind = String(item.kind || '').toLowerCase();
  const cat = String(item.category || '').toLowerCase();
  const row = String(item.row || '').toLowerCase();
  return (
    kind.includes('serie') ||
    kind.includes('teleplay') ||
    cat.includes('serie') ||
    row.includes('serie') ||
    row.includes('telenovela') ||
    row.includes('drama') ||
    (Array.isArray(item.seasons) && item.seasons.length > 0) ||
    (Array.isArray(item.episodes) && item.episodes.length > 0)
  );
}

/** Popular Anime franchises that should always route to Anime section */
export function isAnimeFamily(item: VodItem): boolean {
  const genres = normalizeCatalogText((item.genres || []).join(' '));
  const isAnimated = /(^|[^a-z])(animation|animacion|cartoon|anime)([^a-z]|$)/.test(genres);
  const title = normalizeCatalogText(item.title);
  const isFranchise = /^(pokemon|poketto|dragon ball|naruto|boruto|one piece|detective conan|black clover|doraemon|digimon|sailor moon|saint seiya|caballeros del zodiaco|evangelion|shingeki|attack on titan|gintama|jojo|steel ball run|bleach|jujutsu|demon slayer|kimetsu|chainsaw man|my hero academia|boku no hero|death note|fullmetal|hunter x hunter)(\b|:)/.test(title);
  return isFranchise || (isAnimated && (title.includes('anime') || genres.includes('anime')));
}

/** Adult animated series that must NOT be shown in Kids */
export function isMatureAnimation(item: VodItem): boolean {
  const title = normalizeCatalogText(item.title);
  return /^(rick.*morty|castlevania|invincible|invencible|sociedade da virtude|south park|family guy|padre de familia|american dad|bojack horseman|big mouth|hazbin hotel|helluva boss|sausage party|fiesta de las salchichas|archer|harley quinn|robot chicken|primal|love death robots|solar opposites|f is for family)/.test(title);
}

/** Section classifier: organizes titles into matching UI tabs */
export function belongsToSection(item: VodItem, section: 'movies' | 'series' | 'kids' | 'anime' | 'featured'): boolean {
  if (isAdultItem(item)) return false;

  const anime = isAnimeFamily(item);
  const series = isSeriesItem(item);

  if (section === 'anime') {
    return anime;
  }
  if (section === 'series') {
    return series && !anime;
  }
  if (section === 'movies') {
    return !series && !anime;
  }
  if (section === 'kids') {
    if (anime || isMatureAnimation(item)) return false;
    const cat = (item.category || '').toLowerCase();
    const row = (item.row || '').toLowerCase();
    const genres = (item.genres || []).map(g => g.toLowerCase());
    const isFamilyGenre = genres.some(g => ['family', 'familiar', 'familia', 'kids', 'children', 'infantil', 'animacion', 'animation'].includes(g));
    const isFamilyTitle = /^(monsters inc|monstruos s a|toy story|cars|mickey|minnie|peppa pig|paw patrol|patrulla canina|bluey|cocomelon|disney|pixar|shrek|kung fu panda|madagascar|frozen|encanto|coco|moana|vaiana|intensamente|inside out|minions|mi villano favorito|despicable me)(\b|:)/i.test(normalizeCatalogText(item.title));
    return isFamilyTitle || cat.includes('infantil') || cat.includes('kids') || row.includes('kids') || (isFamilyGenre && !isMatureAnimation(item));
  }
  if (section === 'featured') {
    const cat = (item.category || '').toLowerCase();
    const kind = (item.kind || '').toLowerCase();
    const row = (item.row || '').toLowerCase();
    return (
      cat.includes('destacado') ||
      kind.includes('destacado') ||
      row.includes('top15') ||
      row.includes('2026') ||
      row.includes('premio') ||
      row.includes('se acerca') ||
      row.includes('colección') ||
      (parseFloat(item.score || '0') >= 8.0)
    );
  }
  return true;
}

/**
 * Series Collector: Groups distinct seasons ("Show Season 1", "Show Season 2")
 * into a single unified Series entry with clean title and multiple seasons.
 */
export class SeriesCollector {
  private byKey = new Map<string, VodItem>();
  private byId = new Map<string, VodItem>();

  public add(item: VodItem): { item: VodItem; isFresh: boolean } {
    if (!item) return { item, isFresh: false };
    const id = String(item.id);
    let existing = this.byId.get(id);

    const isSeries = isSeriesItem(item);
    const parsed = parseSeason(item.title);
    const baseTitle = isSeries ? parsed.title : item.title;
    const seasonNumber = parsed.number || 1;

    const groupKey = isSeries ? `series:${normalizeCatalogText(baseTitle)}` : `movie:${normalizeCatalogText(baseTitle)}:${(item.year || '').slice(0, 4)}`;

    if (!existing) {
      existing = this.byKey.get(groupKey);
    }

    if (isSeries) {
      const seasonEntry: VodSeason = {
        id: item.id,
        name: parsed.number ? `Temporada ${parsed.number}` : 'Temporada 1',
        number: seasonNumber,
        episodes: item.episodes || []
      };

      if (existing) {
        // Merge into existing series entry
        existing.seasons = mergeSeasons(existing.seasons, [seasonEntry]);
        if (!existing.synopsis || existing.synopsis.length < 20) {
          existing.synopsis = item.synopsis;
        }
        if (!existing.backdrop && item.backdrop) {
          existing.backdrop = item.backdrop;
        }
        this.byId.set(id, existing);
        return { item: existing, isFresh: false };
      }

      // First season of series seen
      const unifiedItem: VodItem = {
        ...item,
        title: baseTitle,
        isSeries: true,
        kind: 'serie',
        seasons: [seasonEntry]
      };
      this.byId.set(id, unifiedItem);
      this.byKey.set(groupKey, unifiedItem);
      return { item: unifiedItem, isFresh: true };
    }

    // Movie / standalone item
    if (existing) {
      return { item: existing, isFresh: false };
    }
    this.byId.set(id, item);
    this.byKey.set(groupKey, item);
    return { item, isFresh: true };
  }

  public getAll(): VodItem[] {
    return Array.from(new Set(this.byKey.values()));
  }
}

/** Processes and cleans a raw list of items: groups series seasons and filters adult content */
export function organizeCatalogItems(rawItems: VodItem[]): VodItem[] {
  const collector = new SeriesCollector();
  const result: VodItem[] = [];

  for (const item of rawItems) {
    if (!item || isAdultItem(item)) continue;
    const { item: grouped, isFresh } = collector.add(item);
    if (isFresh) {
      result.push(grouped);
    }
  }

  return result;
}
