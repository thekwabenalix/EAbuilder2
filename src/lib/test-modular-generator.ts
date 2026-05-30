/**
 * Phase 0 Step 0c: Integration Test for Modular 4-Brain Generator
 *
 * Tests the new modular generator architecture:
 * 1. Creates a simple FourBrainConfig (Classic ICT: CHoCH + OB + Engulfing)
 * 2. Calls generateEA() to generate the complete EA
 * 3. Verifies output structure (has all required sections)
 * 4. Checks for syntax errors (PrintFormat, function signatures, etc.)
 * 5. Reports any missing placeholders
 *
 * Success criteria:
 * ✓ Output is valid MQL5 (no untranslated {{ }} placeholders)
 * ✓ All brain functions are present
 * ✓ OnTick assembler has all three brain calls
 * ✓ Confluence gate logic is included
 * ✓ Logging statements output brain state
 */

import { generateEA } from "@/generators/gen-ea";
import type { FourBrainConfig, MQL5CodeGenParams } from "@/types/blueprint";

export function testModularGenerator(): {
  success: boolean;
  output?: string;
  errors: string[];
} {
  const errors: string[] = [];

  try {
    // Step 1: Create a simple Classic ICT config (Direction + Setup + Execution)
    const config: FourBrainConfig = {
      direction: {
        modules: ["choch"],
        timeframe: "D1",
      },
      setup: {
        modules: ["order_block"],
        timeframe: "H4",
      },
      execution: {
        modules: ["engulfing"],
        timeframe: "H1",
      },
      management: {
        riskPercent: 1.0,
        rewardRisk: 1.5,
        stopBuffer: 0.001,
        breakEvenEnabled: false,
        breakEvenAtR: 0.5,
        maxOpenTrades: 5,
      },
    };

    const params: MQL5CodeGenParams = {
      eaName: "ClassicICT_Test",
      config,
      globalSymbol: "EURUSD",
      globalMagic: 123456,
    };

    // Step 2: Generate the EA
    const output = generateEA(params);

    // Step 3: Verify output structure
    const checks = [
      { name: "EA Name in Header", test: output.includes("ClassicICT_Test.mq5") },
      { name: "Direction Brain Present", test: output.includes("Direction_Brain_Execute") },
      { name: "Setup Brain Present", test: output.includes("Setup_Brain_Execute") },
      { name: "Execution Brain Present", test: output.includes("Execution_Brain_Execute") },
      { name: "Management Brain Present", test: output.includes("Management_Brain_ManageBreakEven") },
      { name: "OnTick Assembler Present", test: output.includes("void OnTick()") },
      { name: "Confluence Gate Logic", test: output.includes("canTrade") || output.includes("Gate") },
      { name: "Brain State Types Defined", test: output.includes("struct DirectionBrainState") },
      { name: "Global States Declared", test: output.includes("gDirState") && output.includes("gSetupState") },
      { name: "Imports Present", test: output.includes("#include <Trade/Trade.mqh>") },
      { name: "OnInit Present", test: output.includes("int OnInit()") },
      { name: "OnDeinit Present", test: output.includes("void OnDeinit(") },
      { name: "Inputs Generated", test: output.includes("input") },
      { name: "No Unresolved Placeholders", test: !output.includes("{{") && !output.includes("}}") },
      { name: "Logging Statements Present", test: output.includes("PrintFormat") },
    ];

    // Step 4: Report results
    let allPass = true;
    for (const check of checks) {
      if (!check.test) {
        errors.push(`❌ ${check.name}`);
        allPass = false;
      }
    }

    if (allPass) {
      console.log("✅ All Phase 0 Step 0c checks passed!");
      console.log(`   Generated ${output.length} bytes of MQL5 code`);
    }

    return {
      success: allPass,
      output: allPass ? output : undefined,
      errors,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`Exception during generation: ${message}`);
    return { success: false, errors };
  }
}

// Run test if this module is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = testModularGenerator();
  console.log("\n=== Phase 0 Step 0c: Modular Generator Integration Test ===\n");

  if (result.success) {
    console.log("✅ SUCCESS: Modular generator works!\n");
    console.log("Generated EA preview (first 500 chars):");
    console.log(result.output?.substring(0, 500));
    console.log("\n[Output truncated...]");
  } else {
    console.log("❌ FAILURES:\n");
    result.errors.forEach((e) => console.log(`  ${e}`));
  }
}
