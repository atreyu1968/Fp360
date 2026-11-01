---
name: RED FP360 administration safety
description: Durable boundaries for administration, recovery exercises, and integrations.
---

RED FP360 administration is a training console, not an infrastructure control plane. Backup and recovery actions remain readiness exercises only; integrations never contact external services or expose credentials. Administrator accounts use app-owned TOTP with one-time recovery codes. Global administrator invitations, promotions, and deactivations require approval by a different administrator, and requesters cannot approve their own requests. Suspensions preserve historical records.

**Why:** The official module specification and the project's educational-only boundary require safe, auditable administration rather than live infrastructure changes.

**How to apply:** Keep administrative endpoints tenant-scoped and auditable, require server-side MFA for administrators, fail closed on privilege approvals, and keep recovery and external-service workflows explicitly simulation-only.
