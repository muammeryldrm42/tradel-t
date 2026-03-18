// ─── Symbols ─────────────────────────────────────────────────────────────────
export type Symbol = "BTC" | "ETH" | "SOL";
export const SUPPORTED_SYMBOLS: Symbol[] = ["BTC", "ETH", "SOL"];
export type Side = "LONG" | "SHORT";
export type OrderSide = "BUY" | "SELL";
export type OrderType = "LIMIT" | "MARKET" | "STOP_LIMIT" | "STOP_MARKET";
export type OrderStatus = "PENDING" | "OPEN" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED" | "REJECTED" | "EXPIRED";
export type TimeInForce = "GTC" | "IOC" | "FOK" | "POST_ONLY";
export type Interval = "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "6h" | "12h" | "1d" | "1w";
export type ExecutionMode = "DRY_RUN" | "PAPER" | "LIVE";
export type SignalDirection = "LONG" | "SHORT" | "FLAT";
export type MarketRegime = "TRENDING_BULLISH" | "TRENDING_BEARISH" | "RANGING" | "HIGH_VOLATILITY" | "LOW_VOLATILITY" | "BREAKOUT" | "BREAKDOWN" | "UNKNOWN";
export type StrategyType = "TREND_FOLLOWING" | "MEAN_REVERSION" | "BREAKOUT" | "MOMENTUM" | "VOLATILITY_REGIME";
export type BotStatus = "STOPPED" | "STARTING" | "RUNNING" | "PAUSED" | "KILL_SWITCH_ACTIVE" | "ERROR" | "CIRCUIT_BREAKER_TRIPPED";

// ─── Market Data ──────────────────────────────────────────────────────────────
export interface Candle {
  symbol: Symbol;
  interval: Interval;
  openTime: number;
  closeTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  quoteVolume: string;
  trades: number;
  isClosed: boolean;
}

export interface Ticker {
  symbol: Symbol;
  lastPrice: string;
  markPrice: string;
  indexPrice: string;
  fundingRate: string;
  nextFundingTime: number;
  openInterest: string;
  volume24h: string;
  priceChange24h: string;
  priceChangePct24h: string;
  high24h: string;
  low24h: string;
  bestBid: string;
  bestAsk: string;
  bestBidSize: string;
  bestAskSize: string;
  timestamp: number;
}

export interface OrderBookLevel { price: string; size: string; }
export interface OrderBook {
  symbol: Symbol;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  lastUpdateId: number;
  timestamp: number;
}

export interface Trade {
  id: string;
  symbol: Symbol;
  price: string;
  size: string;
  side: OrderSide;
  timestamp: number;
}

// ─── Account & Positions ──────────────────────────────────────────────────────
export interface AccountBalance {
  currency: string;
  total: string;
  available: string;
  locked: string;
  unrealizedPnl: string;
  marginUsed: string;
  marginAvailable: string;
  accountEquity: string;
  maintenanceMargin: string;
  initialMargin: string;
  accountHealth: number;
}

export interface Position {
  id: string;
  symbol: Symbol;
  side: Side;
  size: string;
  entryPrice: string;
  markPrice: string;
  liquidationPrice: string;
  unrealizedPnl: string;
  realizedPnl: string;
  leverage: number;
  margin: string;
  marginType: "ISOLATED" | "CROSS";
  fundingFee: string;
  openedAt: number;
  updatedAt: number;
  isOpen: boolean;
}

export interface Order {
  id: string;
  clientOrderId: string;
  symbol: Symbol;
  side: OrderSide;
  type: OrderType;
  timeInForce: TimeInForce;
  price?: string;
  stopPrice?: string;
  size: string;
  filledSize: string;
  remainingSize: string;
  avgFillPrice?: string;
  status: OrderStatus;
  reduceOnly: boolean;
  postOnly: boolean;
  createdAt: number;
  updatedAt: number;
  fee?: string;
  feeCurrency?: string;
  rejectReason?: string;
}

// ─── Signals & Risk ───────────────────────────────────────────────────────────
export interface TradingSignal {
  id: string;
  symbol: Symbol;
  direction: SignalDirection;
  confidence: number;
  entryPrice: string;
  stopLoss: string;
  takeProfit: string;
  riskRewardRatio: number;
  strategyName: string;
  rationale: string;
  invalidationCondition: string;
  timeframe: Interval;
  generatedAt: number;
  expiresAt: number;
  tags: string[];
  metadata?: Record<string, unknown>;
}

export interface EnsembleSignal extends TradingSignal {
  componentSignals: TradingSignal[];
  agreementScore: number;
  regimeAdjusted: boolean;
  filteredReason?: string;
}

export interface RiskParameters {
  symbol: Symbol;
  maxRiskPerTradePct: number;
  maxDailyLossPct: number;
  maxDrawdownPct: number;
  maxOpenPositions: number;
  maxSymbolExposurePct: number;
  maxCorrelatedExposurePct: number;
  minConfidenceThreshold: number;
  minLiquidationDistancePct: number;
  maxLeverageHardCap: number;
  defaultLeverage: number;
  maxSpreadBps: number;
  maxSlippageBps: number;
  maxFundingRateHourly: number;
  cooldownAfterLossMs: number;
  consecutiveLossTripwire: number;
  minRiskRewardRatio: number;
}

