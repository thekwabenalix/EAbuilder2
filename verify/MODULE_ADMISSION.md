# Module Admission Workflow

This project is a SaaS EA builder, not a folder of handpicked EAs. A module is not
AI-buildable just because an indicator file exists.

## Status Levels

- `detector_only` - standalone indicator/detector exists, but AI must not wire it into EAs
- `not_verified` - visible vocabulary or UI placeholder, but guarded from live wiring
- `template_only` - deterministic template primitive, not an inline state machine
- `verified_state_machine` - admitted for AI 4-Brain wiring through a contract

## Checklist For A New Module

1. Build and visually test the detector or state module in MT5.
2. Add or update the module vocabulary in `src/lib/module-library.ts` if AI may discuss it.
3. Add UI params in `MODULE_UI_PARAMS` only when the builder should expose configuration.
4. Add a contract in `src/lib/module-contracts.ts` before AI can wire it.
5. Add an admission record in `src/lib/module-admission.ts`.
6. Add intake contract tests when raw text should map to the module.
7. Add AI wiring regression tests when the module has semantic events that can be confused.
8. Add MQL5 verifier fixtures when the module has generated MQL5 or inline SM logic.
9. Run `npm run verify`.
10. Compile the emitted `.mq5` fixtures in MetaEditor.

## Current Important Rule

`RBR_DBD` and `MEF` are currently `detector_only`. They may be emitted and tested
as indicators, but they are not part of AI 4-Brain wiring until they have
contracts and verified state-machine behavior.
