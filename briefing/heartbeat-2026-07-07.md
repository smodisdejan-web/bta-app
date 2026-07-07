# Heartbeat - 2026-07-07

## Summary

# Morning Summary

**⚠️ Action Required:**

All overnight checks failed due to authentication issues:
- **Calendar**: invalid_grant error
- **Gmail**: invalid_grant error
- **File system**: Todo and Inbox folders not found

**Next steps:**
1. Re-authenticate calendar and Gmail connections
2. Verify folder structure is properly configured
3. Check if credentials have expired or been revoked

---

No todo folder found.

---

No inbox folder found.

---

Calendar check failed: ('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})

---

Gmail check failed: ('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})
