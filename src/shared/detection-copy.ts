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

type DetectionTableCopy = {
  title: string;
  description: string;
  type: string;
};

const DETECTION_EVENT_TABLE_COPY: Record<string, DetectionTableCopy> = {
  BULLISH_CONTINUATION_PUMP: {
    title: 'Bullish continuation detected',
    description: 'Uptrend showing follow-through',
    type: 'Bullish Continuation'
  },
  BEARISH_CONTINUATION_DUMP: {
    title: 'Bearish continuation detected',
    description: 'Sell-side pressure still extending',
    type: 'Bearish Continuation'
  },
  BEARISH_RELIEF_BOUNCE: {
    title: 'Relief bounce detected',
    description: 'Short bounce inside weak structure',
    type: 'Short-Term Bounce in Bearish Trend'
  },
  BULLISH_PULLBACK: {
    title: 'Bullish pullback detected',
    description: 'Price cooling inside an uptrend',
    type: 'Pullback in Bullish Trend'
  },
  BEARISH_REVERSAL_ATTEMPT: {
    title: 'Bullish reversal attempt detected',
    description: 'Buyers testing bearish structure',
    type: 'Possible Bullish Reversal Attempt'
  },
  BULLISH_BREAKDOWN_ATTEMPT: {
    title: 'Bearish breakdown attempt detected',
    description: 'Sellers testing key support',
    type: 'Possible Bearish Breakdown Attempt'
  },
  RANGE_BREAKOUT_ATTEMPT: {
    title: 'Range breakout attempt detected',
    description: 'Price testing range resistance',
    type: 'Range Breakout Attempt'
  },
  RANGE_BREAKDOWN_ATTEMPT: {
    title: 'Range breakdown attempt detected',
    description: 'Price testing range support',
    type: 'Range Breakdown Attempt'
  },
  LOW_LIQUIDITY_PRICE_SPIKE: {
    title: 'Thin-liquidity price spike detected',
    description: 'Price jumped in shallow liquidity',
    type: 'Low-Liquidity Price Spike'
  },
  LOW_LIQUIDITY_SELL_OFF: {
    title: 'Thin-liquidity sell-off detected',
    description: 'Price dropped in shallow liquidity',
    type: 'Low-Liquidity Sell-Off'
  },
  LIQUIDITY_DRAIN: {
    title: 'Liquidity drain detected',
    description: 'Liquidity removed from the pool',
    type: 'Liquidity Drain'
  },
  LIQUIDITY_ADDED: {
    title: 'Liquidity addition detected',
    description: 'New liquidity entered the market',
    type: 'Liquidity Added'
  },
  PUMP: {
    title: 'Price pump detected',
    description: 'Sharp upward price acceleration',
    type: 'Pump'
  },
  DUMP: {
    title: 'Price dump detected',
    description: 'Sharp downside price movement',
    type: 'Dump'
  },
  BUY_RECOVERY: {
    title: 'Buy recovery detected',
    description: 'Buyers returning after weakness',
    type: 'Buy Recovery'
  },
  SELL_OFF: {
    title: 'Sell-off detected',
    description: 'Sellers pressing price lower',
    type: 'Sell-Off'
  },
  ACCUMULATION: {
    title: 'Accumulation detected',
    description: 'Consistent wallet accumulation observed',
    type: 'Accumulation'
  },
  DISTRIBUTION: {
    title: 'Distribution detected',
    description: 'Sell-side supply entering the market',
    type: 'Distribution'
  }
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
  BULLISH_CONTINUATION_PUMP: (_tokenName) =>
    'Buy-side pressure remains in control as price builds on recent momentum. Continuation is more likely while support holds and volume confirms. Losing buy-side control or breaking key support weakens this structure.',
  BEARISH_CONTINUATION_DUMP: (_tokenName) =>
    'Sell-side pressure is extending the downward structure. Continuation risk stays elevated while selling persists and buyers fail to reclaim meaningful levels. A sustained return of buy-side flow would challenge this outlook.',
  BEARISH_RELIEF_BOUNCE: (_tokenName) =>
    'A reactive relief move is developing within a broader bearish structure. These bounces typically fade without volume confirmation or a resistance reclaim. Sellers reasserting control at resistance would confirm the trend remains intact.',
  BULLISH_PULLBACK: (_tokenName) =>
    'Price is cooling within a healthy bullish structure. This reset can set up the next leg higher while support and liquidity hold. Expanding sell dominance or a support breakdown would signal something more serious.',
  BEARISH_REVERSAL_ATTEMPT: (_tokenName) =>
    'Buy-side pressure is beginning to challenge the prevailing bearish structure. Reversal probability increases if volume follows through and higher lows form. This read remains fragile until price clearly holds above resistance.',
  BULLISH_BREAKDOWN_ATTEMPT: (_tokenName) =>
    'Sellers are testing the market\'s ability to defend key support. Breakdown becomes more likely if selling volume expands and buyers cannot absorb pressure. A decisive support reclaim would invalidate this signal.',
  RANGE_BREAKOUT_ATTEMPT: (_tokenName) =>
    'Price is pushing against the upper boundary of its established range. A confirmed breakout requires expanding buy volume and holding above the level on retest. Failure to hold would push price back into the range.',
  RANGE_BREAKDOWN_ATTEMPT: (_tokenName) =>
    'Price is pressing into the lower boundary of its range, testing buyer defense. Breakdown probability rises if sell volume expands and buyers lack conviction. A recovery back into the range would negate this signal.',
  LOW_LIQUIDITY_PRICE_SPIKE: (_tokenName) =>
    'Price has spiked higher in a thin liquidity environment, raising sustainability concerns. Low-depth conditions amplify moves but reduce directional reliability. This read gains credibility only if liquidity deepens and volume confirms organically.',
  LOW_LIQUIDITY_SELL_OFF: (_tokenName) =>
    'Price has dropped sharply in low-liquidity conditions, increasing slippage and volatility risk. Thin depth can exaggerate selling without reflecting genuine directional pressure. Liquidity returning and price stabilizing would challenge this read.',
  LIQUIDITY_DRAIN: (_tokenName) =>
    'Liquidity depth is deteriorating, reducing the market\'s ability to absorb orders efficiently. Continued outflows may increase volatility and slippage, making sharp price moves more likely. A meaningful liquidity recovery would invalidate this signal.',
  LIQUIDITY_ADDED: (_tokenName) =>
    'New liquidity is entering the market, improving depth and reducing slippage risk. Sustained expansion supports price stability and healthier price discovery. Watch for whether this liquidity is organic or likely to exit quickly.',
  PUMP: (_tokenName) =>
    'Price is accelerating sharply higher, attracting breakout interest alongside elevated chase risk. This move carries more weight when backed by deep liquidity and expanding volume. Without those conditions, swift retracement risk increases significantly.',
  DUMP: (_tokenName) =>
    'Price is declining sharply as selling overwhelms buy-side absorption. Continuation risk stays elevated while liquidity thins and sellers maintain control. Renewed buy-side absorption stabilizing price would signal this move is exhausting.',
  BUY_RECOVERY: (_tokenName) =>
    'Buy-side flow is returning after sustained weakness, suggesting sellers may be losing their grip. Recovery becomes more sustainable when liquidity holds and volume expands. Fading buy flow without follow-through would suggest a temporary reaction.',
  SELL_OFF: (_tokenName) =>
    'Sellers are actively pressing price lower as buy-side absorption weakens. Downside risk stays elevated while liquidity thins and structure deteriorates. A meaningful increase in buy-side absorption would be required to stabilize this move.',
  ACCUMULATION: (_tokenName) =>
    'Buying pressure is steadily absorbing available supply while sell pressure weakens. This typically precedes continuation if liquidity remains healthy and volume expands. Watch for increasing buy-side flow to confirm the accumulation phase.',
  DISTRIBUTION: (_tokenName) =>
    'Sell-side supply is being steadily introduced as holders reduce exposure. Further weakness is likely if buy demand cannot absorb incoming flow and price fails to reclaim its range. A shift toward buy dominance would challenge this outlook.',
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

function titleCaseDetectionLabel(label: string) {
  return label
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function detectionEventSummaryForLabel(label: string, fallback = '') {
  return DETECTION_EVENT_SUMMARIES[detectionLabelKey(label)] || fallback;
}

export function detectionEventTableCopyForLabel(label: string, fallback = ''): DetectionTableCopy {
  const key = detectionLabelKey(label);
  const copy = DETECTION_EVENT_TABLE_COPY[key];
  if (copy) return copy;

  const title = titleCaseDetectionLabel(label || 'Detection Event');
  return {
    title: /detected|attempt|continuation|recovery|pullback|bounce/i.test(title) ? title : `${title} Detected`,
    description: DETECTION_EVENT_SUMMARIES[key] || fallback || 'Detection Engine flagged new token activity',
    type: title.split(' ')[0] || 'Event'
  };
}

export function detectionEventAssessmentForLabel(label: string, tokenName: string, fallback = '') {
  const assessment = DETECTION_EVENT_ASSESSMENTS[detectionLabelKey(label)];
  return assessment ? assessment(tokenName) : fallback;
}
