# Specification: [009] Chat

## Meta

| Field | Value |
|-------|-------|
| Status | Draft |
| Priority | P1 |
| Track | Core |
| NR_OF_TRIES | 0 |

---

## Overview

Dedicated chat service for TAUNT. Chat is not hosted inside the gameplay backend:
it runs as a separate service in its own repository/submodule and exposes a
publicly readable global room, authenticated posting, page-scoped hidden rooms,
and a separate event-feed domain over shared realtime transport.

This spec covers the chat service, the root workspace integration points, and a
small local development harness for exercising two-user flows. It does **not**
define production frontend UI in the separate frontend repo.

## User Stories

- As a spectator, I want to read the main global room without connecting so that
  The Pit can feel active before I authenticate.
- As an authenticated player, I want to post into the global room so that I can
  participate in the live community.
- As an operator, I want chat to fail independently from gameplay services so
  that a realtime outage does not take down betting flows.
- As an operator, I want page-scoped hidden rooms available for future surfaces
  like KOL pages without exposing a public room browser now.
- As a developer, I want a split-pane local test tool that simulates two users
  plus a separate event feed so that realtime chat behavior can be exercised
  repeatedly during development.

---

## Capability Alignment

- **`docs/SCOPE.md` references**: Temporarily non-authoritative during replanning; do not treat as the contract source for this spec
- **Current baseline fit**: Planned
- **Planning bucket**: Core

## Required Context Files

- `docs/references/product-spec-v4.md`
- `docs/references/platform-features.md`
- `docs/specs/_TEMPLATE/spec.md`
- `docs/specs/006-fairness-backend/spec.md`
- `docs/specs/007-jwt-session-auth/spec.md`
- `docs/specs/300-referral-system/spec.md`
- `backend/services/backend/src/routes/auth.ts`
- `backend/services/backend/src/middleware/jwt-auth.ts`
- `backend/services/backend/src/config.ts`

## Contract Files

- `chat/` — dedicated chat service submodule
- `test-tools/chat/` — root-level local diagnostics harness

---

## Functional Requirements

<!-- FR acceptance criteria checkboxes are audited by /gap-analysis after completion.
     Each checkbox gets an HTML comment annotation: satisfied/deferred/gap with evidence.

     Frontend product UI is owned by a separate repo/team. This spec covers the
     standalone chat service, its contracts, and the root-level local test tool.
     UI requirements below refer only to the local diagnostics harness in this repo,
     not to the production frontend. -->

### FR-1: Service Boundary

Chat runs as a dedicated service in its own repository/submodule. The gameplay
backend is not the chat host. The platform frontend and local diagnostics tools
act as clients of the chat service.

**Acceptance Criteria:**
- [ ] `chat/` exists as a dedicated git submodule in the root workspace
- [ ] Root workspace documentation identifies `chat/` as a separate service repo
- [ ] Chat service exposes its own startup, config, and verification commands
- [ ] Chat service failure does not become a required dependency for gameplay APIs

### FR-2: Room Model

V1 ships one visible global room. Additional rooms are allowed only as hidden,
page-scoped rooms tied to a future explicit surface such as a KOL page. There is
no public channel browser in v1.

**Acceptance Criteria:**
- [ ] Service defines a global room as the default public room
- [ ] Service supports a separate page-scoped hidden room type in the data model
- [ ] Hidden rooms are non-discoverable by default
- [ ] No endpoint exposes a public list of all rooms for v1
- [ ] Room metadata supports later attachment to a named page or surface key

### FR-3: Public Read, Authenticated Write

The global room is publicly readable. Posting requires a valid platform session
token. The chat service verifies the token directly using the shared JWT
contract rather than making a runtime authorization callback to the gameplay
backend. Username lookup may still use a separate profile read path after the
token itself is verified.

**Acceptance Criteria:**
- [ ] Global-room message history can be fetched without authentication
- [ ] Global-room realtime stream can be consumed without authentication
- [ ] Posting a chat message requires `Authorization: Bearer <token>`
- [ ] Chat token verification mirrors the platform JWT contract (`HS256`, `sub = user_id`, wallet as secondary claim)
- [ ] Invalid or expired tokens are rejected with 401
- [ ] Logout limitations are documented: already-issued access tokens remain valid until expiry

### FR-4: Username-Only Identity

Chat never renders raw wallets as the visible author identity. Authenticated
posting must resolve a username before a message is accepted.

**Acceptance Criteria:**
- [ ] Message payloads expose `username` as the author identity
- [ ] Message payloads do not expose the raw wallet address in public responses
- [ ] Posting is rejected if the service cannot resolve a username for the authenticated user
- [ ] Username resolution path and trust boundary are documented

### FR-5: Message Lifecycle and Moderation

The global room is intentionally ephemeral-short and lightly moderated. V1
supports rate limits and admin deletion only.

**Acceptance Criteria:**
- [ ] Message retention is bounded by a rolling configurable policy
- [ ] Message posting enforces a maximum message length
- [ ] Posting enforces a configurable per-user rate limit
- [ ] Admin delete is supported for individual messages
- [ ] No keyword filter, reporting workflow, reactions, threads, or attachments are required in v1

