/**
 * Trading schedule (TIME_SESSION_FILTER) — Phase 1–3.
 * Broker/server time windows + weekday filter. Default disabled = trade all day.
 * Phase 3: broker offset hours + optional EU/US DST approximation for London/NY presets.
 */

import type { StrategyBlueprint } from "@/types/blueprint";

export type TradingScheduleMode = "all" | "presets" | "custom_windows";

/** Phase 3 — approximate daylight-saving shift for London / New York presets. */
export type TradingScheduleDstMode = "off" | "eu_us_approx";

export type TradingSessionPreset = "asia" | "london" | "newyork" | "london_ny_overlap";

/** Minutes from midnight [0, 1440). start inclusive, end exclusive (wrap supported). */
export interface TradingTimeWindow {
  startMin: number;
  endMin: number;
}

export interface TradingScheduleOutsideWindow {
  allowNewEntries: boolean;
  manageOpenPositions: boolean;
  closeOpenPositions: boolean;
  cancelPendingOrders: boolean;
}

export interface TradingScheduleConfig {
  enabled: boolean;
  /** Phase 1–3: broker_server only (offset/DST adjust the preset tables). */
  timeReference: "broker_server";
  mode: TradingScheduleMode;
  sessions?: TradingSessionPreset[];
  windows?: TradingTimeWindow[];
  /** MT5 DayOfWeek: 0=Sun … 6=Sat. Default Mon–Fri. */
  allowedDays?: number[];
  outsideWindow?: TradingScheduleOutsideWindow;
  /**
   * Hours added to preset/custom windows so they match this broker's clock
   * (typical IC Markets / Pepperstone style GMT+2/+3 → try +2 or +3).
   */
  brokerOffsetHours?: number;
  /** When presets include London/NY, shift summer vs winter with EU/US approx rules. */
  dstMode?: TradingScheduleDstMode;
}

/** Payload for [APPLY:{"type":"set_time_filter",...}] */
export type SetTimeFilterPatch = {
  enabled?: boolean;
  mode?: TradingScheduleMode;
  sessions?: string[];
  windows?: Array<{ start?: string; end?: string; startMin?: number; endMin?: number }>;
  days?: number[];
  cancelPendingOrders?: boolean;
  closeOpenPositions?: boolean;
  brokerOffsetHours?: number;
  dstMode?: TradingScheduleDstMode;
};

/** Winter / standard broker-hour approximations (not timezone IANA). */
export const SESSION_PRESET_WINDOWS: Record<TradingSessionPreset, TradingTimeWindow> = {
  asia: { startMin: 0, endMin: 9 * 60 },
  london: { startMin: 7 * 60, endMin: 16 * 60 },
  newyork: { startMin: 12 * 60, endMin: 21 * 60 },
  london_ny_overlap: { startMin: 12 * 60, endMin: 16 * 60 },
};

/**
 * Summer tables for fixed-offset brokers: when London/NY spring forward, their
 * open appears one hour earlier on a broker that stays on winter GMT offset.
 */
export const SESSION_PRESET_WINDOWS_SUMMER: Record<TradingSessionPreset, TradingTimeWindow> = {
  asia: { startMin: 0, endMin: 9 * 60 },
  london: { startMin: 6 * 60, endMin: 15 * 60 },
  newyork: { startMin: 11 * 60, endMin: 20 * 60 },
  london_ny_overlap: { startMin: 11 * 60, endMin: 15 * 60 },
};

export const SESSION_PRESET_LABELS: Record<TradingSessionPreset, string> = {
  asia: "Asian",
  london: "London",
  newyork: "New York",
  london_ny_overlap: "London–NY overlap",
};

export const DEFAULT_ALLOWED_DAYS = [1, 2, 3, 4, 5]; // Mon–Fri

export const DEFAULT_OUTSIDE_WINDOW: TradingScheduleOutsideWindow = {
  allowNewEntries: false,
  manageOpenPositions: true,
  closeOpenPositions: false,
  cancelPendingOrders: false,
};

export function defaultTradingSchedule(): TradingScheduleConfig {
  return {
    enabled: false,
    timeReference: "broker_server",
    mode: "all",
    sessions: [],
    windows: [],
    allowedDays: [...DEFAULT_ALLOWED_DAYS],
    outsideWindow: { ...DEFAULT_OUTSIDE_WINDOW },
    brokerOffsetHours: 0,
    dstMode: "off",
  };
}

