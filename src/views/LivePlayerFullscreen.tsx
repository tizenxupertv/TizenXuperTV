import React, { useState, useEffect, useRef } from 'react';
import { LiveChannel } from '../types/channel';
import { playerService } from '../services/playerService';
import { fetchChannelEpg } from '../services/epgService';

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
  const [streamQuality, setStreamQuality] = useState<string>('');
  const [fullscreenEpg, setFullscreenEpg] = useState<{ now?: string; next?: string; time?: string } | null>(null);

  // Reset quality and fetch dynamic EPG on channel change
  useEffect(() => {
    setStreamQuality('');
    setFullscreenEpg(null);
    if (!channel) return;
    let active = true;
    fetchChannelEpg(channel).then(info => {
      if (active && info) setFullscreenEpg(info);
    });
    return () => { active = false; };
  }, [channel?.id, channel?.code]);

  // Detect real hardware stream resolution on Tizen AVPlay or HTML5 Video
  useEffect(() => {
    const updateQuality = () => {
      if ((window as any).XuperAVPlay && (window as any).XuperAVPlay.getCurrentStreamQuality) {
        try {
          const q = (window as any).XuperAVPlay.getCurrentStreamQuality();
          if (q && q.label) {
            setStreamQuality(q.label);
            return;
          }
        } catch (e) {}
      }
      const vid = videoRef.current;
      if (vid && vid.videoWidth && vid.videoHeight) {
        const w = vid.videoWidth;
        const h = vid.videoHeight;
        let label = `${w}x${h}`;
        if (w >= 3800 || h >= 2100) label = 'UHD 4K';
        else if (w >= 1900 || h >= 1000) label = '1080p · FHD';
        else if (w >= 1200 || h >= 700) label = '720p · HD';
        else if (h >= 540) label = '540p';
        else if (h >= 480) label = '480p · SD';
        setStreamQuality(label);
      }
    };
    if (showOsd) {
      updateQuality();
      const timer = setInterval(updateQuality, 1200);
      return () => clearInterval(timer);
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

  const activeNow = (fullscreenEpg && fullscreenEpg.now) || channel.now;
  const activeNext = (fullscreenEpg && fullscreenEpg.next) || channel.next;
  const activeTime = (fullscreenEpg && fullscreenEpg.time) || channel.time;

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
            {activeNow && <div className="osd-program-name">{activeNow}</div>}
          </div>
          <div className="osd-live-tag">
            <span className="live-pulse-dot" /> EN VIVO
          </div>
          {streamQuality ? (
            <div className="live-quality-tag" style={{ fontSize: 13, padding: '4px 10px' }}>
              {streamQuality}
            </div>
          ) : null}
        </div>

        <div className="osd-bottom-row">
          <div className="osd-timing">
            <span>{activeTime || 'EN DIRECTO'}</span>
            {activeNext && <span className="osd-next"> • A continuación: {activeNext}</span>}
          </div>
          <div className="osd-hints">
            <span><b>▲ ▼</b> Cambiar canal</span>
            <span><b>◄</b> Guía rápida</span>
            <span><b>VERDE</b> Último canal</span>
            <span><b>OK</b> OSD Info</span>
            <span><b>ATRÁS</b> Salir</span>
          </div>
        </div>
      </div>
    </div>
  );
};
