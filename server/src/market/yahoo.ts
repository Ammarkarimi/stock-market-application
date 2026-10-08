/**
 * Minimal client for Yahoo Finance's public (unofficial) JSON endpoints. NSE and BSE prices are delayed by
 * about 15 minutes. Yahoo's terms allow personal, non-commercial use only; a commercial deployment needs a
 * licensed feed (an authorised NSE data vendor or a broker API) behind the same interface.
 */

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const QUOTE_BATCH_SIZE = 50;
const REQUEST_TIMEOUT_MS = 15_000;

/** Yahoo tickers for symbols that are not simply `<symbol>.NS`. */
const TICKER_OVERRIDES: Record<string, string> = {
  NIFTY50: '^NSEI',
  SENSEX: '^BSESN',
  NIFTYBANK: '^NSEBANK',
  NIFTYIT: '^CNXIT',
  NIFTYNEXT50: '^NSMIDCP',
  NIFTYAUTO: '^CNXAUTO',
  NIFTYPHARMA: '^CNXPHARMA',
  // LTIMindtree was renamed LTM Ltd.
  LTIM: 'LTM.NS',
};

export const BENCHMARK_TICKER = '^NSEI';

export function yahooTicker(symbol: string): string {
  return TICKER_OVERRIDES[symbol] ?? `${symbol}.NS`;
}

export interface YahooQuote {
  symbol: string;
  marketState?: string;
  regularMarketPrice?: number;
  regularMarketPreviousClose?: number;
  regularMarketOpen?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  /** Seconds since the epoch. */
  regularMarketTime?: number;
  exchangeDataDelayedBy?: number;
  averageDailyVolume3Month?: number;
  epsTrailingTwelveMonths?: number;
  bookValue?: number;
  sharesOutstanding?: number;
  trailingAnnualDividendRate?: number;
  dividendRate?: number;
}

export interface YahooCandle {
  /** Seconds since the epoch. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface YahooProfile {
  description: string | null;
  city: string | null;
  beta: number | null;
  returnOnEquity: number | null;
  debtToEquity: number | null;
  totalRevenue: number | null;
  netIncome: number | null;
}

export interface YahooAnnualFigure {
  /** Fiscal year end, YYYY-MM-DD. */
  periodEnd: string;
  revenue: number | null;
  netIncome: number | null;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface RawValue {
  raw?: number;
}

const raw = (value: RawValue | undefined): number | null => (typeof value?.raw === 'number' ? value.raw : null);

export class YahooFinance {
  private cookie: string | null = null;
  private crumb: string | null = null;

  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  private async request(url: string, withCookie = false): Promise<Response> {
    // The crumb endpoint answers 406 to 'Accept: application/json'.
    const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: '*/*' };
    if (withCookie && this.cookie) headers.Cookie = this.cookie;
    return this.fetchImpl(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  }

  private async json<T>(url: string, withCookie = false): Promise<T> {
    const res = await this.request(url, withCookie);
    if (!res.ok) throw new YahooError(res.status, `Yahoo Finance responded ${res.status} for ${new URL(url).pathname}`);
    return (await res.json()) as T;
  }

