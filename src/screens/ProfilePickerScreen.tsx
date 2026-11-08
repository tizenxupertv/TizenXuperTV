import React, { useEffect, useState } from 'react';
import { useScreenKeys } from '../hooks/useScreenKeys';
import { OnScreenKeyboard, KB_INITIAL, KbState, keyAt, moveCursor, pressKey } from '../components/live/OnScreenKeyboard';
import { displayName, localProfiles, MAIN_PROFILE, MAX_NAME, MAX_PROFILES, type LocalProfile } from '../lib/localProfiles';
import '../styles/profiles.css';

/** How long a message ("Perfil creado") stays */
const NOTICE_MS = 3000;

/** A profile's round badge: its initial on its color */
export const ProfileAvatar: React.FC<{ profile: LocalProfile; size?: number }> = ({ profile, size = 132 }) => (
  <div className="lp-avatar" style={{ background: profile.color, width: size, height: size, fontSize: Math.round(size * 0.44) }}>
    {profile.name.charAt(0).toLocaleUpperCase('es')}
  </div>
);

const PencilIcon = (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" />
  </svg>
);

interface ProfilePickerScreenProps {
  /** Continue with the profile already in use */
  onDone: () => void;
  /** Opened from Perfil: Back closes the view. At startup there is nothing behind it */
  onClose?: () => void;
  /** Opens already in "Administrar perfiles" */
  initialManaging?: boolean;
}

/**
 * The profiles view: "¿Quién está viendo?" when the app opens with two or more local profiles, and from
 * the header avatar's menu. Profiles are added, renamed and deleted here. Choosing another profile
 * than the one in use reloads the app: every service reads its profile's data when it loads.
 */
