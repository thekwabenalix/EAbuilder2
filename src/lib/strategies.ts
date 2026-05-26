import { supabase } from "@/integrations/supabase/client";
import type { StrategyBlueprint } from "@/types/blueprint";
import { DEFAULT_BLUEPRINT } from "@/types/blueprint";

export interface StrategyRow {
  id: string;
  user_id: string;
  name: string;
  prompt: string;
  spec_json: StrategyBlueprint;
  generated_code: string;
  created_at: string;
  updated_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToStrategy(row: any): StrategyRow {
  const raw = (row.spec_json as Record<string, unknown>) || {};
  const spec: StrategyBlueprint = {
    ...DEFAULT_BLUEPRINT,
    ...raw,
    risk: {
      ...DEFAULT_BLUEPRINT.risk,
      ...((raw.risk as Record<string, unknown>) ?? {}),
    },
    execution: {
      ...DEFAULT_BLUEPRINT.execution,
      ...((raw.execution as Record<string, unknown>) ?? {}),
    },
  };
  return { ...row, spec_json: spec } as StrategyRow;
}

export async function listStrategies(): Promise<StrategyRow[]> {
  const { data, error } = await supabase
    .from("strategies")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToStrategy);
}

export async function getStrategy(id: string): Promise<StrategyRow> {
  const { data, error } = await supabase.from("strategies").select("*").eq("id", id).single();
  if (error) throw error;
  return rowToStrategy(data);
}

export async function createStrategy(input: {
  userId: string;
  name: string;
  prompt: string;
  blueprint: StrategyBlueprint;
  generatedCode: string;
}): Promise<StrategyRow> {
  const { data, error } = await supabase
    .from("strategies")
    .insert({
      user_id: input.userId,
      name: input.name,
      prompt: input.prompt,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      spec_json: input.blueprint as any,
      generated_code: input.generatedCode,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToStrategy(data);
}

export async function updateStrategy(
  id: string,
  patch: Partial<{
    name: string;
    prompt: string;
    blueprint: StrategyBlueprint;
    generatedCode: string;
  }>,
): Promise<StrategyRow> {
  const update: {
    name?: string;
    prompt?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    spec_json?: any;
    generated_code?: string;
  } = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.prompt !== undefined) update.prompt = patch.prompt;
  if (patch.blueprint !== undefined) update.spec_json = patch.blueprint;
  if (patch.generatedCode !== undefined) update.generated_code = patch.generatedCode;

  const { data, error } = await supabase
    .from("strategies")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return rowToStrategy(data);
}

export async function deleteStrategy(id: string): Promise<void> {
  const { error } = await supabase.from("strategies").delete().eq("id", id);
  if (error) throw error;
}

export async function duplicateStrategy(id: string, userId: string): Promise<StrategyRow> {
  const original = await getStrategy(id);
  return createStrategy({
    userId,
    name: `${original.name} (copy)`,
    prompt: original.prompt,
    blueprint: original.spec_json,
    generatedCode: original.generated_code,
  });
}
