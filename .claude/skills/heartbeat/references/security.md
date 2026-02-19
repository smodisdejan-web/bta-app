# Heartbeat Security

## Credential Storage

**GitHub Secrets (Overnight):**
- `ANTHROPIC_API_KEY` - Required for AI summarization
- `GOOGLE_OAUTH_REFRESH_TOKEN` - For Gmail/Calendar access (optional)
- `GOOGLE_CLIENT_ID` - OAuth client ID (optional)
- `GOOGLE_CLIENT_SECRET` - OAuth client secret (optional)

These are encrypted at rest by GitHub. They're only exposed to your heartbeat workflow, not to any other workflow or collaborator.

**Local (Daytime):**
- Uses your existing Claude Code authentication (Max subscription)
- Uses your existing Google OAuth tokens in `auth/google/`
- No additional credentials needed

## What the Heartbeat Can and Cannot Do

### By Default (Read-Only)
- Read email subjects and senders (not full bodies)
- Read calendar event titles and times
- Read todo file titles
- Read inbox file names

### Opt-In Actions
- Draft email replies (saved as drafts, never sent)
- Create todo items
- Update heartbeat summary

### Never
- Send emails or messages
- Delete files or emails
- Make purchases or financial transactions
- Access systems not explicitly configured
- Push code changes (except the heartbeat summary itself)

## GitHub Actions Security

- Workflows only run from your own repo
- No third-party actions used (only official GitHub actions)
- The workflow file is committed to your repo - you can audit it anytime
- GitHub Actions logs are visible in your repo's Actions tab

## Budget as a Safety Net

The monthly budget cap serves dual purpose:
1. **Cost control** - Prevents unexpected API bills
2. **Blast radius** - If something goes wrong, it can only spend up to your cap before stopping

## Comparison with OpenClaw

OpenClaw stores all credentials in plain text, runs a large codebase you haven't audited, and allows installing third-party skills from a public marketplace.

The brain heartbeat:
- Stores credentials in GitHub encrypted secrets or local auth files
- Runs code you wrote and can read in minutes
- Has no third-party skill marketplace
- Does nothing you haven't explicitly configured