  /** The quote and quoteSummary endpoints need a session cookie and a matching crumb. */
  private async authenticate(): Promise<void> {
    const res = await this.request('https://fc.yahoo.com');
    const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]).filter(Boolean);
    if (cookies.length === 0) throw new YahooError(res.status, 'Yahoo Finance did not issue a session cookie');
    this.cookie = cookies.join('; ');
    const crumbRes = await this.request('https://query1.finance.yahoo.com/v1/test/getcrumb', true);
    const crumb = (await crumbRes.text()).trim();
    if (!crumbRes.ok || !crumb || crumb.includes('<')) throw new YahooError(crumbRes.status, 'Yahoo Finance did not issue a crumb');
    this.crumb = crumb;
  }

  private async authorised<T>(buildUrl: (crumb: string) => string): Promise<T> {
    if (!this.crumb) await this.authenticate();
    try {
      return await this.json<T>(buildUrl(this.crumb!), true);
    } catch (err) {
      if (!(err instanceof YahooError) || (err.status !== 401 && err.status !== 403)) throw err;
      await this.authenticate();
      return this.json<T>(buildUrl(this.crumb!), true);
    }
  }

  /** Latest quotes, in batches. Unknown tickers are simply absent from the result. */
  async quotes(tickers: string[]): Promise<YahooQuote[]> {
    const results: YahooQuote[] = [];
    for (let i = 0; i < tickers.length; i += QUOTE_BATCH_SIZE) {
      const batch = tickers.slice(i, i + QUOTE_BATCH_SIZE).map(encodeURIComponent).join(',');
      const body = await this.authorised<{ quoteResponse: { result: YahooQuote[] } }>(
        (crumb) => `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${batch}&crumb=${encodeURIComponent(crumb)}`,
      );
      results.push(...body.quoteResponse.result);
    }
    return results;
  }

  /** OHLCV candles; bars with missing values (non-trading intervals) are skipped. */
  async chart(ticker: string, range: string, interval: string): Promise<YahooCandle[]> {
    const body = await this.json<{
      chart: {
        result: { timestamp?: number[]; indicators: { quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }[] } }[] | null;
      };
    }>(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}`);
    const result = body.chart.result?.[0];
    const quote = result?.indicators.quote[0];
    if (!result?.timestamp || !quote) return [];
    const candles: YahooCandle[] = [];
    result.timestamp.forEach((time, i) => {
      const [open, high, low, close] = [quote.open[i], quote.high[i], quote.low[i], quote.close[i]];
      if (open == null || high == null || low == null || close == null) return;
      candles.push({ time, open, high, low, close, volume: quote.volume[i] ?? 0 });
    });
    return candles;
  }

  async profile(ticker: string): Promise<YahooProfile | null> {
    const body = await this.authorised<{
      quoteSummary: {
        result:
          | {
              assetProfile?: { longBusinessSummary?: string; city?: string };
              summaryDetail?: { beta?: RawValue };
              financialData?: { returnOnEquity?: RawValue; debtToEquity?: RawValue; totalRevenue?: RawValue };
              defaultKeyStatistics?: { netIncomeToCommon?: RawValue };
            }[]
          | null;
      };
    }>(
      (crumb) =>
        `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=assetProfile,summaryDetail,financialData,defaultKeyStatistics&crumb=${encodeURIComponent(crumb)}`,
    );
    const r = body.quoteSummary.result?.[0];
    if (!r) return null;
    return {
      description: r.assetProfile?.longBusinessSummary ?? null,
      city: r.assetProfile?.city ?? null,
      beta: raw(r.summaryDetail?.beta),
      returnOnEquity: raw(r.financialData?.returnOnEquity),
      debtToEquity: raw(r.financialData?.debtToEquity),
      totalRevenue: raw(r.financialData?.totalRevenue),
      netIncome: raw(r.defaultKeyStatistics?.netIncomeToCommon),
    };
  }

  /** Annual revenue and net income for the last few fiscal years, oldest first. */
  async annualFinancials(ticker: string, now = Date.now()): Promise<YahooAnnualFigure[]> {
    const period2 = Math.floor(now / 1000);
    const period1 = period2 - 6 * 365 * 86_400;
    const body = await this.json<{
      timeseries: { result: ({ meta: { type: string[] } } & Record<string, { asOfDate: string; reportedValue: { raw: number } }[] | unknown>)[] };
    }>(
      `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(ticker)}?type=annualTotalRevenue,annualNetIncome&period1=${period1}&period2=${period2}`,
    );
    const byPeriod = new Map<string, YahooAnnualFigure>();
    for (const series of body.timeseries.result ?? []) {
      const type = series.meta.type[0]!;
      const points = (series[type] as ({ asOfDate: string; reportedValue: { raw: number } } | null)[] | undefined) ?? [];
      for (const point of points) {
        if (!point) continue;
        const entry = byPeriod.get(point.asOfDate) ?? { periodEnd: point.asOfDate, revenue: null, netIncome: null };
        if (type === 'annualTotalRevenue') entry.revenue = point.reportedValue.raw;
        if (type === 'annualNetIncome') entry.netIncome = point.reportedValue.raw;
        byPeriod.set(point.asOfDate, entry);
      }
    }
    return [...byPeriod.values()].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  }
}

export class YahooError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'YahooError';
  }
}
