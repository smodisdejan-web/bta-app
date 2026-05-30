# Heartbeat - 2026-05-30

## Summary

# Morning Summary

**⚠️ Action Required: Account Access Issues**

All overnight checks failed due to authentication errors:

- **Calendar**: Access denied (invalid_grant)
- **Gmail**: Access denied (invalid_grant)
- **File system**: Todo and inbox folders not found

**Next steps:**
1. Re-authorize calendar and email access
2. Verify folder paths exist
3. Check credential expiration

No actionable items available until access is restored.

---

No todo folder found.

---

No inbox folder found.

---

Calendar check failed: ('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})

---

Gmail check failed: ('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})
