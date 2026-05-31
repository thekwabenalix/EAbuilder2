# EAbuilder2 — Project Rules

A SaaS MT5 Expert Advisor builder. Traders describe strategies in plain English;
the system generates one self-contained, compilable MQL5 EA they can backtest.

This is **not** a personal EA project and **not** a library of hardcoded templates.

---

## Core architecture (do not violate)

```
Trader prompt / visual config
  → AI interprets the strategy
  → AI maps it to modules + the 4 brains
  → system produces a StrategyBlueprint / brain config
  → VERIFIED generators emit a self-contained MQL5 EA
  → EA compiles in MetaEditor
  → EA backtests in MT5
  → system explains the results
```

The goal is **NOT** `prompt → AI writes raw MQL5 from scratch`.
The goal is **`prompt → AI understands → system compiles from verified building blocks`**.

---

## The 4-Brain model

Each brain runs independently on its own timeframe. A trade fires only when all
active brains agree (confluence gate).

- **Direction Brain** → `gBias` (1 BULL / -1 BEAR / 0 NEUTRAL), persistent
- **Setup Brain** → `gSetupActive`, `gSetupDir`, `gSetupSLHint`, reset each bar
- **Execution Brain** → `gExecSignal`, `gExecDir`, `gExecSL`, reset each bar
- **Management Brain** → risk %, R:R, SL/TP, break-even, trailing (deterministic, not AI)

The same module can serve different roles depending on the trader's intent
(e.g. FVG as setup in one strategy, as execution trigger in another).

---

## Non-negotiable rules

1. **AI interprets strategy. Verified templates generate MQL5.**
   Never let AI freely invent MQL5 when a verified module exists.

2. **The AI only returns small structured wiring** (JSON brain functions +
   sm_configs). It must never output a full EA file. The assembler embeds the
   proven inline state machines and all trade/risk/OnTick logic.

3. **Modules are the AI builder's vocabulary, not user-facing files.**
   Users never install indicators or state modules. The final EA is always one
   self-contained `.mq5` with all detection logic embedded inline.

4. **Every state-machine function referenced must be embedded.**
   `reconcileStateMachines()` in `gen-ea.ts` auto-adds any sm_config the AI
   forgot to declare. Keep this guardrail — it is what makes AI output compile.

5. **Never run a freeform AI rewrite on a 4-Brain EA.**
   It rewrites 800+ lines and truncates. For 4-Brain EAs, fixes come from
   "Regen from Template" (deterministic) or "AI Rebuild" (structured re-gen).

6. **Keep detection, state, execution, and management logically separated.**

7. **Extract configuration from the trader's words — never hardcode blindly.**
   EMA periods, lookback bars, expiry, pivot strength all come from the user
   (param inputs) or the description (AI extraction), not fixed defaults.

8. **Every major change must be explainable in user-facing SaaS terms.**

---

## MQL5, not MQL4 (the inline state machines + generators)

- Price data: `iClose/iOpen/iHigh/iLow/iTime(symbol, TF, shift)` — never `Close[]`, `High[]`
- Current price: `SymbolInfoDouble(_Symbol, SYMBOL_ASK/BID)` — never bare `Ask`, `Bid`
- `iMA(symbol, tf, period, ma_shift, method, applied_price)` — 6 params, handle pattern
- Magic: `trade.SetExpertMagicNumber((ulong)magic)` — not `SetMagicNumber`
- No `GetPointer()` on structs in arrays — use direct `arr[i].field` access
- No struct definitions inside functions — declare structs at global scope

---

## Two generation paths

- **Template mode** — `gen-direction/setup/execution-brain.ts` switch-case
  generators. Fast, offline, deterministic. Always compiles.
- **AI mode** — `/api/gen-4brain-ai` (Codex + module library) returns wiring +
  sm_configs; `gen-ea.ts` reconciles and embeds the state machines.

Both produce the same class of self-contained 4-Brain EA.

---

## Verified building blocks

- Inline state machines: `gen-fvg-sm.ts`, `gen-bos-sm.ts`, `gen-ob-sm.ts`,
  `gen-liqsweep-sm.ts`, `gen-ifvg-state-machine.ts`
- Module library (AI vocabulary): `src/lib/module-library.ts`
- UI param definitions: `MODULE_UI_PARAMS` in the same file
- Assembler: `src/generators/gen-ea.ts`

Do not replace verified module logic without explicit approval.
Do not turn the project back into raw prompt-to-MQL5 generation.

---

## Workflow

- Plan before large or isolated changes; surgical fixes can be direct.
- `npx tsc --noEmit` must pass. `npm run build` must succeed.
- Commit + push only when asked. End commit messages with the Co-Authored-By line.
