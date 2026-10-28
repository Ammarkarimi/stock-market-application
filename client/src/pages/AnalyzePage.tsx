import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, CircleHelp, Minus, ScanSearch, Search, ShieldAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { AnalysisChart, AVERAGE_COLORS, type AnalysisLayers, type AnalysisRange } from '@/components/charts/AnalysisChart';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, KeyValue, PageHeader } from '@/components/ui/Misc';
import { Skeleton } from '@/components/ui/Spinner';
import { Segmented } from '@/components/ui/Tabs';
import { api, ApiError, errorMessage, qs } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatChange, formatDate, formatMoney, formatNumber, formatPercent } from '@/lib/format';
import { keys } from '@/lib/queryClient';
import type { AnalysisAction, AnalysisDirection, AnalysisMatch, AnalysisPattern, AnalysisReading, AnalysisSignal, StockAnalysis } from '@/lib/types';

const EXAMPLES = ['Reliance', 'TCS', 'HDFC Bank', 'Infosys', 'Tata Motors', 'Apple', 'Tesla'];

const ACTION_STYLES: Record<AnalysisAction, { label: string; tone: string; soft: string }> = {
  BUY: { label: 'Buy', tone: 'text-gain', soft: 'bg-gain-soft border-gain/30' },
  WAIT: { label: 'Wait', tone: 'text-warning', soft: 'bg-warning-soft border-warning/30' },
  AVOID: { label: 'Avoid', tone: 'text-loss', soft: 'bg-loss-soft border-loss/30' },
};

const directionTone: Record<AnalysisDirection, BadgeTone> = { bullish: 'success', bearish: 'danger', neutral: 'neutral' };

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Tickers such as TCS.NS or ^NSEI are analyzed as typed; anything else is looked up by name. */
const looksLikeTicker = (text: string) => /^[\^]?[A-Z0-9&-]+(\.[A-Z]{1,3}|=X)$/.test(text) || text.startsWith('^');

function DirectionIcon({ direction, className }: { direction: AnalysisDirection; className?: string }) {
  if (direction === 'bullish') return <ArrowUpRight className={cn('text-gain', className)} aria-label="Bullish" />;
  if (direction === 'bearish') return <ArrowDownRight className={cn('text-loss', className)} aria-label="Bearish" />;
  return <Minus className={cn('text-muted', className)} aria-label="Neutral" />;
}

