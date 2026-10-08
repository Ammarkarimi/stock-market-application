import { useSyncExternalStore } from 'react';

/** Server tick tuple: [symbol, last, change, changePercent, high, low, volume, time (s)]. */
export type TickTuple = [string, number, number, number, number, number, number, number];

export interface LiveTick {
  symbol: string;
  lastPrice: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  volume: number;
  /** Exchange time of the price, in seconds. */
  time: number;
  /** Direction of the latest move: 1 up, -1 down, 0 unchanged. */
  direction: -1 | 0 | 1;
  /** Client receive time, used to retrigger flash animations. */
  at: number;
}

const ticks = new Map<string, LiveTick>();
const symbolListeners = new Map<string, Set<() => void>>();
const anyListeners = new Set<() => void>();
let version = 0;

export function applyTicks(tuples: TickTuple[]): void {
  const now = Date.now();
  for (const [symbol, lastPrice, change, changePercent, high, low, volume, time] of tuples) {
    const previous = ticks.get(symbol);
    if (previous && previous.lastPrice === lastPrice && previous.volume === volume) continue;
    const direction = !previous || previous.lastPrice === lastPrice ? (previous?.direction ?? 0) : lastPrice > previous.lastPrice ? 1 : -1;
    ticks.set(symbol, {
      symbol,
      lastPrice,
      change,
      changePercent,
      high,
      low,
      volume,
      time,
      direction,
      at: previous && previous.lastPrice !== lastPrice ? now : (previous?.at ?? 0),
    });
    symbolListeners.get(symbol)?.forEach((listener) => listener());
  }
  version++;
  anyListeners.forEach((listener) => listener());
}

export function clearTicks(): void {
  ticks.clear();
  version++;
  anyListeners.forEach((listener) => listener());
}

export function getTick(symbol: string): LiveTick | undefined {
  return ticks.get(symbol);
}

function subscribeSymbol(symbol: string, listener: () => void) {
  let set = symbolListeners.get(symbol);
  if (!set) symbolListeners.set(symbol, (set = new Set()));
  set.add(listener);
  return () => {
    set!.delete(listener);
  };
}

/** Live tick for one symbol; re-renders only when that symbol changes. */
export function useLiveTick(symbol: string | undefined): LiveTick | undefined {
  return useSyncExternalStore(
    (listener) => (symbol ? subscribeSymbol(symbol, listener) : () => {}),
    () => (symbol ? ticks.get(symbol) : undefined),
    () => undefined,
  );
}

/** Re-renders on every tick batch; use for aggregates such as live portfolio totals. */
export function useLiveVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      anyListeners.add(listener);
      return () => anyListeners.delete(listener);
    },
    () => version,
    () => 0,
  );
}

/** Live price for a symbol, falling back to a value loaded from the API. */
export function livePrice(symbol: string, fallback: number): number {
  return ticks.get(symbol)?.lastPrice ?? fallback;
}

// Connection status of the live stream, for the "Live" indicator.
let connected = false;
const statusListeners = new Set<() => void>();

export function setStreamConnected(value: boolean): void {
  if (connected === value) return;
  connected = value;
  statusListeners.forEach((listener) => listener());
}

export function useStreamConnected(): boolean {
  return useSyncExternalStore(
    (listener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    () => connected,
    () => false,
  );
}
