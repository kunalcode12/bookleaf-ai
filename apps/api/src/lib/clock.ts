/** Injectable time source so SLA, payout and urgency logic is testable. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(at: Date): Clock & { set(next: Date): void; advance(ms: number): void } {
  let current = at;
  return {
    now: () => new Date(current.getTime()),
    set: (next) => {
      current = next;
    },
    advance: (ms) => {
      current = new Date(current.getTime() + ms);
    },
  };
}
