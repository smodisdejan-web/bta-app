# Heartbeat - 2026-09-17

## Summary

# Morning Summary

**🔴 Action Required: Authentication Issues**

All overnight checks failed due to authorization problems:

- **Calendar & Gmail**: Both services returned "invalid_grant" errors
- **File system**: Todo and Inbox folders not found

**Next steps:**
1. Re-authenticate your Google account (likely expired or revoked credentials)
2. Verify folder structure exists
3. Run checks again once credentials are refreshed

No data currently available to review.

---

No todo folder found.

---

No inbox folder found.

---

Calendar check failed: ('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})

---

Gmail check failed: ('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})
