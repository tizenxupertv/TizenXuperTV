import React, { useState, useEffect, useRef } from 'react';
import { LiveChannel } from '../types/channel';
import { playerService } from '../services/playerService';

interface LivePlayerFullscreenProps {
  channel: LiveChannel;
  channelIndex: number;
  totalChannels: number;
  channels: LiveChannel[];
  isFavorite: boolean;
  showGuide: boolean;
  guideFocusIndex: number;
  showOsd: boolean;
  onClose: () => void;
  onSelectChannel: (channel: LiveChannel, index: number) => void;
  onNextChannel: () => void;
  onPrevChannel: () => void;
  onToggleFavorite: (channel: LiveChannel) => void;
  onToggleGuide: (show?: boolean) => void;
  onToggleOsd: () => void;
  numericBuffer?: string;
}

export const LivePlayerFullscreen: React.FC<LivePlayerFullscreenProps> = ({
  channel,
  channelIndex,
  totalChannels,
  channels,
  isFavorite,
  showGuide,
  guideFocusIndex,
  showOsd,
  onClose,
  onSelectChannel,
  onNextChannel,
  onPrevChannel,
  onToggleFavorite,
  onToggleGuide,
  onToggleOsd,
  numericBuffer
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const guideListRef = useRef<HTMLDivElement>(null);
  const [streamQuality, setStreamQuality] = useState<string>('FHD 1080p');

  // Detect real hardware stream resolution on Tizen AVPlay
  useEffect(() => {
    if (showOsd && (window as any).XuperAVPlay && (window as any).XuperAVPlay.getCurrentStreamQuality) {
      try {
        const q = (window as any).XuperAVPlay.getCurrentStreamQuality();
        if (q && q.label) setStreamQuality(q.label);
      } catch (e) {}
    }
  }, [showOsd, channel]);

  // Play fullscreen stream on mount or channel step
  useEffect(() => {
    if (channel && videoRef.current) {
      playerService.playFullscreen(channel, videoRef.current);
    }
  }, [channel]);

  // Keep focused channel in view inside Mini-Guide
  useEffect(() => {
    if (showGuide && guideListRef.current) {
      const el = guideListRef.current.children[guideFocusIndex] as HTMLElement;
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [showGuide, guideFocusIndex]);

  return (
    <div className="live-fullscreen-container">
      {/* Video Surface */}
      <video
        ref={videoRef}
        id="fullscreen-live-video"
        className="live-fullscreen-video"
        playsInline
        autoPlay
      />

      {/* Quick Channel Mini-Guide Sidebar (Slides from left on ◄ arrow) */}
      {showGuide && (
        <aside className="fullscreen-mini-guide">
          <div className="mini-guide-header">
            <span className="mini-guide-title">GUÍA RÁPIDA DE CANALES</span>
            <span className="mini-guide-count">{channels.length} canales</span>
          </div>

          <div className="mini-guide-list" ref={guideListRef}>
            {channels.map((ch, idx) => {
              const isPlaying = ch.id === channel.id;
              const isCursorFocused = idx === guideFocusIndex;

              return (
                <div
                  key={ch.id || idx}
                  className={`mini-guide-card ${isPlaying ? 'is-active-stream' : ''} ${isCursorFocused ? 'is-guide-focused' : ''}`}
                  onClick={() => onSelectChannel(ch, idx)}
                >
                  <div className="live-ch-num">{idx + 1 < 10 ? `0${idx + 1}` : idx + 1}</div>
                  <img
                    className="live-ch-logo"
                    src={ch.logo || 'assets/placeholder_square.jpg'}
                    alt=""
                    onError={(e) => { (e.target as HTMLImageElement).src = 'assets/placeholder_square.jpg'; }}
                  />
                  <div className="live-ch-info">
                    <div className="live-ch-title">
                      <span>{ch.name}</span>
                      {isPlaying && <span className="live-playing-badge">▶ EN VIVO</span>}
                    </div>
                    {ch.now && <div className="live-ch-now">{ch.now}</div>}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mini-guide-footer-hint">
            <span><b>OK</b> Sintonizar</span>
            <span><b>► / ATRÁS</b> Cerrar guía</span>
          </div>
        </aside>
      )}

      {/* Direct Channel Number Tuning Floating Overlay */}
      {numericBuffer && (
        <div className="osd-numeric-banner">
          <span className="osd-numeric-label">CANAL</span>
          <span className="osd-numeric-digits">{numericBuffer}</span>
        </div>
      )}

      {/* Elegant OSD Overlay (Bottom) */}
      <div className={`fullscreen-osd ${showOsd && !showGuide ? 'is-visible' : 'is-hidden'}`}>
        <div className="osd-channel-header">
          <div className="osd-ch-number">{channelIndex + 1 < 10 ? `0${channelIndex + 1}` : channelIndex + 1}</div>
          <img
            className="osd-ch-logo"
            src={channel.logo || 'assets/placeholder_square.jpg'}
            alt=""
            onError={(e) => { (e.target as HTMLImageElement).src = 'assets/placeholder_square.jpg'; }}
          />
          <div className="osd-ch-titles">
            <div className="osd-ch-name">
              <span>{channel.name}</span>
              {isFavorite && <span className="osd-fav-badge">★</span>}
            </div>
            {channel.now && <div className="osd-program-name">{channel.now}</div>}
          </div>
          <div className="osd-live-tag">
            <span className="live-pulse-dot" /> EN VIVO
          </div>
          <div className="live-quality-tag" style={{ fontSize: 13, padding: '4px 10px' }}>
            {streamQuality}
          </div>
        </div>

        <div className="osd-bottom-row">
          <div className="osd-timing">
            <span>{channel.time || 'EN DIRECTO'}</span>
            {channel.next && <span className="osd-next"> • A continuación: {channel.next}</span>}
          </div>
          <div className="osd-hints">
            <span><b>▲ ▼</b> Cambiar canal</span>
            <span><b>◄</b> Guía rápida</span>
            <span><b>OK</b> OSD Info</span>
            <span><b>ATRÁS</b> Salir</span>
          </div>
        </div>
      </div>
    </div>
  );
};
