import React from 'react';

export type TabId = 'tv' | 'deportes' | 'destacados' | 'peliculas' | 'series' | 'kids' | 'anime' | 'explorar' | 'adultos';

export interface TabItem {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

export const TABS: TabItem[] = [
  {
    id: 'tv',
    label: 'TV',
    icon: (
      <svg viewBox="0 0 33 33" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4">
        <rect x="3.5" y="7" width="26" height="17" rx="2.5" />
        <path d="M11 24.5v3h11v-3" />
      </svg>
    )
  },
  {
    id: 'deportes',
    label: 'DEPORTES',
    icon: (
      <svg viewBox="0 0 33 33" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M9 7h15v7a7.5 7.5 0 0 1-15 0V7z" />
        <path d="M9 10H5a3 3 0 0 0 3 3h1M24 10h4a3 3 0 0 1-3 3h-1" />
        <path d="M16.5 21.5v5M11.5 26.5h10" />
      </svg>
    )
  },
  {
    id: 'destacados',
    label: 'DESTACADOS',
    icon: (
      <svg viewBox="0 0 33 33" width="20" height="20" fill="currentColor">
        <path d="M12 15.5V28H7.6A2.6 2.6 0 0 1 5 25.4v-7.3a2.6 2.6 0 0 1 2.6-2.6H12z" />
        <path d="M14 15.6l4.3-9.2a2.2 2.2 0 0 1 4 1.6V13h5.6a2.9 2.9 0 0 1 2.8 3.6l-2 9A3.4 3.4 0 0 1 25.4 28H14z" />
      </svg>
    )
  },
  {
    id: 'peliculas',
    label: 'PELÍCULAS',
    icon: (
      <svg viewBox="0 0 33 33" width="20" height="20">
        <circle cx="16.5" cy="16.5" r="11.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
        <circle cx="16.5" cy="16.5" r="2.4" fill="currentColor" />
        <circle cx="16.5" cy="9.5" r="2.1" fill="currentColor" />
        <circle cx="16.5" cy="23.5" r="2.1" fill="currentColor" />
        <circle cx="9.5" cy="16.5" r="2.1" fill="currentColor" />
        <circle cx="23.5" cy="16.5" r="2.1" fill="currentColor" />
      </svg>
    )
  },
  {
    id: 'series',
    label: 'SERIES',
    icon: (
      <svg viewBox="0 0 33 33" width="20" height="20">
        <rect x="4" y="7" width="25" height="19" rx="2" fill="none" stroke="currentColor" strokeWidth="2.2" />
        <path d="M9 7v19M24 7v19" stroke="currentColor" strokeWidth="1.8" />
        <rect x="5.6" y="9" width="2.4" height="2.6" fill="currentColor" />
        <rect x="5.6" y="15.2" width="2.4" height="2.6" fill="currentColor" />
        <rect x="5.6" y="21.4" width="2.4" height="2.6" fill="currentColor" />
        <rect x="25" y="9" width="2.4" height="2.6" fill="currentColor" />
        <rect x="25" y="15.2" width="2.4" height="2.6" fill="currentColor" />
        <rect x="25" y="21.4" width="2.4" height="2.6" fill="currentColor" />
      </svg>
    )
  },
  {
    id: 'kids',
    label: 'KIDS',
    icon: (
      <svg viewBox="0 0 33 33" width="20" height="20">
        <circle cx="8.6" cy="8.6" r="4" fill="none" stroke="currentColor" strokeWidth="2.2" />
        <circle cx="24.4" cy="8.6" r="4" fill="none" stroke="currentColor" strokeWidth="2.2" />
        <circle cx="16.5" cy="18" r="9.6" fill="none" stroke="currentColor" strokeWidth="2.2" />
        <circle cx="13" cy="17" r="1.5" fill="currentColor" />
        <circle cx="20" cy="17" r="1.5" fill="currentColor" />
        <ellipse cx="16.5" cy="21.6" rx="2.4" ry="1.7" fill="currentColor" />
      </svg>
    )
  },
  {
    id: 'anime',
    label: 'ANIME',
    icon: (
      <svg viewBox="0 0 33 33" width="20" height="20">
        <circle cx="8.5" cy="9" r="4.5" fill="currentColor" />
        <circle cx="24.5" cy="9" r="4.5" fill="currentColor" />
        <path d="M16.5 9c5.8 0 10.5 4.6 10.5 10.3 0 5.7-4.7 9.7-10.5 9.7S6 25 6 19.3C6 13.6 10.7 9 16.5 9z" fill="currentColor" />
        <circle cx="12.5" cy="18" r="1.6" fill="#0b0b0b" />
        <circle cx="20.5" cy="18" r="1.6" fill="#0b0b0b" />
        <ellipse cx="16.5" cy="23" rx="3" ry="2" fill="#0b0b0b" />
      </svg>
    )
  },
  {
    id: 'explorar',
    label: 'EXPLORAR',
    icon: (
      <svg viewBox="0 0 33 33" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4">
        <circle cx="16.5" cy="16.5" r="11.5" />
        <path d="M21.5 11.5l-2.8 7.2-7.2 2.8 2.8-7.2z" fill="currentColor" strokeLinejoin="round" />
      </svg>
    )
  }
];

/** "+18": only when the adult section is enabled in Perfil › Bloqueo; opens the section after the PIN */
export const ADULT_TAB: TabItem = {
  id: 'adultos',
  label: '+18',
  icon: (
    <svg viewBox="0 0 33 33" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4">
      <rect x="7" y="14" width="19" height="14" rx="2.5" />
      <path d="M11 14v-3.5a5.5 5.5 0 0 1 11 0V14" />
    </svg>
  )
};

export function getTabs(adultEnabled: boolean): TabItem[] {
  return adultEnabled ? [...TABS, ADULT_TAB] : TABS;
}

interface TopNavbarProps {
  selectedTab: TabId;
  focusedIndex: number | null;
  onSelectTab: (tab: TabId) => void;
}

export const TopNavbar: React.FC<TopNavbarProps> = ({
  selectedTab,
  focusedIndex,
  onSelectTab
}) => {
  return (
    <nav className="top-navbar">
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
  );
};
