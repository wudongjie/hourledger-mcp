/**
 * HourLedger rule engine.
 *
 * All arithmetic is done in whole minutes; decimal hours only appear at the
 * output boundary so results round-trip exactly with h:mm display.
 */

export type TimeEntry = {
  date: string; // ISO yyyy-mm-dd; used to detect 7th-consecutive-day and workweek
  clockIn: string; // "HH:mm"
  clockOut: string; // "HH:mm"
  unpaidBreakMins: number;
};

export type Ruleset = "federal" | "california" | "alaska" | "colorado" | "nevada";

export type Rounding = "none" | "nearest_15" | "nearest_5" | "nearest_tenth";

export type CalcInput = {
  entries: TimeEntry[];
  hourlyRate: number;
  ruleset: Ruleset;
  workweekStart: number; // 0=Sun … defines the 7-day workweek boundary
  rounding: Rounding;
  options?: {
    /** Override Nevada daily-OT eligibility; defaults to hourlyRate < NV_DAILY_OT_RATE_CAP. */
    nvDailyOt?: boolean;
  };
};

export type DayResult = { date: string; regular: number; ot: number; dt: number };

export type CalcResult = {
  perDay: DayResult[];
  totals: { regular: number; ot: number; dt: number; hours: number };
  pay: { regular: number; ot: number; dt: number; gross: number };
};

const DAY = { reg: 8 * 60, dt: 12 * 60 } as const;
const WEEK_CAP = 40 * 60;

/**
 * Nevada pays daily overtime (past 8h/day) only to employees earning less than
 * 1.5× the state minimum wage — $12.00/h since July 2024, so the cap is $18.00/h
 * (NRS 608.018(1)). At or above it, only the weekly 40-hour rule applies.
 */
export const NV_DAILY_OT_RATE_CAP = 12 * 1.5;

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function roundMinutes(mins: number, rounding: Rounding): number {
  switch (rounding) {
    case "nearest_15":
      return Math.round(mins / 15) * 15;
    case "nearest_5":
      return Math.round(mins / 5) * 5;
    case "nearest_tenth":
      return Math.round(mins / 6) * 6; // 0.1h = 6 min
    default:
      return mins;
  }
}

/** Worked minutes for one entry: shift span (overnight wraps) minus unpaid break, then rounded. */
export function entryMinutes(entry: TimeEntry, rounding: Rounding): number {
  const inM = timeToMinutes(entry.clockIn);
  const outM = timeToMinutes(entry.clockOut);
  let span = outM - inM;
  if (span < 0) span += 24 * 60; // overnight shift
  const worked = Math.max(0, span - (entry.unpaidBreakMins || 0));
  return roundMinutes(worked, rounding);
}

/** Days since epoch for an ISO date (UTC, immune to local DST). */
function dayIndex(isoDate: string): number {
  return Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 86_400_000);
}

/** Epoch day 0 (1970-01-01) was a Thursday. 0=Sun…6=Sat. */
function dayOfWeek(idx: number): number {
  return (((idx + 4) % 7) + 7) % 7;
}

type DayMinutes = { date: string; idx: number; reg: number; ot: number; dt: number };

function classifyWeekFederal(days: DayMinutes[]): void {
  // No daily OT: hours past a cumulative 40 in the workweek become 1.5x.
  let cum = 0;
  for (const d of days) {
    const total = d.reg; // all minutes start in the regular bucket
    const regRoom = Math.max(0, WEEK_CAP - cum);
    d.reg = Math.min(total, regRoom);
    d.ot = total - d.reg;
    cum += total;
  }
}

/**
 * Daily threshold then weekly 40: hours past `dailyCapMins` in a day are 1.5×,
 * and the weekly rule pulls only from the remaining regular pool (no pyramiding).
 * Covers Alaska (8h/day), Colorado (12h/day), and Nevada-qualified (8h/day) —
 * none of which have double time.
 */
