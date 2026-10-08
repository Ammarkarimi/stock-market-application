/** Types mirroring the API's response shapes. Amounts are rupees; timestamps are ISO strings. */

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export type Role = 'USER' | 'ADMIN';

export interface User {
  id: number;
  email: string;
  fullName: string;
  phone: string | null;
  dateOfBirth: string | null;
  pan: string | null;
  address: string | null;
  role: Role;
  status: 'ACTIVE' | 'SUSPENDED';
  hasPin: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Session {
  id: string;
  device: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export interface BankAccount {
  accountHolder: string;
  accountNumberMasked: string;
  ifsc: string;
  bankName: string;
  updatedAt: string;
}

export type NotificationCategory = 'ORDER' | 'IPO' | 'PRICE_ALERT' | 'FUNDS' | 'SECURITY' | 'SYSTEM';
export type NotificationPreferences = Record<Exclude<NotificationCategory, 'SECURITY'>, boolean>;

export interface Profile {
  user: User;
  bankAccount: BankAccount | null;
  notificationPreferences: NotificationPreferences;
}

export interface ActivityEntry {
  id: number;
  actorRole: string;
  actorName: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export type SecurityType = 'STOCK' | 'ETF' | 'REIT' | 'INVIT' | 'INDEX';

export interface Quote {
  symbol: string;
  name: string;
  type: SecurityType;
  exchange: string;
  sector: string | null;
  lastPrice: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePercent: number;
  volume: number;
  turnover: number;
  tradingStatus: 'ACTIVE' | 'HALTED';
  isTradable: boolean;
  updatedAt: string;
}

export interface SecurityListItem extends Quote {
  industry: string | null;
  marketCapCr: number | null;
}

export interface IndexSummary extends Quote {
  sparkline: number[];
  constituents: number;
}

export interface Constituent extends SecurityListItem {
  weight: number;
  contribution: number;
}

export interface SectorPerformance {
  sector: string;
  changePercent: number;
  advances: number;
  declines: number;
  count: number;
  marketCapCr: number;
  topGainer: string | null;
  topLoser: string | null;
}

export interface MarketBreadth {
  advances: number;
  declines: number;
  unchanged: number;
  total: number;
}

export interface MarketStatus {
  status: 'OPEN' | 'CLOSED';
  phase: 'OPEN' | 'PRE_OPEN' | 'CLOSED';
  session: string;
  simulated: boolean;
  /** 'Yahoo Finance' or 'Simulated'. */
  source: string;
  delayMinutes: number;
  /** Exchange time of the latest live price. */
  asOf: string | null;
  feedError: string | null;
  live: boolean;
  tradingDate: string;
  tickIntervalMs: number;
  serverTime: string;
}

export interface MarketOverview {
  status: MarketStatus;
  indices: IndexSummary[];
  breadth: MarketBreadth;
  gainers: SecurityListItem[];
  losers: SecurityListItem[];
  active: SecurityListItem[];
  sectors: SectorPerformance[];
}

export interface Position {
  quantity: number;
  freeQuantity: number;
  averagePrice: number;
  invested: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
  realizedPnl: number;
}

export interface SecurityDetail {
  priceSource: 'live' | 'simulated';
  financialsSource: 'reported' | 'illustrative' | null;
  quote: Quote;
  security: {
    symbol: string;
    name: string;
    type: SecurityType;
    exchange: string;
    sector: string | null;
    industry: string | null;
    description: string | null;
    foundedYear: number | null;
    headquarters: string | null;
    listingDate: string | null;
    faceValue: number | null;
    tickSize: number;
    circuitPct: number;
    underlyingSymbol: string | null;
    expenseRatio: number | null;
    isTradable: boolean;
    tradingStatus: 'ACTIVE' | 'HALTED';
  };
  metrics: {
    marketCapCr: number | null;
    pe: number | null;
    pb: number | null;
    eps: number | null;
    bookValue: number | null;
    dividendPerShare: number | null;
    dividendYield: number | null;
    roe: number | null;
    debtToEquity: number | null;
    beta: number | null;
    revenueCr: number | null;
    netProfitCr: number | null;
    week52High: number;
    week52Low: number;
    avgVolume20d: number | null;
    upperCircuit: number;
    lowerCircuit: number;
  };
  performance: Record<string, number | null>;
  financials: { year: string; revenueCr: number; netProfitCr: number; netMarginPct: number }[];
  memberOf: { symbol: string; name: string; weight: number }[];
  position: Position | null;
  watchlists: { id: number; name: string }[];
  alerts: Alert[];
}

export interface Candle {
  time: number | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type HistoryRange = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | '3Y' | '5Y';

export interface PriceHistory {
  symbol: string;
  range: HistoryRange;
  interval: string;
  candles: Candle[];
}

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT';
export type OrderValidity = 'DAY' | 'IOC';
export type OrderStatus = 'OPEN' | 'EXECUTED' | 'CANCELLED' | 'REJECTED' | 'EXPIRED';

export interface Order {
  id: number;
  symbol: string;
  name: string;
  side: OrderSide;
  orderType: OrderType;
  validity: OrderValidity;
  quantity: number;
  limitPrice: number | null;
  status: OrderStatus;
  statusReason: string | null;
  filledQuantity: number;
  averagePrice: number | null;
  blockedAmount: number;
  lastPrice: number | null;
  tradingDate: string;
  createdAt: string;
  updatedAt: string;
  executedAt: string | null;
  cancelledAt: string | null;
  userId?: number;
  userName?: string;
}

export interface Charges {
  brokerage: number;
  stt: number;
  exchangeCharges: number;
  sebiFees: number;
  stampDuty: number;
  gst: number;
  total: number;
}

export interface Trade {
  id: number;
  orderId: number | null;
  source: 'ORDER' | 'IPO';
  symbol: string;
  name: string;
  side: OrderSide;
  quantity: number;
  price: number;
  value: number;
  charges: Charges;
  netAmount: number;
  realizedPnl: number | null;
  tradingDate: string;
  executedAt: string;
}

export interface TradesPage extends Page<Trade> {
  totals: { buyValue: number; sellValue: number; charges: number; realizedPnl: number };
}

export interface OrderDetail {
  order: Order;
  trade: Trade | null;
  timeline: { action: string; createdAt: string; actorRole: string; details: Record<string, unknown> | null }[];
}

export interface OrderPreview {
  symbol: string;
  name: string;
  side: OrderSide;
  orderType: OrderType;
  validity: OrderValidity;
  quantity: number;
  price: number;
  lastPrice: number;
  value: number;
  charges: Charges;
  totalAmount: number;
  availableBalance: number;
  freeQuantity: number;
  marketable: boolean;
  circuit: { lower: number; upper: number };
  canPlace: boolean;
  issues: string[];
}

export interface Holding {
  symbol: string;
  name: string;
  type: SecurityType;
  sector: string | null;
  quantity: number;
  freeQuantity: number;
  averagePrice: number;
  lastPrice: number;
  prevClose: number;
  invested: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
  dayChange: number;
  dayChangePercent: number;
  weight: number;
  realizedPnl: number;
  firstBoughtAt: string | null;
}

export interface PortfolioSummary {
  invested: number;
  currentValue: number;
  totalPnl: number;
  totalPnlPercent: number;
  dayPnl: number;
  dayPnlPercent: number;
  realizedPnl: number;
  holdingsCount: number;
}

export interface AllocationSlice {
  name: string;
  value: number;
  weight: number;
}

export interface Portfolio {
  summary: PortfolioSummary;
  holdings: Holding[];
  allocation: { bySecurity: AllocationSlice[]; bySector: AllocationSlice[]; byType: AllocationSlice[] };
}

export type PerformanceRange = '1M' | '3M' | '6M' | '1Y' | 'ALL';

export interface PerformancePoint {
  date: string;
  value: number;
  invested: number;
  benchmark: number | null;
}

export interface Performance {
  range: PerformanceRange;
  points: PerformancePoint[];
  startValue: number;
  endValue: number;
}

export interface FundsSummary {
  cashBalance: number;
  availableBalance: number;
  blockedForOrders: number;
  blockedForIpos: number;
  withdrawable: number;
  totalDeposits: number;
  totalWithdrawals: number;
  limits: { minDeposit: number; maxDeposit: number; minWithdrawal: number; maxWithdrawal: number };
}

export interface FundTransaction {
  id: number;
  type: 'DEPOSIT' | 'WITHDRAWAL';
  amount: number;
  method: string;
  status: 'COMPLETED' | 'FAILED';
  reference: string;
  bankAccount: string | null;
  createdAt: string;
  userId?: number;
  userName?: string;
  userEmail?: string;
}

export type LedgerEntryType = 'DEPOSIT' | 'WITHDRAWAL' | 'BUY' | 'SELL' | 'CHARGES' | 'IPO_ALLOTMENT' | 'ADJUSTMENT';

export interface LedgerEntry {
  id: number;
  type: LedgerEntryType;
  amount: number;
  credit: number;
  debit: number;
  balanceAfter: number;
  referenceType: string | null;
  referenceId: number | null;
  description: string;
  createdAt: string;
  userId?: number;
  userName?: string;
  userEmail?: string;
}

export interface Statement {
  from: string;
  to: string;
  openingBalance: number;
  closingBalance: number;
  totalCredits: number;
  totalDebits: number;
  totalsByType: Partial<Record<LedgerEntryType, number>>;
  entries: LedgerEntry[];
}

export interface WatchlistItem extends Quote {
  addedAt: string;
}

export interface Watchlist {
  id: number;
  name: string;
  createdAt: string;
  items: WatchlistItem[];
}

export type AlertCondition = 'ABOVE' | 'BELOW';
export type AlertStatus = 'ACTIVE' | 'TRIGGERED' | 'DISABLED';

export interface Alert {
  id: number;
  symbol: string;
  name: string;
  condition: AlertCondition;
  targetPrice: number;
  status: AlertStatus;
  note: string | null;
  lastPrice: number | null;
  distancePercent: number | null;
  triggeredPrice: number | null;
  triggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: number;
  category: NotificationCategory;
  title: string;
  message: string;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationsPage extends Page<Notification> {
  unreadCount: number;
}

export type IpoStatus = 'UPCOMING' | 'OPEN' | 'CLOSED' | 'ALLOTTED' | 'LISTED' | 'WITHDRAWN';
export type IpoApplicationStatus = 'APPLIED' | 'CANCELLED' | 'ALLOTTED' | 'NOT_ALLOTTED';

export interface IpoApplication {
  id: number;
  applicationNo: string;
  ipoId: number;
  companyName: string;
  symbol: string;
  ipoStatus: IpoStatus;
  quantity: number;
  lots: number;
  bidPrice: number;
  isCutoff: boolean;
  amount: number;
  status: IpoApplicationStatus;
  statusReason: string | null;
  allottedQuantity: number;
  allotmentPrice: number | null;
  amountDebited: number;
  amountRefunded: number;
  sharesCreditedAt: string | null;
  allotmentDate: string;
  listingDate: string;
  createdAt: string;
  updatedAt: string;
  userId?: number;
  userName?: string;
  userEmail?: string;
}

export interface Ipo {
  id: number;
  companyName: string;
  symbol: string;
  issueType: 'MAINBOARD' | 'SME';
  sector: string | null;
  industry: string | null;
  description: string | null;
  status: IpoStatus;
  priceBand: { low: number; high: number };
  lotSize: number;
  minLots: number;
  maxLots: number;
  minInvestment: number;
  maxInvestment: number;
  issueSizeCr: number;
  freshIssueCr: number;
  ofsCr: number;
  quotas: { retail: number; nii: number; qib: number };
  dates: { open: string; close: string; allotment: string; refund: string | null; listing: string };
  issuePrice: number | null;
  listingPrice: number | null;
  listingGainPercent: number | null;
  currentPrice: number | null;
  subscription: { retail: number; nii: number; qib: number; total: number };
  financials: { year: string; revenueCr: number; profitCr: number; assetsCr: number }[];
  registrar: string | null;
  leadManagers: string[];
  myApplication: IpoApplication | null;
  applicationsCount?: number;
}

export interface AuditLog {
  id: number;
  actorId: number | null;
  actorRole: string;
  actorName: string | null;
  subjectUserId: number | null;
  subjectName: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  hash: string;
}

export interface AdminOverview {
  users: { total: number; active: number; suspended: number; admins: number; newToday: number; newThisWeek: number };
  sessions: { active: number };
  orders: { today: number; executedToday: number; rejectedToday: number; open: number };
  trading: { tradesToday: number; turnoverToday: number; chargesToday: number; chargesTotal: number };
  funds: {
    totalCash: number;
    holdingsValue: number;
    depositsToday: number;
    withdrawalsToday: number;
    blockedForOrders: number;
    blockedForIpos: number;
  };
  ipos: { upcoming: number; open: number; awaitingAllotment: number; pendingApplications: number };
  market: { status: MarketStatus; breadth: MarketBreadth };
  daily: { date: string; trades: number; turnover: number; newUsers: number }[];
  recentActivity: AuditLog[];
}

export interface AdminUser extends User {
  cashBalance: number;
  holdingsCount: number;
  ordersCount: number;
  locked: boolean;
}

export interface AdminUserDetail {
  user: User;
  security: { failedLoginAttempts: number; lockedUntil: string | null; pinLockedUntil: string | null; passwordChangedAt: string | null };
  bankAccount: BankAccount | null;
  funds: FundsSummary;
  portfolio: { summary: PortfolioSummary; holdings: Holding[] };
  orders: Order[];
  ipoApplications: IpoApplication[];
  sessions: Session[];
  activity: AuditLog[];
}

export interface Settings {
  charges: {
    brokeragePct: number;
    brokerageMax: number;
    sttPct: number;
    exchangePct: number;
    sebiPerCrore: number;
    stampDutyPct: number;
    gstPct: number;
  };
  funds: { minDeposit: number; maxDeposit: number; minWithdrawal: number; maxWithdrawal: number };
  trading: { maxOrderQuantity: number; ipoRetailLimit: number };
}
