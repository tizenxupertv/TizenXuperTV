import React, { useEffect, useState, useRef } from 'react';
import type { SportsEvent, FullMatchDetails, MatchEventItem } from '../../types/sports.ts';
import { scoreboardService } from '../../services/scoreboardService.ts';
import { useScreenKeys } from '../../hooks/useScreenKeys.ts';
import '../../styles/matchDetailModal.css';

interface MatchDetailModalProps {
  event: SportsEvent;
  onClose: () => void;
  onPlay: (event: SportsEvent) => void;
}

type TabType = 'events' | 'lineups' | 'stats';

function getPositionClass(pos?: string): string {
  if (!pos) return '';
  const p = pos.toUpperCase().trim();
  if (p === 'G' || p === 'GK' || p === 'POR' || p === 'PO' || p.startsWith('GK')) {
    return 'pos-gk';
  }
  if (
    p.startsWith('CD') || p.startsWith('CB') || p.startsWith('LB') || p.startsWith('RB') ||
    p.startsWith('DF') || p.startsWith('WB') || p === 'D' || p.startsWith('D-')
  ) {
    return 'pos-def';
  }
  if (
    p === 'F' || p.startsWith('CF') || p.startsWith('ST') || p.startsWith('RW') ||
    p.startsWith('LW') || p.startsWith('FW') || p.startsWith('DEL') || p.startsWith('DC')
  ) {
    return 'pos-fwd';
  }
  return 'pos-mid';
}

