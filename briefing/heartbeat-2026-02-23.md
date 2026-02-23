# Heartbeat - 2026-02-23

## Summary

# Morning Summary

**⚠️ Action Required: Authentication Issues**

All overnight checks failed due to authorization problems:

- **Calendar**: Authentication error (invalid_grant)
- **Gmail**: Authentication error (invalid_grant)
- **File system**: Todo and Inbox folders not found

**Next steps:**
1. Verify API credentials/tokens are current
2. Re-authenticate calendar and email connections
3. Confirm folder paths are correct

No data could be retrieved to flag items needing attention.

---

No todo folder found.

---

No inbox folder found.

---

Calendar check failed: ('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})

---

Gmail check failed: ('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})