function StockSearch() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const term = useDebounced(query.trim(), 250);

  const suggestions = useQuery({
    queryKey: keys.analysisSearch(term.toLowerCase()),
    queryFn: () => api.get<{ items: AnalysisMatch[] }>(`/analysis/search${qs({ q: term })}`),
    enabled: term.length >= 2,
    staleTime: 5 * 60_000,
  });
  const items = term.length >= 2 ? (suggestions.data?.items ?? []) : [];

  useEffect(() => setActive(-1), [term]);

  const analyze = (symbol: string) => {
    setOpen(false);
    setError(null);
    setQuery('');
    inputRef.current?.blur();
    navigate(`/analyze/${encodeURIComponent(symbol)}`);
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = query.trim();
    if (!text) return;
    if (open && items[active]) return analyze(items[active].symbol);
    if (looksLikeTicker(text.toUpperCase())) return analyze(text.toUpperCase());
    setResolving(true);
    try {
      const result = await queryClient.fetchQuery({
        queryKey: keys.analysisSearch(text.toLowerCase()),
        queryFn: () => api.get<{ items: AnalysisMatch[] }>(`/analysis/search${qs({ q: text })}`),
        staleTime: 5 * 60_000,
      });
      if (result.items[0]) analyze(result.items[0].symbol);
      else setError(`No listed stock, ETF or index matches “${text}”. Try the company name or its ticker, e.g. TCS.NS.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setResolving(false);
    }
  };

  return (
    <div>
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row" role="search">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-subtle" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            role="combobox"
            aria-label="Stock name or symbol"
            aria-expanded={open && items.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            autoComplete="off"
            placeholder="Type a stock name, e.g. Reliance, HDFC Bank, Apple…"
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setError(null);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setOpen(true);
                setActive((i) => Math.min(i + 1, items.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, -1));
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
            className="h-12 w-full rounded-xl border border-border bg-surface pl-11 pr-4 text-[15px] text-fg shadow-card outline-none transition-colors placeholder:text-subtle focus:border-primary"
          />
          {open && term.length >= 2 && (items.length > 0 || !suggestions.isFetching) && (
            <ul id={listId} role="listbox" aria-label="Matching stocks" className="absolute left-0 right-0 top-14 z-40 max-h-80 overflow-y-auto rounded-xl border border-border bg-surface py-1 shadow-pop">
              {items.length === 0 ? (
                <li className="px-4 py-4 text-center text-sm text-muted">{suggestions.isError ? errorMessage(suggestions.error) : `No matches for “${term}”`}</li>
              ) : (
                items.map((item, index) => (
                  <li
                    key={item.symbol}
                    role="option"
                    aria-selected={index === active}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      analyze(item.symbol);
                    }}
                    // Highlight on real mouse movement only, so a list opening under a resting cursor does not steal Enter.
                    onMouseMove={() => setActive(index)}
                    className={cn('flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5', index === active && 'bg-surface-2')}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">{item.name}</p>
                      <p className="text-xs text-muted">{item.symbol}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {item.type !== 'EQUITY' && <Badge tone={item.type === 'INDEX' ? 'info' : 'primary'}>{item.type}</Badge>}
                      <Badge>{item.exchange}</Badge>
                    </div>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
        <Button type="submit" size="lg" icon={<ScanSearch className="size-5" />} loading={resolving} disabled={!query.trim()}>
          Analyze
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-loss">
          {error}
        </p>
      )}
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  const position = (score + 100) / 2;
  return (
    <div>
      <div className="relative h-2 rounded-full bg-[linear-gradient(90deg,var(--loss),var(--warning)_50%,var(--gain))]" role="meter" aria-valuemin={-100} aria-valuemax={100} aria-valuenow={score} aria-label="Signal score">
        <span className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-surface bg-fg shadow" style={{ left: `${position}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-subtle">
        <span>Bearish −100</span>
        <span>0</span>
        <span>+100 Bullish</span>
      </div>
    </div>
  );
}

function VerdictCard({ analysis }: { analysis: StockAnalysis }) {
  const { verdict, levels, currency, price } = analysis;
  const style = ACTION_STYLES[verdict.action];
  const money = (v: number) => formatMoney(v, currency);
  const pctFrom = (v: number) => formatPercent(((v - price.last) / price.last) * 100);
  return (
    <Card className="flex flex-col">
      <CardBody className="flex flex-col gap-5">
        <div className={cn('rounded-xl border p-4', style.soft)}>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">The chart says</p>
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <p className={cn('text-4xl font-bold tracking-tight', style.tone)} data-testid="verdict">
              {style.label}
            </p>
            <Badge tone={verdict.confidence === 'High' ? 'success' : verdict.confidence === 'Medium' ? 'warning' : 'neutral'}>{verdict.confidence} confidence</Badge>
          </div>
          <p className="mt-2 text-sm font-medium text-fg">{verdict.headline}</p>
          <p className="mt-1 text-sm text-muted">{verdict.summary}</p>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-muted">Signal score</span>
            <span className={cn('num font-semibold', verdict.score > 0 ? 'text-gain' : verdict.score < 0 ? 'text-loss' : 'text-fg')}>
              {verdict.score > 0 ? '+' : ''}
              {verdict.score}
            </span>
          </div>
          <ScoreBar score={verdict.score} />
        </div>
        <div className="divide-y divide-border">
          <KeyValue label="Entry (last close)" value={money(levels.entry)} />
          <KeyValue label="Stop-loss" value={<span className="text-loss">{money(levels.stopLoss)} <span className="text-xs text-muted">({pctFrom(levels.stopLoss)})</span></span>} />
          <KeyValue label="Target" value={<span className="text-gain">{money(levels.target)} <span className="text-xs text-muted">({pctFrom(levels.target)})</span></span>} />
          <KeyValue label="Reward : risk" value={`${levels.riskReward.toFixed(1)} : 1`} />
        </div>
      </CardBody>
    </Card>
  );
}

function PatternList({ patterns, currency }: { patterns: AnalysisPattern[]; currency: string }) {
  if (patterns.length === 0) {
    return <EmptyState icon={<CircleHelp className="size-6" />} title="No clear patterns right now" description="Neither a chart pattern nor a notable candlestick formed recently. The verdict rests on trend and momentum." />;
  }
  return (
    <ul className="divide-y divide-border">
      {patterns.map((p) => (
        <li key={`${p.id}-${p.date}`} className="flex gap-3 px-4 py-3 sm:px-5">
          <DirectionIcon direction={p.direction} className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-fg">{p.name}</span>
              <Badge tone={directionTone[p.direction]}>{p.direction}</Badge>
              {p.status && <Badge tone={p.status === 'confirmed' ? 'primary' : 'neutral'}>{p.status}</Badge>}
              <span className="text-xs text-muted">{p.kind === 'candlestick' ? 'Candlestick' : p.kind === 'breakout' ? 'Breakout' : 'Chart pattern'} · {formatDate(p.date)}</span>
            </div>
            <p className="mt-1 text-sm text-muted">{p.description}</p>
            {p.target !== null && <p className="mt-1 text-xs text-muted">Measured-move target: <span className="num font-medium text-fg">{formatMoney(p.target, currency)}</span></p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function SignalColumn({ title, signals, tone }: { title: string; signals: AnalysisSignal[]; tone: 'gain' | 'loss' | 'muted' }) {
  return (
    <div className="min-w-0">
      <h3 className={cn('mb-2 text-xs font-semibold uppercase tracking-wider', tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-muted')}>
        {title} ({signals.length})
      </h3>
      {signals.length === 0 ? (
        <p className="text-sm text-subtle">None</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {signals.map((s) => (
            <li key={s.id} className="flex gap-2.5">
              <span className={cn('num mt-0.5 inline-flex h-5 min-w-9 shrink-0 items-center justify-center rounded-md px-1 text-[11px] font-semibold', s.weight > 0 ? 'bg-gain-soft text-gain' : s.weight < 0 ? 'bg-loss-soft text-loss' : 'bg-surface-3 text-muted')}>
                {s.weight > 0 ? '+' : ''}
                {s.weight}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg">{s.label}</p>
                <p className="text-xs text-muted">{s.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IndicatorRow({ name, reading, value }: { name: string; reading: AnalysisReading; value?: string }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', reading.direction === 'bullish' ? 'bg-gain' : reading.direction === 'bearish' ? 'bg-loss' : 'bg-subtle')} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium text-fg">{name}</span>
          <span className="num text-sm text-fg">{value ?? (reading.value === null ? '—' : formatNumber(reading.value, 2))}</span>
        </div>
        <p className="text-xs text-muted">{reading.reading}</p>
      </div>
    </div>
  );
}

function Indicators({ analysis }: { analysis: StockAnalysis }) {
  const { indicators: i, currency } = analysis;
  const money = (v: number | null) => (v === null ? '—' : formatMoney(v, currency));
  return (
    <div className="grid gap-x-8 sm:grid-cols-2 [&>div]:border-b [&>div]:border-border">
      <IndicatorRow name="RSI (14)" reading={i.rsi} />
      <IndicatorRow name="MACD (12, 26, 9)" reading={i.macd} value={i.macd.histogram === null ? '—' : `${formatChange(i.macd.histogram)} hist.`} />
      <IndicatorRow name="ADX (14)" reading={i.adx} value={i.adx.value === null ? '—' : `${i.adx.value.toFixed(0)} · +DI ${i.adx.plusDi?.toFixed(0)} / −DI ${i.adx.minusDi?.toFixed(0)}`} />
      <IndicatorRow name="Bollinger Bands (20, 2)" reading={i.bollinger} value={i.bollinger.upper === null ? '—' : `${money(i.bollinger.lower)} – ${money(i.bollinger.upper)}`} />
      <IndicatorRow name="20-day average" reading={i.sma20} value={money(i.sma20.value)} />
      <IndicatorRow name="50-day average" reading={i.sma50} value={money(i.sma50.value)} />
      <IndicatorRow name="200-day average" reading={i.sma200} value={money(i.sma200.value)} />
      <IndicatorRow name="Volume" reading={i.volume} value={i.volume.value === null ? '—' : `${i.volume.value.toFixed(1)}× avg`} />
      <IndicatorRow name="52-week range" reading={i.range52w} value={`${money(analysis.price.fiftyTwoWeekLow)} – ${money(analysis.price.fiftyTwoWeekHigh)}`} />
      <IndicatorRow name="Average true range" reading={i.atr} value={money(i.atr.value)} />
    </div>
  );
}

function Levels({ analysis }: { analysis: StockAnalysis }) {
  const { support, resistance } = analysis.levels;
  const row = (level: { price: number; touches: number }, kind: 'Resistance' | 'Support') => (
    <KeyValue
      key={`${kind}-${level.price}`}
      label={
        <span className="flex items-center gap-2">
          <span className={cn('size-2 rounded-full', kind === 'Support' ? 'bg-gain' : 'bg-loss')} />
          {kind} <span className="text-xs text-subtle">· {level.touches} {level.touches === 1 ? 'touch' : 'touches'}</span>
        </span>
      }
      value={formatMoney(level.price, analysis.currency)}
    />
  );
  return (
    <div className="divide-y divide-border">
      {[...resistance].reverse().map((l) => row(l, 'Resistance'))}
      <KeyValue label={<span className="font-medium text-fg">Last close</span>} value={<span className="text-primary">{formatMoney(analysis.price.last, analysis.currency)}</span>} />
      {support.map((l) => row(l, 'Support'))}
      {support.length === 0 && <p className="py-2 text-sm text-muted">No support below: the stock is near its lowest levels in two years.</p>}
      {resistance.length === 0 && <p className="py-2 text-sm text-muted">No resistance above: the stock is near its highest levels in two years.</p>}
    </div>
  );
}

function LayerToggle({ label, checked, onChange, swatch }: { label: string; checked: boolean; onChange: (value: boolean) => void; swatch?: string[] }) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className={cn('inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors', checked ? 'border-primary/40 bg-primary-soft text-primary' : 'border-border text-muted hover:bg-surface-2')}
    >
      {swatch && (
        <span className="flex gap-0.5">
          {swatch.map((color) => (
            <span key={color} className="h-0.5 w-2.5 rounded" style={{ background: `var(${color})` }} />
          ))}
        </span>
      )}
      {label}
    </button>
  );
}

function AnalysisResult({ analysis }: { analysis: StockAnalysis }) {
  const [range, setRange] = useState<AnalysisRange>('1Y');
  const [layers, setLayers] = useState<AnalysisLayers>({ averages: true, bands: false, levels: true, patterns: true });
  const toggle = (key: keyof AnalysisLayers) => (value: boolean) => setLayers((current) => ({ ...current, [key]: value }));
  const { price } = analysis;
  const bullish = analysis.signals.filter((s) => s.direction === 'bullish');
  const bearish = analysis.signals.filter((s) => s.direction === 'bearish');
  const neutral = analysis.signals.filter((s) => s.direction === 'neutral');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">{analysis.name}</h2>
            <Badge>{analysis.symbol}</Badge>
            {analysis.instrumentType !== 'EQUITY' && <Badge tone="info">{analysis.instrumentType}</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted">
            {analysis.exchange} · {analysis.currency} · daily chart, {formatNumber(analysis.bars)} sessions to {formatDate(price.asOf)}
          </p>
        </div>
        <div className="text-right">
          <p className="num text-3xl font-semibold tracking-tight text-fg">{formatMoney(price.last, analysis.currency)}</p>
          <p className={cn('num text-sm font-medium', price.change >= 0 ? 'text-gain' : 'text-loss')}>
            {formatChange(price.change)} ({formatPercent(price.changePercent)}) <span className="font-normal text-muted">last session</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <VerdictCard analysis={analysis} />
        <Card className="xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <Segmented aria-label="Chart range" value={range} onChange={setRange} options={(['6M', '1Y', '2Y'] as const).map((r) => ({ value: r, label: r }))} />
            <div className="flex flex-wrap gap-1.5">
              <LayerToggle label="Averages" checked={layers.averages} onChange={toggle('averages')} swatch={[AVERAGE_COLORS.sma20, AVERAGE_COLORS.sma50, AVERAGE_COLORS.sma200]} />
              <LayerToggle label="Bands" checked={layers.bands} onChange={toggle('bands')} />
              <LayerToggle label="Levels" checked={layers.levels} onChange={toggle('levels')} />
              <LayerToggle label="Patterns" checked={layers.patterns} onChange={toggle('patterns')} />
            </div>
          </div>
          <div className="px-2 pb-2 pt-1">
            <AnalysisChart analysis={analysis} range={range} layers={layers} />
          </div>
          {layers.averages && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-[11px] text-muted">
              {(['sma20', 'sma50', 'sma200'] as const).map((key) => (
                <span key={key} className="flex items-center gap-1.5">
                  <span className="h-0.5 w-3 rounded" style={{ background: `var(${AVERAGE_COLORS[key]})` }} />
                  {key.slice(3)}-day average
                </span>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Patterns found" subtitle="Chart patterns from the swing highs and lows, and candlesticks from the last five sessions" />
          <PatternList patterns={analysis.patterns} currency={analysis.currency} />
        </Card>
        <Card>
          <CardHeader title="Why this verdict" subtitle="Every signal and its weight in the score" />
          <CardBody className="grid gap-6 sm:grid-cols-2">
            <SignalColumn title="Bullish" signals={bullish} tone="gain" />
            <SignalColumn title="Bearish" signals={bearish} tone="loss" />
            {neutral.length > 0 && (
              <div className="sm:col-span-2">
                <SignalColumn title="Neutral" signals={neutral} tone="muted" />
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Indicators" />
          <CardBody className="pt-1">
            <Indicators analysis={analysis} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Support and resistance" subtitle="Price levels where the stock turned more than once" />
          <CardBody className="pt-2">
            <Levels analysis={analysis} />
          </CardBody>
        </Card>
      </div>

      <Disclaimer source={analysis.dataSource} generatedAt={analysis.generatedAt} />
    </div>
  );
}

function Disclaimer({ source, generatedAt }: { source?: string; generatedAt?: string }) {
  return (
    <p className="flex gap-2 rounded-xl border border-border bg-surface-2 px-4 py-3 text-xs text-muted">
      <ShieldAlert className="mt-0.5 size-4 shrink-0" />
      <span>
        This is an automated technical reading of the price chart, for education only. It is not investment advice: it ignores company fundamentals,
        news and your own situation, and patterns fail often. Prices are end-of-day or delayed{source ? ` (${source}` : ''}
        {generatedAt ? `, analyzed ${formatDate(generatedAt)})` : source ? ')' : ''}.
      </span>
    </p>
  );
}

function Intro() {
  const navigate = useNavigate();
  const checks = [
    ['Trend', 'Moving averages (20, 50, 200 days), golden and death crosses, higher highs and lows'],
    ['Momentum', 'RSI, MACD crossovers, ADX trend strength, three-month return'],
    ['Chart patterns', 'Double tops and bottoms, head and shoulders, triangles, breakouts and breakdowns'],
    ['Candlesticks', 'Engulfing, hammer, shooting star, morning and evening star, three soldiers and crows'],
    ['Volume and levels', 'On-balance volume, support and resistance, a stop-loss, a target and the reward-to-risk ratio'],
  ];
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Try:</span>
        {EXAMPLES.map((name) => (
          <button
            key={name}
            type="button"
            onClick={async () => {
              const result = await api.get<{ items: AnalysisMatch[] }>(`/analysis/search${qs({ q: name })}`).catch(() => null);
              if (result?.items[0]) navigate(`/analyze/${encodeURIComponent(result.items[0].symbol)}`);
            }}
            className="rounded-full border border-border bg-surface px-3 py-1 text-sm text-fg hover:border-primary hover:text-primary"
          >
            {name}
          </button>
        ))}
      </div>
      <Card>
        <CardHeader title="What the analyzer checks" subtitle="Each check adds or subtracts points; the total decides Buy (+25 or more), Avoid (−20 or less) or Wait" />
        <CardBody className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {checks.map(([title, text]) => (
            <div key={title}>
              <p className="text-sm font-medium text-fg">{title}</p>
              <p className="mt-0.5 text-sm text-muted">{text}</p>
            </div>
          ))}
        </CardBody>
      </Card>
      <Disclaimer />
    </div>
  );
}

function LoadingResult() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Reading the chart">
      <Skeleton className="h-14 w-72" />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Skeleton className="h-[460px]" />
        <Skeleton className="h-[460px] xl:col-span-2" />
      </div>
    </div>
  );
}

export default function AnalyzePage() {
  const { symbol: rawSymbol } = useParams();
  const symbol = rawSymbol?.toUpperCase();
  const analysis = useQuery({
    queryKey: keys.analysis(symbol ?? ''),
    queryFn: () => api.get<StockAnalysis>(`/analysis/${encodeURIComponent(symbol!)}`),
    enabled: Boolean(symbol),
    staleTime: 5 * 60_000,
    retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 1,
  });

  useEffect(() => {
    document.title = analysis.data ? `${analysis.data.verdict.action === 'BUY' ? 'Buy' : analysis.data.verdict.action === 'AVOID' ? 'Avoid' : 'Wait'} · ${analysis.data.name} · Analyzer` : 'Chart analyzer · StockSphere';
    return () => {
      document.title = 'StockSphere';
    };
  }, [analysis.data]);

  const notFound = analysis.error instanceof ApiError && (analysis.error.status === 404 || analysis.error.status === 422);
  let body;
  if (!symbol) body = <Intro />;
  else if (analysis.isPending) body = <LoadingResult />;
  else if (analysis.error) {
    body = notFound ? (
      <EmptyState icon={<CircleHelp className="size-6" />} title={`Can't analyze ${symbol}`} description={errorMessage(analysis.error)} />
    ) : (
      <ErrorState error={analysis.error} onRetry={() => void analysis.refetch()} />
    );
  } else body = <AnalysisResult key={analysis.data.symbol} analysis={analysis.data} />;

  return (
    <div>
      <PageHeader title="Chart analyzer" description="Type any listed stock. The analyzer reads two years of its real daily chart, finds the patterns and tells you whether the chart says buy." />
      <div className="mb-6">
        <StockSearch key={symbol} />
      </div>
      {body}
    </div>
  );
}

