# Heartbeat - 2026-07-24

## Summary

# Morning Summary

**⚠️ Action Required:**

All overnight checks failed due to authentication issues:
- Calendar access: invalid_grant error
- Gmail access: invalid_grant error
- File system checks: Todo and inbox folders not found

**Next Steps:**
1. Re-authenticate calendar and Gmail connections
2. Verify folder paths for todo/inbox
3. Check API credentials and permissions

---

No todo folder found.

---

No inbox folder found.

---

Calendar check failed: ('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})

---

Gmail check failed: ('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})
