import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SportCategory, SportsEvent, SportsStream } from '../types/sports.ts';
import { isPlayableStream, sportsService } from '../services/sportsService.ts';
import { scoreboardService } from '../services/scoreboardService.ts';
import { feedPlan } from '../lib/scoreFeeds.ts';
import '../styles/sports.css';
import { MatchHeader } from '../components/sports/MatchHeader';
import { MatchDetailModal } from '../components/sports/MatchDetailModal';
import { setTrackOffset } from '../utils/scrollHelper';
import { isPlus, plusFirst, withoutPlusDuplicates } from '../lib/sportsPlus';

/**
 * Deportes tab: vertical sport categories sidebar on left, live row with scores and schedule grid by day on right.
 * OK on a match asks for the signal when it has more than one.
 */

interface Score { homeScore: string; awayScore: string; state: string; periodDetail: string }

const SPORTS: Array<{ id: SportCategory; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'football_plus', label: 'Fútbol+' },
  { id: 'football', label: 'Fútbol' },
  { id: 'basketball', label: 'Básquet' },
  { id: 'american_football', label: 'Fútbol americano' },
  { id: 'baseball', label: 'Béisbol' },
  { id: 'tennis', label: 'Tenis' },
  { id: 'fighting', label: 'Combate' },
  { id: 'motor_sport', label: 'Motor' },
  { id: 'other', label: 'Otros' }
];
const GRID_COLS = 3;
const SCORE_REFRESH_MS = 45_000;
/** The schedule reloads this often while the tab is open… */
const RELOAD_EVERY_MS = 5 * 60_000;
/** …once the remote has been still this long */
const RELOAD_IDLE_MS = 3_000;
const RELOAD_CHECK_MS = 15_000;
/** Scores are worked out this long after the list paints */
const SCORES_DELAY_MS = 120;

type Line =
  | { kind: 'live'; events: SportsEvent[] }
  | { kind: 'grid'; events: SportsEvent[]; header?: string };

function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dayLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(d) - start(today)) / 86_400_000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  if (diff === -1) return 'Ayer';
  return d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'short' });
}

function untilLabel(ms: number, now: number): string {
  const min = Math.round((ms - now) / 60_000);
  if (min <= 0) return 'Por empezar';
  if (min < 60) return `En ${min} min`;
  return '';
}

/** Badge of a Fútbol+ (EPIC+) match, so it is told apart from the same match in the main list */
const PlusBadge: React.FC<{ ev: SportsEvent }> = ({ ev }) =>
  ev.sport === 'football_plus' ? <span className="spb-plus">F+</span> : null;

const isVersus = (e: SportsEvent) => !!e.away && e.away.trim().toLowerCase() !== e.home.trim().toLowerCase();
const leagueOf = (e: SportsEvent) => (e.league.trim().toLowerCase() === e.home.trim().toLowerCase() ? e.sportLabel : e.league);

const Crest: React.FC<{ src?: string; name: string; big?: boolean }> = ({ src, name, big }) => {
  const [failed, setFailed] = React.useState(false);
  return (
    <span className={`spb-crest ${big ? 'is-big' : ''}`}>
      {src && !failed ? (
        <img src={src} alt="" decoding="async" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span className="spb-crest-text">{name.slice(0, 2).toUpperCase()}</span>
      )}
    </span>
  );
};

interface CardProps { ev: SportsEvent; focused: boolean; score: Score | null; onOpen: (ev: SportsEvent) => void }

/** A live match: re-renders only when its focus or score changes */
const LiveCard = React.memo<CardProps>(({ ev, focused, score: s, onOpen }) => {
  const vs = isVersus(ev);
  return (
    <div className={`spb-live-card ${focused ? 'spb-focus' : ''}`} onClick={() => onOpen(ev)}>
      <div className="spb-live-top">
        <span className="spb-league"><PlusBadge ev={ev} />{leagueOf(ev)}</span>
        <span className="spb-live-tag"><span className="spb-dot" />{s && s.state === 'live' && s.periodDetail ? s.periodDetail : 'EN VIVO'}</span>
      </div>
      {vs ? (
        <>
          <div className="spb-team-line"><Crest src={ev.homeLogo} name={ev.home} big /><span className="spb-team">{ev.home}</span><span className="spb-score">{s ? s.homeScore : ''}</span></div>
          <div className="spb-team-line"><Crest src={ev.awayLogo} name={ev.away} big /><span className="spb-team">{ev.away}</span><span className="spb-score">{s ? s.awayScore : ''}</span></div>
        </>
      ) : (
        <div className="spb-team-line"><Crest src={ev.homeLogo || ev.leagueLogo} name={ev.home} big /><span className="spb-team">{ev.home}</span></div>
      )}
    </div>
  );
});

