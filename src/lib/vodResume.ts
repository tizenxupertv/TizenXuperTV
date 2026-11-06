import { VodItem, VodEpisode } from '../types/vod';
import { HistoryItem } from '../types/history';

export interface ResumeTarget {
  episode?: VodEpisode;
  startAt: number;
  label: string;
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

function remaining(position: number, duration: number): string {
  if (!(duration > 0)) return '';
  return ` · ${Math.max(1, Math.round((duration - position) / 60))} min`;
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
          return {
            episode: episodes[idx],
            startAt: Math.max(0, entry.position),
            label: `Continuar ${episodeLabel(episodes[idx], idx, seasonNumber)}${remaining(entry.position, entry.duration)}`
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
    } else if (!entry.series && !isFinished(entry.position, entry.duration) && entry.position > 0) {
      return { startAt: Math.max(0, entry.position), label: `Continuar${remaining(entry.position, entry.duration)}` };
    }
  }

  if (episodes.length > 0) {
    return { episode: episodes[0], startAt: 0, label: `Reproducir ${episodeLabel(episodes[0], 0, seasonNumber)}` };
  }
  return { startAt: 0, label: 'Reproducir' };
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
