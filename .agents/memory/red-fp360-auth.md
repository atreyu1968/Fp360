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

## Invitations and existing accounts

An invitation may target an existing account in another network, but must not create or activate a membership until that signed-in account explicitly accepts. Match the authenticated account to the invited email and scope the new membership and audit event to the invitation's tenant. Rejection, expiry, and revocation must leave all existing memberships unchanged.

**Why:** cross-network access is a security-sensitive choice; an email match or invitation creation is not consent.

**How to apply:** require authentication for accept/reject decisions, show the invited network and role before consent, and preserve unrelated sessions and memberships.

## Rate limiting behind the Replit proxy

Trust exactly one reverse-proxy hop in Express before rate-limited routes.

**Why:** the Replit preview proxy forwards visitor IPs in `X-Forwarded-For`; `express-rate-limit` 8 rejects that header when Express keeps its default `trust proxy` setting.

**How to apply:** keep `app.set("trust proxy", 1)` before the auth and admin rate limiters. Do not trust an arbitrary proxy chain.

## Private product documents

Serve catalog attachments only through the existing app-owned session and tenant-scoped document records. Do not expose the generic private-object route without authentication.

**Why:** product and supplier documents are private to each RED FP360 network, and the project uses custom sessions rather than Clerk or Replit Auth.

**How to apply:** verify the authenticated tenant owns the product and document before issuing a short-lived download URL or deleting an object.
