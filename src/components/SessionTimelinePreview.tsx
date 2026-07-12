import {
  SESSION_PRESET_COLORS,
  SESSION_PRESET_LABELS,
  clampBrokerOffsetHours,
  minutesToHHMM,
  resolvePresetBaseWindow,
  shiftWindowHours,
  windowToTimelineSegments,
  type TradingScheduleConfig,
  type TradingSessionPreset,
  type TradingTimeWindow,
} from "@/lib/trading-schedule";

const HOUR_MARKS = [0, 3, 6, 9, 12, 15, 18, 21, 24] as const;

function formatWindow(w: TradingTimeWindow): string {
  return `${minutesToHHMM(w.startMin)}–${minutesToHHMM(w.endMin)}`;
}

/**
 * 24h broker-time session bands — original UI (not a third-party indicator port).
 * Shows selected sessions with offset applied so the frame matches the filter.
 */
export function SessionTimelinePreview({
  schedule,
  sessions,
}: {
  schedule: TradingScheduleConfig;
  sessions: TradingSessionPreset[];
}) {
  const offset = clampBrokerOffsetHours(schedule.brokerOffsetHours ?? 0);
  const bands = sessions.map((id) => {
    const base = resolvePresetBaseWindow(id, schedule, "winter");
    const shifted = shiftWindowHours(base, offset);
    return { id, window: shifted, segments: windowToTimelineSegments(shifted) };
  });

  if (!bands.length) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Select at least one session to preview the day.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Session map (broker day)</p>
        {offset !== 0 && (
          <span className="text-[10px] font-mono text-muted-foreground">
            offset {offset > 0 ? "+" : ""}
            {offset}h
          </span>
        )}
      </div>

      <div className="relative h-14 rounded-md border border-border bg-muted/30 overflow-hidden">
        {HOUR_MARKS.filter((h) => h > 0 && h < 24).map((h) => (
          <div
            key={h}
            className="absolute top-0 bottom-0 w-px bg-border/60"
            style={{ left: `${(h / 24) * 100}%` }}
          />
        ))}

        {bands.map(({ id, window, segments }, bandIdx) =>
          segments.map((seg, i) => (
            <div
              key={`${id}-${i}`}
              title={`${SESSION_PRESET_LABELS[id]} ${formatWindow(window)}`}
              className="absolute top-1 bottom-5 rounded-sm border border-white/10"
              style={{
                left: `${seg.leftPct}%`,
                width: `${Math.max(seg.widthPct, 0.4)}%`,
                backgroundColor: SESSION_PRESET_COLORS[id],
                opacity: 0.45 + bandIdx * 0.08,
              }}
            />
          )),
        )}

        <div className="absolute inset-x-0 bottom-0 h-4">
          {HOUR_MARKS.map((h) => (
            <span
              key={h}
              className="absolute text-[9px] font-mono text-muted-foreground/80 -translate-x-1/2"
              style={{ left: `${(h / 24) * 100}%` }}
            >
              {String(h).padStart(2, "0")}
            </span>
          ))}
        </div>
      </div>

      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {bands.map(({ id, window }) => (
          <li key={id} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span
              className="h-2 w-2 rounded-sm shrink-0"
              style={{ backgroundColor: SESSION_PRESET_COLORS[id] }}
            />
            <span className="text-foreground/90">{SESSION_PRESET_LABELS[id]}</span>
            <span className="font-mono">{formatWindow(window)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