export const ProfilePickerScreen: React.FC<ProfilePickerScreenProps> = ({ onDone, onClose, initialManaging = false }) => {
  const [, setTick] = useState(0);
  const profiles = localProfiles.list();
  const activeId = localProfiles.active().id;
  const canAdd = profiles.length < MAX_PROFILES;
  // Focus: a tile of the row (profiles, then "Añadir perfil") or the "Administrar perfiles" button below
  const [index, setIndex] = useState(() => Math.max(0, profiles.findIndex(p => p.id === activeId)));
  const [onManageBtn, setOnManageBtn] = useState(false);
  const [managing, setManaging] = useState(initialManaging);
  const [switching, setSwitching] = useState(false);
  // Dialog of a profile while managing (its buttons, or the delete confirmation) and the name editor
  const [menu, setMenu] = useState<{ id: string; choice: number; confirmDelete: boolean } | null>(null);
  const [editor, setEditor] = useState<{ id: string | null; text: string; kb: KbState; error: string } | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const tileCount = profiles.length + (canAdd ? 1 : 0);

  // A first screen, like sign-in: a downloaded update that got this far is good (public/js/boot.js)
  useEffect(() => {
    if (window.XuperBoot) window.XuperBoot.ok();
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (index > tileCount - 1) setIndex(Math.max(0, tileCount - 1));
  }, [index, tileCount]);

  const use = (id: string) => {
    if (switching) return;
    localProfiles.markChosen();
    if (id === activeId) {
      onDone();
      return;
    }
    setSwitching(true);
    localProfiles.select(id);
    window.location.reload();
  };

  const openEditor = (id: string | null) => {
    const p = id ? profiles.find(x => x.id === id) : null;
    setMenu(null);
    setEditor({ id, text: p ? p.name.toLocaleLowerCase('es') : '', kb: KB_INITIAL, error: '' });
  };

  const saveName = () => {
    if (!editor) return;
    const name = displayName(editor.text);
    if (!name) {
      setEditor({ ...editor, error: 'Escribe un nombre.' });
      return;
    }
    if (editor.id) {
      const ok = localProfiles.rename(editor.id, name);
      setNotice(ok ? { text: 'Nombre guardado' } : { text: 'No se pudo guardar el nombre.', error: true });
    } else {
      const created = localProfiles.create(name);
      setNotice(created ? { text: `Perfil «${created.name}» creado` } : { text: 'No se pudo crear el perfil.', error: true });
      if (created) setIndex(profiles.length);
    }
    setEditor(null);
    setTick(t => t + 1);
  };

  const remove = (id: string) => {
    const p = profiles.find(x => x.id === id);
    const ok = localProfiles.remove(id);
    setMenu(null);
    if (ok && id === activeId) {
      // The profile in use is gone: start again with the main one
      setSwitching(true);
      localProfiles.markChosen();
      window.location.reload();
      return;
    }
    setNotice(ok ? { text: `Perfil «${p ? p.name : ''}» eliminado` } : { text: 'No se pudo eliminar el perfil.', error: true });
    setTick(t => t + 1);
  };

  const menuActions = (id: string): Array<{ id: 'rename' | 'delete'; label: string; danger?: boolean }> => [
    { id: 'rename', label: 'Cambiar nombre' },
    ...(id !== MAIN_PROFILE ? [{ id: 'delete' as const, label: 'Eliminar', danger: true }] : [])
  ];
  const runMenu = (id: string, action: 'rename' | 'delete') => {
    if (action === 'rename') openEditor(id);
    else setMenu({ id, choice: 0, confirmDelete: true });
  };

  const activateTile = (i: number) => {
    if (i >= profiles.length) openEditor(null);
    else if (managing) setMenu({ id: profiles[i].id, choice: 0, confirmDelete: false });
    else use(profiles[i].id);
  };

  useScreenKeys(key => {
    if (switching) return;
    // Name editor: the arrows move on the keyboard, OK types, Back cancels
    if (editor) {
      if (key === 'back') setEditor(null);
      else if (key === 'up' || key === 'down' || key === 'left' || key === 'right') {
        const next = moveCursor(editor.kb, key);
        if (next) setEditor({ ...editor, kb: next });
      } else if (key === 'enter') {
        const res = pressKey(keyAt(editor.kb), editor.text, editor.kb, MAX_NAME);
        if (res.ok) saveName();
        else setEditor({ ...editor, text: res.query, kb: res.state, error: '' });
      }
      return;
    }
    // A profile's dialog: left/right choose, OK runs, Back closes (or leaves the delete confirmation)
    if (menu) {
      const count = menu.confirmDelete ? 2 : menuActions(menu.id).length;
      if (key === 'left') setMenu({ ...menu, choice: Math.max(0, menu.choice - 1) });
      else if (key === 'right') setMenu({ ...menu, choice: Math.min(count - 1, menu.choice + 1) });
      else if (key === 'back') setMenu(menu.confirmDelete ? { ...menu, choice: 0, confirmDelete: false } : null);
      else if (key === 'enter') {
        if (menu.confirmDelete) {
          if (menu.choice === 1) remove(menu.id);
          else setMenu({ ...menu, choice: 0, confirmDelete: false });
        } else {
          const action = menuActions(menu.id)[menu.choice];
          if (action) runMenu(menu.id, action.id);
        }
      }
      return;
    }
    if (key === 'back') {
      if (managing) setManaging(false);
      else if (onClose) onClose();
      return;
    }
    if (onManageBtn) {
      if (key === 'up') setOnManageBtn(false);
      else if (key === 'enter') setManaging(m => !m);
      return;
    }
    if (key === 'left') setIndex(i => Math.max(0, i - 1));
    else if (key === 'right') setIndex(i => Math.min(tileCount - 1, i + 1));
    else if (key === 'down') setOnManageBtn(true);
    else if (key === 'enter') activateTile(index);
  });

  const menuProfile = menu ? profiles.find(p => p.id === menu.id) : null;

  return (
    <div className={`lp-picker ${managing ? 'is-managing' : ''}`}>
      <h1 className="lp-picker-title">{managing ? 'Administrar perfiles' : '¿Quién está viendo?'}</h1>
      <div className="lp-picker-row">
        {profiles.map((p, i) => (
          <div key={p.id} className={`lp-picker-item ${!onManageBtn && i === index ? 'is-focused' : ''}`} onClick={() => activateTile(i)}>
            <div className="lp-picker-avatar">
              <ProfileAvatar profile={p} />
              {managing && <div className="lp-picker-edit">{PencilIcon}</div>}
            </div>
            <div className="lp-picker-name">{p.name}</div>
            <div className="lp-picker-tag">{p.id === activeId && onClose ? 'En uso' : ''}</div>
          </div>
        ))}
        {canAdd && (
          <div className={`lp-picker-item ${!onManageBtn && index === profiles.length ? 'is-focused' : ''}`} onClick={() => activateTile(profiles.length)}>
            <div className="lp-picker-avatar"><div className="lp-add-circle">+</div></div>
            <div className="lp-picker-name">Añadir perfil</div>
            <div className="lp-picker-tag" />
          </div>
        )}
      </div>
      <div className={`pf-btn lp-manage-btn ${onManageBtn ? 'is-focused' : ''}`} onClick={() => setManaging(m => !m)}>
        {managing ? 'Listo' : 'Administrar perfiles'}
      </div>
      <p className="lp-picker-hint">
        {switching
          ? 'Cambiando de perfil…'
          : managing
            ? 'Elige un perfil para cambiarle el nombre o eliminarlo.'
            : 'Cada perfil tiene su historial, Mi lista, canales favoritos, ajustes y pestañas en este TV.'}
      </p>

      {menu && menuProfile && (
        <div className="pf-confirm" role="dialog" aria-modal="true">
          <div className="pf-confirm-card">
            <div className="lp-dialog-head">
              <ProfileAvatar profile={menuProfile} size={64} />
              <h2 className="pf-confirm-title">{menu.confirmDelete ? `¿Eliminar «${menuProfile.name}»?` : menuProfile.name}</h2>
            </div>
            {menu.confirmDelete ? (
              <>
                <p className="pf-confirm-text">Se borran su historial, Mi lista, canales favoritos y ajustes en este TV.</p>
                <div className="pf-btn-row">
                  <div className={`pf-btn ${menu.choice === 0 ? 'is-focused' : ''}`} onClick={() => setMenu({ ...menu, choice: 0, confirmDelete: false })}>Cancelar</div>
                  <div className={`pf-btn pf-btn-danger ${menu.choice === 1 ? 'is-focused' : ''}`} onClick={() => remove(menu.id)}>Sí, eliminar</div>
                </div>
              </>
            ) : (
              <div className="lp-actions">
                {menuActions(menu.id).map((a, i) => (
                  <div key={a.id} className={`pf-btn ${a.danger ? 'pf-btn-danger' : ''} ${menu.choice === i ? 'is-focused' : ''}`} onClick={() => runMenu(menu.id, a.id)}>
                    {a.label}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {editor && (
        <div className="pf-confirm" role="dialog" aria-modal="true">
          <div className="pf-confirm-card lp-name-card">
            <h2 className="pf-confirm-title">{editor.id ? 'Cambiar nombre' : 'Nuevo perfil'}</h2>
            <div className={`lp-name-field ${editor.text ? '' : 'is-empty'}`}>
              {editor.text ? displayName(editor.text) : 'Nombre'}
              <span className="lp-name-caret" />
            </div>
            {editor.error && <div className="lp-name-error">{editor.error}</div>}
            <OnScreenKeyboard
              state={editor.kb}
              focused
              okLabel="Guardar"
              onPress={k => {
                const res = pressKey(k, editor.text, editor.kb, MAX_NAME);
                if (res.ok) saveName();
                else setEditor({ ...editor, text: res.query, kb: res.state, error: '' });
              }}
            />
          </div>
        </div>
      )}

      {notice && <div className={`pf-toast ${notice.error ? 'is-error' : ''}`}>{notice.text}</div>}
    </div>
  );
};
