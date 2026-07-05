# Heartbeat - 2026-07-05

## Summary

# Morning Summary

**⚠️ Action Required: Authentication Issues**

All overnight checks failed due to invalid authentication credentials:

- **Calendar**: Access denied (invalid_grant)
- **Gmail**: Access denied (invalid_grant)
- **File system**: Todo and Inbox folders not found

**Next steps:**
1. Re-authenticate calendar and email access
2. Verify folder locations or recreate missing directories
3. Once resolved, checks will run normally

---

No todo folder found.

---

No inbox folder found.

---

Calendar check failed: ('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})

---

Gmail check failed: ('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})
