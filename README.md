# MT5 AI Builder

Turn plain-English forex strategy descriptions or visual 4-Brain configs into
self-contained MT5 Expert Advisors. The system does not ask AI to freely write a
full EA. AI interprets the trader's intent into structured module wiring, then
verified generators assemble compilable MQL5 from proven building blocks.

> Disclaimer: This tool generates code from natural-language descriptions. It
> does not evaluate or guarantee the profitability of any strategy. Always
> forward test on a demo account before trading real capital.

## Stack

- React 19 + TypeScript
- TanStack Start (Vite, file-based routing)
- Tailwind CSS v4 + shadcn/ui
- Supabase auth and Postgres
- Netlify functions for AI parsing, 4-Brain wiring, and assistant routes

## Architecture

```text
Trader prompt / visual config
  -> AI strategy interview or 4-Brain visual setup
  -> StrategyBlueprint + intent contract
  -> module contract registry validates wiring
  -> verified state-machine generators emit one self-contained .mq5
  -> MT5 compile, backtest, export, and diagnostics
```

The 4-Brain model:

- Direction Brain: persistent market bias (`gBias`)
- Setup Brain: active setup zone/state (`gSetupActive`, `gSetupDir`, `gSetupSLHint`)
- Execution Brain: precise entry trigger (`gExecSignal`, `gExecDir`, `gExecSL`)
- Management Brain: deterministic risk, R:R, max SL, break-even, spread, max trades

## Features

- Email/password auth
- Dashboard listing of saved strategies
- AI Description Builder: plain English -> strategy blueprint -> 4-Brain EA
- 4-Brain Visual Builder: module/timeframe/parameter config per brain
- Verified inline state machines for EMA, FVG, IFVG, BOS/CHoCH, OB, OB+FVG,
  liquidity sweep, S/R, gap S/R, breakout, rejection, miss, RSI hidden
  divergence, and engulfing
- AI wiring validation and one bounded repair retry
- Persistent AI wiring diagnostics and downloadable `*-ai-diagnostics.json`
- Code preview with copy / download
- Local compile/backtest integration when the desktop companion is available
- Export bundle: `.mq5`, blueprint JSON, diagnostics JSON, compile log, validation report
- RLS so users only see their own strategies

## Environment

The expected variables are:

| Variable                        | Where used                |
| ------------------------------- | ------------------------- |
| `VITE_SUPABASE_URL`             | Browser Supabase client   |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser Supabase client   |
| `SUPABASE_URL`                  | Function/server runtime   |
| `SUPABASE_PUBLISHABLE_KEY`      | Function/server runtime   |
| `ANTHROPIC_API_KEY`             | AI strategy/wiring routes |

## Database

A single table:

```text
strategies(id, user_id, name, prompt, spec_json jsonb, generated_code, created_at, updated_at)
```

RLS policies restrict every row to its `user_id == auth.uid()`.

## API Functions

- `netlify/functions/parse-strategy.mts`: strategy interview and blueprint extraction.
- `netlify/functions/gen-4brain-ai.mts`: structured AI wiring for 4-Brain EAs.
- `netlify/functions/ea-chat.mts`: chat assistant for compile/backtest feedback.
- `netlify/functions/extract-brain-params.mts`: focused parameter extraction for visual brains.

## Local Development

```bash
npm install
npm run dev
```

## Verification

Run the full release gate before pushing or deploying:

```bash
npm run verify:release
```

That command runs:

- `npm run verify`: module admission, intake contracts, strategy families, AI wiring regressions, and MQL5 static generation checks
- `npx tsc --noEmit`: TypeScript type checking
- `npm run lint`: ESLint
- `npm run build`: production Vite build

Useful focused checks:

```bash
npm run verify:ai
npm run verify:mql5
npm run verify:families
```

## Where To Extend Next

- `src/lib/module-library.ts`: user-facing module vocabulary and UI params.
- `src/lib/module-contracts.ts`: verified semantic events and query functions.
- `src/generators/gen-*-sm.ts`: inline state-machine emitters.
- `src/generators/gen-ea.ts`: final self-contained EA assembler.
- `scripts/verify-*.ts`: regression gates for new strategy families/modules.