export function clampBrokerOffsetHours(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(-12, Math.min(14, Math.round(v)));
}

export function normalizeDstMode(raw: unknown): TradingScheduleDstMode {
  return raw === "eu_us_approx" ? "eu_us_approx" : "off";
}

/** Shift a window by whole hours (wraps into [0, 1440)). */
export function shiftWindowHours(w: TradingTimeWindow, hours: number): TradingTimeWindow {
  const delta = clampBrokerOffsetHours(hours) * 60;
  return normalizeWindow({
    startMin: w.startMin + delta,
    endMin: w.endMin + delta,
  });
}

export function clampMinute(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const m = Math.floor(n) % 1440;
  return m < 0 ? m + 1440 : m;
}

export function minutesToHHMM(mins: number): string {
  const m = clampMinute(mins);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function hhmmToMinutes(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return 0;
  const h = Math.min(23, Math.max(0, parseInt(m[1]!, 10)));
  const mm = Math.min(59, Math.max(0, parseInt(m[2]!, 10)));
  return h * 60 + mm;
}

export function normalizeWindow(w: TradingTimeWindow): TradingTimeWindow {
  return { startMin: clampMinute(w.startMin), endMin: clampMinute(w.endMin) };
}

export function normalizeSessionPreset(raw: string): TradingSessionPreset | null {
  const s = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "asia" || s === "asian" || s === "tokyo") return "asia";
  if (s === "london" || s === "ldn" || s === "uk") return "london";
  if (s === "newyork" || s === "new_york" || s === "ny" || s === "nyc" || s === "us")
    return "newyork";
  if (
    s === "london_ny_overlap" ||
    s === "london_newyork_overlap" ||
    s === "overlap" ||
    s === "london_ny" ||
    s === "ldn_ny"
  )
    return "london_ny_overlap";
  return null;
}

/** Resolve effective windows for codegen / preview (winter presets + broker offset). */
export function resolveTradingWindows(schedule: TradingScheduleConfig | undefined): TradingTimeWindow[] {
  if (!schedule?.enabled || schedule.mode === "all") return [];
  const offset = clampBrokerOffsetHours(schedule.brokerOffsetHours ?? 0);
  if (schedule.mode === "presets") {
    const sessions = schedule.sessions ?? [];
    return sessions
      .map((s) => SESSION_PRESET_WINDOWS[s])
      .filter(Boolean)
      .map((w) => shiftWindowHours(w, offset));
  }
  return (schedule.windows ?? [])
    .slice(0, 3)
    .map(normalizeWindow)
    .map((w) => shiftWindowHours(w, offset));
}

/** Whether a preset should follow EU DST (London) or US DST (New York). */
export function presetDstRegion(
  id: TradingSessionPreset,
): "none" | "eu" | "us" | "both" {
  if (id === "asia") return "none";
  if (id === "london") return "eu";
  if (id === "newyork") return "us";
  return "both";
}

