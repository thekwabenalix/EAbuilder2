import {
  findBuiltinIndicator,
  INDICATOR_CATEGORY_LABEL,
  INDICATOR_REGISTRY,
  type BuiltinIndicator,
} from "./indicator-registry";

export interface BuiltinIndicatorRef {
  id: string;
  name: string;
  category: string;
  via: BuiltinIndicator["via"];
  mql5: string;
  status: "builtin_indicator";
  note: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesPhrase(text: string, phrase: string): boolean {
  const clean = phrase.trim().toLowerCase();
  if (!clean || clean.length < 2) return false;
  if (clean.includes("%")) return text.includes(clean);
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(clean)}([^a-z0-9]|$)`, "i").test(text);
}

function indicatorMentioned(text: string, indicator: BuiltinIndicator): boolean {
  return (
    matchesPhrase(text, indicator.id) ||
    matchesPhrase(text, indicator.name) ||
    indicator.aliases.some((alias) => matchesPhrase(text, alias))
  );
}

function toRef(indicator: BuiltinIndicator): BuiltinIndicatorRef {
  return {
    id: indicator.id,
    name: indicator.name,
    category: INDICATOR_CATEGORY_LABEL[indicator.category],
    via: indicator.via,
    mql5: indicator.mql5,
    status: "builtin_indicator",
    note: "Recognized as a built-in MT5 indicator primitive. It can be referenced by generator logic, but it is not a 4-Brain module unless a verified contract wraps the strategy behavior.",
  };
}

export function collectBuiltinIndicatorRefs(text: string): BuiltinIndicatorRef[] {
  const hay = text.toLowerCase();
  const refs = INDICATOR_REGISTRY.filter((indicator) => indicatorMentioned(hay, indicator)).map(
    toRef,
  );
  return [...new Map(refs.map((ref) => [ref.id, ref])).values()];
}

export function explainBuiltinIndicator(query: string): BuiltinIndicatorRef | undefined {
  const indicator = findBuiltinIndicator(query);
  return indicator ? toRef(indicator) : undefined;
}
