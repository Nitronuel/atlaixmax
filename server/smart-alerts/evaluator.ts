export type SmartAlertType = 'Price' | 'Volume' | 'Liquidity' | 'Whale' | 'Alpha' | 'Risk';

export type SmartAlertCondition =
    | 'above'
    | 'below'
    | 'changes_by_percent'
    | 'buy_above'
    | 'sell_above'
    | 'buy_or_sell_above'
    | 'event_is'
    | 'severity_is';

export type SmartAlertThresholdKind = 'currency' | 'percent' | 'event' | 'severity';

export interface SmartAlertRuleSnapshot {
    id: string;
    user_id: string;
    alert_type: SmartAlertType;
    target: string;
    chain_id: string;
    condition: SmartAlertCondition | string;
    threshold_kind?: SmartAlertThresholdKind | string | null;
    threshold: string;
    trigger_label: string;
    cooldown_minutes: number;
    last_triggered_at: string | null;
    baseline_value?: number | null;
}

export interface SmartAlertMarketSnapshot {
    tokenLabel?: string | null;
    tokenAddress?: string | null;
    eventId?: string | null;
    priceUsd?: number | null;
    volume24hUsd?: number | null;
    liquidityUsd?: number | null;
    whaleUsd?: number | null;
    whaleSide?: 'buy' | 'sell' | null;
    alphaEvent?: string | null;
    riskSeverity?: string | null;
}

export interface SmartAlertEvaluationResult {
    shouldTrigger: boolean;
    observedValue: string | null;
    observedNumber: number | null;
    message: string;
    dedupeKey: string;
    nextBaselineValue: number | null;
    lastError: string | null;
}

const UNIT_MULTIPLIERS: Record<string, number> = {
    k: 1_000,
    m: 1_000_000,
    b: 1_000_000_000
};

const LEGACY_CONDITION_MAP: Record<string, SmartAlertCondition> = {
    'above': 'above',
    'below': 'below',
    'increases by': 'changes_by_percent',
    'drops by': 'changes_by_percent',
    'added above': 'above',
    'removed above': 'above',
    'buy above': 'buy_above',
    'sell above': 'sell_above',
    'buy or sell above': 'buy_or_sell_above',
    'event is': 'event_is',
    'risk is': 'severity_is'
};

export const normalizeSmartAlertCondition = (condition: string): SmartAlertCondition => {
    const normalized = condition.trim().toLowerCase();
    return LEGACY_CONDITION_MAP[normalized] || (normalized as SmartAlertCondition);
};

export const getThresholdKindForCondition = (
    alertType: SmartAlertType,
    condition: SmartAlertCondition
): SmartAlertThresholdKind => {
    if (condition === 'changes_by_percent') return 'percent';
    if (alertType === 'Alpha') return 'event';
    if (alertType === 'Risk') return 'severity';
    return 'currency';
};

export const parseAlertThreshold = (value: string, kind: SmartAlertThresholdKind = 'currency') => {
    const normalized = value.trim().replace(/[,\s]/g, '').toLowerCase();
    if (!normalized) return Number.NaN;

    if (kind === 'percent') {
        const withoutPercent = normalized.replace(/%$/, '');
        const percent = Number(withoutPercent);
        return Number.isFinite(percent) ? percent : Number.NaN;
    }

    const currency = normalized.replace(/^\$/, '');
    const match = currency.match(/^(-?\d+(?:\.\d+)?)([kmb]?)$/);
    if (!match) return Number.NaN;

    const numeric = Number(match[1]);
    if (!Number.isFinite(numeric)) return Number.NaN;

    return numeric * (UNIT_MULTIPLIERS[match[2]] || 1);
};

