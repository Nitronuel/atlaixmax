import { readEnv } from '../env';

export function readBooleanEnv(key: string, fallback = false) {
  const value = readEnv(key).toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

export function detectionResearchEnabled() {
  return readBooleanEnv('DETECTION_RESEARCH_ENABLED', false);
}

export function outcomeScoringEnabled() {
  return readBooleanEnv('DETECTION_OUTCOME_SCORING_ENABLED', false);
}