/** A scheduled (or finished) match */
const GridCard = React.memo<CardProps & { now: number }>(({ ev, focused, score: s, onOpen, now }) => {
  const vs = isVersus(ev);
  const done = ev.status === 'finished';
  const until = done ? '' : untilLabel(ev.startMillis, now);
  return (
    <div className={`spb-card ${done ? 'is-done' : ''} ${focused ? 'spb-focus' : ''}`} onClick={() => onOpen(ev)}>
      <div className="spb-card-time">
        <span className="spb-hour">{hhmm(ev.startMillis)}</span>
        <span className={`spb-when ${done ? 'is-done' : ''}`}>{done ? 'Final' : until}</span>
      </div>
      <div className="spb-card-body">
        <div className="spb-league is-small"><PlusBadge ev={ev} />{leagueOf(ev)}</div>
        {vs ? (
          <>
            <div className="spb-team-line is-small">
              <Crest src={ev.homeLogo} name={ev.home} />
              <span className="spb-team">{ev.home}</span>
              {s && <span className="spb-score is-small">{s.homeScore}</span>}
            </div>
            <div className="spb-team-line is-small">
              <Crest src={ev.awayLogo} name={ev.away} />
              <span className="spb-team">{ev.away}</span>
              {s && <span className="spb-score is-small">{s.awayScore}</span>}
            </div>
          </>
        ) : (
          <div className="spb-team-line is-small">
            <Crest src={ev.homeLogo || ev.leagueLogo} name={ev.home} />
            <span className="spb-team">{ev.home}</span>
          </div>
        )}
      </div>
    </div>
  );
});

// Fixed heights (sports.css): the track offset and the rows to render are computed without measuring the DOM
const SECTION_H = 44;
const LIVE_ROW_H = 202;
const DAY_H = 74;
const ROW_H = 136;
const LIVE_CARD_PITCH = 440;
/** Rows drawn above and below the visible area; the rest are empty spacers */
const RENDER_ABOVE = 500;
const RENDER_BELOW = 1500;

interface Props {
  isFocusActive: boolean;
  /** A match or a title is open over the tab: no background reload meanwhile */
  paused?: boolean;
  onFocusHeader: () => void;
  onPlayEventStream: (event: SportsEvent, streamIndex: number, streams: SportsStream[]) => void;
  /** Where the agenda and the options come from: Deportes (default) or the EPIC+ trial tab */
  source?: SportsSource;
}

/** What the view reads from a sports source */
export interface SportsSource {
  peekEvents(): SportsEvent[];
  getEvents(force?: boolean): Promise<SportsEvent[]>;
  getStreams(linksPath: string): Promise<SportsStream[]>;
}

