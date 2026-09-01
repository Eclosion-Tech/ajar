/**
 * Leading + trailing throttle with explicit flush/cancel — for streaming
 * pointer-driven edits (drags, sliders) as a bounded rate of reducer calls
 * without ever dropping the final value.
 */
export type Throttled<A extends unknown[]> = {
  call: (...args: A) => void;
  /** Fire any pending trailing call immediately. */
  flush: () => void;
  /** Drop any pending trailing call. */
  cancel: () => void;
};

export function throttled<A extends unknown[]>(fn: (...args: A) => void, ms: number): Throttled<A> {
  let lastFired = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;

  const fire = () => {
    if (pending) {
      const args = pending;
      pending = null;
      lastFired = Date.now();
      fn(...args);
    }
  };

  return {
    call: (...args: A) => {
      pending = args;
      const elapsed = Date.now() - lastFired;
      if (elapsed >= ms && timer === null) {
        fire();
        return;
      }
      if (timer === null) {
        timer = setTimeout(
          () => {
            timer = null;
            fire();
          },
          Math.max(0, ms - elapsed),
        );
      }
    },
    flush: () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      fire();
    },
    cancel: () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
    },
  };
}
