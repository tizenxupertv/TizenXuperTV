/**
 * HTTP answers to a live playlist that mean "this link is no longer yours", so a fresh link from the portal
 * (resolveLive with fresh: true) can play the channel: 401/403 (token refused), 409 and 410 (the portal CDNs answer
 * them when a link expired or another session took it; bot reports show them on the portal hosts, and the channel
 * then died on the backups with 404).
 * No relative imports, so tests can load this file in Node.
 */
const STALE_LINK_STATUSES = [401, 403, 409, 410];

export function isStaleLinkStatus(httpCode: number): boolean {
  return STALE_LINK_STATUSES.indexOf(httpCode) !== -1;
}
