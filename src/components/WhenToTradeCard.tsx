import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SessionTimelinePreview } from "@/components/SessionTimelinePreview";
import {
  SESSION_PRESET_COLORS,
  SESSION_PRESET_LABELS,
  clampBrokerOffsetHours,
  clearSessionWindowOverride,
  defaultTradingSchedule,
  minutesToHHMM,
  resolvePresetBaseWindow,
  setSessionWindowOverride,
  tryParseHHMM,
  type TradingScheduleConfig,
  type TradingSessionPreset,
} from "@/lib/trading-schedule";

const WEEKDAYS = [
  { d: 1, label: "Mon" },
  { d: 2, label: "Tue" },
  { d: 3, label: "Wed" },
  { d: 4, label: "Thu" },
  { d: 5, label: "Fri" },
  { d: 6, label: "Sat" },
  { d: 0, label: "Sun" },
] as const;

/** Local draft while typing; commits only on valid HH:MM or blur. */
function TimeHHMMInput({
  minutes,
  onCommit,
  className = "h-8 w-20 text-xs font-mono",
}: {
  minutes: number;
  onCommit: (nextMinutes: number) => void;
  className?: string;
}) {
  const formatted = minutesToHHMM(minutes);
  const [draft, setDraft] = useState(formatted);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(formatted);
  }, [formatted, focused]);

  return (
    <Input
      className={className}
      value={draft}
      placeholder="HH:MM"
      inputMode="numeric"
      onFocus={() => {
        setFocused(true);
        setDraft(formatted);
      }}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        const parsed = tryParseHHMM(next);
        if (parsed !== null) onCommit(parsed);
      }}
      onBlur={() => {
        setFocused(false);
        const parsed = tryParseHHMM(draft);
        if (parsed !== null) {
          onCommit(parsed);
          setDraft(minutesToHHMM(parsed));
        } else {
          setDraft(formatted);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/**
 * When-to-trade / session selector — shared by Configure (/s/$id), /build, and /new.
 */
export function WhenToTradeCard({
  value,
  onChange,
  className = "rounded-lg border border-border p-4 space-y-4",
}: {
  value: TradingScheduleConfig;
  onChange: (next: TradingScheduleConfig) => void;
  className?: string;
}) {
  const schedule = value ?? defaultTradingSchedule();

  return (
    <div className={className}>
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          When to trade
        </p>
        <p className="text-[11px] text-muted-foreground mt-1">
          Broker server time. Outside the window: no new entries; open trades still managed.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: "all", label: "All day" },
            { id: "presets", label: "Selected sessions" },
            { id: "custom_windows", label: "Custom hours" },
          ] as const
        ).map((opt) => {
          const active =
            opt.id === "all"
              ? !schedule.enabled
              : schedule.enabled &&
                (opt.id === "custom_windows"
                  ? schedule.mode === "custom_windows"
                  : schedule.mode !== "custom_windows");
          return (
            <button
              key={opt.id}
              type="button"
              className={`h-8 rounded-md border px-3 text-xs font-medium transition-colors ${
                active
                  ? "border-primary/50 bg-primary/15 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => {
                if (opt.id === "all") {
                  onChange({ ...schedule, enabled: false, mode: "all" });
                  return;
                }
                onChange({
                  ...schedule,
                  enabled: true,
                  mode: opt.id,
                  sessions:
                    opt.id === "presets" && !(schedule.sessions?.length)
                      ? (["london"] as TradingSessionPreset[])
                      : schedule.sessions,
                  windows:
                    opt.id === "custom_windows" && !(schedule.windows?.length)
                      ? [{ startMin: 7 * 60, endMin: 16 * 60 }]
                      : schedule.windows,
                });
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {schedule.enabled && schedule.mode !== "custom_windows" && (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Sessions</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(Object.keys(SESSION_PRESET_LABELS) as TradingSessionPreset[]).map((id) => {
                const on = (schedule.sessions ?? []).includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    className={`h-10 rounded-md border px-3 text-xs font-medium text-left transition-colors ${
                      on
                        ? "border-primary/50 bg-primary/15 text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => {
                      const cur = new Set(schedule.sessions ?? []);
                      if (cur.has(id)) cur.delete(id);
                      else cur.add(id);
                      onChange({ ...schedule, sessions: [...cur] });
                    }}
                  >
                    <span
                      className="mr-1.5 inline-block h-2 w-2 rounded-sm align-middle"
                      style={{ backgroundColor: SESSION_PRESET_COLORS[id] }}
                    />
                    {SESSION_PRESET_LABELS[id]}
                  </button>
                );
              })}
            </div>
          </div>

          <SessionTimelinePreview
            schedule={schedule}
            sessions={(schedule.sessions ?? []) as TradingSessionPreset[]}
          />

          {(schedule.sessions ?? []).length > 0 && (
            <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-3">
              <Label className="text-xs text-muted-foreground">Session frames</Label>
              <p className="text-[10px] text-muted-foreground/80">
                Edit start/end (broker time, before offset). Changes update the map and the EA
                filter.
              </p>
              <div className="space-y-2">
                {(schedule.sessions ?? []).map((id) => {
                  const win = resolvePresetBaseWindow(id, schedule, "winter");
                  const customized = Boolean(schedule.sessionWindowOverrides?.[id]);
                  return (
                    <div
                      key={id}
                      className="flex flex-wrap items-center gap-2 text-xs"
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: SESSION_PRESET_COLORS[id] }}
                      />
                      <span className="w-28 shrink-0 text-muted-foreground truncate">
                        {SESSION_PRESET_LABELS[id]}
                      </span>
                      <TimeHHMMInput
                        minutes={win.startMin}
                        onCommit={(startMin) =>
                          onChange(
                            setSessionWindowOverride(schedule, id, {
                              startMin,
                              endMin: win.endMin,
                            }),
                          )
                        }
                      />
                      <span className="text-muted-foreground">→</span>
                      <TimeHHMMInput
                        minutes={win.endMin}
                        onCommit={(endMin) =>
                          onChange(
                            setSessionWindowOverride(schedule, id, {
                              startMin: win.startMin,
                              endMin,
                            }),
                          )
                        }
                      />
                      {customized && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[10px]"
                          onClick={() =>
                            onChange(clearSessionWindowOverride(schedule, id))
                          }
                        >
                          Reset
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {schedule.enabled && schedule.mode === "custom_windows" && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Custom windows</Label>
          {(schedule.windows ?? []).slice(0, 3).map((w, i) => (
            <div key={i} className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-muted-foreground w-14">Window {i + 1}</span>
              <TimeHHMMInput
                minutes={w.startMin}
                onCommit={(startMin) => {
                  const windows = [...(schedule.windows ?? [])];
                  windows[i] = { ...windows[i]!, startMin };
                  onChange({ ...schedule, windows });
                }}
              />
              <span className="text-xs text-muted-foreground">→</span>
              <TimeHHMMInput
                minutes={w.endMin}
                onCommit={(endMin) => {
                  const windows = [...(schedule.windows ?? [])];
                  windows[i] = { ...windows[i]!, endMin };
                  onChange({ ...schedule, windows });
                }}
              />
              {(schedule.windows?.length ?? 0) > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() =>
                    onChange({
                      ...schedule,
                      windows: (schedule.windows ?? []).filter((_, j) => j !== i),
                    })
                  }
                >
                  Remove
                </Button>
              )}
            </div>
          ))}
          {(schedule.windows?.length ?? 0) < 3 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() =>
                onChange({
                  ...schedule,
                  windows: [
                    ...(schedule.windows ?? []),
                    { startMin: 12 * 60, endMin: 16 * 60 },
                  ],
                })
              }
            >
              Add window
            </Button>
          )}
        </div>
      )}

        {schedule.enabled && (
          <div className="space-y-3 border-t border-border pt-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Broker offset (hours)</Label>
                <Input
                  type="number"
                  min={-12}
                  max={14}
                  step={1}
                  className="h-8 w-24 text-xs font-mono"
                  value={schedule.brokerOffsetHours ?? 0}
                  onChange={(e) =>
                    onChange({
                      ...schedule,
                      brokerOffsetHours: clampBrokerOffsetHours(e.target.value),
                    })
                  }
                />
                <p className="text-[10px] text-muted-foreground/70">
                  Slide session hours to match your broker (often +2 or +3).
                </p>
              </div>
              {schedule.mode !== "custom_windows" && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={schedule.dstMode === "eu_us_approx"}
                      onCheckedChange={(on) =>
                        onChange({
                          ...schedule,
                          dstMode: on ? "eu_us_approx" : "off",
                        })
                      }
                    />
                    <Label className="text-xs text-muted-foreground">DST adjust (London/NY)</Label>
                  </div>
                  <p className="text-[10px] text-muted-foreground/70">
                    Approx EU/US daylight saving — summer tables shift London &amp; New York earlier
                    on fixed-offset brokers.
                  </p>
                </div>
              )}
            </div>

            <Label className="text-xs text-muted-foreground">Trading days</Label>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map(({ d, label }) => {
              const days = schedule.allowedDays ?? [1, 2, 3, 4, 5];
              const on = days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  className={`h-7 min-w-9 rounded border px-2 text-[10px] font-medium ${
                    on
                      ? "border-primary/50 bg-primary/15 text-foreground"
                      : "border-border text-muted-foreground"
                  }`}
                  onClick={() => {
                    const cur = new Set(schedule.allowedDays ?? [1, 2, 3, 4, 5]);
                    if (cur.has(d)) cur.delete(d);
                    else cur.add(d);
                    onChange({
                      ...schedule,
                      allowedDays: [...cur].sort((a, b) => a - b),
                    });
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={schedule.markSessionsOnChart !== false}
                onCheckedChange={(checked) =>
                  onChange({
                    ...schedule,
                    markSessionsOnChart: checked === true,
                  })
                }
              />
              Draw session start/end lines on chart
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={schedule.outsideWindow?.cancelPendingOrders === true}
              onCheckedChange={(checked) =>
                onChange({
                  ...schedule,
                  outsideWindow: {
                    allowNewEntries: false,
                    manageOpenPositions: checked !== true,
                    closeOpenPositions: schedule.outsideWindow?.closeOpenPositions === true,
                    cancelPendingOrders: checked === true,
                  },
                })
              }
            />
            Cancel pending orders outside the window
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={schedule.outsideWindow?.closeOpenPositions === true}
              onCheckedChange={(checked) =>
                onChange({
                  ...schedule,
                  outsideWindow: {
                    allowNewEntries: false,
                    manageOpenPositions: checked !== true,
                    closeOpenPositions: checked === true,
                    cancelPendingOrders: schedule.outsideWindow?.cancelPendingOrders === true,
                  },
                })
              }
            />
            Close open positions at session end
          </label>
        </div>
      )}
    </div>
  );
}
