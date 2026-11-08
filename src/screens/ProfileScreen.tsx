import React, { useState, useEffect, useRef, useMemo } from 'react';
import { PinMode } from '../lib/screenStack';
import { VodItem } from '../types/vod';
import { HistoryItem } from '../types/history';
import { LiveCategory } from '../types/channel';
import { historyService } from '../services/historyService';
import { favoritesService } from '../services/favoritesService';
import { settingsService } from '../services/settingsService';
import { parentalService } from '../services/parentalService';
import { diagnosticService, DiagReport } from '../services/diagnosticService';
import { iptvService, IPTV_LISTS } from '../services/iptvService';
import { HIDEABLE_TABS, tabPrefs } from '../services/tabPrefs';
import { accountService, tvBuildInfo } from '../services/accountService';
import { updateService, type UpdateStatus } from '../services/updateService';
import { playbackEvents } from '../lib/playbackLog';
import { formatSpeed, runSpeedTest, SpeedResult, streamingVerdict } from '../lib/speedTest';
import { useScreenKeys } from '../hooks/useScreenKeys';
import { ScreenHeader, BackIcon } from '../components/layout/Header';
import { QrCode } from '../components/common/QrCode';

/** Perfil › Sobre nosotros: what the self-update is doing on this TV */
function updateLine(s: UpdateStatus): string {
  if (!s.canSelfUpdate) return 'Esta TV no puede actualizarse sola: las versiones nuevas se instalan con Apps2Samsung.';
  if (s.needsReinstall) return 'Hay una versión nueva que se instala con Apps2Samsung.';
  if (s.downloaded) return `Versión ${s.downloaded} descargada: se usará la próxima vez que abras la app.`;
  const installed = s.running && s.running !== s.packaged ? ` · instalada ${s.packaged}` : '';
  const last = s.lastCheck && !s.lastCheck.error ? new Date(s.lastCheck.at) : null;
  const pad = (n: number) => (n < 10 ? '0' : '') + n;
  return last
    ? `Al día · comprobado a las ${pad(last.getHours())}:${pad(last.getMinutes())}${installed}`
    : `Se actualiza sola${installed}`;
}

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
  { id: 'tabs', label: 'Pestañas', icon: '<rect x="4" y="8" width="24" height="18" rx="2"/><path d="M4 13h24M12 8v5M20 8v5"/>' },
  { id: 'parental', label: 'Bloqueo', icon: '<rect x="7" y="14" width="18" height="14" rx="2"/><path d="M11 14V10a5 5 0 0 1 10 0v4"/><path d="M16 19v4"/>' },
  { id: 'iptv', label: 'TV abierta', icon: '<rect x="4" y="9" width="24" height="16" rx="2"/><path d="M11 4l5 5 5-5"/><path d="M12 29h8"/>' },
  { id: 'diag', label: 'Diagnóstico', icon: '<path d="M3 13a19 19 0 0 1 26 0"/><path d="M8 18a12 12 0 0 1 16 0"/><path d="M13 23a6 6 0 0 1 6 0"/><circle cx="16" cy="27.5" r="1.2"/>' },
  { id: 'donate', label: 'Apoyo y Donaciones', icon: '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>' },
  { id: 'about', label: 'Sobre nosotros', icon: '<circle cx="16" cy="16" r="12"/><path d="M16 14v8M16 10h.1"/>' }
];


const DISPLAY_OPTS = ['Ajustar (con bandas)', 'Pantalla completa', 'Automático'];
const TEXT_SIZE_OPTS = ['Normal', 'Grande'];
const AUDIO_OPTS = ['Español (Latino)', 'Español (España)', 'Portugués', 'Inglés'];
const SIZE_OPTS = ['Normal', 'Grande', 'Pequeño'];
const STYLE_OPTS = ['Aa', 'Aa', 'Aa'];
const GRID_COLS = 7;
const IPTV_COLUMNS = 3;

