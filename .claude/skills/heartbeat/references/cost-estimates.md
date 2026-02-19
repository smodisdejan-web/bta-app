# Heartbeat Cost Estimates

## Overnight (API Credits)

All estimates use Anthropic API pricing. The heartbeat prompt + check results typically consume 2,000-4,000 input tokens and generate 500-1,000 output tokens.

### Haiku (Recommended for checks)

| Frequency | Input tokens/run | Output tokens/run | Cost/run | Monthly cost |
|-----------|-----------------|-------------------|----------|-------------|
| 1x/night | ~3,000 | ~800 | ~$0.003 | ~$0.09 |
| 2x/night | ~3,000 | ~800 | ~$0.003 | ~$0.18 |
| 3x/night | ~3,000 | ~800 | ~$0.003 | ~$0.27 |

### Sonnet (For complex reasoning/drafting)

| Frequency | Input tokens/run | Output tokens/run | Cost/run | Monthly cost |
|-----------|-----------------|-------------------|----------|-------------|
| 1x/night | ~3,000 | ~800 | ~$0.02 | ~$0.60 |
| 2x/night | ~3,000 | ~800 | ~$0.02 | ~$1.20 |

### Realistic Monthly Budgets

| Usage Level | Description | Estimated Monthly |
|-------------|-------------|-------------------|
| **Minimal** | Haiku, 1x/night, read-only | $0.10 - $0.50 |
| **Standard** | Haiku checks + occasional Sonnet drafting | $1 - $5 |
| **Heavy** | Sonnet, 3x/night, drafts emails and todos | $5 - $15 |

**Note:** These are the API costs only. GitHub Actions compute is free (within the 2,000 min/month free tier). Your actual usage will be ~150-450 minutes/month depending on frequency.

## Daytime (Subscription)

The daytime heartbeat uses Claude Code CLI which runs on your Anthropic Max subscription. **No additional API cost.**

However, each heartbeat run does consume some of your daily Max usage. A quick check-and-summarize run typically uses a small amount of the daily allowance - comparable to a short conversation.

## Budget Controls

The `heartbeat-config.json` includes a `budget` section:

```json
{
  "budget": {
    "monthly_limit_usd": 10,
    "alert_at_percent": 80
  }
}
```

The overnight script tracks cumulative spending in `z-logs/heartbeat-spend.json`. When the monthly limit is reached, overnight runs are skipped until the next month. The alert threshold triggers a note in the heartbeat summary.
