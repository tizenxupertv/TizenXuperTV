import React from 'react';
import type { SportsEvent } from '../../types/sports.ts';
import '../../styles/sportsPlayer.css';

/** Team crest, or its initials when the image is missing or fails */
export const MatchCrest: React.FC<{ src?: string; name: string }> = ({ src, name }) => (
  <span className="spp-crest">
    {src ? <img src={src} alt="" decoding="async" onError={e => { (e.currentTarget as HTMLElement).style.display = 'none'; }} /> : null}
    <span className="spp-crest-text">{name.slice(0, 2).toUpperCase()}</span>
  </span>
);

/**
 * League (with its logo) and the two teams with their crests, or the single event: the head of the signal picker,
 * the loading screen and the error card.
 */
export const MatchHeader: React.FC<{ event: SportsEvent }> = ({ event }) => {
  const versus = !!event.away && event.away.trim().toLowerCase() !== event.home.trim().toLowerCase();
  return (
    <div className="spp-head">
      <div className="spp-league">
        {event.leagueLogo && <img className="spp-league-logo" src={event.leagueLogo} alt="" onError={e => { (e.currentTarget as HTMLElement).style.display = 'none'; }} />}
        {event.league}
      </div>
      <div className="spp-match">
        <div className="spp-side"><MatchCrest src={versus ? event.homeLogo : event.homeLogo || event.leagueLogo} name={event.home} /><span className="spp-side-name">{event.home}</span></div>
        {versus && (
          <>
            <span className="spp-vs">vs</span>
            <div className="spp-side"><MatchCrest src={event.awayLogo} name={event.away} /><span className="spp-side-name">{event.away}</span></div>
          </>
        )}
      </div>
    </div>
  );
};
