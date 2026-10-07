/**
 * Central time source. Everything that depends on "now" goes through here so tests can move time
 * deterministically (IPO windows, session expiry, day rollover).
 */
let offsetMs = 0;
let frozenAt: number | null = null;

export function nowMs(): number {
  return frozenAt ?? Date.now() + offsetMs;
}

export function now(): Date {
  return new Date(nowMs());
}

export function nowIso(): string {
  return now().toISOString();
}

/** Test helper: freeze the clock at a specific instant. */
export function freezeTime(at: Date | string | number): void {
  frozenAt = new Date(at).getTime();
}

/** Test helper: move the clock forward (works for frozen and running clocks). */
export function advanceTime(ms: number): void {
  if (frozenAt !== null) frozenAt += ms;
  else offsetMs += ms;
}

export function resetTime(): void {
  offsetMs = 0;
  frozenAt = null;
}
