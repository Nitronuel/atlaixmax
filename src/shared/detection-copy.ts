const DETECTION_EVENT_SUMMARIES: Record<string, string> = {
  BULLISH_CONTINUATION_PUMP: 'Buyers are still controlling the move after a price increase.',
  BEARISH_CONTINUATION_DUMP: 'Sellers are still controlling the move after a price drop.',
  BEARISH_RELIEF_BOUNCE: 'Price is bouncing inside a broader weak trend.',
  BULLISH_PULLBACK: 'Price is cooling off inside a broader bullish trend.',
  BEARISH_REVERSAL_ATTEMPT: 'Buyers are trying to turn a weak trend upward.',
  BULLISH_BREAKDOWN_ATTEMPT: 'Sellers are trying to break a stronger setup lower.',
  RANGE_BREAKOUT_ATTEMPT: 'Token price is trying to move above its previous range highs.',
  RANGE_BREAKDOWN_ATTEMPT: 'Token price is trying to move below its previous range lows.',
  LOW_LIQUIDITY_PRICE_SPIKE: 'Price jumped while liquidity was thin.',
  LOW_LIQUIDITY_SELL_OFF: 'Price dropped while liquidity was thin.',
  LIQUIDITY_DRAIN: 'Liquidity is leaving the pool, making price movement less stable.',
  LIQUIDITY_ADDED: 'New liquidity entered the pool, giving trades more depth.',
  PUMP: 'Price is moving up fast with strong short-term activity.',
  DUMP: 'Price is falling fast with strong short-term selling.',
  BUY_RECOVERY: 'Buyers are returning after recent weakness.',
  SELL_OFF: 'Sellers are pressing the token lower.',
  ACCUMULATION: 'Buyers are absorbing supply.',
  DISTRIBUTION: 'Sellers are becoming more active.'
};

const DISPLAY_LABEL_KEYS: Record<string, string> = {
  'Bullish Continuation': 'BULLISH_CONTINUATION_PUMP',
  'Bearish Continuation': 'BEARISH_CONTINUATION_DUMP',
  'Short-Term Bounce in Bearish Trend': 'BEARISH_RELIEF_BOUNCE',
  'Pullback in Bullish Trend': 'BULLISH_PULLBACK',
  'Possible Bullish Reversal Attempt': 'BEARISH_REVERSAL_ATTEMPT',
  'Possible Bearish Breakdown Attempt': 'BULLISH_BREAKDOWN_ATTEMPT',
  'Range Breakout Attempt': 'RANGE_BREAKOUT_ATTEMPT',
  'Range Breakdown Attempt': 'RANGE_BREAKDOWN_ATTEMPT',
  'Low-Liquidity Price Spike': 'LOW_LIQUIDITY_PRICE_SPIKE',
  'Low-Liquidity Sell-Off': 'LOW_LIQUIDITY_SELL_OFF',
  'Liquidity Drain': 'LIQUIDITY_DRAIN',
  'Liquidity Added': 'LIQUIDITY_ADDED',
  'Pump': 'PUMP',
  'Dump': 'DUMP',
  'Buy Recovery': 'BUY_RECOVERY',
  'Sell-Off': 'SELL_OFF',
  'Accumulation': 'ACCUMULATION',
  'Distribution': 'DISTRIBUTION'
};

function normalizeDetectionLabel(label: string) {
  return label.trim().replace(/[-\s]+/g, '_').toUpperCase();
}

export function detectionEventSummaryForLabel(label: string, fallback = '') {
  const displayKey = DISPLAY_LABEL_KEYS[label.trim()];
  return DETECTION_EVENT_SUMMARIES[displayKey || normalizeDetectionLabel(label)] || fallback;
}
