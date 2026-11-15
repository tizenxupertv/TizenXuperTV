/**
 * Wait before asking the portal for the catalog again after a failed load. A failed start used to end in a notice
 * that told the user to reopen the app; the portal usually answers a few seconds later.
 * Attempt 1 is the first retry: 5 s, 10 s, 20 s, then every 30 s for as long as the app stays open.
 */
export function catalogRetryDelayMs(attempt: number): number {
  const steps = [5000, 10000, 20000];
  return steps[Math.max(1, attempt) - 1] || 30000;
}
