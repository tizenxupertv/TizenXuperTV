import React from 'react';
import { TabId, TABS } from './TopNavbar';
import { BrandLogo } from '../common/BrandLogo';

export interface HeaderProps {
  selectedTab: TabId;
  focusedIndex: number | null; // 0..6: tabs, 7: search, 8: profile
  onSelectTab: (tab: TabId) => void;
  onSearchClick: () => void;
  onProfileClick: () => void;
  profileActive?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  selectedTab,
  focusedIndex,
  onSelectTab,
  onSearchClick,
  onProfileClick,
  profileActive
}) => {
  return (
    <header className="app-header">
      {/* 1. Left: Brand Logo */}
      <BrandLogo />

      {/* 2. Center: Direct Navigation Tabs (Apple TV single-bar style) */}
      <nav className="header-navbar">
        <div className="navbar-track">
          {TABS.map((tab, idx) => {
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
          className={`notify-btn ${focusedIndex === 7 ? 'is-focused' : ''}`}
          onClick={onSearchClick}
          title="Buscar"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>

        <button
          className={`notify-btn ${profileActive ? 'is-active' : ''} ${focusedIndex === 8 ? 'is-focused' : ''}`}
          onClick={onProfileClick}
          title="Perfil"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </button>
      </div>
    </header>
  );
};