const formatUsd = (value: number | null | undefined) => {
    if (!Number.isFinite(Number(value))) return null;
    return `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
};

const formatPercent = (value: number) => {
    const prefix = value > 0 ? '+' : '';
    return `${prefix}${value.toFixed(Math.abs(value) >= 10 ? 1 : 2)}%`;
};

const compareThreshold = (
    observed: number | null | undefined,
    condition: SmartAlertCondition,
    threshold: string,
    kind: SmartAlertThresholdKind
) => {
    const observedNumber = Number(observed);
    const thresholdNumber = parseAlertThreshold(threshold, kind);
    if (!Number.isFinite(observedNumber) || !Number.isFinite(thresholdNumber)) return false;

    if (condition === 'below') return observedNumber <= thresholdNumber;
    return observedNumber >= thresholdNumber;
};

const percentChangeFromBaseline = (current: number | null | undefined, baseline: number | null | undefined) => {
    const currentNumber = Number(current);
    const baselineNumber = Number(baseline);
    if (!Number.isFinite(currentNumber) || !Number.isFinite(baselineNumber) || baselineNumber === 0) {
        return null;
    }
    return ((currentNumber - baselineNumber) / Math.abs(baselineNumber)) * 100;
};

const matchesPercentChange = (
    observed: number | null | undefined,
    baseline: number | null | undefined,
    threshold: string
) => {
    const change = percentChangeFromBaseline(observed, baseline);
    const thresholdNumber = Math.abs(parseAlertThreshold(threshold, 'percent'));
    if (change === null || !Number.isFinite(thresholdNumber)) return { matched: false, change: null };
    return { matched: Math.abs(change) >= thresholdNumber, change };
};

const getNumericObserved = (rule: SmartAlertRuleSnapshot, snapshot: SmartAlertMarketSnapshot) => {
    switch (rule.alert_type) {
        case 'Price':
            return snapshot.priceUsd ?? null;
        case 'Volume':
            return snapshot.volume24hUsd ?? null;
        case 'Liquidity':
            return snapshot.liquidityUsd ?? null;
        case 'Whale':
            return snapshot.whaleUsd ?? null;
        default:
            return null;
    }
};

const formatObserved = (rule: SmartAlertRuleSnapshot, observed: number | null, textObserved?: string | null) => {
    if (textObserved) return textObserved;
    if (observed === null) return null;
    return formatUsd(observed);
};

export const evaluateSmartAlertRule = (
    rule: SmartAlertRuleSnapshot,
    snapshot: SmartAlertMarketSnapshot,
    now = new Date()
): SmartAlertEvaluationResult => {
    const condition = normalizeSmartAlertCondition(rule.condition);
    const thresholdKind = (rule.threshold_kind as SmartAlertThresholdKind) || getThresholdKindForCondition(rule.alert_type, condition);
    const observedNumber = getNumericObserved(rule, snapshot);
    const tokenLabel = snapshot.tokenLabel ? ` on ${snapshot.tokenLabel}` : '';

    let matched = false;
    let observedValue: string | null = formatObserved(rule, observedNumber);
    let nextBaselineValue: number | null = null;
    let lastError: string | null = null;

    if (condition === 'changes_by_percent') {
        if (!Number.isFinite(Number(observedNumber))) {
            lastError = 'No numeric market value was available for percentage evaluation.';
        } else if (!Number.isFinite(Number(rule.baseline_value)) || Number(rule.baseline_value) === 0) {
            nextBaselineValue = Number(observedNumber);
            observedValue = formatObserved(rule, observedNumber);
            return {
                shouldTrigger: false,
                observedValue,
                observedNumber,
                message: `${rule.trigger_label} baseline was established${tokenLabel}.`,
                dedupeKey: `${rule.id}:baseline`,
                nextBaselineValue,
                lastError: null
            };
        } else {
            const { matched: percentMatched, change } = matchesPercentChange(observedNumber, rule.baseline_value, rule.threshold);
            matched = percentMatched;
            observedValue = change === null ? formatObserved(rule, observedNumber) : formatPercent(change);
            if (matched) nextBaselineValue = Number(observedNumber);
        }
    } else {
        switch (rule.alert_type) {
            case 'Price':
            case 'Volume':
            case 'Liquidity':
                matched = compareThreshold(observedNumber, condition, rule.threshold, thresholdKind);
                break;
            case 'Whale': {
                const side = snapshot.whaleSide || 'buy';
                const valueMatched = compareThreshold(snapshot.whaleUsd, 'above', rule.threshold, 'currency');
                matched = valueMatched && (
                    condition === 'buy_or_sell_above' ||
                    (condition === 'buy_above' && side === 'buy') ||
                    (condition === 'sell_above' && side === 'sell')
                );
                break;
            }
            case 'Alpha':
                matched = Boolean(snapshot.alphaEvent && snapshot.alphaEvent.toLowerCase() === rule.threshold.toLowerCase());
                observedValue = snapshot.alphaEvent || null;
                break;
            case 'Risk':
                matched = Boolean(snapshot.riskSeverity && (
                    rule.threshold.toLowerCase() === 'any new risk' ||
                    snapshot.riskSeverity.toLowerCase() === rule.threshold.toLowerCase()
                ));
                observedValue = snapshot.riskSeverity || null;
                break;
        }
    }

    const bucket = now.toISOString().slice(0, 13);
    const message = matched
        ? `${rule.trigger_label} triggered${tokenLabel}${observedValue ? ` at ${observedValue}` : ''}.`
        : lastError || `${rule.trigger_label} has not met its condition${tokenLabel}.`;

    return {
        shouldTrigger: matched,
        observedValue,
        observedNumber: Number.isFinite(Number(observedNumber)) ? Number(observedNumber) : null,
        message,
        dedupeKey: `${rule.id}:${rule.alert_type}:${bucket}:${snapshot.eventId || snapshot.tokenAddress || snapshot.tokenLabel || 'market'}`,
        nextBaselineValue,
        lastError
    };
};
