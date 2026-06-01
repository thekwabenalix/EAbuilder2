# MQL5 Compile Verification

`tsc` and `npm run build` only validate the **TypeScript generators** — not the
**MQL5 they emit**. This step closes that gap.

## 1. Emit + static lint

```bash
npm run verify:mql5
```

This writes every recently-built generator's output to `verify/mql5/*.mq5`
(git-ignored) and runs a static lint for the CLAUDE.md MQL5 pitfalls
(MQL4-isms, brace/paren balance, bare `Ask`/`Bid`, `SetMagicNumber`,
`GetPointer`, struct-in-function). It also assembles a **full 4-Brain EA** that
uses `rsi_hd` as the Setup Brain via the AI path and asserts the inline SM is
auto-embedded and reset.

A clean report means "no obvious red flags" — it is **not** a compiler.

## 2. Compile in MetaEditor (the real gate)

Copy the emitted files and press **F7**:

| File                                   | Drop into          | Compile                            |
| -------------------------------------- | ------------------ | ---------------------------------- |
| `*_Detector.mq5`, `*_State_Module.mq5` | `MQL5/Indicators/` | F7 → 0 errors                      |
| `_TEST_RSIHDSM_M15.mq5`                | `MQL5/Indicators/` | F7 → 0 errors (isolated inline SM) |
| `RSI_HD_Continuation_Test.mq5`         | `MQL5/Experts/`    | F7 → 0 errors (full 4-Brain EA)    |

### Priority order (riskiest first)

1. `_TEST_RSIHDSM_M15.mq5` — novel `iRSI` handle inside an inline SM
2. `RSI_HD_Continuation_Test.mq5` — full assembled EA using the new SM
3. `RSI_Hidden_Divergence_Detector.mq5` — separate-window indicator + dual-pane objects
4. The remaining detectors / state modules

Record any compiler errors and fix them in the **generator** (the `.ts` file),
then re-run `npm run verify:mql5` — never hand-edit the emitted `.mq5`.
