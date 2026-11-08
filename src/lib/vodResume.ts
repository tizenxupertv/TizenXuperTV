import type { VodItem, VodEpisode } from '../types/vod';
import type { HistoryItem } from '../types/history';

export interface ResumeTarget {
  episode?: VodEpisode;
  startAt: number;
  label: string;
  remainingText?: string;
  progressPercent?: number;
}

/** A title counts as watched once 90% of it has been played (unknown duration: never) */
export function isFinished(position: number, duration: number): boolean {
  return duration > 0 && position / duration >= 0.9;
}

/** History entries for "Seguir viendo": what was played last and is not finished yet */
export function continueWatchingItems(history: HistoryItem[]): HistoryItem[] {
  return history.filter(h => !isFinished(h.position, h.duration));
}

function episodeNumber(ep: VodEpisode, index: number): number {
  return parseInt(String(ep.number ?? ep.seriesNumber ?? ''), 10) || index + 1;
}

function episodeLabel(ep: VodEpisode, index: number, seasonNumber?: number): string {
  const e = `E${episodeNumber(ep, index)}`;
  return seasonNumber ? `T${seasonNumber}:${e}` : e;
}

/**
 * Formats duration into standard streaming format "X h Y min" or "Y min" (e.g. Netflix, Disney+, Apple TV+).
 * Handles:
 *  - "02:18:00" / "01:45:30" (HH:MM:SS) -> "2 h 18 min"
 *  - 8280 / "8280" (seconds > 600) -> "2 h 18 min"
 *  - 138 / "138" / "138 min" (minutes <= 600) -> "2 h 18 min"
 *  - 45 / "45 min" -> "45 min"
 *  - "2 h" / "120 min" -> "2 h"
 */
export function formatDuration(raw: any): string {
  if (!raw) return '';
  const s = String(raw).trim();
  if (!s || s === '—') return '';

  if (/^\d+\s*h(?:\s*\d+\s*min)?$/i.test(s)) return s;

  let totalMinutes = 0;
  if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(s)) {
    const parts = s.split(':').map(n => parseInt(n, 10));
    if (parts.length === 3) {
      totalMinutes = parts[0] * 60 + parts[1] + Math.round(parts[2] / 60);
    } else if (parts.length === 2) {
      totalMinutes = parts[0] * 60 + parts[1];
    }
  } else {
    const m = s.match(/^(\d+(?:\.\d+)?)/);
    if (!m) return s;
    const num = Math.round(parseFloat(m[1]));
    if (s.toLowerCase().includes('min')) {
      totalMinutes = num;
    } else if (num > 600) {
      totalMinutes = Math.round(num / 60);
    } else {
      totalMinutes = num;
    }
  }

  if (totalMinutes <= 0) return '';
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours > 0 && mins > 0) return `${hours} h ${mins} min`;
  if (hours > 0) return `${hours} h`;
  return `${mins} min`;
}

/**
 * Formats remaining playback time: e.g. "Quedan 2 h 18 min" or "Quedan 42 min"
 */
export function formatRemaining(position: number, duration: number): string {
  if (!(duration > 0) || position <= 0) return '';
  const remainingSec = Math.max(0, duration - position);
  const remainingMin = Math.round(remainingSec / 60);
  if (remainingMin <= 0) return '';
  const hours = Math.floor(remainingMin / 60);
  const mins = remainingMin % 60;
  if (hours > 0 && mins > 0) {
    return `Quedan ${hours} h ${mins} min`;
  } else if (hours > 0) {
    return `Quedan ${hours} h`;
  }
  return `Quedan ${mins} min`;
}

/**
 * What the primary "Reproducir / Continuar" button plays for a title:
 *  - unfinished history entry  -> resume it
 *  - finished episode with a next one in the same season -> next episode from 0
 *  - otherwise -> start (first episode for series)
 */
export function getResumeTarget(
  item: VodItem,
  episodes: VodEpisode[],
  entry?: HistoryItem,
  seasonNumber?: number,
  seasonId?: string
): ResumeTarget {
  const isSeries = Boolean(
    item.isSeries ||
    item.kind === 'serie' ||
    (item.kind !== 'película' && item.kind !== 'pelicula' && episodes.length > 0)
  );

  if (entry && String(entry.id) === String(item.id)) {
    const seasonMatches = (entry.seasonNumber === undefined || seasonNumber === undefined) ||
                          (parseInt(String(entry.seasonNumber), 10) === parseInt(String(seasonNumber), 10));

    if (episodes.length > 0 && seasonMatches) {
      let idx = entry.episodeId ? episodes.findIndex(ep => String(ep.id) === String(entry.episodeId)) : -1;
      // Number matching fallback
      if (idx === -1 && entry.episodeNumber !== undefined) {
        idx = episodes.findIndex((ep, i) => episodeNumber(ep, i) === parseInt(String(entry.episodeNumber), 10));
      }
      if (idx !== -1) {
        if (!isFinished(entry.position, entry.duration)) {
          const progressPercent = entry.duration > 0 ? Math.min(100, Math.max(0, Math.round((entry.position / entry.duration) * 100))) : undefined;
          return {
            episode: episodes[idx],
            startAt: Math.max(0, entry.position),
            label: `Continuar ${episodeLabel(episodes[idx], idx, seasonNumber)}`,
            remainingText: formatRemaining(entry.position, entry.duration),
            progressPercent
          };
        }
        if (idx + 1 < episodes.length) {
          return {
            episode: episodes[idx + 1],
            startAt: 0,
            label: `Reproducir ${episodeLabel(episodes[idx + 1], idx + 1, seasonNumber)}`
          };
        }
      }
    } else if (!isSeries && !isFinished(entry.position, entry.duration) && entry.position > 0) {
      const progressPercent = entry.duration > 0 ? Math.min(100, Math.max(0, Math.round((entry.position / entry.duration) * 100))) : undefined;
      return {
        startAt: Math.max(0, entry.position),
        label: 'Continuar película',
        remainingText: formatRemaining(entry.position, entry.duration),
        progressPercent
      };
    }
  }

  if (episodes.length > 0) {
    return { episode: episodes[0], startAt: 0, label: `Reproducir ${episodeLabel(episodes[0], 0, seasonNumber)}` };
  }
  return { startAt: 0, label: isSeries ? 'Reproducir' : 'Reproducir película' };
}

