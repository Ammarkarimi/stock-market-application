/** Where prices come from and whether the market is trading right now. */
export type MarketSource = 'simulated' | 'yahoo';
export type MarketPhase = 'OPEN' | 'PRE_OPEN' | 'CLOSED';

export interface MarketSessionState {
  source: MarketSource;
  phase: MarketPhase;
  /** Delay of the price feed in minutes (0 for the simulator). */
  delayMinutes: number;
  /** Exchange time of the latest price received from the feed (ms). */
  asOf: number | null;
  /** Exchange time at which the last completed session ended (ms). */
  lastSessionEnd: number | null;
  /** Latest feed error, cleared by the next successful update. */
  lastError: string | null;
}

const state: MarketSessionState = {
  source: 'simulated',
  phase: 'OPEN',
  delayMinutes: 0,
  asOf: null,
  lastSessionEnd: null,
  lastError: null,
};

export function marketSession(): Readonly<MarketSessionState> {
  return state;
}

export function updateMarketSession(patch: Partial<MarketSessionState>): void {
  Object.assign(state, patch);
}

export function isLiveSource(): boolean {
  return state.source !== 'simulated';
}

/** The simulated market never closes; a live market trades only during the exchange's regular session. */
export function isMarketOpen(): boolean {
  return state.source === 'simulated' || state.phase === 'OPEN';
}
