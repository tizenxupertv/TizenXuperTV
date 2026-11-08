import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SportCategory, SportsEvent, SportsStream } from '../types/sports.ts';
import { sportsService } from '../services/sportsService.ts';
import { scoreboardService } from '../services/scoreboardService.ts';
import '../styles/sports.css';
import { MatchHeader } from '../components/sports/MatchHeader';

/**
 * Deportes tab: sport chips, a row of live matches with their scores (services/scoreboardService.ts), and the
 * schedule as a grid of cards grouped by day. OK on a match asks for the signal when it has more than one.
 */

interface Score { homeScore: string; awayScore: string; state: string; periodDetail: string }

const SPORTS: Array<{ id: SportCategory; label: string }> = [
  { id: 'all', label: 'Todos' },
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

type Line =
  | { kind: 'chips' }
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

const isVersus = (e: SportsEvent) => !!e.away && e.away.trim().toLowerCase() !== e.home.trim().toLowerCase();
const leagueOf = (e: SportsEvent) => (e.league.trim().toLowerCase() === e.home.trim().toLowerCase() ? e.sportLabel : e.league);

const Crest: React.FC<{ src?: string; name: string; big?: boolean }> = ({ src, name, big }) => (
  <span className={`spb-crest ${big ? 'is-big' : ''}`}>
    {src ? <img src={src} alt="" onError={e => { (e.currentTarget as HTMLElement).style.display = 'none'; }} /> : null}
    <span className="spb-crest-text">{name.slice(0, 2).toUpperCase()}</span>
  </span>
);

interface Props {
  isFocusActive: boolean;
  onFocusHeader: () => void;
  onPlayEventStream: (event: SportsEvent, streamIndex: number, streams: SportsStream[]) => void;
}

export const SportsView: React.FC<Props> = ({ isFocusActive, onFocusHeader, onPlayEventStream }) => {
  const [events, setEvents] = useState<SportsEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sport, setSport] = useState<SportCategory>('all');
  const [focus, setFocus] = useState({ line: 0, col: 0 });
  const [, setScoreTick] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const [selected, setSelected] = useState<SportsEvent | null>(null);
  const [streams, setStreams] = useState<SportsStream[]>([]);
  const [streamsLoading, setStreamsLoading] = useState(false);
  const [streamFocus, setStreamFocus] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(false);
    try {
      setEvents(await sportsService.getEvents(force));
    } catch (e) {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Scores and "En N min" stay fresh while the tab is open
  useEffect(() => {
    let alive = true;
    const refresh = () => scoreboardService.fetchScores().then(() => { if (alive) setScoreTick(t => t + 1); }, () => {});
    refresh();
    const t = setInterval(() => { refresh(); setNow(Date.now()); }, SCORE_REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // A score only once the match has started (ESPN's "scheduled" games carry 0 - 0)
  const scoreOf = (e: SportsEvent): Score | null => {
    const s = isVersus(e) ? (scoreboardService.findScore(e.home, e.away) as Score | null) : null;
    return s && s.state !== 'scheduled' ? s : null;
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: events.length };
    events.forEach(e => { c[e.sport] = (c[e.sport] || 0) + 1; });
    return c;
  }, [events]);
  const chips = useMemo(() => SPORTS.filter(s => s.id === 'all' || counts[s.id]), [counts]);

  const filtered = useMemo(() => (sport === 'all' ? events : events.filter(e => e.sport === sport)), [events, sport]);

  const lines: Line[] = useMemo(() => {
    const live = filtered.filter(e => e.status === 'live');
    // Upcoming first; finished ones only from today, at the end of their day
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
    const rest = filtered.filter(e => e.status === 'scheduled' || (e.status === 'finished' && e.startMillis >= todayStart))
      .sort((a, b) => (dayLabel(a.startMillis) === dayLabel(b.startMillis)
        ? (a.status === 'finished' ? 1 : 0) - (b.status === 'finished' ? 1 : 0) || a.startMillis - b.startMillis
        : a.startMillis - b.startMillis));
    const out: Line[] = [{ kind: 'chips' }];
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

  const lineLength = (l: Line) => (l.kind === 'chips' ? chips.length : l.events.length);

  // The sport changes: back to the first card of the chips line
  useEffect(() => { setFocus(f => ({ line: Math.min(f.line, lines.length - 1), col: f.line === 0 ? f.col : 0 })); }, [lines.length]);

  // Keep the focused card in view
  useEffect(() => {
    if (!isFocusActive || !rootRef.current) return;
    const el = rootRef.current.querySelector('.spb-focus') as HTMLElement | null;
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, [focus, isFocusActive]);

  const openEvent = useCallback(async (ev: SportsEvent) => {
    setSelected(ev);
    setStreams([]);
    setStreamFocus(0);
    setStreamsLoading(true);
    try {
      const list = await sportsService.getStreams(ev.linksPath);
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
      const k = e.key;
      const isBack = k === 'Escape' || k === 'Backspace' || e.keyCode === 10009;
      if (selected) {
        e.preventDefault();
        if (isBack) e.stopImmediatePropagation();
        if (k === 'ArrowUp') setStreamFocus(i => Math.max(0, i - 1));
        else if (k === 'ArrowDown') setStreamFocus(i => Math.min(streams.length - 1, i + 1));
        else if (k === 'Enter' && streams[streamFocus]) { onPlayEventStream(selected, streamFocus, streams); setSelected(null); }
        else if (isBack) setSelected(null);
        return;
      }
      const line = lines[focus.line];
      if (!line) return;
      if (k === 'ArrowLeft') { e.preventDefault(); setFocus(f => ({ ...f, col: Math.max(0, f.col - 1) })); }
      else if (k === 'ArrowRight') { e.preventDefault(); setFocus(f => ({ ...f, col: Math.min(lineLength(line) - 1, f.col + 1) })); }
      else if (k === 'ArrowUp') {
        e.preventDefault();
        if (focus.line === 0) onFocusHeader();
        else {
          const prev = lines[focus.line - 1];
          setFocus(f => ({ line: f.line - 1, col: prev.kind === 'chips' ? Math.max(0, chips.findIndex(c => c.id === sport)) : Math.min(f.col, lineLength(prev) - 1) }));
        }
      } else if (k === 'ArrowDown') {
        e.preventDefault();
        if (focus.line < lines.length - 1) {
          const next = lines[focus.line + 1];
          setFocus(f => ({ line: f.line + 1, col: line.kind === 'chips' ? 0 : Math.min(f.col, lineLength(next) - 1) }));
        }
      } else if (k === 'Enter') {
        e.preventDefault();
        if (line.kind === 'chips') { const c = chips[focus.col]; if (c) setSport(c.id); }
        else { const ev = line.events[focus.col]; if (ev) openEvent(ev); }
      } else if (isBack && focus.line > 0) {
        // Back from inside the list goes to the top first; from the top, App takes it back to the tabs
        e.preventDefault();
        e.stopImmediatePropagation();
        setFocus({ line: 0, col: Math.max(0, chips.findIndex(c => c.id === sport)) });
      }
    };
    // Capture: runs before App's key handler, so Back can be kept here
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const isF = (line: number, col: number) => isFocusActive && !selected && focus.line === line && focus.col === col;

  const liveCard = (ev: SportsEvent, li: number, ci: number) => {
    const s = scoreOf(ev);
    const vs = isVersus(ev);
    return (
      <div key={ev.id} className={`spb-live-card ${isF(li, ci) ? 'spb-focus' : ''}`} onClick={() => openEvent(ev)}>
        <div className="spb-live-top">
          <span className="spb-league">{leagueOf(ev)}</span>
          <span className="spb-live-tag"><span className="spb-dot" />{s && s.state === 'live' && s.periodDetail ? s.periodDetail : 'EN VIVO'}</span>
        </div>
        {vs ? (
          <>
            <div className="spb-team-line"><Crest src={ev.homeLogo} name={ev.home} big /><span className="spb-team">{ev.home}</span><span className="spb-score">{s ? s.homeScore : ''}</span></div>
            <div className="spb-team-line"><Crest src={ev.awayLogo} name={ev.away} big /><span className="spb-team">{ev.away}</span><span className="spb-score">{s ? s.awayScore : ''}</span></div>
          </>
        ) : (
          <div className="spb-team-line is-single"><Crest src={ev.homeLogo || ev.leagueLogo} name={ev.home} big /><span className="spb-team">{ev.home}</span></div>
        )}
        <div className="spb-meta">{ev.linkNames.length === 1 ? '1 señal' : `${ev.linkNames.length} señales`}</div>
      </div>
    );
  };

  const gridCard = (ev: SportsEvent, li: number, ci: number) => {
    const s = ev.status === 'finished' ? scoreOf(ev) : null;
    const vs = isVersus(ev);
    const done = ev.status === 'finished';
    return (
      <div key={ev.id} className={`spb-card ${done ? 'is-done' : ''} ${isF(li, ci) ? 'spb-focus' : ''}`} onClick={() => openEvent(ev)}>
        <div className="spb-card-time">
          <span className="spb-hour">{hhmm(ev.startMillis)}</span>
          <span className={`spb-when ${done ? 'is-done' : ''}`}>{done ? 'Final' : untilLabel(ev.startMillis, now)}</span>
        </div>
        <div className="spb-card-body">
          <div className="spb-league is-small">{leagueOf(ev)}</div>
          {vs ? (
            <>
              <div className="spb-team-line is-small"><Crest src={ev.homeLogo} name={ev.home} /><span className="spb-team">{ev.home}</span>{s && <span className="spb-score is-small">{s.homeScore}</span>}</div>
              <div className="spb-team-line is-small"><Crest src={ev.awayLogo} name={ev.away} /><span className="spb-team">{ev.away}</span>{s && <span className="spb-score is-small">{s.awayScore}</span>}</div>
            </>
          ) : (
            <div className="spb-team-line is-small"><Crest src={ev.homeLogo || ev.leagueLogo} name={ev.home} /><span className="spb-team">{ev.home}</span></div>
          )}
        </div>
      </div>
    );
  };

  const liveLineIdx = lines.findIndex(l => l.kind === 'live');

  return (
    <div className="spb-root" ref={rootRef}>
      <div className="spb-chips">
        {chips.map((c, i) => (
          <div key={c.id} className={`spb-chip ${sport === c.id ? 'is-on' : ''} ${isF(0, i) ? 'spb-focus' : ''}`} onClick={() => setSport(c.id)}>
            {c.label}<span className="spb-chip-count">{counts[c.id] || 0}</span>
          </div>
        ))}
      </div>

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
      {!loading && !error && lines.length === 1 && (
        <div className="spb-empty">
          <div className="spb-empty-title">No hay eventos</div>
          <div className="spb-empty-text">No encontramos partidos de este deporte por ahora.</div>
        </div>
      )}

      {!loading && !error && liveLineIdx > 0 && (
        <>
          <div className="spb-section"><span className="spb-dot" />En vivo ahora<span className="spb-section-count">{(lines[liveLineIdx] as { events: SportsEvent[] }).events.length}</span></div>
          <div className="spb-live-row">
            {(lines[liveLineIdx] as { events: SportsEvent[] }).events.map((ev, ci) => liveCard(ev, liveLineIdx, ci))}
          </div>
        </>
      )}

      {!loading && !error && lines.map((l, li) => (l.kind === 'grid' ? (
        <React.Fragment key={`g${li}`}>
          {l.header && <div className="spb-section is-day">{l.header}</div>}
          <div className="spb-grid">{l.events.map((ev, ci) => gridCard(ev, li, ci))}</div>
        </React.Fragment>
      ) : null))}

      {selected && (
        <div className="spb-modal">
          <div className="spb-modal-card">
            <MatchHeader event={{ ...selected, league: leagueOf(selected) }} />
            {streamsLoading ? (
              <div className="spp-loading spb-modal-status"><span className="spp-spinner" />Buscando señales…</div>
            ) : streams.length === 0 ? (
              <div className="spb-empty-text spb-modal-status">Todavía no hay señales para este evento.</div>
            ) : (
              <div className="spb-streams">
                {streams.map((st, i) => (
                  <div key={i} className={`spb-stream ${i === streamFocus ? 'spb-focus' : ''}`} onClick={() => { onPlayEventStream(selected, i, streams); setSelected(null); }}>
                    <span>{st.name}</span><span className="spb-stream-play">Ver ▶</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
