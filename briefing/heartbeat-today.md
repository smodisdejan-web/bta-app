# Heartbeat - 2026-02-20

## Attention Needed
- **Google auth still broken** — Calendar & Gmail returning `invalid_grant` for 3+ days. Re-auth required.
- `z-logs/` and `briefing/heartbeat-today.md` untracked — consider adding to `.gitignore` or committing.

## Project Pulse
- **20 commits since Feb 19** — focused on FB campaign matching, whitespace normalization, and Google lead matching.
- Latest: improved Google lead matching + debug spend endpoint.
- Debug endpoints cleaned up (fb-matching & normalize-test removed), but `google-matching` debug route still active.
- 2 stashes on main (from earlier debug/overview work).
- 2 idle feature branches: `feature/ga4-landing-pages`, `feature/overview`.

## Cleanup Candidates
- Google matching debug endpoint (`/api/debug/google-matching`) — still needed?
- 2 stashes could be dropped if no longer relevant.
- Several `chore:` debug commits could be squashed if pushing to a shared branch.

## Calendar / Email
- Unavailable (auth expired — see Attention Needed)

## Drafts Created
- None