### FR-6: Separate Event-Feed Domain

System/gameplay events are not chat messages. They belong to a separate feed
domain with its own payload shape and subscription stream, while sharing the
same underlying realtime transport pattern where practical.

**Acceptance Criteria:**
- [ ] Human chat messages and feed events have distinct payload types
- [ ] Feed subscriptions are separate from room-message subscriptions
- [ ] Internal/system publishers can publish feed events without impersonating chat users
- [ ] Clients can subscribe to chat and feed streams independently
- [ ] Feed items are not injected into the persisted chat-message timeline

### FR-7: Local Diagnostics Harness

The root workspace includes a reusable local diagnostics area with a split-pane
two-user harness for chat development. This is a developer tool, not production UI.

**Acceptance Criteria:**
- [ ] A root-level `test-tools/chat/` area exists
- [ ] Harness shows two independent user panes connected to the same global room
- [ ] Harness includes a separate event-feed lane distinct from chat history
- [ ] Harness allows configuring auth token inputs for both panes
- [ ] Harness surfaces degraded/unavailable states for chat or feed endpoints
- [ ] Harness run instructions are documented for local development

---

## Success Criteria

- Public users can read the global room without authentication
- Authenticated users can post messages with usernames only
- Chat and feed events stay distinct in both API shape and client subscription model
- Hidden rooms are modeled without exposing a public multi-room browser
- Developers can exercise two-user realtime behavior locally from the root workspace
- Chat can be developed and deployed independently from the gameplay backend

---

## Dependencies

- Platform JWT session auth (`backend/services/backend/src/routes/auth.ts`)
- Shared JWT verification contract (`backend/services/backend/src/middleware/jwt-auth.ts`)
- Explicit `JWT_SECRET` agreement across backend and chat service
- Root multi-repo/submodule workflow

## Assumptions

- Frontend product UI remains out of scope for this repo
- The gameplay backend remains the issuer of platform session tokens
- Username resolution may require a separate lookup beyond JWT verification
- SSE or an equivalent lightweight realtime transport is acceptable for v1
- Root-level `test-tools/` is a development-only area and not part of production deliverables

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | `chat/` is a dedicated submodule | Inspect `.gitmodules` and root docs | Git diff + file references |
| 2 | Global room is public-read | HTTP request without auth | Response body showing message history |
| 3 | Posting requires auth | POST with and without token | 401 without token, success with valid token |
| 4 | Username-only identity | Post and fetch messages | Response body contains username, no wallet field |
| 5 | Ephemeral retention works | Insert messages beyond retention window/limit | Oldest messages dropped per policy |
| 6 | Feed domain stays separate | Publish feed event and chat message | Separate payloads/subscriptions visible |
| 7 | Hidden rooms are page-scoped only | Inspect room registry / create hidden room path | Room metadata includes page/surface scope |
| 8 | Two-user harness works locally | Run local tool and post from both panes | Manual smoke + screenshot/log |

---

## Completion Signal

### Implementation Checklist
- [ ] [root] Add `chat/` as a git submodule pointing at `taunt-bet/chat.git`
- [ ] [docs] Update root workspace docs and decisions for the new chat submodule
- [ ] [docs] Create `docs/specs/009-chat/spec.md`
- [ ] [chat] Scaffold service structure for auth, rooms, messages, feeds, realtime, moderation, and config
- [ ] [chat] Implement public-read/auth-write global chat contract
- [ ] [chat] Implement username-only author resolution
- [ ] [chat] Implement separate feed-domain contract over shared transport
- [ ] [chat] Implement very light moderation and ephemeral retention
- [ ] [test] Add service-level tests for auth, room visibility, message posting, retention, and feed separation
- [ ] [root] Add `test-tools/chat/` split-pane local diagnostics harness

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [ ] All existing tests pass where relevant to touched areas
- [ ] New tests added for chat service behavior
- [ ] No lint or typecheck errors in the new chat service

#### Functional Verification
- [ ] All acceptance criteria verified
- [ ] Public-read/auth-write contract verified
- [ ] Username-only author presentation verified
- [ ] Feed separation verified

#### Integration Verification
- [ ] Local two-user harness can exercise a shared global room
- [ ] Local harness can observe feed items separately from chat messages
- [ ] Root docs accurately describe local startup and verification flow

### Iteration Instructions

If ANY check fails:
1. Identify the specific issue
2. Fix the code
3. Re-run tests
4. Re-verify all criteria
5. Check again

**Only when ALL checks pass, output:** `<promise>DONE</promise>`

### Post-Completion: Gap Analysis

After the spec loop outputs `<promise>DONE</promise>`, `spec-loop.sh` automatically runs
`/gap-analysis {id} --non-interactive` which:
1. Audits every FR acceptance criterion against the codebase
2. Writes `docs/specs/{id}/gap-analysis.md` with inventory + audit + recommendations
3. Annotates FR checkboxes with HTML comment evidence (`<!-- satisfied: ... -->`)
4. Commits everything together with the completion commit
