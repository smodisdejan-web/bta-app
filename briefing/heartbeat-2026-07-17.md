# Heartbeat - 2026-07-17

## Summary

# Morning Summary

**⚠️ Action Required:**

All overnight checks failed due to authentication errors:
- Calendar access: `invalid_grant` error
- Gmail access: `invalid_grant` error
- File system: Todo and Inbox folders missing

**Next steps:**
1. Verify API credentials/tokens are valid
2. Check folder structure exists
3. Reauthorize calendar and Gmail if needed

No actionable items from overnight monitoring available until access is restored.

---

No todo folder found.

---

No inbox folder found.

---

Calendar check failed: ('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})

---

Gmail check failed: ('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})
