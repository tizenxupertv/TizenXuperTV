import React from 'react';
import { TabId, TABS, TabItem } from './TopNavbar';
import { BrandLogo } from '../common/BrandLogo';
import { localProfiles } from '../../lib/localProfiles';
import { ProfileAvatar } from '../../screens/ProfilePickerScreen';

export interface HeaderProps {
  selectedTab: TabId;
  focusedIndex: number | null; // tabs first, then search, filter, profile
  /** Tabs to show (the +18 tab is added when enabled) */
  tabs?: TabItem[];
  onSelectTab: (tab: TabId) => void;
  onSearchClick: () => void;
  onFilterClick: () => void;
  onProfileClick: () => void;
  profileActive?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  selectedTab,
  focusedIndex,
  onSelectTab,
  onSearchClick,
  onFilterClick,
  onProfileClick,
  profileActive,
  tabs = TABS
}) => {
  const searchIdx = tabs.length;
  return (
    <header className="app-header">
      {/* 1. Left: Brand Logo */}
      <BrandLogo />

      {/* 2. Center: Direct Navigation Tabs (Apple TV single-bar style) */}
      <nav className="header-navbar">
        <div className="navbar-track">
          {tabs.map((tab, idx) => {
            const isSelected = selectedTab === tab.id;
            const isFocused = focusedIndex === idx;

            return (
              <button
                key={tab.id}
                className={`nav-tab-btn ${isSelected ? 'is-selected' : ''} ${isFocused ? 'is-focused' : ''}`}
                onClick={() => onSelectTab(tab.id)}
              >
                <span className="nav-tab-icon">{tab.icon}</span>
                <span className="nav-tab-label">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* 3. Right: Search & Profile */}
      <div className="header-notify">
        <button
          className={`notify-btn ${focusedIndex === searchIdx ? 'is-focused' : ''}`}
          onClick={onSearchClick}
          title="Buscar"
        >
          {SearchIcon}
        </button>

        <button
          className={`notify-btn ${focusedIndex === searchIdx + 1 ? 'is-focused' : ''}`}
          onClick={onFilterClick}
          title="Filtrar"
        >
          {FilterIcon}
        </button>

        {/* The profile in use: its menu switches profile and opens Mi lista and Ajustes */}
        <button
          className={`notify-btn lp-header-avatar ${profileActive ? 'is-active' : ''} ${focusedIndex === searchIdx + 2 ? 'is-focused' : ''}`}
          onClick={onProfileClick}
          title={`Perfil: ${localProfiles.active().name}`}
        >
          <ProfileAvatar profile={localProfiles.active()} size={36} />
        </button>
      </div>
    </header>
  );
};

// ---------- Header of the screens opened over the home (catalog, filters, search, detail, profile)
// Same bar, same place for the logo: the tabs give way to the screen's title, and the icons on the
// right are that screen's actions.

export const SearchIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export const FilterIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round">
    <path d="M3 5h18l-7 8.5V20l-4-2v-4.5L3 5z" />
  </svg>
);

export const ProfileIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

export const BackIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

export const CloseIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export interface HeaderAction {
  id: string;
  title: string;
  icon: React.ReactNode;
  onClick?: () => void;
}

interface ScreenHeaderProps {
  /** Screen name, next to the logo after a divider; screens that need no name leave it out */
  title?: string;
  subtitle?: string;
  actions?: HeaderAction[];
  /** Index of the focused action, or null */
  focusedAction?: number | null;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({ title, subtitle, actions = [], focusedAction = null }) => (
  <header className="app-header screen-header">
    <div className="screen-header-left">
      <BrandLogo />
      {title && (
        <>
          <div className="screen-header-divider" />
          <div className="screen-header-title">
            <span>{title}</span>
            {subtitle && <span className="screen-header-sub">{subtitle}</span>}
          </div>
        </>
      )}
    </div>
    <div className="screen-header-spacer" />
    <div className="header-notify">
      {actions.map((a, i) => (
        <button
          key={a.id}
          className={`notify-btn ${focusedAction === i ? 'is-focused' : ''}`}
          onClick={a.onClick}
          title={a.title}
        >
          {a.icon}
        </button>
      ))}
    </div>
  </header>
);
