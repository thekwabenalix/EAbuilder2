/**
 * Phase 4 — Assistant credit policy.
 *
 * Deterministic platform work stays free (rule audit, repair plan, APPLY regen,
 * compile/download via local runner). Cloud AI diagnosis/chat consumes credits.
 *
 * Balance is stored in localStorage until a billed backend is wired. Plans map
 * to monthly allowances that soft-reset on first use after the period ends.
 */

export type AssistantCreditPlan = "starter" | "builder" | "studio";

export type AssistantCreditAction =
  | "cloud_chat"
  | "cloud_chat_with_images"
  | "ai_surgical_fix"
  | "free_diagnosis"
  | "free_apply"
  | "free_compile";

export interface AssistantCreditWallet {
  plan: AssistantCreditPlan;
  balance: number;
  usedThisPeriod: number;
  periodStartIso: string;
}

export interface CreditSpendResult {
  ok: boolean;
  cost: number;
  balance: number;
  reason?: string;
}

export const ASSISTANT_CREDITS_STORAGE_KEY = "eab-assistant-credits";

/** Monthly allowances by plan (soft client-side meter). */
export const PLAN_MONTHLY_CREDITS: Record<AssistantCreditPlan, number> = {
  starter: 15,
  builder: 100,
  studio: 300,
};

export const CREDIT_COSTS: Record<
  Extract<AssistantCreditAction, "cloud_chat" | "cloud_chat_with_images" | "ai_surgical_fix">,
  number
> = {
  cloud_chat: 1,
  cloud_chat_with_images: 2,
  ai_surgical_fix: 3,
};

export const FREE_CREDIT_ACTIONS: AssistantCreditAction[] = [
  "free_diagnosis",
  "free_apply",
  "free_compile",
];

const PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

export function isFreeAssistantAction(action: AssistantCreditAction): boolean {
  return FREE_CREDIT_ACTIONS.includes(action);
}

export function creditCostForChat(hasImages: boolean): number {
  return hasImages ? CREDIT_COSTS.cloud_chat_with_images : CREDIT_COSTS.cloud_chat;
}

export function defaultWallet(plan: AssistantCreditPlan = "starter"): AssistantCreditWallet {
  return {
    plan,
    balance: PLAN_MONTHLY_CREDITS[plan],
    usedThisPeriod: 0,
    periodStartIso: nowIso(),
  };
}

function refreshPeriod(wallet: AssistantCreditWallet): AssistantCreditWallet {
  const start = Date.parse(wallet.periodStartIso);
  if (!Number.isFinite(start) || Date.now() - start < PERIOD_MS) return wallet;
  return {
    ...wallet,
    balance: PLAN_MONTHLY_CREDITS[wallet.plan],
    usedThisPeriod: 0,
    periodStartIso: nowIso(),
  };
}

export function readAssistantCredits(): AssistantCreditWallet {
  if (typeof window === "undefined") return defaultWallet();
  try {
    const raw = localStorage.getItem(ASSISTANT_CREDITS_STORAGE_KEY);
    if (!raw) {
      const fresh = defaultWallet();
      localStorage.setItem(ASSISTANT_CREDITS_STORAGE_KEY, JSON.stringify(fresh));
      return fresh;
    }
    const parsed = JSON.parse(raw) as Partial<AssistantCreditWallet>;
    const plan =
      parsed.plan === "builder" || parsed.plan === "studio" || parsed.plan === "starter"
        ? parsed.plan
        : "starter";
    const wallet = refreshPeriod({
      plan,
      balance:
        typeof parsed.balance === "number" ? Math.max(0, Math.floor(parsed.balance)) : PLAN_MONTHLY_CREDITS[plan],
      usedThisPeriod:
        typeof parsed.usedThisPeriod === "number" ? Math.max(0, Math.floor(parsed.usedThisPeriod)) : 0,
      periodStartIso:
        typeof parsed.periodStartIso === "string" ? parsed.periodStartIso : nowIso(),
    });
    localStorage.setItem(ASSISTANT_CREDITS_STORAGE_KEY, JSON.stringify(wallet));
    return wallet;
  } catch {
    return defaultWallet();
  }
}

export function writeAssistantCredits(wallet: AssistantCreditWallet): AssistantCreditWallet {
  const next = refreshPeriod(wallet);
  if (typeof window !== "undefined") {
    localStorage.setItem(ASSISTANT_CREDITS_STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}

export function setAssistantCreditPlan(plan: AssistantCreditPlan): AssistantCreditWallet {
  const current = readAssistantCredits();
  if (current.plan === plan) return current;
  return writeAssistantCredits({
    plan,
    balance: PLAN_MONTHLY_CREDITS[plan],
    usedThisPeriod: 0,
    periodStartIso: nowIso(),
  });
}

export function canAffordAssistantCredits(cost: number, wallet = readAssistantCredits()): boolean {
  return cost <= 0 || wallet.balance >= cost;
}

/** Spend credits for a billable AI action. Free actions always succeed at cost 0. */
export function spendAssistantCredits(
  action: AssistantCreditAction,
  wallet = readAssistantCredits(),
): CreditSpendResult {
  if (isFreeAssistantAction(action)) {
    return { ok: true, cost: 0, balance: wallet.balance };
  }

  const cost =
    action === "cloud_chat"
      ? CREDIT_COSTS.cloud_chat
      : action === "cloud_chat_with_images"
        ? CREDIT_COSTS.cloud_chat_with_images
        : CREDIT_COSTS.ai_surgical_fix;

  const refreshed = refreshPeriod(wallet);
  if (refreshed.balance < cost) {
    return {
      ok: false,
      cost,
      balance: refreshed.balance,
      reason: `Not enough AI credits (need ${cost}, have ${refreshed.balance}). Free diagnosis and Apply now still work.`,
    };
  }

  const next = writeAssistantCredits({
    ...refreshed,
    balance: refreshed.balance - cost,
    usedThisPeriod: refreshed.usedThisPeriod + cost,
  });
  return { ok: true, cost, balance: next.balance };
}

export function creditPolicySummary(wallet = readAssistantCredits()): string {
  return [
    `Plan: ${wallet.plan} · ${wallet.balance} AI credits left this period`,
    `Used: ${wallet.usedThisPeriod} · Allowance: ${PLAN_MONTHLY_CREDITS[wallet.plan]}/month`,
    "Free: rule audit, repair plan, Apply now, compile/download",
    `Paid: cloud chat (${CREDIT_COSTS.cloud_chat}–${CREDIT_COSTS.cloud_chat_with_images} credits), AI surgical fix (${CREDIT_COSTS.ai_surgical_fix})`,
  ].join("\n");
}
