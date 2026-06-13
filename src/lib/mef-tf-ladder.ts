/** Timeframe ladder for MEF gap/base TF defaults (main → 1 lower → 2 lower). */
const TF_LADDER = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN"] as const;

export function lowerTfLabel(tf: string, steps: number): string {
  const u = tf.toUpperCase();
  const i = TF_LADDER.indexOf(u as (typeof TF_LADDER)[number]);
  if (i < 0) return tf;
  return TF_LADDER[Math.max(0, i - steps)] ?? tf;
}
