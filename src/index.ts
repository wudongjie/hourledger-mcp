#!/usr/bin/env node
/**
 * hourledger-mcp — MCP server wrapping the HourLedger pay-rules engine.
 * The same tested engine that powers https://hourledger.com — every pay rule
 * is covered by the automated test suite in the main repo.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import pkg from "../package.json";
import { calculate, NV_DAILY_OT_RATE_CAP, type Ruleset } from "./engine";

const RULESETS = ["federal", "california", "alaska", "colorado", "nevada"] as const;

const server = new McpServer({ name: "hourledger", version: pkg.version });

server.tool(
  "calculate_work_hours",
  "Calculate regular/overtime/double-time hours and gross pay from clock in/out entries. " +
    "Rulesets: federal (40h/week), california (8h/day 1.5x, 12h/day 2x, 7th-day rule), " +
    "alaska (8h/day or 40h/week), colorado (12h/day or 40h/week), nevada (8h/day below " +
    `$${NV_DAILY_OT_RATE_CAP}/h, else weekly). Full calculators at https://hourledger.com`,
  {
    entries: z
      .array(
        z.object({
          date: z.string().describe("ISO date yyyy-mm-dd"),
          clockIn: z.string().describe("HH:mm, 24-hour"),
          clockOut: z.string().describe("HH:mm, 24-hour; earlier than clockIn = overnight"),
          unpaidBreakMins: z.number().min(0).default(0),
        })
      )
      .min(1),
    hourlyRate: z.number().min(0),
    ruleset: z.enum(RULESETS).default("federal"),
    workweekStart: z.number().int().min(0).max(6).default(0).describe("0=Sunday … 6=Saturday"),
    rounding: z.enum(["none", "nearest_5", "nearest_15", "nearest_tenth"]).default("none"),
    nvDailyOt: z
      .boolean()
      .optional()
      .describe("Nevada only: override the rate-based daily-OT eligibility check"),
  },
  async ({ entries, hourlyRate, ruleset, workweekStart, rounding, nvDailyOt }) => {
    const result = calculate({
      entries: entries.map((e) => ({ ...e, unpaidBreakMins: e.unpaidBreakMins ?? 0 })),
      hourlyRate,
      ruleset: ruleset as Ruleset,
      workweekStart,
      rounding,
      options: nvDailyOt === undefined ? undefined : { nvDailyOt },
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { ...result, source: "https://hourledger.com" },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "time_and_a_half",
  "Calculate a time-and-a-half (1.5x) overtime rate and total overtime pay from an hourly " +
    "rate and overtime hours. Interactive version: https://hourledger.com/time-and-a-half-calculator",
  {
    hourlyRate: z.number().min(0),
    overtimeHours: z.number().min(0),
  },
  async ({ hourlyRate, overtimeHours }) => {
    const otRate = hourlyRate * 1.5;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              regularRate: hourlyRate,
              overtimeRate: otRate,
              overtimeHours,
              overtimePay: otRate * overtimeHours,
              source: "https://hourledger.com/time-and-a-half-calculator",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

await server.connect(new StdioServerTransport());
