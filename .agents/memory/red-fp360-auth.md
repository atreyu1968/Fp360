---
name: RED FP360 authentication
description: Authentication provider constraint for the RED FP360 project.
---

Use app-owned authentication for RED FP360; do not use Clerk.

**Why:** the user explicitly ruled out Clerk and selected custom authentication.

**How to apply:** use server-side sessions and enforce role and tenant access in the API. Do not add Clerk packages, middleware, or client components.