/** Telegram places, as QR codes: the TV cannot open links. Channel and group are invitations with approval */
const TELEGRAM_LINKS = [
  { name: 'Soporte', desc: 'Ayuda y reportes', url: 'https://t.me/TizenXuperSupportBot?start=soporte' },
  { name: 'Canal', desc: 'Novedades y versiones', url: 'https://t.me/+u72Cmxw-HDY0NGMx' },
  { name: 'Comunidad', desc: 'Habla con otros usuarios', url: 'https://t.me/+jbQgGArewEozMzZh' }
];
const MAX_LIST = 30;
/** "Cerrar sesión" needs a second OK within this time */
const LOGOUT_CONFIRM_MS = 4000;
/** How long the message after removing titles stays */
const NOTICE_MS = 3000;

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
  // Internet speed test: result, live speed while it runs, and a failure
  const [speed, setSpeed] = useState<SpeedResult | null>(null);
  const [speedRunning, setSpeedRunning] = useState(false);
  const [speedLive, setSpeedLive] = useState<number | null>(null);
  const [speedError, setSpeedError] = useState(false);
  const speedAbort = useRef<AbortController | null>(null);
  // "Buscar actualizaciones" in Sobre nosotros: running, and what the last check found
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateResult, setUpdateResult] = useState<'uptodate' | 'downloaded' | 'reinstall' | 'error' | null>(null);
  const mountedRef = useRef(true);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [reportState, setReportState] = useState<'idle' | 'sending' | 'ok' | 'too_many' | 'signed_out' | 'error'>('idle');
  const [loggingOut, setLoggingOut] = useState(false);
  // "Borrar historial": confirmation (0 = Cancelar, selected first; 1 = Sí, borrar) and the result message
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearChoice, setClearChoice] = useState<0 | 1>(0);
  // Short message after removing titles ("Historial borrado", "… quitado de favoritos")
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  // "Quitar títulos": while on, OK on a title removes it from the list shown
  const [editMode, setEditMode] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const rerender = () => setTick(t => t + 1);

  useEffect(() => {
    const unsubs = [
      historyService.subscribe(rerender),
      favoritesService.subscribe(rerender),
      settingsService.subscribe(rerender),
      parentalService.subscribe(rerender),
      iptvService.subscribe(rerender),
      accountService.subscribe(rerender),
      updateService.subscribe(rerender),
      tabPrefs.subscribe(rerender)
    ];
    return () => {
      unsubs.forEach(u => u());
      // Leaving the screen stops a speed test that is still downloading, and keeps "Diagnosticar" from starting one
      mountedRef.current = false;
      if (speedAbort.current) speedAbort.current.abort();
    };
  }, []);

  // Problem report for support: TV, network, last network check and recent playback events
  const sendReport = () => {
    if (reportState === 'sending') return;
    setReportState('sending');
    const { version, model } = accountService.deviceInfo();
    let network = '';
    try {
      const w = window as any;
      const type = w.webapis && w.webapis.network ? w.webapis.network.getActiveConnectionType() : -1;
      network = ['Sin conexión', 'Wi-Fi', 'Datos móviles', 'Cable'][type] || '';
    } catch (e) {}
    // Formats the in-app player (HLS.js over MediaSource) can decode on this TV
    const formats: Array<[string, string]> = [
      ['H264', 'video/mp4; codecs="avc1.64001f"'],
      ['HEVC', 'video/mp4; codecs="hvc1.1.6.L120.90"'],
      ['AAC', 'audio/mp4; codecs="mp4a.40.2"'],
      ['MP3', 'audio/mpeg'],
      ['MP3/mp4', 'audio/mp4; codecs="mp3"'],
      ['AC3', 'audio/mp4; codecs="ac-3"'],
      ['EAC3', 'audio/mp4; codecs="ec-3"']
    ];
    let caps = '';
    try {
      const MS = (window as any).MediaSource;
      caps = formats.map(([name, type]) => `${name} ${MS && MS.isTypeSupported(type) ? '✓' : '✗'}`).join(' · ');
    } catch (e) {}
    const now = new Date();
    const local = `${now.getHours() < 10 ? '0' : ''}${now.getHours()}:${now.getMinutes() < 10 ? '0' : ''}${now.getMinutes()}`;
    const build = tvBuildInfo();
    accountService.sendReport({
      app: version,
      model,
      network,
      screen: `${window.screen.width}x${window.screen.height}`,
      diag: report ? { verdict: report.verdict, portalMs: report.portalMs, cdns: report.cdns } : null,
      events: [
        ...playbackEvents(),
        ...(build ? [{ at: now.getTime(), local, kind: 'info', channel: 'Televisor', detail: build }] : []),
        ...(caps ? [{ at: now.getTime(), local, kind: 'info', channel: 'Formatos del reproductor', detail: caps }] : []),
        ...(speed ? [{
          at: now.getTime(), local, kind: 'info', channel: 'Velocidad de internet',
          detail: `${formatSpeed(speed.mbps)}${speed.latencyMs !== null ? ` · latencia ${speed.latencyMs} ms` : ''}`
        }] : [])
      ]
    }).then(setReportState);
  };

  // First OK asks for confirmation; the second signs out and restarts at the sign-in screen
  useEffect(() => {
    if (!confirmLogout) return;
    const t = setTimeout(() => setConfirmLogout(false), LOGOUT_CONFIRM_MS);
    return () => clearTimeout(t);
  }, [confirmLogout]);
  const logout = () => {
    if (loggingOut) return;
    if (!confirmLogout) {
      setConfirmLogout(true);
      return;
    }
    setLoggingOut(true);
    accountService.logout().then(() => window.location.reload());
  };

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);
  const clearHistory = () => {
    const ok = historyService.clearHistory();
    setConfirmClear(false);
    setEditMode(false);
    setNotice(ok ? { text: 'Historial borrado' } : { text: 'No se pudo borrar el historial. Inténtalo de nuevo.', error: true });
    setFocus({ r: 1, c: 0 });
  };
  const removeFromList = (id: string, title: string) => {
    const fromHistory = listTab === 'history';
    const ok = fromHistory ? historyService.removeEntry(id) : favoritesService.removeFavorite(id);
    setNotice(ok
      ? { text: `«${title}» quitado ${fromHistory ? 'del historial' : 'de mi lista'}` }
      : { text: 'No se pudo quitar. Inténtalo de nuevo.', error: true });
  };
  // Edit mode ends when the list changes tab or section, or runs out of titles
  useEffect(() => { setEditMode(false); }, [listTab, section]);
  const historyCount = historyService.getHistory().length;

  const settings = settingsService.get();
  const hasPin = parentalService.hasPin();

  const runDiag = (): Promise<void> => {
    if (diagRunning) return Promise.resolve();
    setDiagRunning(true);
    return diagnosticService.run()
      .then(r => setReport(r))
      .catch(() => setReport({ verdict: 'portal-down', hosts: [], portalMs: null, cdns: 0 }))
      .then(() => setDiagRunning(false));
  };

  const runSpeed = (): Promise<void> => {
    if (speedRunning) return Promise.resolve();
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    speedAbort.current = ctrl;
    setSpeedRunning(true);
    setSpeedError(false);
    setSpeedLive(null);
    return runSpeedTest({
      signal: ctrl ? ctrl.signal : undefined,
      onProgress: p => { if (p.phase === 'download') setSpeedLive(p.mbps); }
    })
      .then(r => setSpeed(r))
      .catch(() => { if (!(ctrl && ctrl.signal.aborted)) setSpeedError(true); })
      .then(() => setSpeedRunning(false));
  };

  const checkUpdates = () => {
    if (updateChecking) return;
    setUpdateChecking(true);
    setUpdateResult(null);
    updateService.check()
      .then(() => {
        const st = updateService.status();
        setUpdateResult(st.downloaded ? 'downloaded' : st.needsReinstall ? 'reinstall' : st.lastCheck && st.lastCheck.error ? 'error' : 'uptodate');
      })
      .then(() => setUpdateChecking(false));
  };

  // One button runs every check: first the servers (a few seconds), then the speed, so the two do not compete for the line
  const runAll = () => {
    if (diagRunning || speedRunning) return;
    runDiag().then(() => { if (mountedRef.current) runSpeed(); });
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
        open: () => onOpenHistory(h),
        remove: () => removeFromList(String(h.id), h.title)
      }));
    }
    return favoritesService.getFavoriteIds().slice(0, MAX_LIST).map(id => {
      const vod = catalogItems.find(it => String(it.id) === id);
      return {
        key: id,
        title: vod ? vod.title : 'Contenido',
        poster: vod ? (vod.poster || vod.landscape || '') : '',
        subtitle: vod && vod.isSeries ? 'Serie' : 'Película',
        open: () => { if (vod) onOpenVod(vod); },
        remove: () => removeFromList(id, vod ? vod.title : 'Contenido')
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listTab, catalogItems, historyService.getHistory().length, favoritesService.getFavoriteIds().join(',')]);


  useEffect(() => {
    if (editMode && listItems.length === 0) setEditMode(false);
  }, [editMode, listItems.length]);

  // Build the focusable grid of the active panel: rows of cells.
  const rows: Cell[][] = (() => {
    const id = SECTIONS[section].id;
    const r: Cell[][] = [];
    if (id === 'account') {
      r.push([{ id: 'logout', onActivate: logout }]);
      const tabs: Cell[] = [
        { id: 'tab-history', onActivate: () => { setListTab('history'); setFocus({ r: 1, c: 0 }); } },
        { id: 'tab-favs', onActivate: () => { setListTab('favs'); setFocus({ r: 1, c: 1 }); } }
      ];
      if (listItems.length > 0) {
        tabs.push({ id: 'edit-list', onActivate: () => setEditMode(e => !e) });
      }
      if (listTab === 'history' && historyCount > 0) {
        tabs.push({ id: 'clear-history', onActivate: () => { setClearChoice(0); setConfirmClear(true); } });
      }
      r.push(tabs);
      for (let i = 0; i < listItems.length; i += GRID_COLS) {
        r.push(listItems.slice(i, i + GRID_COLS).map(it => ({ id: 'card-' + it.key, onActivate: editMode ? it.remove : it.open })));
      }
    } else if (id === 'playback') {
      const radio = (group: string, opts: string[], key: 'display' | 'audio' | 'subLang' | 'size' | 'style' | 'textSize') =>
        r.push(opts.map((_, i) => ({ id: `${group}-${i}`, onActivate: () => settingsService.set({ [key]: i }) })));
      radio('textSize', TEXT_SIZE_OPTS, 'textSize');
      radio('display', DISPLAY_OPTS, 'display');
      radio('audio', AUDIO_OPTS, 'audio');
      r.push([{ id: 'subtitle', onActivate: () => settingsService.set({ subtitle: !settings.subtitle }) }]);
      radio('subLang', AUDIO_OPTS, 'subLang');
      radio('size', SIZE_OPTS, 'size');
      radio('style', STYLE_OPTS, 'style');
    } else if (id === 'tabs') {
      // One row of cards, like TV abierta: ◄ ► move between them
      r.push(HIDEABLE_TABS.map(t => ({ id: `tab-${t.id}`, onActivate: () => tabPrefs.setHidden(t.id, !tabPrefs.isHidden(t.id)) })));
    } else if (id === 'parental') {
      if (!hasPin) {
        r.push([{ id: 'create', onActivate: () => onRequestPin('create') }]);
      } else {
        r.push([
          { id: 'change', onActivate: () => onRequestPin('change') },
          { id: 'disable', onActivate: () => onRequestPin('disable') }
        ]);
        // +18 section: turning it on always asks the PIN; turning it off does not
        r.push([{
          id: 'adult',
          onActivate: () => {
            if (parentalService.isAdultEnabled()) parentalService.setAdultEnabled(false);
            else onRequestPin('unlock', () => parentalService.setAdultEnabled(true));
          }
        }]);
      }
    } else if (id === 'iptv') {
      // A grid of IPTV_COLUMNS cards per row: ◄ ► move along a row, ▲ ▼ between rows
      for (let i = 0; i < IPTV_LISTS.length; i += IPTV_COLUMNS) {
        r.push(IPTV_LISTS.slice(i, i + IPTV_COLUMNS).map(l => ({ id: `iptv-${l.id}`, onActivate: () => iptvService.setEnabled(l.id, !iptvService.isEnabled(l.id)) })));
      }
    } else if (id === 'diag') {
      r.push([{ id: 'run', onActivate: runAll }, { id: 'report', onActivate: sendReport }]);
    } else if (id === 'about') {
      const st = updateService.status();
      if (st.canSelfUpdate) {
        // Restarting is reloading: the loader then starts the downloaded version (public/js/boot.js)
        r.push([{ id: 'update-check', onActivate: checkUpdates }, ...(st.downloaded ? [{ id: 'update-restart', onActivate: () => window.location.reload() }] : [])]);
      }
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
    // Clear-history confirmation: left/right choose, OK confirms the choice, Back cancels
    if (confirmClear) {
      if (key === 'left' || key === 'right') setClearChoice(c => (c === 0 ? 1 : 0));
      else if (key === 'back') setConfirmClear(false);
      else if (key === 'enter') {
        if (clearChoice === 1) clearHistory();
        else setConfirmClear(false);
      }
      return;
    }
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
      if (editMode) setEditMode(false);
      else setArea('menu');
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

  const account = accountService.session();

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
              <div className="pf-account-id">{account ? account.name || 'Usuario de Telegram' : '—'}</div>
              <div className="pf-account-type">
                Sesión iniciada con Telegram{account && account.username ? ` (@${account.username})` : ''} · tu historial y tu lista se quedan en este TV
              </div>
            </div>
            <div className={`pf-btn pf-btn-danger pf-logout ${isF('logout') ? 'is-focused' : ''}`} onClick={tap('logout')}>
              {loggingOut ? 'Cerrando sesión…' : confirmLogout ? 'Pulsa OK otra vez para salir' : 'Cerrar sesión'}
            </div>
          </div>
          <div className="pf-hr" />
          <div className="pf-tabs">
            <div className={`pf-tab ${listTab === 'history' ? 'is-selected' : ''} ${isF('tab-history') ? 'is-focused' : ''}`} onClick={tap('tab-history')}>Historial</div>
            <div className={`pf-tab ${listTab === 'favs' ? 'is-selected' : ''} ${isF('tab-favs') ? 'is-focused' : ''}`} onClick={tap('tab-favs')}>Mi lista</div>
            {listItems.length > 0 && (
              <div className={`pf-btn pf-list-action ${editMode ? 'is-on' : ''} ${isF('edit-list') ? 'is-focused' : ''}`} onClick={tap('edit-list')}>
                {editMode ? 'Listo' : 'Quitar títulos'}
              </div>
            )}
            {listTab === 'history' && historyCount > 0 && (
              <div className={`pf-btn pf-btn-danger pf-list-action ${isF('clear-history') ? 'is-focused' : ''}`} onClick={tap('clear-history')}>Borrar historial</div>
            )}
            <div className="pf-total">Total <span>{listItems.length}</span></div>
          </div>
          {editMode && listItems.length > 0 && (
            <div className="pf-edit-hint">Elige un título y pulsa OK para quitarlo. Pulsa Atrás o «Listo» para terminar.</div>
          )}
          {listItems.length === 0 ? (
            <div className="pf-empty">No hay títulos para mostrar todavía.</div>
          ) : (
            <div className="pf-grid">
              {listItems.map(it => (
                <div key={it.key} className={`pf-card-item ${editMode ? 'is-removing' : ''} ${isF('card-' + it.key) ? 'is-focused' : ''}`} onClick={tap('card-' + it.key)}>
                  <div className="pf-poster">
                    <img src={it.poster || 'assets/placeholder_vertical.png'} alt="" loading="lazy" />
                  </div>
                  <div className="pf-card-progress">{it.subtitle}</div>
                  <div className="pf-card-name">{it.title}</div>
                </div>
              ))}
            </div>
          )}
          {confirmClear && (
            <div className="pf-confirm" role="dialog" aria-modal="true">
              <div className="pf-confirm-card">
                <h2 className="pf-confirm-title">¿Borrar el historial?</h2>
                <p className="pf-confirm-text">
                  Se borran los títulos vistos y el progreso de películas y episodios en este TV. Tus favoritos y ajustes no cambian.
                </p>
                <div className="pf-btn-row">
                  <div className={`pf-btn ${clearChoice === 0 ? 'is-focused' : ''}`} onClick={() => setConfirmClear(false)}>Cancelar</div>
                  <div className={`pf-btn pf-btn-danger ${clearChoice === 1 ? 'is-focused' : ''}`} onClick={clearHistory}>Sí, borrar</div>
                </div>
              </div>
            </div>
          )}
          {notice && <div className={`pf-toast ${notice.error ? 'is-error' : ''}`}>{notice.text}</div>}
        </div>
      );
    }

    if (id === 'playback') {
      return (
        <div className="pf-playback">
          <h2 className="pf-title">Configuración global</h2>
          <p className="pf-note">El tamaño del texto se aplica a toda la app; el resto, a todas las películas y series.</p>
          {radioRow('Tamaño del texto', 'textSize', TEXT_SIZE_OPTS, settings.textSize || 0)}
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

    if (id === 'tabs') {
      return (
        <div className="pf-parental">
          <h2 className="pf-title">Pestañas</h2>
          <p className="pf-note">
            Elige qué pestañas se muestran arriba. Los títulos de Kids y Anime siguen disponibles en Buscar y en Explorar aunque ocultes su pestaña.
          </p>
          <div className="pf-iptv-grid" style={{ gridTemplateColumns: `repeat(${IPTV_COLUMNS}, 1fr)` }}>
            {HIDEABLE_TABS.map(t => {
              const shown = !tabPrefs.isHidden(t.id);
              return (
                <div key={t.id} className={`pf-iptv-card ${shown ? 'is-on' : ''} ${isF(`tab-${t.id}`) ? 'is-focused' : ''}`} onClick={tap(`tab-${t.id}`)}>
                  <div className="pf-iptv-card-top">
                    <div className="pf-iptv-card-name">{t.name}</div>
                    <div className={`pf-switch ${shown ? 'on' : 'off'}`}>
                      <span className="pf-switch-knob" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    if (id === 'parental') {
      if (!hasPin) {
        return (
          <div className="pf-parental">
            <h2 className="pf-title">Control parental</h2>
            <p className="pf-note">
              Crea un PIN de 4 dígitos para poder activar la sección para adultos (+18); se pedirá cada vez que entres a ella.
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
            El PIN protege solo el contenido para adultos: se pide para activar la sección +18 y cada vez que entras a ella
            (la pestaña +18 y la categoría 18+ de TV en vivo).
          </p>
          <div className="pf-btn-row">
            <div className={`pf-btn ${isF('change') ? 'is-focused' : ''}`} onClick={tap('change')}>Cambiar PIN</div>
            <div className={`pf-btn pf-btn-danger ${isF('disable') ? 'is-focused' : ''}`} onClick={tap('disable')}>Desactivar bloqueo</div>
          </div>
          <div className={`pf-row pf-row-wide ${isF('adult') ? 'is-focused' : ''}`} onClick={tap('adult')}>
            <div className="pf-row-label">
              <div className="pf-row-title">Sección para adultos (+18)</div>
              <div className="pf-row-desc">
              {parentalService.isAdultEnabled()
                ? 'Activada: aparece la pestaña +18 y pide el PIN al entrar'
                : 'Desactivada: el contenido para adultos está oculto (activarla pide el PIN)'}
              </div>
            </div>
            <div className={`pf-switch ${parentalService.isAdultEnabled() ? 'on' : 'off'}`}>
              <span className="pf-switch-knob" />
            </div>
          </div>
        </div>
      );
    }

    if (id === 'iptv') {
      return (
        <div className="pf-parental">
          <h2 className="pf-title">TV abierta (listas gratuitas)</h2>
          <p className="pf-note">
            Canales públicos y gratuitos recopilados por iptv-org. Cada lista activada aparece como una categoría al final de
            TV en vivo y se descarga la primera vez que la abres. Algunas señales pueden caerse o estar bloqueadas en tu región.
          </p>
          <div className="pf-iptv-grid" style={{ gridTemplateColumns: `repeat(${IPTV_COLUMNS}, 1fr)` }}>
            {IPTV_LISTS.map(l => {
              const on = iptvService.isEnabled(l.id);
              return (
                <div key={l.id} className={`pf-iptv-card ${on ? 'is-on' : ''} ${isF(`iptv-${l.id}`) ? 'is-focused' : ''}`} onClick={tap(`iptv-${l.id}`)}>
                  <div className="pf-iptv-card-top">
                    <div className="pf-iptv-card-name">{l.name}</div>
                    <div className={`pf-switch ${on ? 'on' : 'off'}`}>
                      <span className="pf-switch-knob" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    if (id === 'diag') {
      const verdict = report ? VERDICTS[report.verdict] : null;
      const tested = !!report && !diagRunning;
      // Portal and video servers are only tested when the secure DNS answered
      const reached = tested && report!.verdict !== 'no-internet' && report!.verdict !== 'doh-blocked';
      const hostsOk = report ? report.hosts.filter(h => h.ok).length : 0;
      const hostsFailed = report ? report.hosts.filter(h => !h.ok).map(h => h.host) : [];
      const speedClass = speedRunning ? '' : speedError ? 'bad' : speed ? streamingVerdict(speed.mbps).cls : '';
      const cards: Array<{ label: string; value: string; sub: string; cls: string }> = [
        {
          label: 'Internet y DNS seguro',
          value: tested ? `${hostsOk} de ${report!.hosts.length}` : '—',
          sub: tested ? (hostsOk === report!.hosts.length ? 'Todos responden' : 'Hay dominios sin respuesta') : 'Sin analizar',
          cls: tested ? (report!.hosts.length && hostsOk === report!.hosts.length ? 'ok' : hostsOk ? 'warn' : 'bad') : ''
        },
        {
          label: 'Portal',
          value: reached ? (report!.portalMs !== null ? `${report!.portalMs} ms` : 'Sin respuesta') : '—',
          sub: reached ? (report!.portalMs !== null ? 'Responde' : 'Caído o bloqueado') : tested ? 'No se pudo probar' : 'Sin analizar',
          cls: reached ? (report!.portalMs !== null ? 'ok' : 'bad') : ''
        },
        {
          label: 'Servidores de video',
          value: reached && report!.portalMs !== null ? String(report!.cdns) : '—',
          sub: reached && report!.portalMs !== null ? (report!.cdns > 0 ? 'Disponibles' : 'Ninguno disponible') : tested ? 'No se pudo probar' : 'Sin analizar',
          cls: reached && report!.portalMs !== null ? (report!.cdns > 0 ? 'ok' : 'warn') : ''
        },
        {
          label: 'Velocidad de internet',
          value: speedRunning ? (speedLive !== null ? formatSpeed(speedLive) : '…') : speed ? formatSpeed(speed.mbps) : speedError ? 'Error' : '—',
          sub: speedRunning
            ? (speedLive !== null ? 'Descargando…' : 'Midiendo la latencia…')
            : speedError
              ? 'No se pudo medir'
              : speed
                ? `${speed.latencyMs !== null ? `Latencia ${speed.latencyMs} ms · ` : ''}${streamingVerdict(speed.mbps).text}`
                : 'Sin medir',
          cls: speedClass
        }
      ];
      return (
        <div className="pf-diag">
          <h2 className="pf-title">Diagnóstico de red</h2>
          <p className="pf-note">
            Comprueba si el televisor llega a los servidores de TizenXuper TV y mide tu internet, todo con un solo botón. Si un canal o una película no se ve,
            envíanos un reporte justo después: incluye el modelo de la TV, la red, la velocidad y los últimos errores de reproducción.
          </p>
          <div className="pf-diag-actions">
            <div className={`pf-btn ${isF('run') ? 'is-focused' : ''}`} onClick={tap('run')}>
              {diagRunning || speedRunning ? 'Diagnosticando…' : report ? 'Diagnosticar de nuevo' : 'Diagnosticar'}
            </div>
            <div className={`pf-btn ${isF('report') ? 'is-focused' : ''}`} onClick={tap('report')}>
              {reportState === 'sending' ? 'Enviando…' : 'Enviar reporte a soporte'}
            </div>
          </div>
          <div className={`pf-diag-summary pf-diag-verdict ${diagRunning ? '' : verdict ? verdict.cls : ''}`}>
            {diagRunning
              ? 'Consultando DNS seguro, portal y servidores…'
              : verdict
                ? verdict.text
                : 'Pulsa «Diagnosticar» para empezar.'}
          </div>
          <div className="pf-diag-cards">
            {cards.map(c => (
              <div key={c.label} className={`pf-diag-card ${c.cls}`}>
                <div className="pf-diag-card-label"><span className="pf-diag-dot" />{c.label}</div>
                <div className="pf-diag-card-value">{c.value}</div>
                <div className="pf-diag-card-sub">{c.sub}</div>
              </div>
            ))}
          </div>
          {tested && hostsFailed.length > 0 && (
            <div className="pf-diag-failed">Sin respuesta: {hostsFailed.join(', ')}</div>
          )}
          {reportState !== 'idle' && reportState !== 'sending' && (
            <div className={`pf-diag-report ${reportState}`}>
              {reportState === 'ok' && '✓ Reporte enviado. Te responderemos por Telegram.'}
              {reportState === 'too_many' && 'Ya enviaste varios reportes esta hora. Espera un poco antes de enviar otro.'}
              {reportState === 'signed_out' && 'La sesión de Telegram de esta TV se cerró. Reinicia la app para volver a iniciarla.'}
              {reportState === 'error' && 'No se pudo enviar el reporte. Revisa la conexión e inténtalo de nuevo.'}
            </div>
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
          TizenXuper TV es una interfaz hecha para televisores Samsung: pensada para el control remoto, rápida, ordenada y
          cómoda de usar. No producimos ni alojamos contenido: el catálogo y los canales vienen de servicios de terceros, y
          nos ocupamos de que se vean y se manejen bien.
        </p>
        <div className="pf-about-cards">
          <div className="pf-about-card">
            <div className="pf-about-card-title">Lo que hacemos</div>
            <div className="pf-about-card-text">Navegación pensada para el control, filtros y búsqueda, fichas claras, un reproductor cómodo, tu lista y tu historial en la TV, y actualizaciones automáticas.</div>
          </div>
          <div className="pf-about-card">
            <div className="pf-about-card-title">Lo que no hacemos</div>
            <div className="pf-about-card-text">No somos dueños del contenido ni de los servicios que lo ofrecen. La disponibilidad de películas, series y canales depende de ellos.</div>
          </div>
          <div className="pf-about-card">
            <div className="pf-about-card-title">Un proyecto independiente</div>
            <div className="pf-about-card-text">Gratuito, hecho por la comunidad y mantenido con tu ayuda. Si algo falla o tienes ideas, cuéntanos por Telegram.</div>
          </div>
        </div>
        <h3 className="pf-subtitle">Telegram</h3>
        <p className="pf-about-body">Escanea un código con la cámara de tu teléfono.</p>
        <div className="pf-tg-grid">
          {TELEGRAM_LINKS.map(l => (
            <div key={l.name} className="pf-tg-card">
              <div className="pf-tg-qr"><QrCode text={l.url} size={132} /></div>
              <div className="pf-tg-info">
                <div className="pf-tg-name">{l.name}</div>
                <div className="pf-tg-desc">{l.desc}</div>
              </div>
            </div>
          ))}
        </div>
        {/* Version and updates as a bar at the bottom: the text at the left, the actions at the right */}
        <div className="pf-update-bar">
          <div className="pf-update-bar-text">
            <div className="pf-update-bar-title">TizenXuper TV · v{accountService.deviceInfo().version}</div>
            <div className="pf-update-bar-desc">
              {updateChecking
                ? 'Buscando actualizaciones…'
                : updateResult === 'uptodate' ? 'Estás al día.'
                : updateResult === 'downloaded' ? `Versión ${updateService.status().downloaded} descargada. Reinicia para estrenarla.`
                : updateResult === 'reinstall' ? 'Hay una versión nueva que se instala con Apps2Samsung.'
                : updateResult === 'error' ? 'No se pudo comprobar. Revisa la conexión e inténtalo de nuevo.'
                : updateLine(updateService.status())}
            </div>
          </div>
          {updateService.status().canSelfUpdate && (
            <div className="pf-update-bar-actions">
              <div className={`pf-btn ${isF('update-check') ? 'is-focused' : ''}`} onClick={tap('update-check')}>
                {updateChecking ? 'Buscando…' : 'Buscar actualizaciones'}
              </div>
              {updateService.status().downloaded && (
                <div className={`pf-btn ${isF('update-restart') ? 'is-focused' : ''}`} onClick={tap('update-restart')}>
                  Reiniciar para actualizar
                </div>
              )}
            </div>
          )}
        </div>
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
