const DETECTION_EVENT_SUMMARIES: Record<string, string> = {
  BULLISH_CONTINUATION_PUMP: 'Buyers may still be controlling the move; follow-through needs volume and support.',
  BEARISH_CONTINUATION_DUMP: 'Sellers may still be controlling the move; recovery needs stronger buy flow.',
  BEARISH_RELIEF_BOUNCE: 'Price may be bouncing inside a broader weak trend.',
  BULLISH_PULLBACK: 'Price may be cooling off inside a broader bullish trend.',
  BEARISH_REVERSAL_ATTEMPT: 'Buyers may be trying to turn a weak trend upward.',
  BULLISH_BREAKDOWN_ATTEMPT: 'Sellers may be testing a stronger setup lower.',
  RANGE_BREAKOUT_ATTEMPT: 'Price may be testing the upper side of its recent range.',
  RANGE_BREAKDOWN_ATTEMPT: 'Price may be testing the lower side of its recent range.',
  LOW_LIQUIDITY_PRICE_SPIKE: 'Price jumped while liquidity was thin; the move may be fragile.',
  LOW_LIQUIDITY_SELL_OFF: 'Price dropped while liquidity was thin; exits may be unstable.',
  LIQUIDITY_DRAIN: 'Liquidity may be leaving the pool, making price movement less stable.',
  LIQUIDITY_ADDED: 'New liquidity may be improving trading depth.',
  PUMP: 'Price is moving up fast; confirmation depends on liquidity and follow-through.',
  DUMP: 'Price is falling fast; risk rises if sell pressure and weak liquidity persist.',
  BUY_RECOVERY: 'Buyers may be returning after recent weakness.',
  SELL_OFF: 'Sellers may be pressing the token lower.',
  ACCUMULATION: 'Buyers may be absorbing supply; upside still needs liquidity and follow-through.',
  DISTRIBUTION: 'Sellers may be pushing supply into the market.'
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

const DETECTION_EVENT_ASSESSMENTS: Record<string, (tokenName: string) => string> = {
  BULLISH_CONTINUATION_PUMP: (tokenName) =>
    `${tokenName} is showing bullish continuation tendencies. Buyers may still control the move. Follow-through improves if price holds support, liquidity stays deep, and volume confirms. The read weakens if sellers reclaim momentum.`,
  BEARISH_CONTINUATION_DUMP: (tokenName) =>
    `${tokenName} is showing bearish continuation tendencies. Sellers may still control the move. Downside risk rises if sell pressure persists, liquidity weakens, and buyers fail to reclaim levels. The read weakens if buy volume returns.`,
  BEARISH_RELIEF_BOUNCE: (tokenName) =>
    `${tokenName} is showing short-term bounce tendencies inside a weaker trend. Buyers may be reacting after selling. Relief odds improve if volume rises and price reclaims resistance. The read weakens if sellers return.`,
  BULLISH_PULLBACK: (tokenName) =>
    `${tokenName} is showing pullback tendencies inside a stronger trend. Price may be cooling while structure holds. The reset stays healthier if support and liquidity hold. The read weakens if sell dominance expands.`,
  BEARISH_REVERSAL_ATTEMPT: (tokenName) =>
    `${tokenName} is showing possible reversal tendencies after weakness. Buyers may be trying to turn structure upward. Recovery odds improve if volume follows through and price builds higher lows. The read weakens at resistance.`,
  BULLISH_BREAKDOWN_ATTEMPT: (tokenName) =>
    `${tokenName} is showing possible breakdown tendencies. Sellers may be testing buyer defense. Downside risk rises if support fails, selling volume confirms, and liquidity weakens. The read fades if buyers reclaim the level.`,
  RANGE_BREAKOUT_ATTEMPT: (tokenName) =>
    `${tokenName} is showing range breakout tendencies. Price may be testing range highs. Upside odds improve if buy volume expands and price holds above the breakout area. The read weakens if price falls back.`,
  RANGE_BREAKDOWN_ATTEMPT: (tokenName) =>
    `${tokenName} is showing range breakdown tendencies. Price may be testing range lows. Downside risk rises if sell volume expands, liquidity weakens, and buyers fail to reclaim. The read weakens if price recovers.`,
  LOW_LIQUIDITY_PRICE_SPIKE: (tokenName) =>
    `${tokenName} is showing low-liquidity spike tendencies. Price moved up while depth looked thin, making the move less reliable. The read improves if liquidity deepens and weakens if price retraces quickly.`,
  LOW_LIQUIDITY_SELL_OFF: (tokenName) =>
    `${tokenName} is showing low-liquidity sell-off tendencies. Price dropped while depth looked thin, raising slippage risk. The read worsens if liquidity keeps falling and weakens if buyers stabilize price.`,
  LIQUIDITY_DRAIN: (tokenName) =>
    `${tokenName} is showing liquidity drain tendencies. Depth may be leaving the pool, making price less stable and raising slippage risk. The read improves if liquidity returns and worsens if depth keeps shrinking.`,
  LIQUIDITY_ADDED: (tokenName) =>
    `${tokenName} is showing liquidity expansion tendencies. New depth may be entering the pool. Trade stability improves if activity stays organic. The read strengthens with buy dominance and weakens if added liquidity disappears quickly.`,
  PUMP: (tokenName) =>
    `${tokenName} is showing sharp upside momentum. Price is moving up fast, raising breakout interest and chase risk. The read improves if liquidity and volume support it, and weakens on quick retraces.`,
  DUMP: (tokenName) =>
    `${tokenName} is showing sharp downside momentum. Price is falling fast with short-term selling. Continuation risk rises if liquidity weakens and sellers keep pressing. The read improves if buyers stabilize price.`,
  BUY_RECOVERY: (tokenName) =>
    `${tokenName} is showing buy recovery tendencies. Buyers may be returning after weakness. Recovery odds improve if liquidity holds, volume expands, and sellers lose control. The read weakens if buy flow fades.`,
  SELL_OFF: (tokenName) =>
    `${tokenName} is showing sell-off tendencies. Sellers may be pressing price lower. Downside risk rises if liquidity thins, volatility expands, or structure turns bearish. The read weakens if buyers absorb selling.`,
  ACCUMULATION: (tokenName) =>
    `${tokenName} is showing accumulation tendencies. Buyers may be absorbing supply. Upside odds improve if liquidity stays deep, volume expands, and sellers lose control. The read weakens if buy dominance fades.`,
  DISTRIBUTION: (tokenName) =>
    `${tokenName} is showing distribution tendencies. Sellers may be pushing supply into the market. Downside risk rises if sell dominance persists and price cannot reclaim range. The read weakens if buyers absorb supply.`,
  CONSOLIDATION: (tokenName) =>
    `${tokenName} is showing consolidation tendencies. Price may be moving inside a tighter range while the market waits for direction. The read gets clearer when volume, liquidity, and price break the range.`,
  LOW_ACTIVITY: (tokenName) =>
    `${tokenName} is showing low activity. Recent scans lack enough depth or participation for a strong read. Confidence stays lower because small trades can distort price. The read improves when volume and liquidity increase.`,
  INSUFFICIENT_DATA: (tokenName) =>
    `${tokenName} does not have enough reliable detection data yet. Atlaix needs more trading history, liquidity context, and repeated snapshots before forming a stronger read.`,
  UNKNOWN: (tokenName) =>
    `${tokenName}'s latest scan did not produce a clean directional event. Current data does not point strongly to accumulation, distribution, continuation, or liquidity danger. The read improves with clearer volume and flow.`
};

DETECTION_EVENT_ASSESSMENTS.BULLISH_CONTINUATION = DETECTION_EVENT_ASSESSMENTS.BULLISH_CONTINUATION_PUMP;
DETECTION_EVENT_ASSESSMENTS.BEARISH_CONTINUATION = DETECTION_EVENT_ASSESSMENTS.BEARISH_CONTINUATION_DUMP;
DETECTION_EVENT_ASSESSMENTS.SHORT_TERM_BOUNCE_IN_BEARISH_TREND = DETECTION_EVENT_ASSESSMENTS.BEARISH_RELIEF_BOUNCE;
DETECTION_EVENT_ASSESSMENTS.PULLBACK_IN_BULLISH_TREND = DETECTION_EVENT_ASSESSMENTS.BULLISH_PULLBACK;
DETECTION_EVENT_ASSESSMENTS.POSSIBLE_BULLISH_REVERSAL_ATTEMPT = DETECTION_EVENT_ASSESSMENTS.BEARISH_REVERSAL_ATTEMPT;
DETECTION_EVENT_ASSESSMENTS.POSSIBLE_BEARISH_BREAKDOWN_ATTEMPT = DETECTION_EVENT_ASSESSMENTS.BULLISH_BREAKDOWN_ATTEMPT;

function normalizeDetectionLabel(label: string) {
  return label.trim().replace(/[-\s]+/g, '_').toUpperCase();
}

function detectionLabelKey(label: string) {
  return DISPLAY_LABEL_KEYS[label.trim()] || normalizeDetectionLabel(label);
}

export function detectionEventSummaryForLabel(label: string, fallback = '') {
  return DETECTION_EVENT_SUMMARIES[detectionLabelKey(label)] || fallback;
}

export function detectionEventAssessmentForLabel(label: string, tokenName: string, fallback = '') {
  const assessment = DETECTION_EVENT_ASSESSMENTS[detectionLabelKey(label)];
  return assessment ? assessment(tokenName) : fallback;
}
