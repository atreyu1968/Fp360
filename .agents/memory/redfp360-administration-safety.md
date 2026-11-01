---
name: RED FP360 administration safety
description: Durable boundaries for administration, recovery exercises, and integrations.
---

RED FP360 administration is a training console, not an infrastructure control plane. Backup and recovery actions remain readiness exercises only; external integrations stay simulation-only and never expose credentials. The AI scenario coordinator is an exception: its provider is configured in the administrator panel, it may use a local AI endpoint, and it only proposes changes for approval. Administrator accounts use app-owned TOTP with one-time recovery codes. Global administrator invitations, promotions, and deactivations require approval by a different administrator, and requesters cannot approve their own requests. Suspensions preserve historical records.

**Why:** The official module specification and the project's educational-only boundary require safe, auditable administration rather than live infrastructure changes.

**How to apply:** Keep administrative endpoints tenant-scoped and auditable, require server-side MFA for administrators, fail closed on privilege approvals, and keep recovery and external-service workflows explicitly simulation-only.

## Administrative API test fixtures

Tests for administrative business routes should use a development-only session fixture whose MFA state is already verified. Reserve the real TOTP setup and verification endpoints for tests that specifically cover MFA. Give each integration-test run a distinct synthetic client IP so rate limits from earlier runs do not make the suite order-dependent.

**Why:** Protected administrator routes reject sessions until MFA is verified, and the MFA/login endpoints are rate-limited. Repeating unrelated access-control tests through setup can exhaust those limits before the tested behavior is reached.

**How to apply:** Seed only the required MFA/session state in isolated development test data; never bypass these checks in application code or run such fixtures against production.

## Infrastructure recovery evidence

Infrastructure recovery drills are separate from the ERP's didactic backup exercise. Run them only against newly created disposable databases and fictional files. A local App Storage adapter can verify references and application access controls, but must never be reported as proof of cloud bucket recovery or provider-level privacy.

**Why:** Before opening centers, a successful educational exercise or a local storage substitute can otherwise be mistaken for a verified recovery of real infrastructure.

**How to apply:** Keep the evidence explicit about what was restored, isolation and cleanup. Provider IAM, anonymous object access, retention, and recovery timing need their own disposable-provider verification, never tests against user data.
