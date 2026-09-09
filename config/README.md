# config/

## funnel-targets.json

Targets for `/api/funnel` (Business Health Funnel). JSON has no comments, so the explanation
lives here.

**What it is.** The funnel already grades itself against the account's own history
(`meta.benchmark` = the previous period of the same length). Targets are the *other* half:
the number the business wants to hit, independent of what it did last period. The API reads
this file and returns it as `targets`; the frontend decides how to render it.

**How it is read.**

- `master` → the target block for the master funnel (`?campaign=master`).
- `umbrellas.<key>` → the target block for one umbrella view (`?campaign=turkey`, …).
  Valid keys are the 14 umbrella slugs: `turkey`, `dalmatincki`, `asset`, `bofu`, `croatia`,
  `earlybook`, `brand`, `pmax`, `clg`, `smarter`, `dobrik`, `youtube`, `matchmaker`, `boost`.
- Every field is `null` by default. A block where **every** field is null comes back as
  `targets: null`, exactly like before this file existed — so nothing changes for the
  frontend until real numbers are filled in.
- `meta.targetsSource` in the response says where the targets came from
  (`"config/funnel-targets.json"`).

**Fields** (all optional, all `null` = "do not grade this"):

| field            | unit                                            |
| ---------------- | ----------------------------------------------- |
| `spend`          | EUR for the whole window                        |
| `leads`          | count for the whole window                      |
| `qualityLeads`   | count for the whole window (Streak AI ≥ 50)     |
| `bookings`       | count for the whole window                      |
| `revenue`        | EUR RVC for the whole window                    |
| `cpl`            | EUR per lead                                    |
| `cpql`           | EUR per quality lead                            |
| `costPerBooking` | EUR per booking                                 |
| `roas`           | revenue ÷ spend, e.g. `3.5`                     |

**Careful with the window.** Volume targets (`spend`, `leads`, `qualityLeads`, `bookings`,
`revenue`) are absolute numbers, so they only make sense against one window length. Ratio
targets (`cpl`, `cpql`, `costPerBooking`, `roas`) are window-independent and are the safer
ones to fill in first.

**Changing values.** The file is imported at build time, so a new value goes live with the
next `vercel --prod --yes`. It is intentionally in git — targets are a decision, and the
history of that decision is worth keeping.
