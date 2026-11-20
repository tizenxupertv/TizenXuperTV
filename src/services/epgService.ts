import { getChannelProgram, EpgProgramItem } from './catalogService';
import { LiveChannel } from '../types/channel';

interface CachedEpg {
  timestamp: number;
  programs: EpgProgramItem[];
  current?: { now: string; next?: string; time?: string; desc?: string };
}

const epgMemoryCache: Record<string, CachedEpg> = {};
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export function parseEpgTimestamp(ts: string | undefined): Date | null {
  if (!ts) return null;
  const s = String(ts).trim();
  if (s.length === 14 && /^\d{14}$/.test(s)) {
    const y = parseInt(s.slice(0, 4), 10);
    const m = parseInt(s.slice(4, 6), 10) - 1;
    const d = parseInt(s.slice(6, 8), 10);
    const h = parseInt(s.slice(8, 10), 10);
    const min = parseInt(s.slice(10, 12), 10);
    const sec = parseInt(s.slice(12, 14), 10);
    return new Date(y, m, d, h, min, sec);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function formatHhMm(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// Flag to disable live Magis EPG network queries (avoids 100% portal200001 failure loops and relay traffic)
const EPG_DISABLED = true;

export async function fetchChannelEpg(channel: LiveChannel): Promise<{ now: string; next?: string; time?: string; desc?: string } | null> {
  if (EPG_DISABLED) {
    return null;
  }
  const code = String(channel.code || channel.id || '');
  if (!code || code.startsWith('extra-') || code.startsWith('wiwy-') || code.startsWith('epic-')) {
    return null; // Special feeds don't have Magis portal EPG
  }

  const nowMs = Date.now();
  const cached = epgMemoryCache[code];
  if (cached && (nowMs - cached.timestamp < CACHE_TTL_MS)) {
    return resolveCurrentEpg(cached.programs);
  }

  try {
    const colId = typeof channel.colId === 'number' ? channel.colId : parseInt(String(channel.colId || '0'), 10) || 0;
    const res = await getChannelProgram(code, colId);
    if (!res || !Array.isArray(res.programList) || !res.programList.length) {
      return null;
    }

    const current = resolveCurrentEpg(res.programList);
    epgMemoryCache[code] = {
      timestamp: nowMs,
      programs: res.programList,
      current: current || undefined
    };
    return current;
  } catch (e) {
    return null;
  }
}

function resolveCurrentEpg(programs: EpgProgramItem[]): { now: string; next?: string; time?: string; desc?: string } | null {
  if (!programs.length) return null;
  const now = new Date();
  const nowTime = now.getTime();

  let activeIdx = -1;
  for (let i = 0; i < programs.length; i++) {
    const p = programs[i];
    const sDate = parseEpgTimestamp(p.startTime);
    const eDate = parseEpgTimestamp(p.endTime);
    if (sDate && eDate) {
      if (nowTime >= sDate.getTime() && nowTime <= eDate.getTime()) {
        activeIdx = i;
        break;
      }
    }
  }

  if (activeIdx === -1) {
    activeIdx = programs.findIndex(p => {
      const s = parseEpgTimestamp(p.startTime);
      return s && s.getTime() > nowTime;
    });
    if (activeIdx === -1) activeIdx = programs.length - 1;
  }

  const currentProg = programs[activeIdx];
  if (!currentProg) return null;
  const nextProg = programs[activeIdx + 1];

  const sDate = parseEpgTimestamp(currentProg.startTime);
  const eDate = parseEpgTimestamp(currentProg.endTime);
  const timeStr = (sDate && eDate) ? `${formatHhMm(sDate)} - ${formatHhMm(eDate)}` : undefined;

  return {
    now: currentProg.programName,
    next: nextProg ? nextProg.programName : undefined,
    time: timeStr,
    desc: currentProg.desc || currentProg.remark || undefined
  };
}
