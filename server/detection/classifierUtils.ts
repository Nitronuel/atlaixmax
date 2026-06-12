import type { RiskLevel } from "./types";

export function riskLevelFor(score: number): RiskLevel {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 35) return "medium";
  return "low";
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "unknown";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}
