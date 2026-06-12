import { describe, expect, it } from "vitest";
import { calculate, entryMinutes, type CalcInput, type TimeEntry } from "./engine";
import { hmmToHours, hoursToHmm } from "./format";

/** A shift starting at midnight lasting `hours`, optionally with an unpaid break. */
function day(date: string, hours: number, breakMins = 0): TimeEntry {
  const spanMins = hours * 60 + breakMins;
  const h = String(Math.floor(spanMins / 60)).padStart(2, "0");
  const m = String(spanMins % 60).padStart(2, "0");
  return { date, clockIn: "00:00", clockOut: `${h}:${m}`, unpaidBreakMins: breakMins };
}

// 2026-01-04 is a Sunday; Mon–Fri are 01-05 … 01-09, Sat is 01-10.
const MON_FRI = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"];
const SUN_SAT = ["2026-01-04", ...MON_FRI, "2026-01-10"];

function run(entries: TimeEntry[], ruleset: CalcInput["ruleset"], rate = 20) {
  return calculate({ entries, hourlyRate: rate, ruleset, workweekStart: 0, rounding: "none" });
}

function expectHours(
  result: ReturnType<typeof calculate>,
  regular: number,
  ot: number,
  dt: number
) {
  expect(result.totals.regular).toBe(regular);
  expect(result.totals.ot).toBe(ot);
  expect(result.totals.dt).toBe(dt);
  expect(result.totals.hours).toBe(regular + ot + dt);
}

describe("federal ruleset", () => {
  it("F1: 5 × 8h → 40 / 0 / 0", () => {
    expectHours(run(MON_FRI.map((d) => day(d, 8)), "federal"), 40, 0, 0);
  });

  it("F2: 5 × 9h → 40 / 5 / 0", () => {
    expectHours(run(MON_FRI.map((d) => day(d, 9)), "federal"), 40, 5, 0);
  });

  it("F3: 4 × 10h → 40 / 0 / 0 (no daily OT federally)", () => {
    expectHours(run(MON_FRI.slice(0, 4).map((d) => day(d, 10)), "federal"), 40, 0, 0);
  });

  it("F4: 6 × 8h → 40 / 8 / 0", () => {
    expectHours(run(SUN_SAT.slice(0, 6).map((d) => day(d, 8)), "federal"), 40, 8, 0);
  });

  it("F5: 5 × 8h spans with 30min unpaid breaks → 37.5 / 0 / 0", () => {
    expectHours(run(MON_FRI.map((d) => day(d, 7.5, 30)), "federal"), 37.5, 0, 0);
  });
});

describe("california ruleset", () => {
  it("C1: one 10h day → 8 / 2 / 0 (daily OT)", () => {
    expectHours(run([day(MON_FRI[0], 10)], "california"), 8, 2, 0);
  });

  it("C2: one 13h day → 8 / 4 / 1 (double time past 12)", () => {
    expectHours(run([day(MON_FRI[0], 13)], "california"), 8, 4, 1);
  });

  it("C3: 7 consecutive days × 8h → 40 / 16 / 0 (7th-day rule + weekly de-pyramid)", () => {
    const result = run(SUN_SAT.map((d) => day(d, 8)), "california");
    expectHours(result, 40, 16, 0);
    // Day 7 itself is entirely 1.5x under the 7th-consecutive-day rule.
    const seventh = result.perDay.find((d) => d.date === "2026-01-10")!;
    expect(seventh).toMatchObject({ regular: 0, ot: 8, dt: 0 });
  });

  it("C4: one 12h day → 8 / 4 / 0 (daily OT must not also trip weekly OT)", () => {
    expectHours(run([day(MON_FRI[0], 12)], "california"), 8, 4, 0);
  });

  it("C5: 5 × 9h → 40 / 5 / 0 (daily OT only; regular pool stays at 40)", () => {
    expectHours(run(MON_FRI.map((d) => day(d, 9)), "california"), 40, 5, 0);
  });
});

describe("alaska ruleset (1.5× past 8h/day or 40h/week, no double time)", () => {
  it("A1: one 10h day → 8 / 2 / 0 (daily OT)", () => {
    expectHours(run([day(MON_FRI[0], 10)], "alaska"), 8, 2, 0);
  });

  it("A2: 4 × 10h → 32 / 8 / 0 (daily OT where federal pays none)", () => {
    expectHours(run(MON_FRI.slice(0, 4).map((d) => day(d, 10)), "alaska"), 32, 8, 0);
  });

  it("A3: 6 × 10h → 40 / 20 / 0 (daily then weekly, no pyramiding)", () => {
    expectHours(run(SUN_SAT.slice(0, 6).map((d) => day(d, 10)), "alaska"), 40, 20, 0);
  });

  it("A4: one 13h day → 8 / 5 / 0 (no double time in Alaska)", () => {
    expectHours(run([day(MON_FRI[0], 13)], "alaska"), 8, 5, 0);
  });
});

