# Heartbeat - 2026-06-22

## Summary

# Morning Summary

**⚠️ System Issues Requiring Attention:**

1. **Authentication Failed** - Calendar and Gmail checks both returned `invalid_grant` errors. Your access tokens may have expired.
   - Action: Re-authenticate your Google account in the settings.

2. **Missing Folders** - No todo or inbox folders detected in the system.
   - Action: Verify folder configuration after re-authenticating.

**Recommendation:** Address the authentication issue first—this is blocking all checks.

---

No todo folder found.

---

No inbox folder found.

---

Calendar check failed: ('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})

---

Gmail check failed: ('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})
