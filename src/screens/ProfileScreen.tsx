import React, { useState, useEffect, useRef, useMemo } from 'react';
import pkg from '../../package.json';
import { PinMode } from '../lib/screenStack';
import { VodItem } from '../types/vod';
import { HistoryItem } from '../types/history';
import { LiveCategory } from '../types/channel';
import { historyService } from '../services/historyService';
import { favoritesService } from '../services/favoritesService';
import { settingsService } from '../services/settingsService';
import { parentalService } from '../services/parentalService';
import { diagnosticService, DiagReport } from '../services/diagnosticService';
import { useScreenKeys } from '../hooks/useScreenKeys';
import { ScreenHeader, BackIcon } from '../components/layout/Header';

interface ProfileScreenProps {
  isTop: boolean;
  hidden?: boolean;
  isSearchOpen?: boolean;
  initialSection?: number;
  liveCategories: LiveCategory[];
  catalogItems: VodItem[];
  onClose: () => void;
  onOpenHistory: (item: HistoryItem) => void;
  onOpenVod: (item: VodItem) => void;
  onRequestPin: (mode: PinMode, onSuccess?: () => void) => void;
}

interface Cell {
  id: string;
  onActivate: () => void;
}

const SECTIONS = [
  { id: 'account', label: 'Mi perfil', icon: '<circle cx="16" cy="10" r="5"/><path d="M6 27c.7-6 4.3-9 10-9s9.3 3 10 9"/>' },
  { id: 'playback', label: 'Configuración global', icon: '<rect x="4" y="6" width="24" height="20" rx="3"/><path d="M13 11l8 5-8 5z"/>' },
  { id: 'parental', label: 'Bloqueo', icon: '<rect x="7" y="14" width="18" height="14" rx="2"/><path d="M11 14V10a5 5 0 0 1 10 0v4"/><path d="M16 19v4"/>' },
  { id: 'diag', label: 'Diagnóstico', icon: '<path d="M3 13a19 19 0 0 1 26 0"/><path d="M8 18a12 12 0 0 1 16 0"/><path d="M13 23a6 6 0 0 1 6 0"/><circle cx="16" cy="27.5" r="1.2"/>' },
  { id: 'donate', label: 'Apoyo y Donaciones', icon: '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>' },
  { id: 'about', label: 'Sobre nosotros', icon: '<circle cx="16" cy="16" r="12"/><path d="M16 14v8M16 10h.1"/>' }
];

const VOD_TABS = [
  { id: 'peliculas', label: 'Películas' },
  { id: 'series', label: 'Series' },
  { id: 'kids', label: 'Kids' },
  { id: 'anime', label: 'Anime' }
];

const DISPLAY_OPTS = ['Ajustar (con bandas)', 'Pantalla completa', 'Automático'];
const AUDIO_OPTS = ['Español (Latino)', 'Español (España)', 'Portugués', 'Inglés'];
const SIZE_OPTS = ['Normal', 'Grande', 'Pequeño'];
const STYLE_OPTS = ['Aa', 'Aa', 'Aa'];
const GRID_COLS = 7;
const LOCK_COLS = 4;
const MAX_LIST = 30;

