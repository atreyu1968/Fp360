---
name: Idempotent replay authorization
description: Actor identity and current scope checks for replayed operations across RED FP360 modules.
---

An idempotent retry must match the original actor and revalidate current resource access before returning a prior result. Matching a request fingerprint alone does not prove that the current user owns the operation or still has access to its resource.

**Why:** A center can lose campaign access while its user's identity and organization remain unchanged, and a different user in the same tenant can reuse an operation key; cached results can otherwise bypass current visibility.

**How to apply:** Bind replay keys to the original user, then recheck tenant-scoped resource permissions before returning cached data. Preserve narrowly scoped exceptions only where the normal operation explicitly allows pending or invited recipients.
