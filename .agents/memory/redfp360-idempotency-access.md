---
name: Inter-centre replay authorization
description: Current-access checks for idempotent retries in cross-centre coordination.
---

An idempotent retry must revalidate the caller's current campaign visibility before returning a prior result. Matching the original user, role, organization, and request fingerprint does not prove that the user's campaign participation is still active.

**Why:** A center can lose campaign access while its user's identity and organization remain unchanged; returning cached campaign data after that transition bypasses the current visibility policy.

**How to apply:** Recheck tenant-scoped campaign access on every replay path. Preserve narrowly scoped exceptions only where the normal operation explicitly allows pending or invited recipients.