export function resolveAllowedDays(schedule: TradingScheduleConfig | undefined): number[] {
  const days = schedule?.allowedDays?.length ? schedule.allowedDays : DEFAULT_ALLOWED_DAYS;
  return [...new Set(days.filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b);
}

export function isTradingScheduleActive(schedule: TradingScheduleConfig | undefined): boolean {
  if (!schedule?.enabled || schedule.mode === "all") return false;
  return resolveTradingWindows(schedule).length > 0;
}

/** Pure check used by verify tests (mirrors MQL5 logic). */
export function isWithinTradingWindows(
  minuteOfDay: number,
  dayOfWeek: number,
  windows: TradingTimeWindow[],
  allowedDays: number[],
): boolean {
  if (allowedDays.length && !allowedDays.includes(dayOfWeek)) return false;
  if (!windows.length) return true;
  const m = clampMinute(minuteOfDay);
  return windows.some((w) => {
    const s = clampMinute(w.startMin);
    const e = clampMinute(w.endMin);
    if (s === e) return true; // full day
    if (s < e) return m >= s && m < e;
    return m >= s || m < e; // wraps midnight
  });
}

export function tradingScheduleFromSessionFilter(
  sessionFilter: string[] | undefined | null,
): TradingScheduleConfig | undefined {
  if (!sessionFilter?.length) return undefined;
  const sessions = [
    ...new Set(
      sessionFilter.map(normalizeSessionPreset).filter((s): s is TradingSessionPreset => Boolean(s)),
    ),
  ];
  if (!sessions.length) return undefined;
  return {
    ...defaultTradingSchedule(),
    enabled: true,
    mode: "presets",
    sessions,
  };
}

/** Deterministic extract from trader prompt / strategy notes (interview repair). */
export function extractTradingScheduleFromText(text: string): TradingScheduleConfig | undefined {
  const t = text.toLowerCase();
  if (!t.trim()) return undefined;

  const wantsAllDay =
    /\b(all\s*day|any\s*session|24\s*\/?\s*7|no\s*session\s*filter|trade\s*all\s*sessions)\b/.test(
      t,
    );
  if (wantsAllDay) return undefined;

  const sessions: TradingSessionPreset[] = [];
  if (/\b(asia|asian|tokyo)\b/.test(t)) sessions.push("asia");
  if (/\b(london|ldn)\b/.test(t) && !/\boverlap\b/.test(t)) sessions.push("london");
  if (/\b(new\s*york|newyork|ny\s*session|nyc)\b/.test(t) && !/\boverlap\b/.test(t))
    sessions.push("newyork");
  if (/\b(london[\s-]*ny|ldn[\s-]*ny|overlap)\b/.test(t)) sessions.push("london_ny_overlap");

  // Custom HH:MM–HH:MM (first window only; presets win if both present)
  const winMatch = t.match(
    /\b(?:from|between|only|trade)?\s*(\d{1,2}):(\d{2})\s*(?:-|–|to|until)\s*(\d{1,2}):(\d{2})\b/,
  );

  if (sessions.length) {
    return {
      ...defaultTradingSchedule(),
      enabled: true,
      mode: "presets",
      sessions: [...new Set(sessions)],
    };
  }

  if (winMatch) {
    const startMin = hhmmToMinutes(`${winMatch[1]}:${winMatch[2]}`);
    const endMin = hhmmToMinutes(`${winMatch[3]}:${winMatch[4]}`);
    return {
      ...defaultTradingSchedule(),
      enabled: true,
      mode: "custom_windows",
      windows: [{ startMin, endMin }],
    };
  }

  if (/\b(session\s*filter|trading\s*hours|only\s*during\s*session)\b/.test(t)) {
    return {
      ...defaultTradingSchedule(),
      enabled: true,
      mode: "presets",
      sessions: ["london"],
    };
  }

  return undefined;
}

export function sanitizeTradingSchedule(
  raw: Partial<TradingScheduleConfig> | undefined | null,
): TradingScheduleConfig | undefined {
  if (!raw || raw.enabled !== true) return undefined;
  const sessions = [
    ...new Set(
      (raw.sessions ?? [])
        .map((s) => normalizeSessionPreset(String(s)))
        .filter((s): s is TradingSessionPreset => Boolean(s)),
    ),
  ];
  const windows = (raw.windows ?? [])
    .map((w) => normalizeWindow({ startMin: Number(w.startMin), endMin: Number(w.endMin) }))
    .filter((w) => Number.isFinite(w.startMin) && Number.isFinite(w.endMin))
    .slice(0, 3);
  if (raw.mode === "custom_windows" && windows.length) {
    return {
      ...defaultTradingSchedule(),
      enabled: true,
      mode: "custom_windows",
      windows,
      allowedDays: resolveAllowedDays(raw as TradingScheduleConfig),
      outsideWindow: { ...DEFAULT_OUTSIDE_WINDOW, ...raw.outsideWindow },
      brokerOffsetHours: clampBrokerOffsetHours(raw.brokerOffsetHours),
      dstMode: normalizeDstMode(raw.dstMode),
    };
  }
  if (sessions.length || raw.mode === "presets") {
    return {
      ...defaultTradingSchedule(),
      enabled: true,
      mode: "presets",
      sessions: sessions.length ? sessions : ["london"],
      allowedDays: resolveAllowedDays(raw as TradingScheduleConfig),
      outsideWindow: { ...DEFAULT_OUTSIDE_WINDOW, ...raw.outsideWindow },
      brokerOffsetHours: clampBrokerOffsetHours(raw.brokerOffsetHours),
      dstMode: normalizeDstMode(raw.dstMode),
    };
  }
  return undefined;
}

export function mergeTradingSchedule(
  existing: TradingScheduleConfig | undefined,
  extracted: TradingScheduleConfig | undefined,
): TradingScheduleConfig | undefined {
  if (!extracted) return existing;
  if (!existing?.enabled) return extracted;
  // Keep explicit user/AI schedule if already on
  return existing;
}

export type SetTimeFilterResult = {
  blueprint: StrategyBlueprint;
  changed: boolean;
  notes: string[];
  schedule: TradingScheduleConfig;
};

export function applySetTimeFilter(
  bp: StrategyBlueprint,
  patch: SetTimeFilterPatch,
): SetTimeFilterResult {
  const notes: string[] = [];
  const prev = bp.fourBrain?.management?.tradingSchedule ?? defaultTradingSchedule();
  let next: TradingScheduleConfig = {
    ...defaultTradingSchedule(),
    ...prev,
    outsideWindow: { ...DEFAULT_OUTSIDE_WINDOW, ...prev.outsideWindow },
  };

  if (patch.enabled === false) {
    next = { ...defaultTradingSchedule(), enabled: false, mode: "all" };
    notes.push("Trading schedule disabled (all day)");
  } else {
    next.enabled = true;
    if (patch.cancelPendingOrders !== undefined) {
      next.outsideWindow = {
        ...DEFAULT_OUTSIDE_WINDOW,
        ...next.outsideWindow,
        cancelPendingOrders: patch.cancelPendingOrders,
      };
      notes.push(
        patch.cancelPendingOrders
          ? "Cancel pending orders outside session"
          : "Keep pending orders outside session",
      );
    }
    if (patch.closeOpenPositions !== undefined) {
      next.outsideWindow = {
        ...DEFAULT_OUTSIDE_WINDOW,
        ...next.outsideWindow,
        closeOpenPositions: patch.closeOpenPositions,
      };
      notes.push(
        patch.closeOpenPositions
          ? "Close open positions outside session"
          : "Keep managing open positions outside session",
      );
    }
    if (patch.brokerOffsetHours !== undefined) {
      next.brokerOffsetHours = clampBrokerOffsetHours(patch.brokerOffsetHours);
      notes.push(`Broker offset: ${next.brokerOffsetHours}h`);
    }
    if (patch.dstMode !== undefined) {
      next.dstMode = normalizeDstMode(patch.dstMode);
      notes.push(
        next.dstMode === "eu_us_approx"
          ? "DST adjust on (EU/US approx)"
          : "DST adjust off",
      );
    }
    if (patch.days?.length) {
      next.allowedDays = [...new Set(patch.days.filter((d) => d >= 0 && d <= 6))].sort(
        (a, b) => a - b,
      );
      notes.push(`Allowed days: ${next.allowedDays.join(",")}`);
    }

    const sessions = (patch.sessions ?? [])
      .map(normalizeSessionPreset)
      .filter((s): s is TradingSessionPreset => Boolean(s));
    const windows = (patch.windows ?? [])
      .map((w) => {
        if (typeof w.startMin === "number" && typeof w.endMin === "number") {
          return normalizeWindow({ startMin: w.startMin, endMin: w.endMin });
        }
        if (typeof w.start === "string" && typeof w.end === "string") {
          return normalizeWindow({
            startMin: hhmmToMinutes(w.start),
            endMin: hhmmToMinutes(w.end),
          });
        }
        return null;
      })
      .filter((w): w is TradingTimeWindow => Boolean(w))
      .slice(0, 3);

    const mode =
      patch.mode ??
      (windows.length ? "custom_windows" : sessions.length ? "presets" : next.mode === "all" ? "presets" : next.mode);

    if (mode === "custom_windows" && windows.length) {
      next.mode = "custom_windows";
      next.windows = windows;
      next.sessions = [];
      notes.push(
        `Custom windows: ${windows.map((w) => `${minutesToHHMM(w.startMin)}–${minutesToHHMM(w.endMin)}`).join(", ")}`,
      );
    } else if (sessions.length || mode === "presets") {
      next.mode = "presets";
      next.sessions = sessions.length ? sessions : next.sessions?.length ? next.sessions : ["london"];
      next.windows = [];
      notes.push(`Sessions: ${next.sessions.map((s) => SESSION_PRESET_LABELS[s]).join(", ")}`);
    } else if (patch.enabled === true && !isTradingScheduleActive(next)) {
      next.mode = "presets";
      next.sessions = ["london"];
      notes.push("Enabled London session (default)");
    }
  }

  const mgmt = {
    ...(bp.fourBrain?.management ?? {}),
    tradingSchedule: next,
  };
  let blueprint: StrategyBlueprint = {
    ...bp,
    fourBrain: bp.fourBrain
      ? { ...bp.fourBrain, management: mgmt }
      : bp.fourBrain,
  };
  if (blueprint.strategyFlow) {
    blueprint = {
      ...blueprint,
      strategyFlow: { ...blueprint.strategyFlow, management: mgmt },
    };
  }
  if (Array.isArray(blueprint.execution?.sessionFilter) || next.enabled) {
    const labels =
      next.enabled && next.mode === "presets"
        ? (next.sessions ?? []).map((s) => (s === "newyork" ? "new_york" : s))
        : [];
    blueprint = {
      ...blueprint,
      execution: {
        ...blueprint.execution,
        sessionFilter: labels,
      },
    };
  }

  const prevKey = JSON.stringify(prev);
  const nextKey = JSON.stringify(next);
  const changed = prevKey !== nextKey;
  if (!changed && !notes.length) notes.push("Trading schedule already matches");

  return { blueprint, changed, notes, schedule: next };
}

/**
 * Emit MQL5 inputs + helpers for the schedule.
 * When inactive, returns empty strings (no inputs / always allow).
 * Phase 3: broker offset + optional EU/US DST summer tables for session presets.
 */
export function emitTradingScheduleMql5(schedule: TradingScheduleConfig | undefined): {
  inputs: string;
  helpers: string;
  entryGate: string;
  panelLine: string;
  onTickHook: string;
} {
  if (!isTradingScheduleActive(schedule)) {
    return {
      inputs: "",
      helpers: "",
      entryGate: "",
      panelLine: `   s += "Session: all day (broker)\\n";`,
      onTickHook: "",
    };
  }

  const offset = clampBrokerOffsetHours(schedule!.brokerOffsetHours ?? 0);
  const dstOn = schedule!.dstMode === "eu_us_approx" && schedule!.mode === "presets";
  const days = resolveAllowedDays(schedule);
  const dayMask = days.reduce((acc, d) => acc | (1 << d), 0);
  const cancelPending = schedule?.outsideWindow?.cancelPendingOrders === true;
  const closePositions = schedule?.outsideWindow?.closeOpenPositions === true;

  type WinEmit = {
    winter: TradingTimeWindow;
    summer: TradingTimeWindow;
    dstRegion: 0 | 1 | 2 | 3; // none | eu | us | both
  };

  const wins: WinEmit[] = [];
  if (schedule!.mode === "presets") {
    for (const id of schedule!.sessions ?? []) {
      const winter = normalizeWindow(SESSION_PRESET_WINDOWS[id]);
      const summer = normalizeWindow(SESSION_PRESET_WINDOWS_SUMMER[id]);
      const region = presetDstRegion(id);
      wins.push({
        winter,
        summer,
        dstRegion: region === "none" ? 0 : region === "eu" ? 1 : region === "us" ? 2 : 3,
      });
    }
  } else {
    for (const w of (schedule!.windows ?? []).slice(0, 3).map(normalizeWindow)) {
      wins.push({ winter: w, summer: w, dstRegion: 0 });
    }
  }
  const windows = wins.slice(0, 3);
  if (!windows.length) {
    return {
      inputs: "",
      helpers: "",
      entryGate: "",
      panelLine: `   s += "Session: all day (broker)\\n";`,
      onTickHook: "",
    };
  }

  const winInputs = windows
    .map((w, i) => {
      const n = i + 1;
      const wh = Math.floor(w.winter.startMin / 60);
      const wm = w.winter.startMin % 60;
      const eh = Math.floor(w.winter.endMin / 60);
      const em = w.winter.endMin % 60;
      const sh = Math.floor(w.summer.startMin / 60);
      const sm = w.summer.startMin % 60;
      const seh = Math.floor(w.summer.endMin / 60);
      const sem = w.summer.endMin % 60;
      const summerBlock = dstOn
        ? `
input int  InpWin${n}SumStartH = ${sh};  // Window ${n} summer start hour
input int  InpWin${n}SumStartM = ${sm};  // Window ${n} summer start minute
input int  InpWin${n}SumEndH   = ${seh};  // Window ${n} summer end hour
input int  InpWin${n}SumEndM   = ${sem};  // Window ${n} summer end minute
input int  InpWin${n}DstRegion = ${w.dstRegion};  // 0=none 1=EU 2=US 3=both`
        : "";
      return `input bool InpWin${n}Enable = true;  // Window ${n} on
input int  InpWin${n}StartH = ${wh};  // Window ${n} start hour (broker, winter/base)
input int  InpWin${n}StartM = ${wm};  // Window ${n} start minute
input int  InpWin${n}EndH   = ${eh};  // Window ${n} end hour (exclusive)
input int  InpWin${n}EndM   = ${em};  // Window ${n} end minute${summerBlock}`;
    })
    .join("\n");

  const dstHelpers = dstOn
    ? `
bool Session_IsLastSunday(int year, int month, int day)
{
   MqlDateTime dt;
   dt.year = year; dt.mon = month; dt.day = day; dt.hour = 12; dt.min = 0; dt.sec = 0;
   datetime t = StructToTime(dt);
   TimeToStruct(t, dt);
   if(dt.day_of_week != 0) return false;
   MqlDateTime nxt = dt;
   nxt.day = day + 7;
   datetime t2 = StructToTime(nxt);
   MqlDateTime n2; TimeToStruct(t2, n2);
   return n2.mon != month;
}

bool Session_IsNthSunday(int year, int month, int day, int n)
{
   MqlDateTime dt;
   dt.year = year; dt.mon = month; dt.day = day; dt.hour = 12; dt.min = 0; dt.sec = 0;
   datetime t = StructToTime(dt);
   TimeToStruct(t, dt);
   if(dt.day_of_week != 0) return false;
   int sundayIndex = 1 + (day - 1) / 7;
   return sundayIndex == n;
}

bool Session_IsEuDst(datetime t)
{
   MqlDateTime dt; TimeToStruct(t, dt);
   if(dt.mon > 3 && dt.mon < 10) return true;
   if(dt.mon < 3 || dt.mon > 10) return false;
   if(dt.mon == 3) {
      // From last Sunday of March
      for(int d = dt.day; d >= 1; d--) {
         if(Session_IsLastSunday(dt.year, 3, d)) return dt.day >= d;
      }
      return false;
   }
   // October: until last Sunday
   for(int d = 31; d >= 1; d--) {
      if(Session_IsLastSunday(dt.year, 10, d)) return dt.day < d;
   }
   return false;
}

bool Session_IsUsDst(datetime t)
{
   MqlDateTime dt; TimeToStruct(t, dt);
   if(dt.mon > 3 && dt.mon < 11) return true;
   if(dt.mon < 3 || dt.mon > 11) return false;
   if(dt.mon == 3) {
      for(int d = 1; d <= 14; d++) {
         if(Session_IsNthSunday(dt.year, 3, d, 2)) return dt.day >= d;
      }
      return false;
   }
   // November: until first Sunday
   for(int d = 1; d <= 7; d++) {
      if(Session_IsNthSunday(dt.year, 11, d, 1)) return dt.day < d;
   }
   return false;
}

bool Session_UseSummer(int region, datetime t)
{
   if(region <= 0) return false;
   if(region == 1) return Session_IsEuDst(t);
   if(region == 2) return Session_IsUsDst(t);
   return Session_IsEuDst(t) || Session_IsUsDst(t);
}
`
    : "";

  const checkWins = windows
    .map((_, i) => {
      const n = i + 1;
      if (dstOn) {
        return `   if(InpWin${n}Enable) {
      bool summer = InpDstAdjust && Session_UseSummer(InpWin${n}DstRegion, TimeCurrent());
      int s = summer ? (InpWin${n}SumStartH * 60 + InpWin${n}SumStartM)
                     : (InpWin${n}StartH * 60 + InpWin${n}StartM);
      int e = summer ? (InpWin${n}SumEndH * 60 + InpWin${n}SumEndM)
                     : (InpWin${n}EndH * 60 + InpWin${n}EndM);
      s = (s + off) % 1440; if(s < 0) s += 1440;
      e = (e + off) % 1440; if(e < 0) e += 1440;
      if(s == e) return true;
      if(s < e) { if(mins >= s && mins < e) return true; }
      else { if(mins >= s || mins < e) return true; }
   }`;
      }
      return `   if(InpWin${n}Enable) {
      int s = (InpWin${n}StartH * 60 + InpWin${n}StartM + off) % 1440; if(s < 0) s += 1440;
      int e = (InpWin${n}EndH * 60 + InpWin${n}EndM + off) % 1440; if(e < 0) e += 1440;
      if(s == e) return true;
      if(s < e) { if(mins >= s && mins < e) return true; }
      else { if(mins >= s || mins < e) return true; }
   }`;
    })
    .join("\n");

  const maintenanceHelpers =
    cancelPending || closePositions
      ? `
void SessionOutsideMaintenance()
{
   if(IsTradingTime()) return;
${
  cancelPending
    ? `   if(InpCancelPendingOutside) {
      for(int i = OrdersTotal() - 1; i >= 0; i--) {
         ulong ticket = OrderGetTicket(i);
         if(ticket == 0) continue;
         if(!OrderSelect(ticket)) continue;
         if(OrderGetString(ORDER_SYMBOL) != InpSymbol) continue;
         if((long)OrderGetInteger(ORDER_MAGIC) != InpMagic) continue;
         long type = OrderGetInteger(ORDER_TYPE);
         if(type != ORDER_TYPE_BUY_LIMIT && type != ORDER_TYPE_SELL_LIMIT
            && type != ORDER_TYPE_BUY_STOP && type != ORDER_TYPE_SELL_STOP
            && type != ORDER_TYPE_BUY_STOP_LIMIT && type != ORDER_TYPE_SELL_STOP_LIMIT) continue;
         if(!trade.OrderDelete(ticket) && InpAudit)
            PrintFormat("[SESSION] pending cancel failed ticket=%I64u err=%d", ticket, GetLastError());
         else if(InpAudit)
            PrintFormat("[SESSION] cancelled pending ticket=%I64u (outside session)", ticket);
      }
   }`
    : ""
}
${
  closePositions
    ? `   if(InpClosePositionsOutside) {
      for(int i = PositionsTotal() - 1; i >= 0; i--) {
         ulong tk = PositionGetTicket(i);
         if(tk == 0 || !PositionSelectByTicket(tk)) continue;
         if(PositionGetString(POSITION_SYMBOL) != InpSymbol) continue;
         if(PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
         if(!trade.PositionClose(tk) && InpAudit)
            PrintFormat("[SESSION] position close failed ticket=%I64u err=%d", tk, GetLastError());
         else if(InpAudit)
            PrintFormat("[SESSION] closed position ticket=%I64u (outside session)", tk);
      }
   }`
    : ""
}
}
`
      : "";

  const extras: string[] = [];
  if (offset !== 0) extras.push(`offset ${offset > 0 ? "+" : ""}${offset}h`);
  if (dstOn) extras.push("DST approx");
  if (cancelPending) extras.push("cancel pendings");
  if (closePositions) extras.push("close positions");
  const panelExtra = extras.length ? `, ${extras.join(", ")}` : "";

  return {
    inputs: `input bool InpUseSessionFilter = true;  // TIME_SESSION_FILTER (broker server time)
input int  InpAllowedDaysMask = ${dayMask};  // bit0=Sun … bit6=Sat (default Mon–Fri)
input int  InpBrokerOffsetHours = ${offset};  // hours added to window tables (align to broker)
input bool InpDstAdjust = ${dstOn ? "true" : "false"};  // EU/US DST summer tables for London/NY
input bool InpCancelPendingOutside = ${cancelPending ? "true" : "false"};  // cancel pendings outside session
input bool InpClosePositionsOutside = ${closePositions ? "true" : "false"};  // close positions outside session
${winInputs}`,
    helpers: `
${dstHelpers}bool IsTradingDay()
{
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   int bit = 1 << dt.day_of_week;
   if(InpAllowedDaysMask == 0) return true;
   return (InpAllowedDaysMask & bit) != 0;
}

bool IsTradingTime()
{
   if(!InpUseSessionFilter) return true;
   if(!IsTradingDay()) return false;
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   int mins = dt.hour * 60 + dt.min;
   int off = InpBrokerOffsetHours * 60;
${checkWins}
   return false;
}
${maintenanceHelpers}`,
    entryGate: `   if(!IsTradingTime()) {
      gLastGate = "BLOCKED: outside session";
      if(InpAudit) {
         MqlDateTime _sdt; TimeToStruct(TimeCurrent(), _sdt);
         PrintFormat("[GATE] BLOCKED: outside session (broker %02d:%02d dow=%d)",
            _sdt.hour, _sdt.min, _sdt.day_of_week);
      }
      return;
   }`,
    panelLine: `   s += "Session: FILTER on (broker${panelExtra})\\n";`,
    onTickHook:
      cancelPending || closePositions ? `   SessionOutsideMaintenance();` : "",
  };
}

/** Parse "YYYY.MM.DD HH:MM" (or similar) into minute-of-day, or null. */
export function parseBrokerMinuteFromTimestamp(time: string): number | null {
  const m = time.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*$/);
  if (!m) return null;
  const h = parseInt(m[1]!, 10);
  const mm = parseInt(m[2]!, 10);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

/** Which broker-hour session presets contain this minute (overlap-aware). */
export function classifyBrokerMinuteToSessions(minuteOfDay: number): TradingSessionPreset[] {
  const hits: TradingSessionPreset[] = [];
  for (const id of Object.keys(SESSION_PRESET_WINDOWS) as TradingSessionPreset[]) {
    const w = SESSION_PRESET_WINDOWS[id];
    if (isWithinTradingWindows(minuteOfDay, 1, [w], [0, 1, 2, 3, 4, 5, 6])) hits.push(id);
  }
  return hits;
}

export type SessionBreakdownCounts = Record<TradingSessionPreset | "other", number>;

export function emptySessionBreakdown(): SessionBreakdownCounts {
  return { asia: 0, london: 0, newyork: 0, london_ny_overlap: 0, other: 0 };
}

/** Bucket trade entry timestamps into broker-hour session presets (Phase 3 audit). */
export function buildSessionBreakdownFromTimes(times: string[]): SessionBreakdownCounts {
  const counts = emptySessionBreakdown();
  for (const t of times) {
    const mins = parseBrokerMinuteFromTimestamp(t);
    if (mins === null) {
      counts.other += 1;
      continue;
    }
    const hits = classifyBrokerMinuteToSessions(mins);
    if (!hits.length) {
      counts.other += 1;
      continue;
    }
    // Count once under the most specific label when overlap is present
    if (hits.includes("london_ny_overlap")) counts.london_ny_overlap += 1;
    else if (hits.length === 1) counts[hits[0]!] += 1;
    else {
      // Multi-hit without overlap id: prefer London then NY then Asia
      if (hits.includes("london")) counts.london += 1;
      else if (hits.includes("newyork")) counts.newyork += 1;
      else counts[hits[0]!] += 1;
    }
  }
  return counts;
}

/** Optional assistant hint when many entries fall outside configured sessions. */
export function suggestScheduleFromBreakdown(
  breakdown: SessionBreakdownCounts,
  configured?: TradingScheduleConfig,
): string | null {
  const total =
    breakdown.asia +
    breakdown.london +
    breakdown.newyork +
    breakdown.london_ny_overlap +
    breakdown.other;
  if (total < 3) return null;

  const ranked = (
    Object.entries(breakdown) as Array<[keyof SessionBreakdownCounts, number]>
  )
    .filter(([k, n]) => k !== "other" && n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;

  const top = ranked[0]!;
  if (top[1] / total < 0.4) return null;

  const configuredSessions = configured?.enabled
    ? configured.mode === "presets"
      ? configured.sessions ?? []
      : []
    : [];
  if (configuredSessions.includes(top[0] as TradingSessionPreset)) return null;

  return `Most entries cluster in ${SESSION_PRESET_LABELS[top[0] as TradingSessionPreset]} (${top[1]}/${total}). Consider setting Trading Schedule to that session (Apply set_time_filter) if the strategy is session-specific.`;
}
