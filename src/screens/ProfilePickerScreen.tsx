import React, { useEffect, useState } from 'react';
import { useScreenKeys } from '../hooks/useScreenKeys';
import { localProfiles, type LocalProfile } from '../lib/localProfiles';
import '../styles/profiles.css';

/** A profile's round badge: its initial on its color */
export const ProfileAvatar: React.FC<{ profile: LocalProfile; size?: number }> = ({ profile, size = 132 }) => (
  <div className="lp-avatar" style={{ background: profile.color, width: size, height: size, fontSize: Math.round(size * 0.44) }}>
    {profile.name.charAt(0).toLocaleUpperCase('es')}
  </div>
);

/**
 * "¿Quién está viendo?" when the app opens with two or more local profiles. Choosing another profile than the
 * last one reloads the app: every service reads its profile's data when it loads.
 */
export const ProfilePickerScreen: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const profiles = localProfiles.list();
  const activeId = localProfiles.active().id;
  const [index, setIndex] = useState(() => Math.max(0, profiles.findIndex(p => p.id === activeId)));
  const [switching, setSwitching] = useState(false);

  // A first screen, like sign-in: a downloaded update that got this far is good (public/js/boot.js)
  useEffect(() => {
    if (window.XuperBoot) window.XuperBoot.ok();
  }, []);

  const pick = (i: number) => {
    const p = profiles[i];
    if (!p || switching) return;
    localProfiles.markChosen();
    if (p.id === activeId) {
      onDone();
      return;
    }
    setSwitching(true);
    localProfiles.select(p.id);
    window.location.reload();
  };

  useScreenKeys(key => {
    if (key === 'left') setIndex(i => Math.max(0, i - 1));
    else if (key === 'right') setIndex(i => Math.min(profiles.length - 1, i + 1));
    else if (key === 'enter') pick(index);
  });

  return (
    <div className="lp-picker">
      <h1 className="lp-picker-title">¿Quién está viendo?</h1>
      <div className="lp-picker-row">
        {profiles.map((p, i) => (
          <div key={p.id} className={`lp-picker-item ${i === index ? 'is-focused' : ''}`} onClick={() => pick(i)}>
            <ProfileAvatar profile={p} />
            <div className="lp-picker-name">{p.name}</div>
          </div>
        ))}
      </div>
      <p className="lp-picker-hint">{switching ? 'Cambiando de perfil…' : 'Los perfiles se administran en Perfil › Perfiles.'}</p>
    </div>
  );
};
