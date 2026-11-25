// Tiny trend bot — v2: per-asset EMA trend filter, equal-weight entries,
// plus an equity drawdown guard and trend-strength sizing.
//
// Idea (own design, round parameters, no tuning to any window):
// hold an asset only while its fast EMA (4h) sits above its slow EMA (12h)
// by a small confirmation margin; otherwise sit in USDC. Positions are sized
// equally at ~20% of equity each (under the 25% cap), exited in full when
// the trend flips or on a 5% stop-loss from entry, so the bot trades
// regularly instead of buying once and holding. Winners are NOT capped by
// a take-profit: a position that keeps trending stays held until the trend
// itself flips, so gains run and re-entry fees are avoided; losers are cut
// by the stop. A take-profit was tried and removed: it forced re-buys into
// the same uptrend after fees, pure churn.
// Drawdown guard: if equity falls 5% below its running peak, exit every
// position at once and stay out of new buys until equity recovers to within
// 3% of the peak — this caps the worst drawdown on a sharp reversal.
// Sizing refinement: a barely-positive trend (fast/slow < 1.01) gets only
// half size (10% of equity), a clear trend gets the full 20%, so whipsaw
// bars cost less. Deterministic: no clock, no env, no Math.random — every
// decision is a pure function of the bars seen so far.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState } from './vendor/makefun-bars.ts';

const SYMBOLS = ['FARTCOIN', 'JITOSOL', 'POPCAT', 'RAY', 'SOL', 'WETH', 'WIF'];
const FAST = 4;
const SLOW = 12;
const TARGET_WEIGHT_BPS = 2000; // 20% of equity per asset on a clear trend
const HALF_WEIGHT_BPS = 1000; // 10% of equity on a weak trend
const STRONG_TREND = 1.01; // fast/slow ratio above this = full size
const ENTRY_MARGIN = 1.002; // fast must beat slow by 0.2% to enter
const STOP_LOSS = 0.05; // sell if 5% below entry price
const GUARD_DROP = 0.05; // exit everything if equity is 5% below its peak
const GUARD_RECOVER = 0.03; // resume buying once within 3% of the peak
const MAX_SLIPPAGE_BPS = 100;
const MIN_NOTIONAL = 1000000n; // 1 USDC in quote units

const emaFast = new Map<string, number>();
const emaSlow = new Map<string, number>();
const barsSeen = new Map<string, number>();
const entryPrice = new Map<string, number>();
let equityPeak = 0n;
let guardTripped = false;

function priceOf(state: BarsState, symbol: string): number | null {
  const close = state.close(symbol);
  const meta = state.symbols.get(symbol);
  if (close === null || meta === undefined) return null;
  return Number(close) / 10 ** meta.price_scale;
}

await runBars({
  onBatch(state, _batch) {
    if (state.warmingUp) return [];
    const out: { side: 'buy' | 'sell'; symbol: string; notional_quote_units?: bigint; qty?: bigint; max_slippage_bps: number }[] = [];

    // Equity drawdown guard: track the running peak, trip on a 5% drop.
    if (state.equity > equityPeak) equityPeak = state.equity;
    if (!guardTripped && equityPeak > 0n && state.equity * 100n < equityPeak * 95n) {
      guardTripped = true;
    }
    if (guardTripped) {
      if (state.equity * 100n >= equityPeak * 97n) {
        guardTripped = false; // recovered to within 3% of the peak: resume
      } else {
        // Guard active: flatten everything, no new buys this bar.
        for (const symbol of SYMBOLS) {
          const held = state.positions.get(symbol);
          if (held !== undefined && held.qty > 0n) {
            out.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
            entryPrice.delete(symbol);
          }
        }
        return out.slice(0, 16);
      }
    }
    void GUARD_DROP;
    void GUARD_RECOVER;

    let cashLeft = state.cash;
    for (const symbol of SYMBOLS) {
      const price = priceOf(state, symbol);
      if (price === null || price <= 0) continue;
      const n = (barsSeen.get(symbol) ?? 0) + 1;
      barsSeen.set(symbol, n);
      const kF = 2 / (FAST + 1);
      const kS = 2 / (SLOW + 1);
      const prevF = emaFast.get(symbol);
      const prevS = emaSlow.get(symbol);
      const f = prevF === undefined ? price : prevF + kF * (price - prevF);
      const s = prevS === undefined ? price : prevS + kS * (price - prevS);
      emaFast.set(symbol, f);
      emaSlow.set(symbol, s);
      if (n < SLOW) continue; // need a full slow-EMA window before trusting a signal

      const held = state.positions.get(symbol);
      const heldQty = held?.qty ?? 0n;
      const ratio = f / s;
      const trendUp = ratio > 1;
      const entry = entryPrice.get(symbol);

      // Exit: trend flipped or stop-loss.
      if (heldQty > 0n) {
        let exit = !trendUp;
        if (entry !== undefined && entry > 0 && price <= entry * (1 - STOP_LOSS)) exit = true;
        if (exit) {
          out.push({ side: 'sell', symbol, qty: heldQty, max_slippage_bps: MAX_SLIPPAGE_BPS });
          entryPrice.delete(symbol);
        }
        continue;
      }

      // Entry: trend up past the confirmation margin, sized by trend strength.
      if (ratio <= ENTRY_MARGIN) continue;
      const weightBps = ratio >= STRONG_TREND ? TARGET_WEIGHT_BPS : HALF_WEIGHT_BPS;
      const target = (state.equity * BigInt(weightBps)) / 10000n;
      const room = state.weightRoom(symbol);
      let notional = target < room ? target : room;
      if (notional > cashLeft) notional = cashLeft;
      if (notional < MIN_NOTIONAL) continue;
      const impact = state.impactBps(symbol, notional);
      if (impact !== null && impact > 50n) continue; // skip if the pool is too thin for this size
      out.push({ side: 'buy', symbol, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS });
      cashLeft -= notional;
      entryPrice.set(symbol, price);
    }
    return out.slice(0, 16);
  },
});
