/**
 * Phase 0 Step 0d: Complete Classic ICT EA Generation and Verification
 *
 * This test demonstrates the fully refactored modular architecture by:
 * 1. Creating a complete Classic ICT strategy config
 *    - Direction Brain: CHoCH @ D1
 *    - Setup Brain: OB (Order Block) @ H4
 *    - Execution Brain: Bullish Engulfing @ H1
 *    - Management: 1% risk, 1.5 R:R
 *
 * 2. Generating the complete EA using the new modular system
 *
 * 3. Verifying visibility:
 *    - All brain functions generate expected outputs
 *    - OnTick assembler logs brain state to tester
 *    - Confluence gate logic prevents invalid trades
 *
 * Next step after this: Backtest for 1 week on EURUSD H1, verify tester log output
 */

import { generateMql5FromBlueprint } from "./mql5-template-generator";
import type { StrategyBlueprint } from "@/types/blueprint";

const EMPTY_STATS = {
  lines: 0,
  hasDirectionBrain: false,
  hasSetupBrain: false,
  hasExecutionBrain: false,
  hasManagementBrain: false,
  hasConfluenceGate: false,
  loggingCalls: 0,
};

export function generateClassicICTEA(): {
  success: boolean;
  ea?: string;
  errors: string[];
  stats: {
    lines: number;
    hasDirectionBrain: boolean;
    hasSetupBrain: boolean;
    hasExecutionBrain: boolean;
    hasManagementBrain: boolean;
    hasConfluenceGate: boolean;
    loggingCalls: number;
  };
} {
  const errors: string[] = [];

  try {
    // Step 1: Create Classic ICT blueprint
    const blueprint: StrategyBlueprint = {
      version: "2.0",
      name: "Classic_ICT_CHoCH_OB_Engulfing",
      strategyType: ["SMC"],
      marketPhilosophy: "ICT multi-timeframe",
      compilable: true,
      compilableRuleIds: [],
      subjectiveRuleIds: [],
      pendingClarifications: [],
      confidence: 90,

      fourBrain: {
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
      },

      risk: {
        riskPercent: 1.0,
        rewardRisk: 1.5,
        lotSizingMethod: "equity_percent" as const,
        stopType: "candle_extreme" as const,
        stopBufferPoints: 20,
        trailingStop: false,
        breakevenEnabled: false,
        partialClose: false,
        maxOpenTrades: 5,
      },

      rules: [],
      execution: {
        symbol: "EURUSD",
        setupTimeframe: "H4",
        entryTimeframe: "H1",
        orderType: "market",
        setupExpiryBars: 24,
        sessionFilter: [],
        spreadFilterPoints: 25,
        magicNumber: 100001,
      },
    };

    // Step 2: Generate EA using modular system
    const ea = generateMql5FromBlueprint(blueprint);

    if (!ea) {
      errors.push("EA generation returned empty output");
      return { success: false, errors, stats: EMPTY_STATS };
    }

    // Step 3: Verify output structure
    const stats = {
      lines: ea.split("\n").length,
      hasDirectionBrain: ea.includes("Direction_Brain_Execute"),
      hasSetupBrain: ea.includes("Setup_Brain_Execute"),
      hasExecutionBrain: ea.includes("Execution_Brain_Execute"),
      hasManagementBrain: ea.includes("Management_Brain_ManageBreakEven"),
      hasConfluenceGate:
        (ea.includes("bias != 0") || ea.includes("canTrade")) && ea.includes("signalReady"),
      loggingCalls: (ea.match(/PrintFormat/g) || []).length,
    };

    // Verify all critical components
    const checks = [
      {
        name: "Direction Brain Implementation",
        test: stats.hasDirectionBrain,
      },
      {
        name: "Setup Brain Implementation",
        test: stats.hasSetupBrain,
      },
      {
        name: "Execution Brain Implementation",
        test: stats.hasExecutionBrain,
      },
      {
        name: "Management Brain Implementation",
        test: stats.hasManagementBrain,
      },
      {
        name: "Confluence Gate Logic (Dir+Setup+Exec)",
        test: stats.hasConfluenceGate,
      },
      {
        name: "Logging for Visibility",
        test: stats.loggingCalls > 0,
      },
      {
        name: "No Untranslated Placeholders",
        test: !ea.includes("{{") && !ea.includes("}}"),
      },
      {
        name: "Valid MQL5 Header",
        test: ea.includes("#property") && ea.includes("#include <Trade/Trade.mqh>"),
      },
      {
        name: "OnTick Event Handler",
        test: ea.includes("void OnTick()"),
      },
      {
        name: "OnInit/OnDeinit Lifecycle",
        test: ea.includes("int OnInit()") && ea.includes("void OnDeinit("),
      },
    ];

    // Report failures
    let allPass = true;
    for (const check of checks) {
      if (!check.test) {
        errors.push(`Missing: ${check.name}`);
        allPass = false;
      }
    }

    // Additional content checks
    if (!ea.includes("struct DirectionBrainState")) {
      errors.push("Missing: DirectionBrainState struct definition");
      allPass = false;
    }
    if (!ea.includes("gDirState") || !ea.includes("gSetupState") || !ea.includes("gExecState")) {
      errors.push("Missing: Global brain state variables");
      allPass = false;
    }

    return {
      success: allPass,
      ea: allPass ? ea : undefined,
      errors,
      stats,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`Exception: ${message}`);
    return { success: false, errors, stats: EMPTY_STATS };
  }
}

// Export for testing
export function reportPhase0Step0d(): void {
  const result = generateClassicICTEA();

  console.log("\n=== Phase 0 Step 0d: Classic ICT EA Generation ===\n");

  if (result.success) {
    console.log("✅ SUCCESS: Classic ICT EA generated successfully!\n");
    console.log("📊 Generation Stats:");
    console.log(`   - Lines of MQL5: ${result.stats.lines}`);
    console.log(`   - Direction Brain: ${result.stats.hasDirectionBrain ? "✓" : "✗"}`);
    console.log(`   - Setup Brain: ${result.stats.hasSetupBrain ? "✓" : "✗"}`);
    console.log(`   - Execution Brain: ${result.stats.hasExecutionBrain ? "✓" : "✗"}`);
    console.log(`   - Management Brain: ${result.stats.hasManagementBrain ? "✓" : "✗"}`);
    console.log(`   - Confluence Gate: ${result.stats.hasConfluenceGate ? "✓" : "✗"}`);
    console.log(`   - Logging Calls: ${result.stats.loggingCalls}`);

    console.log("\n📋 Generated EA (first 800 chars):\n");
    console.log(result.ea!.substring(0, 800));
    console.log("\n[Output truncated...]\n");

    console.log("✅ Next step: Manual backtest on EURUSD H1 for 1 week");
    console.log("   Expected: Tester log shows [D1], [S4], [M1] outputs with brain states\n");
  } else {
    console.log("❌ FAILURES:\n");
    result.errors.forEach((e) => console.log(`   - ${e}`));
  }
}
