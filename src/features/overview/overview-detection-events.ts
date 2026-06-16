import type { DetectionEvent } from '../../shared/detection';
import type { OverviewToken } from '../../shared/overview';

function normalizedTokenKey(chain: string, address: string) {
  const normalizedAddress = address.trim().toLowerCase();
  if (!normalizedAddress) return '';
  return `${chain.trim().toLowerCase()}:${normalizedAddress}`;
}

function detectionEventKeys(event: DetectionEvent) {
  return [
    normalizedTokenKey(event.token.chain, event.token.address),
    normalizedTokenKey(event.token.chain, event.token.pairAddress)
  ].filter(Boolean);
}

function overviewTokenKeys(token: OverviewToken) {
  return [
    normalizedTokenKey(token.chain, token.address),
    normalizedTokenKey(token.chain, token.pairAddress)
  ].filter(Boolean);
}

export function buildLatestDetectionEventLookup(events: DetectionEvent[]) {
  const lookup = new Map<string, DetectionEvent>();
  [...events]
    .sort((left, right) => right.detectedAt - left.detectedAt)
    .forEach((event) => {
      detectionEventKeys(event).forEach((key) => {
        if (!lookup.has(key)) lookup.set(key, event);
      });
    });
  return lookup;
}

export function latestDetectionEventForToken(lookup: Map<string, DetectionEvent>, token: OverviewToken) {
  for (const key of overviewTokenKeys(token)) {
    const event = lookup.get(key);
    if (event) return event;
  }
  return null;
}

export function detectionEventLabelForToken(lookup: Map<string, DetectionEvent>, token: OverviewToken) {
  return latestDetectionEventForToken(lookup, token)?.eventType || 'None';
}
