import { describe, expect, it } from "vitest";
import { classifyToken } from "./classification";
import { calculateFeatures } from "./features";
import type { TokenSnapshot } from "./types";

describe("v3 hierarchical classifier", () => {
  it("classifies an aligned pump as bullish continuation while preserving sell dominance contradiction", () => {
    const snapshot = makeSnapshot({
      volume5m: 50_000,
      buys5m: 40,
      sells5m: 85,
      priceChange5m: 19,
      priceChange1h: 42,
      priceChange6h: 55,
      priceChange24h: 70
    });
    const history = Array.from({ length: 12 }, () => makeSnapshot({ volume5m: 10_000 }));
    const features = calculateFeatures(snapshot, history);
    const classification = classifyToken({ snapshot, features, history, previousClassification: null });

    expect(classification.primaryLabel).toBe("BULLISH_CONTINUATION_PUMP");
    expect(classification.lowerTimeframeTrigger).toBe("SHARP_5M_PUMP");
    expect(classification.contradictorySignals).toContain("SELL_TXN_DOMINANCE");
  });

  it("classifies a 5m pump inside a bearish structure as a relief bounce", () => {
    const snapshot = makeSnapshot({
      volume5m: 50_000,
      buys5m: 90,
      sells5m: 45,
      priceChange5m: 18,
      priceChange1h: -22,
      priceChange6h: -48,
      priceChange24h: -70
    });
    const history = Array.from({ length: 12 }, () => makeSnapshot({ volume5m: 10_000, priceChange1h: -20, priceChange6h: -45, priceChange24h: -68 }));
    const features = calculateFeatures(snapshot, history);
    const classification = classifyToken({ snapshot, features, history, previousClassification: null });

    expect(classification.primaryLabel).toBe("BEARISH_RELIEF_BOUNCE");
    expect(classification.structuralRegime).toBe("BEARISH");
    expect(classification.activeRegime).toBe("COUNTER_TREND_BOUNCE");
  });

  it("classifies a 5m dump inside bullish structure as a pullback", () => {
    const snapshot = makeSnapshot({
      volume5m: 40_000,
      buys5m: 90,
      sells5m: 55,
      priceChange5m: -9,
      priceChange1h: 18,
      priceChange6h: 42,
      priceChange24h: 85
    });
    const history = Array.from({ length: 12 }, () => makeSnapshot({ volume5m: 10_000 }));
    const features = calculateFeatures(snapshot, history);
    const classification = classifyToken({ snapshot, features, history, previousClassification: null });

    expect(classification.primaryLabel).toBe("BULLISH_PULLBACK");
    expect(classification.structuralRegime).toBe("STRONG_BULLISH");
    expect(classification.contradictorySignals).toContain("TIMEFRAME_CONFLICT");
  });

  it("prioritizes a meaningful liquidity drain over directional labels", () => {
    const snapshot = makeSnapshot({
      liquidityUsd: 65_000,
      volume5m: 60_000,
      buys5m: 30,
      sells5m: 90,
      priceChange5m: -20,
      priceChange1h: -30
    });
    const history = [makeSnapshot({ liquidityUsd: 100_000 }), ...Array.from({ length: 11 }, () => makeSnapshot())];
    const features = calculateFeatures(snapshot, history);
    const classification = classifyToken({ snapshot, features, history, previousClassification: null });

    expect(classification.primaryLabel).toBe("LIQUIDITY_DRAIN");
    expect(classification.riskLevel).toBe("critical");
    expect(classification.secondarySignals).toContain("SELL_TXN_DOMINANCE");
  });

  it("returns low-liquidity price spike instead of a clean pump", () => {
    const snapshot = makeSnapshot({
      liquidityUsd: 800,
      volume5m: 400,
      buys5m: 3,
      sells5m: 1,
      traders5m: 4,
      priceChange5m: 35,
      priceChange1h: 40
    });
    const history = Array.from({ length: 3 }, () => makeSnapshot({ liquidityUsd: 900, volume5m: 300 }));
    const features = calculateFeatures(snapshot, history);
    const classification = classifyToken({ snapshot, features, history, previousClassification: null });

    expect(classification.primaryLabel).toBe("LOW_LIQUIDITY_PRICE_SPIKE");
    expect(classification.riskLevel).toBe("critical");
  });

  it("does not treat dead tokens as consolidation", () => {
    const snapshot = makeSnapshot({
      volume5m: 0,
      buys5m: 0,
      sells5m: 0,
      traders5m: 0,
      priceChange5m: 0,
      priceChange1h: 0
    });
    const history = Array.from({ length: 12 }, () => makeSnapshot({ volume5m: 0, buys5m: 0, sells5m: 0, traders5m: 0 }));
    const features = calculateFeatures(snapshot, history);
    const classification = classifyToken({ snapshot, features, history, previousClassification: null });

    expect(classification.primaryLabel).toBe("LOW_ACTIVITY");
  });

  it("requires repeated buy dominance for accumulation", () => {
    const snapshot = makeSnapshot({
      volume5m: 15_000,
      buys5m: 70,
      sells5m: 35,
      priceChange5m: 1.5,
      priceChange1h: 5
    });
    const history = Array.from({ length: 4 }, () => makeSnapshot({ volume5m: 12_000, buys5m: 64, sells5m: 36, priceChange5m: 1 }));
    const features = calculateFeatures(snapshot, history);
    const classification = classifyToken({ snapshot, features, history, previousClassification: null });

    expect(classification.primaryLabel).toBe("ACCUMULATION");
  });

  it("ignores large liquidity percentages when the dollar move is tiny", () => {
    const snapshot = makeSnapshot({
      liquidityUsd: 75,
      volume5m: 2_000,
      buys5m: 20,
      sells5m: 20
    });
    const history = [makeSnapshot({ liquidityUsd: 100 }), ...Array.from({ length: 4 }, () => makeSnapshot())];
    const features = calculateFeatures(snapshot, history);
    const classification = classifyToken({ snapshot, features, history, previousClassification: null });

    expect(classification.primaryLabel).not.toBe("LIQUIDITY_DRAIN");
  });
});

function makeSnapshot(overrides: Partial<TokenSnapshot> = {}): TokenSnapshot {
  return {
    tokenId: "solana:test",
    timestamp: new Date().toISOString(),
    priceUsd: 0.01,
    marketCap: 100_000,
    liquidityUsd: 100_000,
    volume5m: 1_000,
    volume1h: 10_000,
    volume6h: 50_000,
    volume24h: 200_000,
    buys5m: 10,
    sells5m: 10,
    traders5m: 20,
    priceChange5m: 0,
    priceChange1h: 0,
    priceChange6h: 0,
    priceChange24h: 0,
    raw: {},
    ...overrides
  };
}
