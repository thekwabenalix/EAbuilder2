# MT5 AI Builder

Turn plain-English forex strategy descriptions into editable MT5 Expert Advisor
specs, then generate downloadable MQL5 code, JSON specs, and validation
reports.

> Disclaimer: This tool generates code from natural-language descriptions. It
> does not evaluate or guarantee the profitability of any strategy. Always
> forward test on a demo account before trading real capital.

## Stack

- React 19 + TypeScript
- TanStack Start (Vite, file-based routing)
- Tailwind CSS v4 + shadcn/ui
- Lovable Cloud (Supabase) — auth, Postgres, Edge Functions
- Lovable AI Gateway (optional) for prompt parsing

## Features

- Email/password auth (Supabase Auth)
- Dashboard listing of saved strategies
- Plain-English prompt → structured `StrategySpec`
- Editable strategy spec form
- Modular MQL5 EA generator (inputs, EMA handles, signal logic, risk model)
- Code preview with copy / download
- Builder progress, validation report cards, export bundle (.mq5/.json/.txt)
- RLS so users only see their own strategies

## Environment

Lovable Cloud auto-provisions and writes `.env`. The variables are:

| Variable                        | Where used                                                  |
| ------------------------------- | ----------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | Browser Supabase client                                     |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser Supabase client                                     |
| `SUPABASE_URL`                  | Edge function runtime                                       |
| `SUPABASE_PUBLISHABLE_KEY`      | Edge function runtime                                       |
| `LOVABLE_API_KEY`               | Optional — enables real AI parsing in `mt5-strategy-parser` |

If `LOVABLE_API_KEY` is missing, the edge function falls back to a deterministic
mock parser so the UI still works end-to-end.

## Database

A single table:

```
strategies(id, user_id, name, prompt, spec_json jsonb, generated_code, created_at, updated_at)
```

RLS policies restrict every row to its `user_id == auth.uid()`.

## Edge Function

`supabase/functions/mt5-strategy-parser/index.ts`

- Accepts `POST { prompt: string }`
- Returns `{ spec: StrategySpec, source: "ai" | "mock" }`
- Deployed automatically by Lovable Cloud

## Local development

```bash
bun install
bun dev
```

## Where to extend next

- `src/lib/mql5-generator.ts` — modular code emitter. Add risk variants,
  trailing stops, multi-symbol support, etc.
- `supabase/functions/mt5-strategy-parser` — swap or fine-tune the AI prompt,
  add tool calls / structured output for richer specs.
- `Validation` tab — wire to a real MetaEditor / MetaTrader 5 build pipeline
  to replace the placeholder compile/backtest reports (look for `TODO`).
- Add Google sign-in via `lovable.auth.signInWithOAuth("google", ...)` if
  desired.
