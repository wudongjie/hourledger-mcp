# hourledger-mcp

An [MCP](https://modelcontextprotocol.io) server that calculates **work hours, overtime, and gross pay** — wrapping the same tested rules engine that powers [HourLedger](https://hourledger.com), a suite of free, no-sign-up work-hours calculators.

## Tools

### `calculate_work_hours`

Takes clock in/out entries (with unpaid breaks), an hourly rate, and a ruleset; returns the per-day and total regular / overtime / double-time split plus gross pay.

Supported rulesets, each covered by the automated test suite:

| Ruleset | Rule |
| --- | --- |
| `federal` | 1.5× past 40 h/week ([FLSA](https://www.dol.gov/agencies/whd/overtime)) |
| `california` | 1.5× past 8 h/day, 2× past 12 h/day, 7th-day rule, no pyramiding ([Labor Code §510](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=LAB&sectionNum=510.)) |
| `alaska` | 1.5× past 8 h/day or 40 h/week (AS 23.10.060) |
| `colorado` | 1.5× past 12 h/day or 40 h/week (COMPS Order) |
| `nevada` | daily 8 h rule only below 1.5× minimum wage — applied automatically from the rate (NRS 608.018) |

Handles overnight shifts, per-entry rounding policies (exact / 5 min / 15 min / 0.1 h), and configurable workweek start day.

### `time_and_a_half`

Quick 1.5× rate and overtime-pay calculation from a rate and OT hours.

## Setup

### Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "hourledger": {
      "command": "npx",
      "args": ["-y", "hourledger-mcp"]
    }
  }
}
```

Or with Claude Code: `claude mcp add hourledger -- npx -y hourledger-mcp`

## Example

> "How much do I make this week? I worked Monday to Thursday 7am–5pm at $19/hour in Nevada."

The model calls `calculate_work_hours` with the four 10-hour entries and gets back the correct Nevada answer ($19 ≥ $18 cutoff → weekly rule only → 40 regular hours, no OT), with day-by-day detail.

## Interactive calculators

Prefer a UI? Every ruleset has a free, no-sign-up calculator at **[hourledger.com](https://hourledger.com)**:

- [Work hours & overtime](https://hourledger.com) · [Overtime](https://hourledger.com/overtime-calculator) · [Time and a half](https://hourledger.com/time-and-a-half-calculator)
- [California](https://hourledger.com/california-overtime-calculator) · [Alaska](https://hourledger.com/alaska-overtime-calculator) · [Colorado](https://hourledger.com/colorado-overtime-calculator) · [Nevada](https://hourledger.com/nevada-overtime-calculator)
- [Embed a calculator on your own site](https://hourledger.com/embed)

## Disclaimer

General information, not legal or payroll advice. Exemptions and local rules vary — verify disputed pay with your state labor agency or a qualified professional.

## Development

The pay-rules engine (`src/engine.ts` + its 27 tests) is mirrored from the HourLedger site project, where rule changes land first. `npm test` runs the full suite; `prepublishOnly` enforces tests + build before any publish.

## License

MIT
