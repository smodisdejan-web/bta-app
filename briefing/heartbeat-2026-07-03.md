# Heartbeat - 2026-07-03

## Summary

# Morning Summary

**⚠️ ACTION REQUIRED: Authentication Issues**

Multiple services are failing due to invalid credentials:
- **Calendar** - Authentication failed
- **Gmail** - Authentication failed
- **File system** - Todo and inbox folders not found

**Recommendation:** Check and refresh your API credentials/tokens for Calendar and Gmail. Verify folder paths for local storage.

No other data available to review.

---

No todo folder found.

---

No inbox folder found.

---

Calendar check failed: ('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})

---

Gmail check failed: ('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})
