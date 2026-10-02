export type Candle = { time: number; open: number; high: number; low: number; close: number };
export type StrategyName = 'Momentum' | 'Fast' | 'Bounce' | 'Flash5st';
export type Direction = 'CALL' | 'PUT' | 'HOLD';

export type StrategyDecision = {
  strategy: StrategyName;
  direction: Direction;
  confidence: number;
  reason: string;
  referencePrice: number;
  generatedAt: number;
};

export type RiskConfig = {
  maxBid: number;
  maxDailyLoss: number;
  maxTradesPerDay: number;
  cooldownMs: number;
  minConfidence: number;
};

export type RiskSnapshot = {
  dailyPnl: number;
  tradesToday: number;
  lastDecisionAt?: number;
  emergencyStop: boolean;
};

export type RiskResult = {
  allowed: boolean;
  reasons: string[];
};

const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback;
const closes = (candles: Candle[]) => candles.map(c => finite(c.close)).filter(c => c > 0);
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const sma = (values: number[], period: number) => mean(values.slice(-period));
const momentum = (values: number[], period: number) => {
  if (values.length <= period) return 0;
  const previous = values[values.length - period - 1];
  return previous ? (values.at(-1)! - previous) / previous : 0;
};

function momentumDecision(values: number[], strategy: StrategyName, fast: number, slow: number): StrategyDecision {
  const price = values.at(-1) || 0;
  const fastMean = sma(values, fast);
  const slowMean = sma(values, slow);
  const delta = slowMean ? (fastMean - slowMean) / slowMean : 0;
  const direction: Direction = delta > 0.00025 ? 'CALL' : delta < -0.00025 ? 'PUT' : 'HOLD';
  const confidence = Math.min(0.99, Math.max(0, Math.abs(delta) * 80 + Math.abs(momentum(values, fast)) * 20));
  return { strategy, direction, confidence, referencePrice: price, generatedAt: Date.now(), reason: `${strategy}: SMA${fast}/${slow} spread ${(delta * 100).toFixed(3)}%` };
}

export function evaluateStrategy(candles: Candle[], strategy: StrategyName): StrategyDecision {
  const values = closes(candles);
  const empty: StrategyDecision = { strategy, direction: 'HOLD', confidence: 0, referencePrice: 0, generatedAt: Date.now(), reason: 'Menunggu candle yang cukup.' };
  if (values.length < 5) return empty;

  if (strategy === 'Momentum') return momentumDecision(values, strategy, 5, Math.min(13, values.length));
  if (strategy === 'Fast') return momentumDecision(values, strategy, 3, Math.min(7, values.length));

  if (strategy === 'Bounce') {
    const window = values.slice(-8);
    const average = mean(window);
    const deviation = Math.sqrt(mean(window.map(value => (value - average) ** 2)));
    const price = values.at(-1)!;
    const z = deviation ? (price - average) / deviation : 0;
    const direction: Direction = z < -1 ? 'CALL' : z > 1 ? 'PUT' : 'HOLD';
    return { strategy, direction, confidence: Math.min(0.99, Math.abs(z) / 3), referencePrice: price, generatedAt: Date.now(), reason: `Bounce: z-score ${z.toFixed(2)}` };
  }

  const recent = values.slice(-5);
  const rising = recent.every((value, index) => index === 0 || value >= recent[index - 1]);
  const falling = recent.every((value, index) => index === 0 || value <= recent[index - 1]);
  const direction: Direction = rising ? 'CALL' : falling ? 'PUT' : 'HOLD';
  return { strategy, direction, confidence: direction === 'HOLD' ? 0 : 0.62, referencePrice: values.at(-1)!, generatedAt: Date.now(), reason: `Flash5st: ${rising ? '5 candle naik' : falling ? '5 candle turun' : 'candle campuran'}` };
}

export function checkRisk(config: RiskConfig, snapshot: RiskSnapshot, bid: number, decision: StrategyDecision, now = Date.now()): RiskResult {
  const reasons: string[] = [];
  if (snapshot.emergencyStop) reasons.push('emergency stop aktif');
  if (!Number.isFinite(bid) || bid <= 0) reasons.push('nominal bid tidak valid');
  if (bid > config.maxBid) reasons.push(`bid melewati batas ${config.maxBid}`);
  if (snapshot.dailyPnl <= -Math.abs(config.maxDailyLoss)) reasons.push('batas kerugian harian tercapai');
  if (snapshot.tradesToday >= config.maxTradesPerDay) reasons.push('batas jumlah trade harian tercapai');
  if (snapshot.lastDecisionAt && now - snapshot.lastDecisionAt < config.cooldownMs) reasons.push('cooldown antar keputusan belum selesai');
  if (decision.direction === 'HOLD') reasons.push('strategi belum menghasilkan arah');
  if (decision.confidence < config.minConfidence) reasons.push(`confidence ${(decision.confidence * 100).toFixed(0)}% di bawah minimum ${(config.minConfidence * 100).toFixed(0)}%`);
  return { allowed: reasons.length === 0, reasons };
}

export function paperOrderPreview(asset: string, bid: number, decision: StrategyDecision) {
  return { mode: 'paper', submitted: false, asset, bid, direction: decision.direction, confidence: decision.confidence, referencePrice: decision.referencePrice, reason: decision.reason, createdAt: decision.generatedAt } as const;
}