export const MatchDetailModal: React.FC<MatchDetailModalProps> = ({
  event,
  onClose,
  onPlay
}) => {
  const [details, setDetails] = useState<FullMatchDetails | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<TabType>('events');
  // Focus: 'nav' (tabs), 'play' (play button in header/nav), 'content'
  const [focusArea, setFocusArea] = useState<'nav' | 'play' | 'content'>('nav');
  const [navTabIndex, setNavTabIndex] = useState<number>(0); // 0: events, 1: lineups, 2: stats
  const [contentIndex, setContentIndex] = useState<number>(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  const TABS: TabType[] = ['events', 'lineups', 'stats'];

  useEffect(() => {
    let alive = true;
    setLoading(true);
    scoreboardService.getMatchDetails(event.home, event.away)
      .then(d => {
        if (!alive) return;
        setDetails(d);
        // If no events but stats exist, default to stats
        if (d && d.events.length === 0 && d.stats.length > 0) {
          setActiveTab('stats');
          setNavTabIndex(2);
        } else if (d && d.events.length === 0 && d.lineups) {
          setActiveTab('lineups');
          setNavTabIndex(1);
        }
        setLoading(false);
      })
      .catch(err => {
        if (!alive) return;
        console.warn('[MatchDetailModal] fetch error:', err);
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [event.home, event.away]);

  // Keep focused item in view when navigating vertically with remote
  useEffect(() => {
    if (focusArea !== 'content' || !bodyRef.current) return;
    const focusedEl = bodyRef.current.querySelector('.is-focused') as HTMLElement | null;
    if (focusedEl) {
      focusedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focusArea, contentIndex, activeTab]);

  useScreenKeys(key => {
    if (key === 'back') {
      onClose();
      return;
    }

    if (focusArea === 'nav') {
      if (key === 'left') {
        if (navTabIndex > 0) {
          const next = navTabIndex - 1;
          setNavTabIndex(next);
          setActiveTab(TABS[next]);
          setContentIndex(0);
        }
      } else if (key === 'right') {
        if (navTabIndex < TABS.length - 1) {
          const next = navTabIndex + 1;
          setNavTabIndex(next);
          setActiveTab(TABS[next]);
          setContentIndex(0);
        } else {
          setFocusArea('play');
        }
      } else if (key === 'down') {
        setFocusArea('content');
        setContentIndex(0);
      } else if (key === 'enter') {
        setFocusArea('content');
      }
      return;
    }

    if (focusArea === 'play') {
      if (key === 'left') {
        setFocusArea('nav');
        setNavTabIndex(TABS.length - 1);
      } else if (key === 'enter') {
        onPlay(event);
      } else if (key === 'down') {
        setFocusArea('content');
      }
      return;
    }

    if (focusArea === 'content') {
      const homeTotal = (details?.lineups?.home?.starters?.length || 0) + (details?.lineups?.home?.bench?.length || 0);
      const awayTotal = (details?.lineups?.away?.starters?.length || 0) + (details?.lineups?.away?.bench?.length || 0);
      const maxItems = activeTab === 'events'
        ? (details?.events.length || 0)
        : activeTab === 'stats'
        ? (details?.stats.length || 0)
        : activeTab === 'lineups'
        ? Math.max(homeTotal, awayTotal, 1)
        : 1;

      if (key === 'up') {
        if (contentIndex === 0) {
          setFocusArea('nav');
        } else {
          setContentIndex(i => Math.max(0, i - 1));
        }
      } else if (key === 'down') {
        setContentIndex(i => Math.min(Math.max(0, maxItems - 1), i + 1));
      } else if (key === 'left') {
        if (navTabIndex > 0) {
          const next = navTabIndex - 1;
          setNavTabIndex(next);
          setActiveTab(TABS[next]);
          setContentIndex(0);
        }
      } else if (key === 'right') {
        if (navTabIndex < TABS.length - 1) {
          const next = navTabIndex + 1;
          setNavTabIndex(next);
          setActiveTab(TABS[next]);
          setContentIndex(0);
        }
      }
      return;
    }
  });

  const getEventIcon = (type: MatchEventItem['type']) => {
    switch (type) {
      case 'goal': return '⚽';
      case 'yellow_card': return '🟨';
      case 'red_card': return '🟥';
      case 'substitution': return '🔄';
      case 'penalty': return '🎯';
      default: return '⏱️';
    }
  };

  const isLive = details?.status === 'live' || event.status === 'live';
  const scoreDisplay = details
    ? `${details.homeScore ?? '0'} - ${details.awayScore ?? '0'}`
    : 'VS';

  return (
    <div className="match-modal-backdrop" role="dialog" aria-modal="true">
      <div className="match-modal-card">
        {/* Header */}
        <div className="match-modal-header">
          <div className="match-modal-league">{event.league || event.sportLabel}</div>
          <div className="match-modal-scoreboard">
            {/* Home Team */}
            <div className="match-modal-team is-home">
              <span className="match-modal-team-name">{details?.homeTeam || event.home}</span>
              <div className="match-modal-crest">
                {(details?.homeLogo || event.homeLogo) ? (
                  <img src={details?.homeLogo || event.homeLogo} alt="" />
                ) : (
                  <span className="match-modal-crest-fallback">
                    {(details?.homeTeam || event.home).slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
            </div>

            {/* Score & Status */}
            <div className="match-modal-center-score">
              <div className="match-modal-score-num">{scoreDisplay}</div>
              <div className={`match-modal-status-badge ${isLive ? 'is-live' : ''}`}>
                {isLive ? (
                  <>
                    <span className="match-modal-live-dot" />
                    <span>{details?.periodDetail || 'EN VIVO'}</span>
                  </>
                ) : details?.status === 'finished' ? (
                  'FINALIZADO'
                ) : (
                  details?.periodDetail || 'PROGRAMADO'
                )}
              </div>
            </div>

            {/* Away Team */}
            <div className="match-modal-team is-away">
              <div className="match-modal-crest">
                {(details?.awayLogo || event.awayLogo) ? (
                  <img src={details?.awayLogo || event.awayLogo} alt="" />
                ) : (
                  <span className="match-modal-crest-fallback">
                    {(details?.awayTeam || event.away)?.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
              <span className="match-modal-team-name">{details?.awayTeam || event.away}</span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="match-modal-nav">
          <button
            className={`match-nav-tab ${activeTab === 'events' ? 'is-active' : ''} ${
              focusArea === 'nav' && navTabIndex === 0 ? 'is-focused' : ''
            }`}
            onClick={() => { setActiveTab('events'); setNavTabIndex(0); }}
          >
            Eventos
          </button>
          <button
            className={`match-nav-tab ${activeTab === 'lineups' ? 'is-active' : ''} ${
              focusArea === 'nav' && navTabIndex === 1 ? 'is-focused' : ''
            }`}
            onClick={() => { setActiveTab('lineups'); setNavTabIndex(1); }}
          >
            Alineaciones
          </button>
          <button
            className={`match-nav-tab ${activeTab === 'stats' ? 'is-active' : ''} ${
              focusArea === 'nav' && navTabIndex === 2 ? 'is-focused' : ''
            }`}
            onClick={() => { setActiveTab('stats'); setNavTabIndex(2); }}
          >
            Estadísticas
          </button>

          <button
            className={`match-nav-play-btn ${focusArea === 'play' ? 'is-focused' : ''}`}
            onClick={() => onPlay(event)}
          >
            <span>▶</span>
            <span>Ver Partido</span>
          </button>
        </div>

        {/* Tab Body */}
        <div className="match-modal-body" ref={bodyRef}>
          {loading ? (
            <div className="match-modal-empty">
              <span>Cargando detalles tácticos del partido…</span>
            </div>
          ) : !details ? (
            <div className="match-modal-empty">
              <span>No hay información táctica disponible para este partido.</span>
            </div>
          ) : activeTab === 'events' ? (
            details.events.length > 0 ? (
              <div className="match-timeline-container">
                {/* Timeline Team Header */}
                <div className="match-timeline-head">
                  <div className="timeline-team-indicator is-home">
                    <span className="timeline-team-name">{details.homeTeam}</span>
                  </div>
                  <div className="timeline-axis-label">
                    <span>LÍNEA DE TIEMPO</span>
                  </div>
                  <div className="timeline-team-indicator is-away">
                    <span className="timeline-team-name">{details.awayTeam}</span>
                  </div>
                </div>

                <div className="match-timeline-track">
                  {/* Central Spine */}
                  <div className="match-timeline-spine" />

                  {details.events.map((ev, idx) => {
                    const isHome = ev.teamSide === 'home';
                    const isFocused = focusArea === 'content' && contentIndex === idx;

                    return (
                      <div
                        key={ev.id || idx}
                        className={`match-timeline-row is-${ev.teamSide} ${isFocused ? 'is-focused' : ''}`}
                      >
                        {/* Left Column (Home Team events) */}
                        <div className="timeline-slot is-home">
                          {isHome && (
                            <div className="timeline-event-card is-home">
                              <div className="timeline-player-name">{ev.player}</div>
                              {ev.subPlayer && (
                                <div className="timeline-sub-player">
                                  <span className="timeline-sub-tag">Sale:</span> {ev.subPlayer}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Center Node on Axis */}
                        <div className="timeline-node">
                          <div className={`timeline-node-badge is-${ev.type}`}>
                            <span className="timeline-event-icon">{getEventIcon(ev.type)}</span>
                          </div>
                          <span className="timeline-time-badge">{ev.time}</span>
                        </div>

                        {/* Right Column (Away Team events) */}
                        <div className="timeline-slot is-away">
                          {!isHome && (
                            <div className="timeline-event-card is-away">
                              <div className="timeline-player-name">{ev.player}</div>
                              {ev.subPlayer && (
                                <div className="timeline-sub-player">
                                  <span className="timeline-sub-tag">Sale:</span> {ev.subPlayer}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="match-modal-empty">
                <span>Sin eventos registrados aún (goles, tarjetas, sustituciones).</span>
              </div>
            )
          ) : activeTab === 'lineups' ? (
            details.lineups ? (
              <div className="match-lineups-container">
                {/* Home Lineup */}
                <div className="match-lineup-col">
                  <div className="match-lineup-head">
                    <span className="match-lineup-side-label">Local</span>
                    {details.lineups.home.formation && (
                      <span className="match-lineup-formation">Formación: {details.lineups.home.formation}</span>
                    )}
                  </div>
                  <div className="match-sub-title">Titulares</div>
                  <div className="match-player-list">
                    {details.lineups.home.starters.map((p, pi) => (
                      <div
                        key={p.id || pi}
                        className={`match-player-row ${focusArea === 'content' && contentIndex === pi ? 'is-focused' : ''}`}
                      >
                        <span className="match-player-num">{p.jersey || '•'}</span>
                        <span className="match-player-name">{p.name}</span>
                        {p.position && <span className={`match-player-pos ${getPositionClass(p.position)}`}>{p.position}</span>}
                      </div>
                    ))}
                  </div>
                  {details.lineups.home.bench.length > 0 && (
                    <>
                      <div className="match-sub-title">Suplentes</div>
                      <div className="match-player-list">
                        {details.lineups.home.bench.map((p, pi) => {
                          const rIdx = details.lineups!.home.starters.length + pi;
                          return (
                            <div
                              key={p.id || pi}
                              className={`match-player-row ${focusArea === 'content' && contentIndex === rIdx ? 'is-focused' : ''}`}
                            >
                              <span className="match-player-num">{p.jersey || '•'}</span>
                              <span className="match-player-name">{p.name}</span>
                              {p.position && <span className={`match-player-pos ${getPositionClass(p.position)}`}>{p.position}</span>}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>

                {/* Away Lineup */}
                <div className="match-lineup-col">
                  <div className="match-lineup-head">
                    <span className="match-lineup-side-label">Visitante</span>
                    {details.lineups.away.formation && (
                      <span className="match-lineup-formation">Formación: {details.lineups.away.formation}</span>
                    )}
                  </div>
                  <div className="match-sub-title">Titulares</div>
                  <div className="match-player-list">
                    {details.lineups.away.starters.map((p, pi) => (
                      <div
                        key={p.id || pi}
                        className={`match-player-row ${focusArea === 'content' && contentIndex === pi ? 'is-focused' : ''}`}
                      >
                        <span className="match-player-num">{p.jersey || '•'}</span>
                        <span className="match-player-name">{p.name}</span>
                        {p.position && <span className={`match-player-pos ${getPositionClass(p.position)}`}>{p.position}</span>}
                      </div>
                    ))}
                  </div>
                  {details.lineups.away.bench.length > 0 && (
                    <>
                      <div className="match-sub-title">Suplentes</div>
                      <div className="match-player-list">
                        {details.lineups.away.bench.map((p, pi) => {
                          const rIdx = details.lineups!.away.starters.length + pi;
                          return (
                            <div
                              key={p.id || pi}
                              className={`match-player-row ${focusArea === 'content' && contentIndex === rIdx ? 'is-focused' : ''}`}
                            >
                              <span className="match-player-num">{p.jersey || '•'}</span>
                              <span className="match-player-name">{p.name}</span>
                              {p.position && <span className={`match-player-pos ${getPositionClass(p.position)}`}>{p.position}</span>}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="match-modal-empty">
                <span>Alineaciones no disponibles aún para este partido.</span>
              </div>
            )
          ) : (
            details.stats.length > 0 ? (
              <div className="match-stats-list">
                {details.stats.map((s, si) => (
                  <div key={s.label || si} className="match-stat-item">
                    <div className="match-stat-labels">
                      <span className="match-stat-val is-home">{s.homeValue}</span>
                      <span className="match-stat-title">{s.label}</span>
                      <span className="match-stat-val is-away">{s.awayValue}</span>
                    </div>
                    <div className="match-stat-bar-track">
                      <div
                        className="match-stat-bar-home"
                        style={{ width: `${s.homePercent ?? 50}%` }}
                      />
                      <div
                        className="match-stat-bar-away"
                        style={{ width: `${s.awayPercent ?? 50}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="match-modal-empty">
                <span>Estadísticas aún no disponibles para este encuentro.</span>
              </div>
            )
          )}
        </div>

        {/* Footer */}
        <div className="match-modal-footer">
          <span>
            <b>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 3 }}>
                <path d="M16 4l-10 8 10 8V4z" />
              </svg>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 5 }}>
                <path d="M8 4l10 8-10 8V4z" />
              </svg>
            </b>
            Cambiar pestaña
          </span>
          <span><b>▲ ▼</b> Desplazar contenido</span>
          <span><b>OK</b> Ver transmisión</span>
          <span><b>Atrás</b> Cerrar</span>
        </div>
      </div>
    </div>
  );
};

