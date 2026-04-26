# Heartbeat - 2026-04-26

## Summary

# Morning Summary

**⚠️ Action Required: Authentication Issues**

All overnight checks failed due to authorization problems:

- **Calendar**: Authentication error (invalid_grant)
- **Gmail**: Authentication error (invalid_grant)
- **File system**: Todo and inbox folders not found

**Next steps:**
1. Verify API credentials are current
2. Re-authenticate calendar and email services
3. Check folder paths for todo/inbox directories

No data retrieved to report on tasks, emails, or calendar events.

---

No todo folder found.

---

No inbox folder found.

---

Calendar check failed: ('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})

---

Gmail check failed: ('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})
