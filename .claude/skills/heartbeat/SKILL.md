---
name: heartbeat
description: Set up a proactive brain that works while you sleep. Configures overnight GitHub Actions cron + local daytime heartbeat. Walks through what actions to allow, frequency, and budget. USE WHEN user says "heartbeat", "proactive brain", "overnight agent", "brain while I sleep", or asks about making the brain work autonomously.
members: true
---

# Heartbeat - Proactive Brain Setup

Make your brain work while you sleep. Two-tier architecture:
- **Daytime (computer on):** Local heartbeat via launchd/cron, uses Claude Code (subscription)
- **Overnight (computer off):** GitHub Actions cron, uses API credits (cheap with Haiku)

## How It Works

**Daytime:** A launchd plist (Mac) or cron job (Linux) runs a heartbeat script every 30-60 minutes. It invokes Claude Code CLI with a focused prompt that checks your world and acts on anything obvious.

**Overnight:** A GitHub Actions workflow runs on a cron schedule (typically once, ~30 min before you wake up). It uses the Anthropic API directly (not Claude Code subscription) to check email, calendar, and todos, then leaves a summary for your morning `/gm`.

## Setup Process

### Step 1: Ask Configuration Questions

Use AskUserQuestion to walk through these decisions:

**Question 1: What should your brain check?**
Options (multi-select):
- Gmail (unread/urgent emails)
- Google Calendar (tomorrow's prep needs)
- Todo folder (overdue items)
- Inbox folder (unprocessed notes)

**Question 2: What actions should it be allowed to take?**
Options (multi-select):
- Read-only (just summarize what needs attention)
- Draft email replies (saved as drafts, not sent)
- Create todo items for things that need action
- Update project status notes

**Question 3: When should the overnight heartbeat run?**
Options:
- Once before I wake up (e.g., 5:30 AM local time) (Recommended)
- Twice overnight (e.g., midnight + early morning)
- Every few hours overnight

**Question 4: Do you also want a daytime heartbeat?**
Options:
- Yes, every 30 minutes while my computer is on (Recommended)
- Yes, every hour
- No, just overnight

**Question 5: Monthly budget for overnight API credits?**
Options:
- Minimal (~$3/month - Haiku only, read-only checks)
- Moderate (~$10/month - Haiku + occasional Sonnet for drafting)
- Flexible (~$20/month - Sonnet for complex tasks)

### Step 2: Generate Configuration

Based on answers, create `.claude/heartbeat-config.json`:

```json
{
  "checks": ["gmail", "calendar", "todos", "inbox"],
  "actions": ["summarize", "draft_emails", "create_todos"],
  "overnight": {
    "schedule": "30 5 * * *",
    "timezone": "Australia/Melbourne",
    "model": "claude-haiku-4-5-20251001",
    "max_tokens_per_run": 4000
  },
  "daytime": {
    "enabled": true,
    "interval_minutes": 30,
    "use_claude_code": true
  },
  "budget": {
    "monthly_limit_usd": 10,
    "alert_at_percent": 80
  }
}
```

### Step 3: Generate Files

Based on config, generate these files:

1. **GitHub Actions workflow** - Read `templates/heartbeat-workflow.yml` and customize with user's schedule, timezone, and checks. Write to `.github/workflows/heartbeat.yml`.

2. **Heartbeat prompt** - Read `templates/heartbeat-prompt.md` and customize with user's allowed checks and actions. Write to `.claude/heartbeat-prompt.md`.

3. **Overnight script** - Read `scripts/overnight-heartbeat.py` as the template. This is the Python script that GitHub Actions runs. Copy to `scripts/overnight-heartbeat.py` at the brain root.

4. **Daytime plist (Mac only)** - Read `templates/launchd-heartbeat.plist` and customize with user's interval and brain path. Write to `~/Library/LaunchAgents/com.brain.heartbeat.plist`.

5. **Heartbeat log viewer** - The overnight run writes its summary to `briefing/heartbeat-{date}.md`. The `/gm` command can pick this up.

### Step 4: Set Up GitHub Secrets

Walk the user through adding their Anthropic API key to GitHub:

```bash
# Check if gh CLI is authenticated
gh auth status

# Add the secret
gh secret set ANTHROPIC_API_KEY
```

Also need Google credentials for Gmail/Calendar checks. Guide them through:
- Service account JSON as a GitHub secret (for Sheets/Drive access)
- OAuth refresh token as a GitHub secret (for Gmail/Calendar)

**IMPORTANT:** If the user doesn't have OAuth credentials set up, point them to `auth/CLAUDE.md` for the Google Cloud setup instructions. Don't try to set up OAuth from scratch in this skill.

### Step 5: Test

Run a test of the overnight script locally first:

```bash
python3 scripts/overnight-heartbeat.py --dry-run
```

This should show what the heartbeat would check and report, without taking any actions.

Then test the GitHub Action:

```bash
gh workflow run heartbeat.yml
```

### Step 6: Activate Daytime Heartbeat (Mac)

```bash
# Load the launchd plist
launchctl load ~/Library/LaunchAgents/com.brain.heartbeat.plist

# Verify it's loaded
launchctl list | grep brain.heartbeat
```

### Step 7: Summary

Show the user what was set up:
- Overnight: GitHub Actions runs at [time] [timezone], checks [list], can [actions]
- Daytime: launchd runs every [interval] minutes when your Mac is on
- Budget: ~$[estimate]/month for overnight API credits
- Logs: Check `briefing/heartbeat-*.md` for overnight activity, `/gm` picks these up automatically

## Teaching Context

When explaining to members, use this framing:

**The brain already works when you're at the keyboard.** The heartbeat makes it work when you're not. Think of it like having a night shift assistant who:
- Checks your email and flags anything urgent
- Reviews tomorrow's calendar and preps notes
- Scans your todo list for overdue items
- Leaves a summary on your desk for the morning

**It's not an autonomous agent making big decisions.** It's a checklist runner with good judgment about what's worth flagging. Most runs will produce a short "nothing urgent" summary. Occasionally it'll catch something useful.

**Cost control is built in.** Haiku is cheap (~$0.01-0.05 per run). Even running 3x/night, you're looking at $3-5/month. The config has a monthly budget cap - if you hit it, the heartbeat pauses until next month.

## References

- `references/architecture.md` - Detailed two-tier architecture explanation
- `references/security.md` - Security considerations and credential handling
- `references/cost-estimates.md` - Detailed API cost breakdowns by model and usage pattern
