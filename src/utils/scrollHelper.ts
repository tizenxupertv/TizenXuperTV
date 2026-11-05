/**
 * Fast eased scrolling for the TV. The browser's smooth scroll lasts ~300-500 ms and cannot be tuned;
 * this one takes 180 ms (100 ms while keys repeat) and a new key press continues from where the
 * current animation is, so focus never waits for the scroll.
 */
const running = new WeakMap<HTMLElement, number>();

export function animateScroll(el: HTMLElement, axis: 'left' | 'top', to: number, duration = 180): void {
  const prop = axis === 'left' ? 'scrollLeft' : 'scrollTop';
  const prev = running.get(el);
  if (prev) cancelAnimationFrame(prev);
  const from = el[prop];
  const delta = to - from;
  if (Math.abs(delta) < 1) return;
  const start = performance.now();
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
    el[prop] = from + delta * eased;
    if (p < 1) running.set(el, requestAnimationFrame(step));
    else running.delete(el);
  };
  running.set(el, requestAnimationFrame(step));
}

/**
 * GPU scrolling for rows and pages. Moving `scrollLeft`/`scrollTop` frame by frame makes the TV
 * repaint the whole area on every frame (smooth in desktop Chrome, choppy on the TV). Instead the
 * row (or page track) is moved with a CSS transform transition, which the compositor animates
 * without repainting; a new key press retargets the running transition from where it is.
 */
const offsets = new WeakMap<HTMLElement, number>();
const EASE = 'cubic-bezier(0.25, 0.8, 0.25, 1)';
let lastMoveAt = 0;

/** Turns a native scroller into a transform track; its parent clips it */
function prepare(el: HTMLElement): void {
  if (el.dataset.tvTrack) return;
  el.dataset.tvTrack = '1';
  el.scrollLeft = 0;
  el.scrollTop = 0;
  el.style.overflow = 'visible';
  el.style.willChange = 'transform';
  if (el.parentElement) el.parentElement.style.overflow = 'hidden';
}

export function getTrackOffset(el: HTMLElement | null): number {
  return el ? offsets.get(el) || 0 : 0;
}

/** Moves a track to `value` px (left or up); `animate: false` jumps there */
export function setTrackOffset(el: HTMLElement, axis: 'x' | 'y', value: number, animate = true): void {
  prepare(el);
  if (Math.abs((offsets.get(el) || 0) - value) < 1 && el.style.transform) return;
  offsets.set(el, value);
  const now = performance.now();
  const rapid = now - lastMoveAt < 160; // held key: shorter moves keep up with focus
  lastMoveAt = now;
  el.style.transition = animate ? `transform ${rapid ? 120 : 220}ms ${EASE}` : 'none';
  el.style.transform = axis === 'x' ? `translate3d(${-value}px, 0, 0)` : `translate3d(0, ${-value}px, 0)`;
}

/**
 * Keeps the focused card of a row inside the comfort zone (tvOS style): the row only moves when
 * the card gets near an edge, and the first card always brings the row back to the start.
 *
 * Performance: Slider geometry (pitch, width, padding) is cached per container so repeated
 * key navigation runs with pure integer arithmetic (0 ms, zero DOM reflows). It stays 100%
 * responsive by auto-invalidating on window resize.
 */
interface SliderMetrics {
  cardWidth: number;
  pitch: number;
  padLeft: number;
  view: number;
  max: number;
  measuredAt: number;
}

const sliderMetricsCache = new WeakMap<HTMLElement, SliderMetrics>();
let lastResizeTime = 0;

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    lastResizeTime = Date.now();
  }, { passive: true });
}

export function scrollHorizontalSlider(
  container: HTMLElement | null,
  target: HTMLElement | null,
  index: number,
  paddingLeft = 48,
  paddingRight = 160
) {
  if (!container || !target) return;
  prepare(container);
  if (index === 0) {
    setTrackOffset(container, 'x', 0);
    return;
  }

  // Check if we already measured this container at the current screen size
  let metrics = sliderMetricsCache.get(container);
  const isStale = !metrics || metrics.measuredAt < lastResizeTime || metrics.cardWidth === 0;

  if (isStale) {
    const cardWidth = target.offsetWidth || 176;
    // Calculate pitch from adjacent sibling or target width + gap
    let pitch = cardWidth + 18;
    const nextSib = target.nextElementSibling as HTMLElement | null;
    if (nextSib && nextSib.offsetLeft > target.offsetLeft) {
      pitch = nextSib.offsetLeft - target.offsetLeft;
    }
    const view = container.clientWidth || 1920;
    const endPad = parseFloat(getComputedStyle(container).paddingRight) || 0;
    const padLeft = parseFloat(getComputedStyle(container).paddingLeft) || paddingLeft;
    const max = Math.max(0, container.scrollWidth + endPad - view);

    metrics = {
      cardWidth,
      pitch,
      padLeft,
      view,
      max,
      measuredAt: Date.now()
    };
    sliderMetricsCache.set(container, metrics);
  }

  // Pure mathematical calculation (0 ms, zero reflows during navigation):
  const left = metrics.padLeft + index * metrics.pitch;
  const right = left + metrics.cardWidth;
  const current = getTrackOffset(container);
  let next = current;
  if (left - current < paddingLeft) next = left - paddingLeft;
  else if (right - current > metrics.view - paddingRight) next = right - (metrics.view - paddingRight);
  setTrackOffset(container, 'x', Math.min(metrics.max, Math.max(0, next)));
}
