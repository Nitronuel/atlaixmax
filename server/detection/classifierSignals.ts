import type { LowerTimeframeTrigger, SignalLabel } from "./types";

export function triggerToSignal(trigger: LowerTimeframeTrigger): SignalLabel {
  switch (trigger) {
    case "SHARP_5M_PUMP":
      return "SHARP_5M_PUMP";
    case "SHARP_5M_DUMP":
      return "SHARP_5M_DUMP";
    case "5M_VOLUME_SPIKE":
      return "5M_VOLUME_SPIKE";
    case "5M_LIQUIDITY_DROP":
      return "5M_LIQUIDITY_DROP";
    case "5M_LIQUIDITY_INCREASE":
      return "5M_LIQUIDITY_INCREASE";
    case "5M_BUY_TXN_DOMINANCE":
      return "BUY_TXN_DOMINANCE";
    case "5M_SELL_TXN_DOMINANCE":
      return "SELL_TXN_DOMINANCE";
    default:
      return "WEAK_ACTIVITY";
  }
}
