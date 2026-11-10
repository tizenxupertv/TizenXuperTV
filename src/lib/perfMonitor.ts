/**
 * High-Precision TV Performance Monitor & Profiler for Tizen / Chromium.
 *
 * Measures:
 * 1. Real-time FPS & frame duration via requestAnimationFrame
 * 2. View render and mount duration (ms)
 * 3. Image loading & decoding duration (ms)
 * 4. DOM node count (tree complexity)
 * 5. JavaScript heap memory (Chromium memory API)
 * 6. Long tasks / jank detection (> 40ms)
 */

import { useEffect, useRef } from 'react';

export interface ViewRenderMetric {
  count: number;
  lastMs: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
}

export interface PerfState {
  fps: number;
  frameMs: number;
  jankFrames: number;
  domNodes: number;
  heapUsedMb: number;
  heapTotalMb: number;
  activeImages: number;
  totalImagesLoaded: number;
  avgImageLoadMs: number;
  activeView: string;
  renders: Record<string, ViewRenderMetric>;
}

const perfState: PerfState = {
  fps: 60,
  frameMs: 16.6,
  jankFrames: 0,
  domNodes: 0,
  heapUsedMb: 0,
  heapTotalMb: 0,
  activeImages: 0,
  totalImagesLoaded: 0,
  avgImageLoadMs: 0,
  activeView: 'home',
  renders: {}
};

let imageLoadCount = 0;
let imageTotalDuration = 0;
let hudListeners: Array<(state: PerfState) => void> = [];

if (typeof window !== 'undefined') {
  (window as any).__xuperPerf = perfState;
}

/** DOM size and JS heap, read when someone looks at them (walking the whole DOM is not free) */
function measureDomAndHeap(): void {
  perfState.domNodes = document.getElementsByTagName('*').length;
  const memory = (performance as any).memory;
  if (memory && memory.usedJSHeapSize) {
    perfState.heapUsedMb = Math.round((memory.usedJSHeapSize / 1048576) * 10) / 10;
    perfState.heapTotalMb = Math.round((memory.totalJSHeapSize / 1048576) * 10) / 10;
  }
}

// RAF loop for FPS and frame latency. It runs only while the HUD is on screen (someone is subscribed): a callback
// on every frame for the whole life of the app, also under a playing video, is work an old TV does not have to spare
let rafId = 0;

function startLoop(): void {
  if (rafId || typeof window === 'undefined') return;
  let lastRaf = performance.now();
  let frameCount = 0;
  let fpsTimer = performance.now();

  const rafLoop = (now: number) => {
    const delta = now - lastRaf;
    lastRaf = now;
    frameCount++;

    perfState.frameMs = Math.round(delta * 10) / 10;

    // Detect frame drop / jank
    if (delta > 40) {
      perfState.jankFrames++;
      if (delta > 70) {
        console.warn(`[PERF ALERT] Long frame: ${Math.round(delta)}ms | View: ${perfState.activeView} | DOM: ${perfState.domNodes} | Heap: ${perfState.heapUsedMb}MB`);
      }
    }

    // Update FPS once per second
    if (now - fpsTimer >= 1000) {
      perfState.fps = Math.round((frameCount * 1000) / (now - fpsTimer));
      frameCount = 0;
      fpsTimer = now;

      measureDomAndHeap();

      // Notify HUD listeners
      for (const listener of hudListeners) {
        listener({ ...perfState });
      }
    }

    rafId = requestAnimationFrame(rafLoop);
  };

  rafId = requestAnimationFrame(rafLoop);
}

function stopLoop(): void {
  if (!rafId) return;
  cancelAnimationFrame(rafId);
  rafId = 0;
}

/** Record render duration for a specific view */
export function recordViewRender(viewName: string, durationMs: number): void {
  perfState.activeView = viewName;
  const current = perfState.renders[viewName] || {
    count: 0,
    lastMs: 0,
    totalMs: 0,
    avgMs: 0,
    maxMs: 0
  };

  const count = current.count + 1;
  const totalMs = current.totalMs + durationMs;
  perfState.renders[viewName] = {
    count,
    lastMs: Math.round(durationMs * 10) / 10,
    totalMs: Math.round(totalMs * 10) / 10,
    avgMs: Math.round((totalMs / count) * 10) / 10,
    maxMs: Math.max(current.maxMs, Math.round(durationMs * 10) / 10)
  };
}

/** Record image load start/end to measure actual network/decode cost */
export function startImageTracking(): () => void {
  perfState.activeImages++;
  const start = performance.now();
  return () => {
    perfState.activeImages = Math.max(0, perfState.activeImages - 1);
    const duration = performance.now() - start;
    imageLoadCount++;
    imageTotalDuration += duration;
    perfState.totalImagesLoaded = imageLoadCount;
    perfState.avgImageLoadMs = Math.round((imageTotalDuration / imageLoadCount) * 10) / 10;
  };
}

/** Hook to measure view mount/render time */
export function useViewProfiler(viewName: string): void {
  const startRef = useRef(performance.now());
  startRef.current = performance.now();

  useEffect(() => {
    const duration = performance.now() - startRef.current;
    recordViewRender(viewName, duration);
  });
}

/** Subscribe to live performance HUD updates */
export function subscribePerf(listener: (state: PerfState) => void): () => void {
  hudListeners.push(listener);
  startLoop();
  return () => {
    hudListeners = hudListeners.filter(l => l !== listener);
    if (!hudListeners.length) stopLoop();
  };
}

/** Returns the current performance metrics snapshot */
export function getPerfSnapshot(): PerfState {
  return { ...perfState };
}

/** Prints a structured diagnostic report to the console and returns it as a string */
export function logPerformanceReport(): string {
  // FPS and frame time are measured only while the HUD is shown; DOM and memory are read now
  if (typeof document !== 'undefined') measureDomAndHeap();
  const lines: string[] = [
    '====== [PERF DIAGNOSTIC REPORT] ======',
    `Active View: ${perfState.activeView} | FPS: ${perfState.fps} | Frame: ${perfState.frameMs}ms`,
    `DOM Nodes: ${perfState.domNodes} | RAM: ${perfState.heapUsedMb}MB / ${perfState.heapTotalMb}MB`,
    `Images: ${perfState.activeImages} in flight | Loaded: ${perfState.totalImagesLoaded} | Avg: ${perfState.avgImageLoadMs}ms`,
    `Jank Frames (>40ms): ${perfState.jankFrames}`,
    '--- Render Cost by View ---'
  ];

  Object.keys(perfState.renders).forEach(view => {
    const r = perfState.renders[view];
    lines.push(`• ${view.padEnd(14)}: Last: ${r.lastMs}ms | Avg: ${r.avgMs}ms | Max: ${r.maxMs}ms | Renders: ${r.count}`);
  });
  lines.push('======================================');

  const report = lines.join('\n');
  console.log(report);
  return report;
}

if (typeof window !== 'undefined') {
  (window as any).__xuperPerfReport = logPerformanceReport;
}