export interface RiskAssessment {
  approved: boolean;
  reasons: string[];
  warnings: string[];
  adjustedLeverage?: number;
  adjustedSize?: string;
  liquidationDistance?: number;
  score: number;
  timestamp: number;
}

export interface LeverageDecision {
  leverage: number;
  reason: string;
  requiresHigherConfidenceThreshold: number;
  liquidationSafetyMultiplier: number;
}

// ─── Orders & Execution ───────────────────────────────────────────────────────
export interface OrderRequest {
  symbol: Symbol;
  side: OrderSide;
  type: OrderType;
  size: string;
  price?: string;
  stopPrice?: string;
  timeInForce?: TimeInForce;
  reduceOnly?: boolean;
  postOnly?: boolean;
  clientOrderId: string;
  leverage?: number;
  signal?: TradingSignal;
  riskAssessment?: RiskAssessment;
}

export interface OrderResult {
  success: boolean;
  order?: Order;
  error?: string;
  simulated: boolean;
  mode: ExecutionMode;
  latencyMs?: number;
}

export interface ExecutionContext {
  mode: ExecutionMode;
  dryRun: boolean;
  paperTrading: boolean;
  liveEnabled: boolean;
  symbolAllowlist: Symbol[];
  operatorConfirmationToken?: string;
  acknowledgedRisk: boolean;
}

// ─── Trades & Simulations ─────────────────────────────────────────────────────
export type TradePhase = "SIGNAL_GENERATED" | "RISK_ASSESSED" | "ORDER_SUBMITTED" | "ORDER_FILLED" | "POSITION_OPEN" | "STOP_TRIGGERED" | "TP_TRIGGERED" | "MANUALLY_CLOSED" | "LIQUIDATED" | "REJECTED";

export interface TradeLifecycleEvent {
  tradeId: string;
  phase: TradePhase;
  symbol: Symbol;
  timestamp: number;
  data: Record<string, unknown>;
  error?: string;
}

export interface SimulatedTrade {
  id: string;
  symbol: Symbol;
  side: Side;
  entryPrice: string;
  exitPrice?: string;
  size: string;
  leverage: number;
  entryFee: string;
  exitFee: string;
  fundingFees: string;
  realizedPnl?: string;
  unrealizedPnl?: string;
  entryTime: number;
  exitTime?: number;
  holdDurationMs?: number;
  exitReason?: string;
  signal: TradingSignal;
  riskAssessment: RiskAssessment;
  lifecycleEvents: TradeLifecycleEvent[];
  isOpen: boolean;
}

// ─── Backtest ─────────────────────────────────────────────────────────────────
export interface FeeModel { makerFeePct: number; takerFeePct: number; usePostOnly: boolean; }
export interface SlippageModel { baseSlippageBps: number; volumeImpactFactor: number; maxSlippageBps: number; }
export interface FundingModel { intervalHours: number; useHistoricalRates: boolean; fallbackRateHourly: number; }

export interface BacktestConfig {
  id: string;
  name: string;
  symbols: Symbol[];
  startDate: number;
  endDate: number;
  interval: Interval;
  initialCapital: string;
  strategyConfigs: StrategyConfig[];
  riskParams: Partial<RiskParameters>;
  feeModel: FeeModel;
  slippageModel: SlippageModel;
  fundingModel: FundingModel;
  latencyModelMs: number;
}

export interface PerformanceMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnl: string;
  totalPnlPct: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  sortinoRatio: number;
  expectancy: string;
  profitFactor: number;
  avgWin: string;
  avgLoss: string;
  avgHoldTimeMs: number;
  maxConsecutiveLosses: number;
  totalFees: string;
  finalEquity: string;
}

export interface EquityPoint { timestamp: number; equity: string; drawdownPct: number; }

export interface BacktestResult {
  id: string;
  config: BacktestConfig;
  trades: SimulatedTrade[];
  metrics: PerformanceMetrics;
  equityCurve: EquityPoint[];
  completedAt: number;
  durationMs: number;
}

// ─── Strategy & Regime ────────────────────────────────────────────────────────
export interface StrategyConfig {
  type: StrategyType;
  symbol: Symbol;
  enabled: boolean;
  weight: number;
  params: Record<string, number | string | boolean>;
  timeframes: Interval[];
}

export interface RegimeState {
  symbol: Symbol;
  regime: MarketRegime;
  confidence: number;
  volatilityPercentile: number;
  trendStrength: number;
  volumeConfirmation: boolean;
  detectedAt: number;
  indicators: Record<string, number>;
}

// ─── Bot State ────────────────────────────────────────────────────────────────
export interface BotState {
  status: BotStatus;
  mode: ExecutionMode;
  startedAt?: number;
  lastHeartbeat: number;
  activePositions: number;
  dailyPnl: string;
  dailyLoss: string;
  dailyTrades: number;
  consecutiveLosses: number;
  circuitBreakerTripped: boolean;
  circuitBreakerReason?: string;
  killSwitchActive: boolean;
  error?: string;
  lastSignalAt?: Partial<Record<Symbol, number>>;
}
