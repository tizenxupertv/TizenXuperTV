/**
 * Update channel of the TV: 'stable' takes only releases, 'beta' also GitHub pre-releases (the bot's
 * /tv/update?channel=beta). No relative imports, so tests can load this file in Node.
 */
export type UpdateChannel = 'stable' | 'beta';

/** Query string for /tv/update: the running version, and the beta channel when chosen */
export function updateQuery(running: string, channel: UpdateChannel): string {
  return `?v=${encodeURIComponent(running)}${channel === 'beta' ? '&channel=beta' : ''}`;
}