const VERDICTS: Record<string, { cls: string; text: string }> = {
  ok: { cls: 'ok', text: 'Todo correcto: el portal y los servidores de video responden.' },
  'no-internet': { cls: 'bad', text: 'Sin conexión a internet. Revisa la red del televisor.' },
  'doh-blocked': { cls: 'bad', text: 'La red bloquea el DNS seguro (Cloudflare por HTTPS).' },
  'portal-down': { cls: 'warn', text: 'El portal no responde. Puede estar caído o bloqueado en tu red.' },
  'no-cdn': { cls: 'warn', text: 'El portal responde pero no hay servidor de video disponible.' }
};

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = (m < 10 ? '0' : '') + m;
  const rr = (r < 10 ? '0' : '') + r;
  return h > 0 ? `${h}:${mm}:${rr}` : `${mm}:${rr}`;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  isTop,
  hidden = false,
  isSearchOpen = false,
  initialSection = 0,
  liveCategories,
  catalogItems,
  onClose,
  onOpenHistory,
  onOpenVod,
  onRequestPin
}) => {
  const [section, setSection] = useState<number>(initialSection);
  const [area, setArea] = useState<'menu' | 'panel'>('menu');
  const [focus, setFocus] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const [listTab, setListTab] = useState<'history' | 'favs'>('history');
  const [, setTick] = useState(0);
  const [report, setReport] = useState<DiagReport | null>(null);
  const [diagRunning, setDiagRunning] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const rerender = () => setTick(t => t + 1);

  useEffect(() => {
    const unsubs = [
      historyService.subscribe(rerender),
      favoritesService.subscribe(rerender),
      settingsService.subscribe(rerender),
      parentalService.subscribe(rerender)
    ];
    return () => unsubs.forEach(u => u());
  }, []);

  const settings = settingsService.get();
  const hasPin = parentalService.hasPin();

  const runDiag = () => {
    if (diagRunning) return;
    setDiagRunning(true);
    diagnosticService.run()
      .then(r => setReport(r))
      .catch(() => setReport({ verdict: 'portal-down', hosts: [], portalMs: null, cdns: 0 }))
      .then(() => setDiagRunning(false));
  };

  // Items shown in "Mi lista"
  const listItems = useMemo(() => {
    if (listTab === 'history') {
      return historyService.getHistory().slice(0, MAX_LIST).map(h => ({
        key: h.id,
        title: h.title,
        poster: h.poster,
        subtitle: h.series
          ? `Ya miró hasta ${h.episodeNumber ? 'epis. ' + h.episodeNumber : 'un episodio'}`
          : `Ya miró hasta ${formatTime(h.position)}`,
        open: () => onOpenHistory(h)
      }));
    }
    return favoritesService.getFavoriteIds().slice(0, MAX_LIST).map(id => {
      const vod = catalogItems.find(it => String(it.id) === id);
      return {
        key: id,
        title: vod ? vod.title : 'Contenido',
        poster: vod ? (vod.poster || vod.landscape || '') : '',
        subtitle: vod && vod.isSeries ? 'Serie' : 'Película',
        open: () => { if (vod) onOpenVod(vod); }
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listTab, catalogItems, historyService.getHistory().length, favoritesService.getFavoriteIds().join(',')]);

  const guardedToggle = (apply: () => void) => {
    if (parentalService.hasPin() && !parentalService.isSessionUnlocked()) {
      onRequestPin('unlock', apply);
    } else {
      apply();
    }
  };

  const lockCats = liveCategories.filter(c => !c.isFav && String(c.id) !== 'favs');

  // Build the focusable grid of the active panel: rows of cells.
  const rows: Cell[][] = (() => {
    const id = SECTIONS[section].id;
    const r: Cell[][] = [];
    if (id === 'account') {
      r.push([
        { id: 'tab-history', onActivate: () => { setListTab('history'); setFocus({ r: 0, c: 0 }); } },
        { id: 'tab-favs', onActivate: () => { setListTab('favs'); setFocus({ r: 0, c: 1 }); } }
      ]);
      for (let i = 0; i < listItems.length; i += GRID_COLS) {
        r.push(listItems.slice(i, i + GRID_COLS).map(it => ({ id: 'card-' + it.key, onActivate: it.open })));
      }
    } else if (id === 'playback') {
      const radio = (group: string, opts: string[], key: 'display' | 'audio' | 'subLang' | 'size' | 'style') =>
        r.push(opts.map((_, i) => ({ id: `${group}-${i}`, onActivate: () => settingsService.set({ [key]: i }) })));
      radio('display', DISPLAY_OPTS, 'display');
      radio('audio', AUDIO_OPTS, 'audio');
      r.push([{ id: 'subtitle', onActivate: () => settingsService.set({ subtitle: !settings.subtitle }) }]);
      radio('subLang', AUDIO_OPTS, 'subLang');
      radio('size', SIZE_OPTS, 'size');
      radio('style', STYLE_OPTS, 'style');
    } else if (id === 'parental') {
      if (!hasPin) {
        r.push([{ id: 'create', onActivate: () => onRequestPin('create') }]);
      } else {
        r.push([
          { id: 'change', onActivate: () => onRequestPin('change') },
          { id: 'disable', onActivate: () => onRequestPin('disable') }
        ]);
        for (let i = 0; i < lockCats.length; i += LOCK_COLS) {
          r.push(lockCats.slice(i, i + LOCK_COLS).map(c => ({
            id: 'live-' + c.id,
            onActivate: () => guardedToggle(() => parentalService.toggleLiveCat(c.id))
          })));
        }
        r.push(VOD_TABS.map(t => ({
          id: 'tab-' + t.id,
          onActivate: () => guardedToggle(() => parentalService.toggleVodTab(t.id))
        })));
      }
    } else if (id === 'diag') {
      r.push([{ id: 'run', onActivate: runDiag }]);
    } else if (id === 'donate') {
      r.push([{ id: 'donate-qr', onActivate: () => {} }]);
    }
    return r;
  })();

  const focusedId = area === 'panel' && rows[focus.r] && rows[focus.r][focus.c] ? rows[focus.r][focus.c].id : '';
  const isF = (cellId: string) => focusedId === cellId;

  // Mouse / pointer: a click focuses the cell and activates it, like OK on the remote
  const tap = (cellId: string) => () => {
    for (let r = 0; r < rows.length; r++) {
      const c = rows[r].findIndex(cell => cell.id === cellId);
      if (c !== -1) {
        setArea('panel');
        setFocus({ r, c });
        rows[r][c].onActivate();
        return;
      }
    }
  };

  useEffect(() => {
    if (!focusedId || !panelRef.current) return;
    const el = panelRef.current.querySelector('.is-focused') as HTMLElement | null;
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [focusedId]);

  useScreenKeys(key => {
    if (area === 'menu') {
      if (key === 'up') setSection(s => Math.max(0, s - 1));
      else if (key === 'down') setSection(s => Math.min(SECTIONS.length - 1, s + 1));
      else if (key === 'right' || key === 'enter') {
        if (rows.length > 0) {
          setArea('panel');
          setFocus({ r: 0, c: 0 });
        }
      } else if (key === 'back') onClose();
      return;
    }
    // panel
    if (key === 'back') {
      setArea('menu');
      return;
    }
    if (key === 'up') {
      if (focus.r > 0) {
        const nr = focus.r - 1;
        setFocus({ r: nr, c: Math.min(focus.c, rows[nr].length - 1) });
      }
    } else if (key === 'down') {
      if (focus.r < rows.length - 1) {
        const nr = focus.r + 1;
        setFocus({ r: nr, c: Math.min(focus.c, rows[nr].length - 1) });
      }
    } else if (key === 'left') {
      if (focus.c > 0) setFocus({ ...focus, c: focus.c - 1 });
      else setArea('menu');
    } else if (key === 'right') {
      if (focus.c < rows[focus.r].length - 1) setFocus({ ...focus, c: focus.c + 1 });
    } else if (key === 'enter') {
      const cell = rows[focus.r] && rows[focus.r][focus.c];
      if (cell) cell.onActivate();
    }
  }, isTop && !hidden && !isSearchOpen);

  // Keep focus inside the grid when its shape changes (e.g. switching list tab)
  useEffect(() => {
    if (area !== 'panel') return;
    if (!rows[focus.r]) setFocus({ r: Math.max(0, rows.length - 1), c: 0 });
    else if (!rows[focus.r][focus.c]) setFocus({ r: focus.r, c: Math.max(0, rows[focus.r].length - 1) });
  });

  const profileId = (() => {
    try {
      const raw = localStorage.getItem('xuper_local_profile_v1');
      return raw ? JSON.parse(raw).id || '—' : '—';
    } catch (e) {
      return '—';
    }
  })();

  const radioRow = (label: string, group: string, opts: string[], selected: number) => (
    <div className="pf-row">
      <div className="pf-row-label">{label}</div>
      <div className="pf-row-opts">
        {opts.map((o, i) => (
          <div key={i} className={`pf-opt ${i === selected ? 'is-checked' : ''} ${isF(`${group}-${i}`) ? 'is-focused' : ''}`} onClick={tap(`${group}-${i}`)}>
            <span className="pf-radio" />
            <span className={group === 'style' ? `pf-style-${i}` : ''}>{o}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const renderPanel = () => {
    const id = SECTIONS[section].id;

    if (id === 'account') {
      return (
        <div className="pf-list">
          <div className="pf-account">
            <div className="pf-avatar">
              <svg viewBox="0 0 32 32" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="2"
                dangerouslySetInnerHTML={{ __html: SECTIONS[0].icon }} />
            </div>
            <div className="pf-account-info">
              <div className="pf-account-id">{profileId}</div>
              <div className="pf-account-type">Perfil local de este televisor · sin registro ni contraseña, tus datos no salen del TV</div>
            </div>
          </div>
          <div className="pf-hr" />
          <div className="pf-tabs">
            <div className={`pf-tab ${listTab === 'history' ? 'is-selected' : ''} ${isF('tab-history') ? 'is-focused' : ''}`} onClick={tap('tab-history')}>Historial</div>
            <div className={`pf-tab ${listTab === 'favs' ? 'is-selected' : ''} ${isF('tab-favs') ? 'is-focused' : ''}`} onClick={tap('tab-favs')}>Mis favoritos</div>
            <div className="pf-total">Total <span>{listItems.length}</span></div>
          </div>
          {listItems.length === 0 ? (
            <div className="pf-empty">No hay títulos para mostrar todavía.</div>
          ) : (
            <div className="pf-grid">
              {listItems.map(it => (
                <div key={it.key} className={`pf-card-item ${isF('card-' + it.key) ? 'is-focused' : ''}`} onClick={tap('card-' + it.key)}>
                  <div className="pf-poster">
                    <img src={it.poster || 'assets/placeholder_vertical.png'} alt="" loading="lazy" />
                  </div>
                  <div className="pf-card-progress">{it.subtitle}</div>
                  <div className="pf-card-name">{it.title}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (id === 'playback') {
      return (
        <div className="pf-playback">
          <h2 className="pf-title">Configuración global de reproducción</h2>
          <p className="pf-note">Estas preferencias se aplican automáticamente a todas las películas y series nuevas.</p>
          {radioRow('Formato de pantalla', 'display', DISPLAY_OPTS, settings.display)}
          {radioRow('Audio preferido', 'audio', AUDIO_OPTS, settings.audio)}
          <div className="pf-hr" />
          <h3 className="pf-subtitle">Subtítulos</h3>
          <div className="pf-row">
            <div className="pf-row-label">Activar subtítulos</div>
            <div className={`pf-switch ${settings.subtitle ? 'on' : 'off'} ${isF('subtitle') ? 'is-focused' : ''}`} onClick={tap('subtitle')}>
              <span className="pf-switch-knob" />
            </div>
          </div>
          {radioRow('Idioma', 'subLang', AUDIO_OPTS, settings.subLang)}
          {radioRow('Tamaño', 'size', SIZE_OPTS, settings.size)}
          {radioRow('Estilo', 'style', STYLE_OPTS, settings.style)}
        </div>
      );
    }

    if (id === 'parental') {
      if (!hasPin) {
        return (
          <div className="pf-parental">
            <h2 className="pf-title">Control parental</h2>
            <p className="pf-note">
              Crea un PIN de 4 dígitos para proteger las categorías de TV en vivo y las pestañas de contenido que elijas.
              Si lo olvidas, deberás reinstalar la app.
            </p>
            <div className={`pf-btn ${isF('create') ? 'is-focused' : ''}`} onClick={tap('create')}>Crear PIN</div>
          </div>
        );
      }
      return (
        <div className="pf-parental">
          <h2 className="pf-title">Control parental</h2>
          <p className="pf-note">
            Las categorías marcadas piden el PIN al abrirlas. Tras desbloquear, no se vuelve a pedir hasta cerrar la app.
          </p>
          <div className="pf-btn-row">
            <div className={`pf-btn ${isF('change') ? 'is-focused' : ''}`} onClick={tap('change')}>Cambiar PIN</div>
            <div className={`pf-btn pf-btn-danger ${isF('disable') ? 'is-focused' : ''}`} onClick={tap('disable')}>Desactivar bloqueo</div>
          </div>
          <h3 className="pf-subtitle">Canales en vivo</h3>
          <div className="pf-lock-grid">
            {lockCats.map(c => (
              <div key={String(c.id)} className={`pf-lock-item ${isF('live-' + c.id) ? 'is-focused' : ''}`} onClick={tap('live-' + c.id)}>
                <span>{c.name}</span>
                <span className={`pf-lock-badge ${parentalService.isLiveCatMarked(c.id) ? 'on' : ''}`}>
                  {parentalService.isLiveCatMarked(c.id) ? 'Bloqueada' : 'Libre'}
                </span>
              </div>
            ))}
          </div>
          <h3 className="pf-subtitle">Pestañas de contenido</h3>
          <div className="pf-lock-grid">
            {VOD_TABS.map(t => (
              <div key={t.id} className={`pf-lock-item ${isF('tab-' + t.id) ? 'is-focused' : ''}`} onClick={tap('tab-' + t.id)}>
                <span>{t.label}</span>
                <span className={`pf-lock-badge ${parentalService.isVodTabMarked(t.id) ? 'on' : ''}`}>
                  {parentalService.isVodTabMarked(t.id) ? 'Bloqueada' : 'Libre'}
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (id === 'diag') {
      const verdict = report ? VERDICTS[report.verdict] : null;
      return (
        <div className="pf-diag">
          <h2 className="pf-title">Diagnóstico de red</h2>
          <p className="pf-note">
            Comprueba si el televisor llega a los servidores de XuperTV. Prueba el DNS seguro, el portal y los servidores de video.
          </p>
          <div className="pf-diag-top">
            <div className={`pf-btn ${isF('run') ? 'is-focused' : ''}`} onClick={tap('run')}>
              {diagRunning ? 'Analizando…' : report ? 'Analizar de nuevo' : 'Analizar red'}
            </div>
            <div className={`pf-diag-summary ${verdict ? verdict.cls : ''}`}>
              {diagRunning
                ? 'Consultando DNS seguro, portal y servidores…'
                : verdict
                  ? verdict.text
                  : 'Pulsa "Analizar red" para empezar.'}
            </div>
          </div>
          {report && !diagRunning && (
            <>
              <div className="pf-diag-meta">
                Portal: {report.portalMs !== null ? `${report.portalMs} ms` : 'sin respuesta'} · Servidores de video: {report.cdns}
              </div>
              <div className="pf-diag-table">
                <div className="pf-diag-row pf-diag-head">
                  <span>Dominio</span><span>Estado</span><span>Dirección (DNS seguro)</span>
                </div>
                {report.hosts.map(h => (
                  <div key={h.host} className="pf-diag-row">
                    <span>{h.host}</span>
                    <span className={h.ok ? 'ok' : 'bad'}>{h.ok ? 'Correcto' : 'Sin respuesta'}</span>
                    <span>{h.ips.join(', ') || '—'}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      );
    }

    if (id === 'donate') {
      return (
        <div className="pf-donate-view">
          <h2 className="pf-title">Donaciones y Apoyo al Proyecto</h2>
          <div className="pf-hr" />
          <div className="pf-donate-content">
            <div className={`pf-donate-card ${isF('donate-qr') ? 'is-focused' : ''}`} onClick={tap('donate-qr')}>
              <img
                src="assets/paypal-donation-qr.png"
                alt="Código QR de Donación PayPal"
                className="pf-donate-qr"
              />
              <div className="pf-donate-badge">PayPal Oficial</div>
            </div>
            <div className="pf-donate-info">
              <h3 className="pf-donate-heading">Apoya el desarrollo de TizenXuper TV</h3>
              <p className="pf-donate-text">
                TizenXuper TV es un proyecto comunitario optimizado para televisores Samsung Tizen.
                Tu aporte voluntario nos permite costear la infraestructura de servidores, mantener las listas y guías actualizadas, y seguir desarrollando mejoras y nuevas funciones.
              </p>
              <div className="pf-donate-steps">
                <div className="pf-donate-step">
                  <span className="pf-step-num">1</span>
                  <span>Abre la cámara de tu teléfono móvil o lector de códigos QR.</span>
                </div>
                <div className="pf-donate-step">
                  <span className="pf-step-num">2</span>
                  <span>Apunta directamente al código QR en la pantalla del televisor.</span>
                </div>
                <div className="pf-donate-step">
                  <span className="pf-step-num">3</span>
                  <span>Ingresa de forma segura a PayPal para realizar tu contribución voluntaria.</span>
                </div>
              </div>
              <p className="pf-donate-thanks">¡Muchas gracias por apoyar a la comunidad de TizenXuper TV!</p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="pf-about">
        <h2 className="pf-title">Sobre nosotros</h2>
        <div className="pf-hr" />
        <p className="pf-about-body">
          Xuper TV se dedica a ofrecer a los usuarios una amplia variedad de recursos de alta calidad. Aquí encontrarás
          miles de películas, series, animes y canales en vivo, todo reunido en un solo lugar. Brindamos una experiencia
          estable, diversa y siempre actualizada, además de contenidos gratuitos para disfrutar.
        </p>
        <div className="pf-about-port">TizenXuperTV · v{(pkg as any).version}</div>
        <h3 className="pf-subtitle">Compartir la app</h3>
        <p className="pf-about-body">
          Para instalar XuperTV en otro televisor Samsung necesitas el paquete .wgt de la app. El historial de este perfil
          permanece privado en este TV.
        </p>
      </div>
    );
  };

  return (
    <div className="profile-screen" style={hidden ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}>
      <ScreenHeader
        title="Perfil"
        actions={[{ id: 'back', title: 'Volver', icon: BackIcon, onClick: onClose }]}
      />
      <div className="profile-body">
      <aside className="pf-menu">
        <div className="pf-menu-title">Ajustes</div>
        {SECTIONS.map((s, i) => (
          <div
            key={s.id}
            className={`pf-menu-item ${i === section ? 'is-selected' : ''} ${area === 'menu' && i === section ? 'is-focused' : ''}`}
            onClick={() => {
              setSection(i);
              setArea('menu');
            }}
          >
            <svg viewBox="0 0 32 32" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4"
              dangerouslySetInnerHTML={{ __html: s.icon }} />
            <span>{s.label}</span>
          </div>
        ))}
      </aside>
      <section className="pf-panel" ref={panelRef}>
        {renderPanel()}
      </section>
      </div>
    </div>
  );
};
