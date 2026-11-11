import type { LiveChannel } from '../types/channel.ts';

/** First word of a channel name, the brand its siblings share: "ESPN U HD" and "ESPN 2" are both ESPN */
const brandOf = (name: string): string => String(name || '').trim().split(/\s+/)[0].toUpperCase();

/**
 * The service's channels with our own placed among them: each one right after the last channel of its brand, or
 * at the end when the list has none of that brand. Ours never repeat one the service already lists
 */
export function placeExtraChannels(list: LiveChannel[], extras: LiveChannel[]): LiveChannel[] {
  const out = list.slice();
  const seen = new Set(list.map(c => String(c.id)));
  for (const extra of extras) {
    if (seen.has(String(extra.id))) continue;
    seen.add(String(extra.id));
    const brand = brandOf(extra.name);
    let at = -1;
    for (let i = 0; i < out.length; i++) if (brandOf(out[i].name) === brand) at = i;
    if (at >= 0) out.splice(at + 1, 0, extra);
    else out.push(extra);
  }
  return out;
}