describe("colorado ruleset (1.5× past 12h/day or 40h/week, no double time)", () => {
  it("CO1: one 13h day → 12 / 1 / 0", () => {
    expectHours(run([day(MON_FRI[0], 13)], "colorado"), 12, 1, 0);
  });

  it("CO2: 4 × 10h → 40 / 0 / 0 (under the 12h daily trigger)", () => {
    expectHours(run(MON_FRI.slice(0, 4).map((d) => day(d, 10)), "colorado"), 40, 0, 0);
  });

  it("CO3: 5 × 9h → 40 / 5 / 0 (weekly rule)", () => {
    expectHours(run(MON_FRI.map((d) => day(d, 9)), "colorado"), 40, 5, 0);
  });
});

describe("nevada ruleset (daily 8h only below 1.5× minimum wage)", () => {
  it("N1: 4 × 10h at $15/h (< $18 cap) → 32 / 8 / 0 (daily OT applies)", () => {
    expectHours(run(MON_FRI.slice(0, 4).map((d) => day(d, 10)), "nevada", 15), 32, 8, 0);
  });

  it("N2: 4 × 10h at $20/h (≥ $18 cap) → 40 / 0 / 0 (weekly only)", () => {
    expectHours(run(MON_FRI.slice(0, 4).map((d) => day(d, 10)), "nevada", 20), 40, 0, 0);
  });

  it("N3: explicit option overrides the rate-based default", () => {
    const result = calculate({
      entries: MON_FRI.slice(0, 4).map((d) => day(d, 10)),
      hourlyRate: 20,
      ruleset: "nevada",
      workweekStart: 0,
      rounding: "none",
      options: { nvDailyOt: true },
    });
    expect(result.totals.regular).toBe(32);
    expect(result.totals.ot).toBe(8);
  });

  it("N4: 5 × 9h at $20/h → 40 / 5 / 0 (weekly rule still applies)", () => {
    expectHours(run(MON_FRI.map((d) => day(d, 9)), "nevada", 20), 40, 5, 0);
  });
});

describe("biweekly entry (two separate workweeks)", () => {
  it("B1: 10 × 9h across two weeks → each week classified independently (80 / 10 / 0)", () => {
    const WEEK2 = ["2026-01-12", "2026-01-13", "2026-01-14", "2026-01-15", "2026-01-16"];
    const result = run([...MON_FRI, ...WEEK2].map((d) => day(d, 9)), "federal");
    expectHours(result, 80, 10, 0);
  });
});

describe("shared logic", () => {
  it("pays 1× / 1.5× / 2× of the hourly rate", () => {
    const result = run([day(MON_FRI[0], 13)], "california", 20); // 8 / 4 / 1
    expect(result.pay).toEqual({ regular: 160, ot: 120, dt: 40, gross: 320 });
  });

  it("handles overnight shifts across midnight", () => {
    const entry: TimeEntry = {
      date: "2026-01-05",
      clockIn: "22:00",
      clockOut: "06:00",
      unpaidBreakMins: 0,
    };
    expect(entryMinutes(entry, "none")).toBe(480);
  });

  it("rounds each entry before totaling", () => {
    const entry: TimeEntry = {
      date: "2026-01-05",
      clockIn: "09:00",
      clockOut: "17:07",
      unpaidBreakMins: 0,
    }; // 487 worked minutes
    expect(entryMinutes(entry, "none")).toBe(487);
    expect(entryMinutes(entry, "nearest_15")).toBe(480);
    expect(entryMinutes(entry, "nearest_5")).toBe(485);
    expect(entryMinutes(entry, "nearest_tenth")).toBe(486);
  });

  it("splits the workweek on the configured start day", () => {
    // Worked Sat + Sun. With a Sunday-start week they fall in different weeks
    // (no 7th-day or weekly accumulation); with a Saturday start, same week.
    const entries = [day("2026-01-10", 12), day("2026-01-11", 12)];
    const sundayStart = calculate({
      entries,
      hourlyRate: 10,
      ruleset: "federal",
      workweekStart: 0,
      rounding: "none",
    });
    expect(sundayStart.totals.ot).toBe(0);
    const saturdayStart = calculate({
      entries,
      hourlyRate: 10,
      ruleset: "federal",
      workweekStart: 6,
      rounding: "none",
    });
    expect(saturdayStart.totals.ot).toBe(0); // still under 40 — sanity: same week, 24h
    expect(saturdayStart.totals.regular).toBe(24);
  });

  it("decimal ↔ h:mm round-trips exactly", () => {
    expect(hoursToHmm(0.25)).toBe("0:15");
    expect(hmmToHours("0:15")).toBe(0.25);
    expect(hoursToHmm(37.5)).toBe("37:30");
    expect(hmmToHours("37:30")).toBe(37.5);
    for (const mins of [1, 5, 6, 15, 487, 2400]) {
      expect(hmmToHours(hoursToHmm(mins / 60))).toBe(mins / 60);
    }
  });
});
