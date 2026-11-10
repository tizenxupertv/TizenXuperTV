import React, { useState, useEffect } from 'react';
import { subscribePerf, PerfState, getPerfSnapshot } from '../../lib/perfMonitor';

export const PerfHud: React.FC = () => {
  const [stats, setStats] = useState<PerfState>(getPerfSnapshot);
  const [visible, setVisible] = useState<boolean>(false);

  useEffect(() => {
    (window as any).__togglePerfHud = () => setVisible(v => !v);
  }, []);
  // The monitor measures only while someone is subscribed: the HUD subscribes while it is shown
  useEffect(() => {
    if (!visible) return;
    return subscribePerf(setStats);
  }, [visible]);

  if (!visible) return null;

  const currentViewMetric = stats.renders[stats.activeView];
  const lastRender = currentViewMetric ? `${currentViewMetric.lastMs}ms` : '—';
  const fpsColor = stats.fps >= 55 ? '#10b981' : stats.fps >= 40 ? '#f59e0b' : '#ef4444';

  return (
    <div className="perf-hud-overlay">
      <div className="perf-hud-pill">
        <span className="perf-hud-dot" style={{ backgroundColor: fpsColor }} />
        <span className="perf-hud-fps">{stats.fps} FPS</span>
        <span className="perf-hud-sep">|</span>
        <span className="perf-hud-stat">Frame: {stats.frameMs}ms</span>
        <span className="perf-hud-sep">|</span>
        <span className="perf-hud-stat">Jank: {stats.jankFrames}</span>
        <span className="perf-hud-sep">|</span>
        <span className="perf-hud-stat">DOM: {stats.domNodes} nodos</span>
        {stats.heapUsedMb > 0 && (
          <>
            <span className="perf-hud-sep">|</span>
            <span className="perf-hud-stat">RAM: {stats.heapUsedMb}MB</span>
          </>
        )}
        <span className="perf-hud-sep">|</span>
        <span className="perf-hud-stat">{stats.activeView}: {lastRender}</span>
        <span className="perf-hud-sep">|</span>
        <span className="perf-hud-stat">Imgs: {stats.activeImages} decod ({stats.avgImageLoadMs}ms avg)</span>
      </div>
    </div>
  );
};