export const SportsView: React.FC<Props> = ({ isFocusActive, paused = false, onFocusHeader, onPlayEventStream, source = sportsService }) => {
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const [events, setEvents] = useState<SportsEvent[]>(() => source.peekEvents());
  const [loading, setLoading] = useState(() => source.peekEvents().length === 0);
  const [error, setError] = useState(false);
  const [sport, setSport] = useState<SportCategory>('all');
  const [focusArea, setFocusArea] = useState<'sidebar' | 'content'>('sidebar');
  const [sidebarIndex, setSidebarIndex] = useState(0);
  const [contentFocus, setContentFocus] = useState({ line: 0, col: 0 });
  const [scoreTick, setScoreTick] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const [selected, setSelected] = useState<SportsEvent | null>(null);
  const [detailEvent, setDetailEvent] = useState<SportsEvent | null>(null);
  const [streams, setStreams] = useState<SportsStream[]>([]);
  const [streamsLoading, setStreamsLoading] = useState(false);
  const [streamFocus, setStreamFocus] = useState(0);

  const trackRef = useRef<HTMLDivElement>(null);
  const liveTrackRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const loadedAtRef = useRef(0);
  const lastKeyAtRef = useRef(0);

  const load = useCallback(async (force = false) => {
    const shown = force ? [] : sourceRef.current.peekEvents();
    setError(false);
    if (!shown.length) setLoading(true);
    try {
      setEvents(await sourceRef.current.getEvents(force));
      loadedAtRef.current = Date.now();
    } catch (e) {
      if (!shown.length) setError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const eventsRef = useRef(events);
  eventsRef.current = events;
  const refreshScoresRef = useRef<() => void>(() => {});
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  useEffect(() => {
    const t = setInterval(() => {
      const nowMs = Date.now();
      if (document.hidden || pausedRef.current) return;
      if (nowMs - loadedAtRef.current < RELOAD_EVERY_MS || nowMs - lastKeyAtRef.current < RELOAD_IDLE_MS) return;
      loadedAtRef.current = nowMs;
      sourceRef.current.getEvents(true).then(list => { if (list.length) setEvents(list); }, () => {});
    }, RELOAD_CHECK_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let alive = true;
    // Only the feeds of the sports on the schedule, and often only where a match is in play (lib/scoreFeeds)
    const refresh = () => scoreboardService.fetchScores(false, feedPlan(eventsRef.current, Date.now()))
      .then(() => { if (alive) setScoreTick(t => t + 1); }, () => {});
    refreshScoresRef.current = refresh;
    refresh();
    const t = setInterval(() => {
      if (pausedRef.current || document.hidden) return;
      refresh();
      setNow(Date.now());
    }, SCORE_REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);
  // The schedule arrived or changed: its feeds may be due now, without waiting for the next tick
  useEffect(() => {
    if (events.length && !pausedRef.current) refreshScoresRef.current();
  }, [events]);

  const [scores, setScores] = useState<Map<string, Score>>(() => new Map());
  useEffect(() => {
    const t = setTimeout(() => {
      const m = new Map<string, Score>();
      events.forEach(e => {
        if (!isVersus(e)) return;
        const sc = scoreboardService.findScore(e.home, e.away) as Score | null;
        if (sc) m.set(e.id, sc);
      });
      setScores(m);
    }, SCORES_DELAY_MS);
    return () => clearTimeout(t);
  }, [events, scoreTick]);

  const liveEvents = useMemo(() => events.map(e => {
    const sc = scores.get(e.id);
    const status: SportsEvent['status'] = sc && (sc.state === 'live' || sc.state === 'finished')
      ? (sc.state as SportsEvent['status'])
      : now < e.startMillis ? 'scheduled' : now <= e.endMillis ? 'live' : 'finished';
    return status === e.status ? e : { ...e, status };
  }), [events, scores, now]);

  // Fútbol+ (EPIC+) goes first: a match in both agendas keeps only its Fútbol+ copy, which also counts in Fútbol
  const shown = useMemo(() => withoutPlusDuplicates(liveEvents), [liveEvents]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: shown.length };
    shown.forEach(e => {
      c[e.sport] = (c[e.sport] || 0) + 1;
      if (isPlus(e)) c.football = (c.football || 0) + 1;
    });
    return c;
  }, [shown]);
  const chips = useMemo(() => SPORTS.filter(s => s.id === 'all' || counts[s.id]), [counts]);

  const filtered = useMemo(() => (sport === 'all' ? shown
    : sport === 'football' ? shown.filter(e => e.sport === 'football' || isPlus(e))
    : shown.filter(e => e.sport === sport)), [shown, sport]);

  const lines: Line[] = useMemo(() => {
    const live = filtered.filter(e => e.status === 'live').sort(plusFirst);
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
    const rest = filtered.filter(e => e.status === 'scheduled' || (e.status === 'finished' && e.startMillis >= todayStart))
      .sort((a, b) => (dayLabel(a.startMillis) === dayLabel(b.startMillis)
        ? (a.status === 'finished' ? 1 : 0) - (b.status === 'finished' ? 1 : 0) || plusFirst(a, b)
        : a.startMillis - b.startMillis));
    const out: Line[] = [];
    if (live.length) out.push({ kind: 'live', events: live });
    let day = '';
    for (let i = 0; i < rest.length; i += 0) {
      const d = dayLabel(rest[i].startMillis);
      const sameDay: SportsEvent[] = [];
      while (i < rest.length && dayLabel(rest[i].startMillis) === d) sameDay.push(rest[i++]);
      for (let j = 0; j < sameDay.length; j += GRID_COLS) {
        out.push({ kind: 'grid', events: sameDay.slice(j, j + GRID_COLS), header: j === 0 && d !== day ? d : undefined });
      }
      day = d;
    }
    return out;
  }, [filtered]);

  // Keep focused match if still visible, otherwise clamp
  const focusedIdRef = useRef<string | null>(null);
  useEffect(() => {
    const id = focusedIdRef.current;
    setContentFocus(f => {
      if (id) {
        for (let li = 0; li < lines.length; li++) {
          const l = lines[li];
          const ci = l.events.findIndex(e => e.id === id);
          if (ci >= 0) return li === f.line && ci === f.col ? f : { line: li, col: ci };
        }
      }
      const line = Math.min(f.line, Math.max(0, lines.length - 1));
      const l = lines[line];
      const len = !l ? 0 : l.events.length;
      const col = Math.max(0, Math.min(f.col, Math.max(0, len - 1)));
      return line === f.line && col === f.col ? f : { line, col };
    });
  }, [lines]);

  useEffect(() => {
    const cur = lines[contentFocus.line];
    focusedIdRef.current = cur && cur.events[contentFocus.col] ? cur.events[contentFocus.col].id : null;
  }, [contentFocus, lines]);

  // Ensure sidebar selection is within chips bounds
  useEffect(() => {
    if (sidebarIndex >= chips.length) {
      setSidebarIndex(Math.max(0, chips.length - 1));
    }
  }, [chips.length, sidebarIndex]);

  // Scroll sidebar item into view
  useEffect(() => {
    if (sidebarRef.current && focusArea === 'sidebar') {
      const el = sidebarRef.current.children[sidebarIndex] as HTMLElement;
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [sidebarIndex, focusArea]);

  // Top of each line in the track and its height
  const layout = useMemo(() => {
    let y = 0;
    return lines.map(l => {
      const h = l.kind === 'live' ? SECTION_H + LIVE_ROW_H : (l.header ? DAY_H : 0) + ROW_H;
      const top = y;
      y += h;
      return { top, h };
    });
  }, [lines]);

  // Page offset: the list starts at the top (live now, then today) while the categories have the focus, and follows
  // the focused line inside the list
  const pageOffset = focusArea !== 'content' || contentFocus.line === 0 ? 0 : Math.max(0, layout[contentFocus.line] ? layout[contentFocus.line].top - 10 : 0);
  useEffect(() => {
    if (trackRef.current) setTrackOffset(trackRef.current, 'y', pageOffset);
  }, [pageOffset]);

  const liveCol = lines[contentFocus.line]?.kind === 'live' ? contentFocus.col : 0;
  useEffect(() => {
    if (liveTrackRef.current) setTrackOffset(liveTrackRef.current, 'x', liveCol <= 1 ? 0 : (liveCol - 1) * LIVE_CARD_PITCH);
  }, [liveCol]);

  const openEvent = useCallback(async (ev: SportsEvent) => {
    setSelected(ev);
    setStreams([]);
    setStreamFocus(0);
    setStreamsLoading(true);
    try {
      const list = (await sourceRef.current.getStreams(ev.linksPath)).filter(isPlayableStream);
      if (list.length === 1) {
        setSelected(null);
        onPlayEventStream(ev, 0, list);
        return;
      }
      setStreams(list);
    } catch (e) {
      setStreams([]);
    } finally {
      setStreamsLoading(false);
    }
  }, [onPlayEventStream]);

  useEffect(() => {
    if (!isFocusActive) return;
    const onKey = (e: KeyboardEvent) => {
      lastKeyAtRef.current = Date.now();
      const k = e.key;
      const isBack = k === 'Escape' || k === 'Backspace' || e.keyCode === 10009;
      if (detailEvent) return;

      if (selected) {
        e.preventDefault();
        if (isBack) e.stopImmediatePropagation();
        const totalOpts = streams.length + 1; // streams + "Alineaciones y Estadísticas"
        if (k === 'ArrowUp') setStreamFocus(i => Math.max(0, i - 1));
        else if (k === 'ArrowDown') setStreamFocus(i => Math.min(totalOpts - 1, i + 1));
        else if (k === 'Enter') {
          if (streamFocus < streams.length && streams[streamFocus]) {
            onPlayEventStream(selected, streamFocus, streams);
            setSelected(null);
          } else if (streamFocus === streams.length) {
            const ev = selected;
            setSelected(null);
            setDetailEvent(ev);
          }
        } else if (isBack) setSelected(null);
        return;
      }

      if (focusArea === 'sidebar') {
        if (k === 'ArrowUp') {
          e.preventDefault();
          if (sidebarIndex === 0) {
            onFocusHeader();
          } else {
            const next = sidebarIndex - 1;
            setSidebarIndex(next);
            if (chips[next]) setSport(chips[next].id);
          }
        } else if (k === 'ArrowDown') {
          e.preventDefault();
          if (sidebarIndex < chips.length - 1) {
            const next = sidebarIndex + 1;
            setSidebarIndex(next);
            if (chips[next]) setSport(chips[next].id);
          }
        } else if (k === 'ArrowRight' || k === 'Enter') {
          e.preventDefault();
          if (lines.length > 0) {
            setFocusArea('content');
            setContentFocus({ line: 0, col: 0 });
          }
        } else if (isBack) {
          e.preventDefault();
          e.stopImmediatePropagation();
          onFocusHeader();
        }
        return;
      }

      // focusArea === 'content'
      const line = lines[contentFocus.line];
      if (!line) {
        if (isBack || k === 'ArrowLeft') {
          e.preventDefault();
          setFocusArea('sidebar');
        }
        return;
      }

      const isInfoKey = e.keyCode === 405 || e.keyCode === 457 || e.keyCode === 458 || k === 'i' || k === 'I' || k === 'y' || k === 'Y';
      if (isInfoKey) {
        const ev = line.events[contentFocus.col];
        if (ev) {
          e.preventDefault();
          e.stopImmediatePropagation();
          setDetailEvent(ev);
          return;
        }
      }

      if (k === 'ArrowLeft') {
        e.preventDefault();
        if (contentFocus.col > 0) {
          setContentFocus(f => ({ ...f, col: f.col - 1 }));
        } else {
          setFocusArea('sidebar');
        }
      } else if (k === 'ArrowRight') {
        e.preventDefault();
        setContentFocus(f => ({ ...f, col: Math.min(line.events.length - 1, f.col + 1) }));
      } else if (k === 'ArrowUp') {
        e.preventDefault();
        if (contentFocus.line === 0) {
          onFocusHeader();
        } else {
          const prev = lines[contentFocus.line - 1];
          setContentFocus(f => ({ line: f.line - 1, col: Math.min(f.col, prev.events.length - 1) }));
        }
      } else if (k === 'ArrowDown') {
        e.preventDefault();
        if (contentFocus.line < lines.length - 1) {
          const next = lines[contentFocus.line + 1];
          setContentFocus(f => ({ line: f.line + 1, col: Math.min(f.col, next.events.length - 1) }));
        }
      } else if (k === 'Enter') {
        e.preventDefault();
        const ev = line.events[contentFocus.col];
        if (ev) openEvent(ev);
      } else if (isBack) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setFocusArea('sidebar');
      }
    };

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isFocusActive, selected, detailEvent, focusArea, sidebarIndex, chips, lines, contentFocus, streams, streamFocus, onFocusHeader, openEvent, onPlayEventStream]);

  const isF = (line: number, col: number) => isFocusActive && !selected && focusArea === 'content' && contentFocus.line === line && contentFocus.col === col;
  const liveLineIdx = lines.findIndex(l => l.kind === 'live');

  return (
    <div className="spb-root">
      <div className="spb-layout">
        <aside className="live-col-categories">
          <div className="live-col-header">
            <div className="live-header-lead">
              <span className="live-header-title">Categorías</span>
              <span className="live-header-sub">{chips.length} categorías</span>
            </div>
            <span className="beta-pill">Beta</span>
          </div>
          <div className="live-cat-vlist" ref={sidebarRef}>
            {chips.map((c, i) => {
              const isSidebarFocused = isFocusActive && !selected && focusArea === 'sidebar' && sidebarIndex === i;
              const isActive = sport === c.id;
              return (
                <div
                  key={c.id}
                  className={`live-cat-vrow ${isActive ? 'is-active-cat' : ''} ${isSidebarFocused ? 'is-focused' : ''}`}
                  onClick={() => {
                    setSidebarIndex(i);
                    setSport(c.id);
                    setFocusArea('content');
                    setContentFocus({ line: 0, col: 0 });
                  }}
                >
                  <span className="live-cat-vname">{c.label}</span>
                  <span className="browse-cat-vcount">{counts[c.id] || 0}</span>
                </div>
              );
            })}
          </div>
        </aside>

        <main className="spb-main-content">
          <div className="spb-track" ref={trackRef}>
            {loading && (
              <div className="spb-skeleton">
                {Array.from({ length: 6 }).map((_, i) => <div key={i} className="spb-card is-skeleton" />)}
              </div>
            )}
            {error && !loading && (
              <div className="spb-empty">
                <div className="spb-empty-title">No se pudo cargar la agenda</div>
                <div className="spb-empty-text">Revisa tu conexión e inténtalo de nuevo.</div>
                <div className="pf-btn is-focused" onClick={() => load(true)}>Reintentar</div>
              </div>
            )}
            {!loading && !error && lines.length === 0 && (
              <div className="spb-empty">
                <div className="spb-empty-title">No hay eventos</div>
                <div className="spb-empty-text">No encontramos partidos de este deporte por ahora.</div>
              </div>
            )}

            {!loading && !error && liveLineIdx >= 0 && (
              <>
                <div className="spb-section"><span className="spb-dot" />En vivo ahora<span className="spb-section-count">{(lines[liveLineIdx] as { events: SportsEvent[] }).events.length}</span></div>
                <div className="spb-live-row">
                  <div className="spb-live-track" ref={liveTrackRef}>
                    {(lines[liveLineIdx] as { events: SportsEvent[] }).events.map((ev, ci) => (
                      <LiveCard key={ev.id} ev={ev} focused={isF(liveLineIdx, ci)} score={scores.get(ev.id) || null} onOpen={openEvent} />
                    ))}
                  </div>
                </div>
              </>
            )}

            {!loading && !error && lines.map((l, li) => {
              if (l.kind !== 'grid') return null;
              const { top, h } = layout[li];
              if (top + h < pageOffset - RENDER_ABOVE || top > pageOffset + RENDER_BELOW) return <div key={`g${li}`} style={{ height: h }} />;
              return (
                <React.Fragment key={`g${li}`}>
                  {l.header && <div className="spb-section is-day">{l.header}</div>}
                  <div className="spb-grid">
                    {l.events.map((ev, ci) => (
                      <GridCard key={ev.id} ev={ev} focused={isF(li, ci)} score={ev.status === 'finished' ? (scores.get(ev.id) || null) : null} onOpen={openEvent} now={now} />
                    ))}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </main>
      </div>

      {selected && (
        <div className="spb-modal">
          <div className="spb-modal-card">
            <MatchHeader event={{ ...selected, league: leagueOf(selected) }} />
            {streamsLoading ? (
              <div className="spp-loading spb-modal-status"><span className="spp-spinner" />Buscando señales…</div>
            ) : streams.length === 0 ? (
              <div className="spb-empty-text spb-modal-status">Este evento no tiene señales que se puedan ver en la app por ahora.</div>
            ) : (
              <div className="spb-streams">
                {streams.map((st, i) => (
                  <div key={i} className={`spb-stream ${i === streamFocus ? 'spb-focus' : ''}`} onClick={() => { onPlayEventStream(selected, i, streams); setSelected(null); }}>
                    <span>{st.name}</span><span className="spb-stream-play">Ver ▶</span>
                  </div>
                ))}
                <div
                  className={`spb-stream spb-details-btn ${streamFocus === streams.length ? 'spb-focus' : ''}`}
                  onClick={() => {
                    const ev = selected;
                    setSelected(null);
                    setDetailEvent(ev);
                  }}
                >
                  <span>📊 Alineaciones y Estadísticas</span><span className="spb-stream-play">Ver ›</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {detailEvent && (
        <MatchDetailModal
          event={detailEvent}
          onClose={() => setDetailEvent(null)}
          onPlay={ev => {
            setDetailEvent(null);
            openEvent(ev);
          }}
        />
      )}
    </div>
  );
};
