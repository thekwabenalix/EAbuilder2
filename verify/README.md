# Project Verification

`tsc` and `npm run build` validate the TypeScript app and generators, but they do
not prove that the AI wiring contract stayed faithful to the trader's prompt or
that emitted MQL5 avoids known MT5 pitfalls. These checks close that gap.

## 1. Run The Normal Verifier

```bash
npm run verify
```

This runs both:

- `npm run verify:ai` - raw-text and semantic regression tests for AI wiring
- `npm run verify:mql5` - MQL5 emit and static lint for generated modules and EAs

Use this before trusting a build.

## 2. AI Wiring Regressions

```bash
npm run verify:ai
```

This catches failures where the AI or deterministic adapter changes the trader's
rules while translating text into structured wiring. Current protected cases
include:

- `only 48 EMA` must stay `slow`, not widen to `either`
- `either 12 or 48 EMA` is allowed only when the trader says either
- IFVG formation entries must use `JustInverted()`, not later IFVG retest confirmation
- IFVG entries must stay timestamp-gated after the EMA test

## 3. Emit And Static Lint

```bash
npm run verify:mql5
```

This writes every recently built generator's output to `verify/mql5/*.mq5`
(git-ignored) and runs a static lint for known MQL5 pitfalls from the project
rules: MQL4-style series access, bare `Ask`/`Bid`, `SetMagicNumber`,
`GetPointer`, brace/paren imbalance, and structs declared inside functions.

It also assembles full 4-Brain EA fixtures and checks important generator
contracts, including state-machine auto-embedding, reset calls, EMA retest gates,
IFVG formation entries, and the module contract registry.

A clean report means "no obvious red flags"; it is not a compiler.

## 4. Compile In MetaEditor

Copy the emitted files and press F7:

| File                                   | Drop into          | Compile                         |
| -------------------------------------- | ------------------ | ------------------------------- |
| `*_Detector.mq5`, `*_State_Module.mq5` | `MQL5/Indicators/` | F7 -> 0 errors                  |
| `_TEST_*.mq5`                          | `MQL5/Indicators/` | F7 -> 0 errors                  |
| `*_Test.mq5` full EAs                  | `MQL5/Experts/`    | F7 -> 0 errors                  |

### Priority Order

1. New or recently changed inline state-machine harnesses, for example `_TEST_EGSM_M5.mq5`
2. Full assembled EA fixtures, for example `EMA_Test_Then_IFVG_Test.mq5`
3. New standalone detectors or state modules
4. Older unchanged detectors and state modules

Record compiler errors and fix them in the generator `.ts` file, then re-run
`npm run verify`. Never hand-edit the emitted `.mq5`.
