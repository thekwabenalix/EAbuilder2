# Project Verification

`tsc` and `npm run build` validate the TypeScript app and generators, but they do
not prove that the AI wiring contract stayed faithful to the trader's prompt or
that emitted MQL5 avoids known MT5 pitfalls. These checks close that gap.

## 1. Run The Normal Verifier

```bash
npm run verify
```

This runs:

- `npm run verify:modules` - module admission checks across vocabulary, UI, contracts, and detector-only status
- `npm run verify:intake` - StrategyBlueprint/FourBrain intake contract tests
- `npm run verify:ai` - raw-text and semantic regression tests for AI wiring
- `npm run verify:mql5` - MQL5 emit and static lint for generated modules and EAs
- `npm run verify:mql5-syntax` - strict syntax gate on golden + blessed EA fixtures (fails CI on red flags)

Use this before trusting a build.

## 2. Module Admission

```bash
npm run verify:modules
```

This protects against half-added modules. A module must be deliberately admitted
as detector-only, not verified, template-only, or a verified state machine. See
`verify/MODULE_ADMISSION.md` for the workflow.

## 3. Strategy Intake Contracts

```bash
npm run verify:intake
```

This protects the boundary where interview output becomes a normalized
StrategyBlueprint and FourBrainConfig. Current protected cases include:

- explicit 4-Brain configs preserve modules and params
- BOS direction, order-block setup, and engulfing execution infer correctly from rules
- supply/demand zones map to the order-block family instead of disappearing
- IFVG text maps to `fvg_inversion`, not generic `fvg`
- unsupported SMA does not silently become EMA

## 4. AI Wiring Regressions

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

## 5. Emit And Static Lint

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

## 5b. Strict Syntax Gate (CI)

```bash
npm run verify:mql5-syntax
```

Runs after `verify:mql5` in `npm run verify`. Lints every emitted fixture under
`verify/mql5/` and **fails** on MQL4-isms, placeholder text, brace imbalance, and
missing EA structure markers. Also emits blessed-flow compile anchors.

## 6. MetaEditor Compile Smoke (optional)

```bash
npm run compile:golden
```

Windows + MetaEditor only. Compiles `verify/mql5/golden/*.mq5` when MT5 is
installed. Skips cleanly when MetaEditor is missing unless
`MQL5_COMPILE_REQUIRED=1`.

Set repository variables for self-hosted CI:

- `METAEDITOR_PATH` — path to `metaeditor64.exe`
- `MT5_DATA_PATH` — terminal data folder containing `MQL5/`
- `MQL5_COMPILE_REQUIRED=1` — fail the compile job when MetaEditor is absent

## 7. Compile In MetaEditor

Copy the emitted files and press F7:

| File                                   | Drop into          | Compile        |
| -------------------------------------- | ------------------ | -------------- |
| `*_Detector.mq5`, `*_State_Module.mq5` | `MQL5/Indicators/` | F7 -> 0 errors |
| `_TEST_*.mq5`                          | `MQL5/Indicators/` | F7 -> 0 errors |
| `*_Test.mq5` full EAs                  | `MQL5/Experts/`    | F7 -> 0 errors |

### Priority Order

1. New or recently changed inline state-machine harnesses, for example `_TEST_EGSM_M5.mq5`
2. Full assembled EA fixtures, for example `EMA_Test_Then_IFVG_Test.mq5`
3. New standalone detectors or state modules
4. Older unchanged detectors and state modules

Record compiler errors and fix them in the generator `.ts` file, then re-run
`npm run verify`. Never hand-edit the emitted `.mq5`.
