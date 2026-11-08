import React, { useState } from 'react';
import { useScreenKeys } from '../../hooks/useScreenKeys';
import { localProfiles } from '../../lib/localProfiles';
import { ProfileAvatar } from '../../screens/ProfilePickerScreen';
import '../../styles/profiles.css';

export type ProfileMenuAction = 'manage' | 'add' | 'list' | 'settings';

interface ProfileMenuProps {
  onAction: (action: ProfileMenuAction) => void;
  onClose: () => void;
}

/**
 * The header avatar's menu, like the big streaming apps: the other profiles (OK switches to one), then
 * profile management, Mi lista e historial and Ajustes. ▲ ▼ move, OK runs, Back closes.
 */
export const ProfileMenu: React.FC<ProfileMenuProps> = ({ onAction, onClose }) => {
  const active = localProfiles.active();
  const others = localProfiles.list().filter(p => p.id !== active.id);
  const [switching, setSwitching] = useState(false);

  const items: Array<{ id: string; label: string; run: () => void; profileId?: string; divider?: boolean }> = [
    ...others.map(p => ({
      id: `p-${p.id}`,
      label: p.name,
      profileId: p.id,
      run: () => {
        setSwitching(true);
        localProfiles.select(p.id);
        localProfiles.markChosen();
        window.location.reload();
      }
    })),
    others.length > 0
      ? { id: 'manage', label: 'Administrar perfiles', run: () => onAction('manage') }
      : { id: 'add', label: 'Añadir perfil', run: () => onAction('add') },
    { id: 'list', label: 'Mi lista e historial', run: () => onAction('list'), divider: true },
    { id: 'settings', label: 'Ajustes', run: () => onAction('settings') }
  ];
  const [index, setIndex] = useState(0);

  useScreenKeys(key => {
    if (switching) return;
    if (key === 'up') setIndex(i => Math.max(0, i - 1));
    else if (key === 'down') setIndex(i => Math.min(items.length - 1, i + 1));
    else if (key === 'enter') items[index].run();
    else if (key === 'back' || key === 'left' || key === 'right') onClose();
  });

  return (
    <>
      <div className="lp-menu-scrim" onClick={onClose} />
      <div className="lp-menu" role="menu">
        <div className="lp-menu-head">
          <ProfileAvatar profile={active} size={52} />
          <div className="lp-menu-head-text">
            <div className="lp-menu-name">{active.name}</div>
            <div className="lp-menu-sub">{switching ? 'Cambiando de perfil…' : 'Perfil en uso'}</div>
          </div>
        </div>
        {items.map((it, i) => {
          const p = it.profileId ? others.find(o => o.id === it.profileId) : null;
          return (
            <React.Fragment key={it.id}>
              {it.divider && <div className="lp-menu-divider" />}
              <div className={`lp-menu-item ${i === index ? 'is-focused' : ''}`} role="menuitem" onClick={it.run}>
                {p ? <ProfileAvatar profile={p} size={34} /> : <span className="lp-menu-icon">{ICONS[it.id]}</span>}
                <span className="lp-menu-label">{it.label}</span>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </>
  );
};

const ICONS: Record<string, React.ReactNode> = {
  manage: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" />
    </svg>
  ),
  add: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  list: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" />
    </svg>
  ),
  settings: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  )
};
