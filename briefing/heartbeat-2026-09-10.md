# Heartbeat - 2026-09-10

## Summary

# Morning Summary

**⚠️ Action Required:**

All overnight checks failed due to authentication issues:

- **Calendar** - Authentication error (invalid_grant)
- **Gmail** - Authentication error (invalid_grant)
- **File system** - Todo and inbox folders not found

**Next steps:**
1. Re-authenticate calendar and Gmail accounts
2. Verify todo/inbox folder paths are correct
3. Run checks again once credentials are refreshed

---

No todo folder found.

---

No inbox folder found.

---

Calendar check failed: ('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})

---

Gmail check failed: ('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})