function classifyWeekDailyThenWeekly(days: DayMinutes[], dailyCapMins: number): void {
  for (const d of days) {
    const total = d.reg;
    d.reg = Math.min(total, dailyCapMins);
    d.ot = total - d.reg;
  }
  let excess = days.reduce((sum, d) => sum + d.reg, 0) - WEEK_CAP;
  for (let i = days.length - 1; i >= 0 && excess > 0; i--) {
    const move = Math.min(days[i].reg, excess);
    days[i].reg -= move;
    days[i].ot += move;
    excess -= move;
  }
}

function classifyWeekCalifornia(days: DayMinutes[]): void {
  // 1+2. Daily thresholds, with the 7th-consecutive-day override.
  const isSeventhDayWeek = days.length === 7; // worked every day of this workweek
  days.forEach((d, i) => {
    const total = d.reg;
    if (isSeventhDayWeek && i === 6) {
      d.reg = 0;
      d.ot = Math.min(total, DAY.reg);
      d.dt = Math.max(0, total - DAY.reg);
    } else {
      d.reg = Math.min(total, DAY.reg);
      d.ot = Math.min(Math.max(0, total - DAY.reg), DAY.dt - DAY.reg);
      d.dt = Math.max(0, total - DAY.dt);
    }
  });

  // 3+4. Weekly 40-hour rule pulls only from the regular pool (no pyramiding).
  let excess = days.reduce((sum, d) => sum + d.reg, 0) - WEEK_CAP;
  for (let i = days.length - 1; i >= 0 && excess > 0; i--) {
    const move = Math.min(days[i].reg, excess);
    days[i].reg -= move;
    days[i].ot += move;
    excess -= move;
  }
}

export function calculate(input: CalcInput): CalcResult {
  // Aggregate worked minutes per calendar date (multiple entries per day allowed).
  const byDate = new Map<string, number>();
  for (const entry of input.entries) {
    const mins = entryMinutes(entry, input.rounding);
    if (mins <= 0) continue; // a zero-minute day is not a worked day
    byDate.set(entry.date, (byDate.get(entry.date) ?? 0) + mins);
  }

  // Group worked days into workweeks anchored on workweekStart.
  const weeks = new Map<number, DayMinutes[]>();
  for (const [date, mins] of byDate) {
    const idx = dayIndex(date);
    const offset = (((dayOfWeek(idx) - input.workweekStart) % 7) + 7) % 7;
    const weekKey = idx - offset;
    const week = weeks.get(weekKey) ?? [];
    week.push({ date, idx, reg: mins, ot: 0, dt: 0 });
    weeks.set(weekKey, week);
  }

  const nvDailyOt = input.options?.nvDailyOt ?? input.hourlyRate < NV_DAILY_OT_RATE_CAP;

  const perDayMins: DayMinutes[] = [];
  for (const days of weeks.values()) {
    days.sort((a, b) => a.idx - b.idx);
    switch (input.ruleset) {
      case "california":
        classifyWeekCalifornia(days);
        break;
      case "alaska":
        classifyWeekDailyThenWeekly(days, DAY.reg);
        break;
      case "colorado":
        classifyWeekDailyThenWeekly(days, DAY.dt); // 12h/day, 1.5× (no double time)
        break;
      case "nevada":
        if (nvDailyOt) classifyWeekDailyThenWeekly(days, DAY.reg);
        else classifyWeekFederal(days);
        break;
      default:
        classifyWeekFederal(days);
    }
    perDayMins.push(...days);
  }
  perDayMins.sort((a, b) => a.idx - b.idx);

  const totalMins = perDayMins.reduce(
    (acc, d) => ({ reg: acc.reg + d.reg, ot: acc.ot + d.ot, dt: acc.dt + d.dt }),
    { reg: 0, ot: 0, dt: 0 }
  );

  const regular = totalMins.reg / 60;
  const ot = totalMins.ot / 60;
  const dt = totalMins.dt / 60;
  const rate = input.hourlyRate;

  return {
    perDay: perDayMins.map((d) => ({
      date: d.date,
      regular: d.reg / 60,
      ot: d.ot / 60,
      dt: d.dt / 60,
    })),
    totals: { regular, ot, dt, hours: regular + ot + dt },
    pay: {
      regular: regular * rate,
      ot: ot * rate * 1.5,
      dt: dt * rate * 2,
      gross: regular * rate + ot * rate * 1.5 + dt * rate * 2,
    },
  };
}
