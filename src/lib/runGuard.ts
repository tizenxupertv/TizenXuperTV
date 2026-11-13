/**
 * One run of something that keeps calling back after it was replaced: a signal that failed goes on reporting errors
 * for a few seconds, and those must not reach the signal the viewer chose next.
 *
 * Every callback of the run goes through `wrap`; `end()` (the effect's cleanup) turns them all into no-ops.
 */
export interface RunGuard {
  /** False once the run was replaced or closed */
  alive(): boolean;
  /** The same function, doing nothing after end() */
  wrap<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void;
  end(): void;
}

export function createRunGuard(): RunGuard {
  let on = true;
  return {
    alive: () => on,
    wrap: fn => (...args) => {
      if (on) fn(...args);
    },
    end: () => {
      on = false;
    }
  };
}
