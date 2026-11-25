# Tiny Bot — Beat Buy-and-Hold on Solana

[![make.fun](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/competitions/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/veneraxyz/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1-entry-v1/rank.svg)](https://make.fun/competitions/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/veneraxyz/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1-entry-v1/reward.svg)](https://make.fun/competitions/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)

A tiny paper-trading bot for [Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana](https://make.fun/competitions/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1) — hourly bars for FARTCOIN, JITOSOL, POPCAT, RAY, SOL, WETH and WIF, starting from 10,000 USDC.

## Strategy

Per-asset trend filter, invented fresh with round parameters (no tuning to any window):

- **Hold only in an uptrend:** an asset is held only while its fast EMA (4h) sits above its slow EMA (12h) by a 0.2% confirmation margin; otherwise the bot sits in USDC.
- **Equal-weight sizing:** a clear trend (fast/slow ≥ 1.01) gets 20% of equity; a weak trend gets half size (10%). Never above the 25% per-symbol cap. Trades are skipped when pool impact would exceed 50 bps.
- **Regular exits:** positions close in full when the trend flips, on a 5% stop-loss from entry, or on a 10% take-profit — so the bot trades regularly instead of buying once and holding.
- **Equity drawdown guard:** if equity falls 5% below its running peak, the bot flattens everything and stays out of new buys until equity recovers to within 3% of the peak.

Fully deterministic: no clock, no environment, no randomness — every decision is a pure function of the bars seen so far.

## Files

- `main.ts` — the bot (run by the grader as `node /bot/main.ts`)
- `vendor/makefun-bars.ts` — the kit's wire shim, copied verbatim

## License

MIT — see `LICENSE`.
