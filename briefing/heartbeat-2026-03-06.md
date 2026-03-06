# Heartbeat - 2026-03-06

## Summary

# Morning Summary

**⚠️ All Systems Down - Authentication Issues**

All overnight checks failed due to invalid credentials:

- **Calendar**: Authentication error (invalid_grant)
- **Gmail**: Authentication error (invalid_grant)
- **File system**: Todo and inbox folders not found

**Action needed:**
1. Verify API credentials/tokens are current
2. Re-authenticate calendar and email services
3. Check file paths for todo and inbox folders

No data available until these are resolved.

---

No todo folder found.

---

No inbox folder found.

---

Calendar check failed: ('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})

---

Gmail check failed: ('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})
