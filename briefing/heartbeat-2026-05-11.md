# Heartbeat - 2026-05-11

## Summary

# Morning Summary

**⚠️ Critical Issues - Action Required:**

1. **Authentication Failures** - Calendar and Gmail checks failed with invalid grant errors. You need to re-authenticate these services.

2. **Missing Folders** - Todo and Inbox folders not found. Verify folder structure is intact.

**Next Steps:**
- Re-authorize Calendar and Gmail access
- Check that folder paths are correctly configured
- Once fixed, run checks again to restore monitoring

---

No todo folder found.

---

No inbox folder found.

---

Calendar check failed: ('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})

---

Gmail check failed: ('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})
