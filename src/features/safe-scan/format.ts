export function formatNumber(value: unknown, fallback = 'N/A') {
  if (value === null || value === undefined || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: numeric >= 100 ? 0 : 2 }).format(numeric);
}

export function formatCompact(value: unknown, fallback = 'N/A') {
  if (value === null || value === undefined || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 2
  }).format(numeric);
}

export function formatPercent(value: unknown, fallback = 'N/A') {
  const numeric = normalizePercentValue(value);
  if (numeric === null) return fallback;
  return `${numeric.toFixed(numeric >= 10 ? 1 : 2)}%`;
}

export function formatPercentPoints(value: unknown, fallback = 'N/A') {
  if (value === null || value === undefined || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return `${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2
  }).format(numeric)}%`;
}

export function formatCurrencyCompact(value: unknown, fallback = 'N/A') {
  if (value === null || value === undefined || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: numeric >= 100 ? 2 : 4
  }).format(numeric);
}

export function shortenAddress(value = '') {
  if (!value) return 'N/A';
  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-5)}` : value;
}

export function formatAge(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 'Unknown';
  const seconds = numeric >= 1_000_000_000
    ? Math.max(0, (Date.now() - (numeric < 10_000_000_000 ? numeric * 1000 : numeric)) / 1000)
    : numeric;
  const days = Math.floor(seconds / 86400);
  if (days >= 1) return `${formatNumber(days)}d`;
  const hours = Math.floor(seconds / 3600);
  if (hours >= 1) return `${formatNumber(hours)}h`;
  const minutes = Math.floor(seconds / 60);
  return minutes >= 1 ? `${formatNumber(minutes)}m` : `${formatNumber(seconds)}s`;
}

export function normalizePercentValue(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const absolute = Math.abs(numeric);
  const scaled = absolute >= 1e15
    ? numeric / 1e18
    : absolute > 100
      ? numeric / 1e6
      : numeric;
  return scaled > 0 && scaled <= 1 ? scaled * 100 : scaled;
}
