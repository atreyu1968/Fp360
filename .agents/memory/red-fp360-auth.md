---
name: RED FP360 authentication
description: Authentication provider constraint for the RED FP360 project.
---

Use app-owned authentication for RED FP360; do not use Clerk.

**Why:** the user explicitly ruled out Clerk and selected custom authentication.

**How to apply:** use server-side sessions and enforce role and tenant access in the API. Do not add Clerk packages, middleware, or client components.

## Cookies in the preview

Distinguish the application's cookie settings from the attributes observed through the preview gateway.

**Why:** browser verification confirmed that the local development response sends HttpOnly and SameSite=Lax without Secure, while the public HTTPS preview transforms it to HttpOnly, Secure, and SameSite=None for iframe use.

**How to apply:** compare local and proxied responses separately when diagnosing sessions. Do not weaken same-origin checks or change production cookie policy merely to match preview gateway attributes.
