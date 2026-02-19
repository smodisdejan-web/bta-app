# Heartbeat Architecture

## Two-Tier Design

The heartbeat uses two separate systems optimized for different contexts:

### Tier 1: Daytime (Local)

**When:** Your computer is on (working hours)
**How:** macOS launchd plist triggers Claude Code CLI on an interval
**Cost:** $0 (uses Claude Code subscription / Max plan)
**Capabilities:** Full brain access - can read files, check Gmail, run skills, even make edits

The launchd plist runs `claude --dangerously-skip-permissions -p "..."` with a focused heartbeat prompt. Claude Code has full access to the brain repo and all MCP tools.

**Why not just use this?** It only works when the computer is awake. If you close your laptop at 6 PM, nothing runs until you open it again.

### Tier 2: Overnight (Remote)

**When:** Computer is off (evenings, overnight, weekends)
**How:** GitHub Actions cron runs a Python script
**Cost:** ~$0.01-0.10 per run (Anthropic API credits, Haiku model)
**Capabilities:** Limited to what's configured - email, calendar, todos

The Python script runs directly in GitHub Actions. It checks configured sources, generates a summary, and commits it to the repo. When you `/gm` the next morning, the heartbeat summary is there waiting.

**Why not use Claude Code here?** Claude Code requires a subscription and is designed for interactive/CLI use. The Anthropic API with Haiku is purpose-built for lightweight automated tasks and costs fractions of a cent per run.

## Data Flow

```
[Overnight: GitHub Actions]
    |
    v
Python script → Anthropic API (Haiku)
    |
    v
briefing/heartbeat-{date}.md → git commit + push
    |
    v
[Morning: You open laptop]
    |
    v
/gm → reads heartbeat summary → includes in briefing
    |
    v
[Daytime: launchd]
    |
    v
Claude Code CLI → full brain access → periodic checks
    |
    v
briefing/heartbeat-today.md (overwritten each run)
```

## Security Considerations

- **GitHub Secrets:** API keys stored as encrypted secrets, never in code
- **Read-mostly:** Default config is read-only (summarize). Write actions (drafting emails, creating todos) are opt-in
- **No sending:** The heartbeat can draft emails but never sends them. You review and send manually
- **Budget cap:** Monthly spending limit prevents runaway costs
- **Minimal permissions:** The overnight script only accesses what you explicitly configure

## Why Not a VPS?

A VPS (Hetzner, DigitalOcean, etc.) would give you:
- Always-on compute
- Full control over the environment
- Ability to run Claude Code via the Node.js SDK

But it also means:
- Server management (security updates, SSH, etc.)
- Monthly cost whether you use it or not ($4-6/mo minimum)
- Credential management on a remote server
- Another thing to maintain

GitHub Actions gives you 90% of the benefit with 0% of the server management. You can always graduate to a VPS later if you need more capabilities.

## Extending the Heartbeat

The check system is modular. To add a new check:

1. Add a function to `overnight-heartbeat.py` that returns a markdown string
2. Add it to the `check_map` dictionary
3. Add the check name to your `heartbeat-config.json`

Example checks you might add:
- **Slack:** Check for unread DMs
- **GitHub:** Check for PR reviews needed
- **Analytics:** Pull yesterday's key metrics
- **RSS:** Scan feeds for breaking news in your industry