/** Start position for a specific episode chosen from the list */
export function startAtForEpisode(ep: VodEpisode, entry?: HistoryItem): number {
  if (!entry) return 0;
  const epId = ep.id ? String(ep.id) : '';
  const epNum = ep.number ?? ep.seriesNumber;

  // Check explicit record in watchedEpisodes
  const record = (epId && entry.watchedEpisodes?.[epId]) ||
                 (epNum !== undefined && entry.watchedEpisodes?.[`num_${epNum}`]);
  if (record) {
    if (record.finished || isFinished(record.position, record.duration)) return 0;
    return Math.max(0, record.position);
  }

  if (isFinished(entry.position, entry.duration)) return 0;
  const matchId = !!(entry.episodeId && String(entry.episodeId) === epId);
  const matchNum = entry.episodeNumber !== undefined && epNum !== undefined &&
    parseInt(String(entry.episodeNumber), 10) === parseInt(String(epNum), 10);
  if (matchId || matchNum) {
    return Math.max(0, entry.position);
  }
  return 0;
}

export interface EpisodeStatus {
  isCurrent: boolean;
  isWatched: boolean;
  progressPercent: number; // 0 to 100
  position: number;
  duration: number;
}

export function getEpisodeStatus(
  ep: VodEpisode,
  index: number,
  entry?: HistoryItem,
  seasonNumber?: number
): EpisodeStatus {
  if (!entry) {
    return { isCurrent: false, isWatched: false, progressPercent: 0, position: 0, duration: 0 };
  }

  const epNum = episodeNumber(ep, index);
  const epId = ep.id ? String(ep.id) : '';
  const currentEpId = entry.episodeId ? String(entry.episodeId) : '';
  const currentEpNum = entry.episodeNumber !== undefined ? parseInt(String(entry.episodeNumber), 10) : undefined;

  const seasonMatches = (entry.seasonNumber === undefined || seasonNumber === undefined) ||
                        (parseInt(String(entry.seasonNumber), 10) === parseInt(String(seasonNumber), 10));

  // Check explicit record in watchedEpisodes if present
  const record = (epId && entry.watchedEpisodes?.[epId]) ||
                 (epNum !== undefined && entry.watchedEpisodes?.[`num_${epNum}`]);

  // Check if this is the currently active episode in history (must match season!)
  const isMatchCurrent = seasonMatches && (
    (currentEpId && epId && currentEpId === epId) ||
    (currentEpNum !== undefined && currentEpNum === epNum)
  );

  if (isMatchCurrent) {
    const finished = isFinished(entry.position, entry.duration);
    const progress = entry.duration > 0 ? Math.min(100, Math.round((entry.position / entry.duration) * 100)) : 0;
    return {
      isCurrent: !finished,
      isWatched: finished,
      progressPercent: finished ? 100 : progress,
      position: entry.position,
      duration: entry.duration
    };
  }

  if (record) {
    const finished = record.finished || isFinished(record.position, record.duration);
    const progress = record.duration > 0 ? Math.min(100, Math.round((record.position / record.duration) * 100)) : 0;
    return {
      isCurrent: false,
      isWatched: finished,
      progressPercent: finished ? 100 : progress,
      position: record.position,
      duration: record.duration
    };
  }

  // Season comparison fallback: if viewing an earlier season than current progress, it's watched.
  // If viewing a later season, it's unwatched unless explicitly recorded.
  if (entry.seasonNumber !== undefined && seasonNumber !== undefined) {
    const entrySeason = parseInt(String(entry.seasonNumber), 10);
    const viewSeason = parseInt(String(seasonNumber), 10);
    if (!isNaN(entrySeason) && !isNaN(viewSeason)) {
      if (viewSeason < entrySeason) {
        return { isCurrent: false, isWatched: true, progressPercent: 100, position: 0, duration: 0 };
      }
      if (viewSeason > entrySeason) {
        return { isCurrent: false, isWatched: false, progressPercent: 0, position: 0, duration: 0 };
      }
    }
  }

  // Fallback: in a sequential series (same season), any episode with number < current episode number was already watched!
  if (seasonMatches && currentEpNum !== undefined && epNum < currentEpNum) {
    return {
      isCurrent: false,
      isWatched: true,
      progressPercent: 100,
      position: 0,
      duration: 0
    };
  }

  return { isCurrent: false, isWatched: false, progressPercent: 0, position: 0, duration: 0 };
}
