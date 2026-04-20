# Specification: [302] Telegram Bot

## Meta

| Field | Value |
|-------|-------|
| Status | Draft |
| Priority | P2 |
| Track | Extended |
| NR_OF_TRIES | 0 |

---

## Overview

TAUNT needs a lightweight Telegram presence that works without wallet linking and
without adding a second identity system in v1. This spec defines a stateless
Telegram Bot API surface for simple command-driven discovery plus a separate
"Challenge over Telegram" share flow from the webapp.

V1 is intentionally narrow:

- The bot responds to commands in DMs and group chats.
- The bot returns links and short formatted text only.
- The webapp challenge flow uses Telegram's standard share URL with prefilled
  text and a canonical TAUNT link.
- Telegram account linking, inline-mode challenge cards, `/stats`, and
  user-targeted `/challenge @user` flows are explicitly deferred.

For v1, the bot runtime should live in a dedicated `telegram/` service
submodule. The backend remains the source of public profile, referral, and
Dogpile data, but the Telegram webhook/runtime should fail independently from
gameplay APIs and workers.

## User Stories

- As a Telegram user, I want simple bot commands so that I can discover TAUNT
  links and status information without connecting a wallet.
- As a TAUNT player, I want to share an open game to Telegram from the webapp so
  that I can invite other people into the flow with one tap.
- As an operator, I want the bot to remain stateless in v1 so that Telegram
  integration does not introduce a second auth/linking system before it is
  justified.
- As an operator, I want the Telegram runtime isolated from the gameplay backend
  so that bot failures do not widen the backend blast radius.

---

## Capability Alignment

- **`docs/SCOPE.md` references**: Section 2 "Shipped Capabilities" (subsection
  "Growth"), Section 6 "Repo Ownership", Section 8 "Spec Index"
- **Current baseline fit**: Planned
- **Planning bucket**: Extended

## Required Context Files

- `docs/FEATURE_CHECKLIST.md`
- `docs/references/TAUNT - Platform Features → v1 (Living Document).md`
- `docs/specs/_TEMPLATE/spec.md`
- `docs/specs/008-user-profile/spec.md`
- `docs/specs/009-chat/spec.md`
- `docs/specs/300-referral-system/spec.md`
- `backend/src/index.ts`
- `backend/src/routes/public-profile.ts`
- `backend/src/routes/public-referral.ts`
- `backend/src/routes/referral.ts`
- `backend/src/routes/dogpile.ts`
- `backend/src/config.ts`
- `telegram/README.md`
- `telegram/package.json`
- `telegram/src/index.ts`
- `telegram/src/app.ts`
- `telegram/src/commands.ts`
- `webapp/src/lib/routes.ts`
- `webapp/src/App.tsx`
- `webapp/src/pages/flip-you/use-flip-you.ts`
- `webapp/src/pages/pot-shot/use-pot-shot.ts`

## Contract Files

- `backend/src/routes/public-profile.ts` — public player
  identity lookup contract
- `backend/src/routes/public-referral.ts` — public referral
  lookup contract for the Telegram service
- `backend/src/routes/referral.ts` — existing authenticated
  referral code contract that v1 cannot reuse directly
- `backend/src/routes/dogpile.ts` — Dogpile response shape
- `telegram/src/commands.ts` — bot command registry contract
- `webapp/src/lib/routes.ts` — canonical frontend route prefixes
- `webapp/src/App.tsx` — route registration for root game pages and referral
  capture

---

## Functional Requirements

<!-- FR acceptance criteria checkboxes are audited by /gap-analysis after completion.
     Each checkbox gets an HTML comment annotation: satisfied/deferred/gap with evidence.

     Frontend product UI is owned by a separate repo/team. This spec covers the
     backend-owned Telegram bot contract plus the data/link contract needed by a
     separate webapp to launch Telegram sharing. UI requirements below refer only
     to data, URLs, and message content, not visual design. -->

### FR-1: V1 Runtime Boundary

V1 ships as a dedicated `telegram/` service submodule, not as a chat-service
feature and not as a backend route bundle. The bot must stay stateless: no
wallet auth, no Telegram account linking, and no user-specific session state
outside standard Telegram update handling.

**Acceptance Criteria:**
- [ ] The Telegram bot runtime is implemented inside the dedicated `telegram/`
      submodule rather than inside `backend/` or `chat/`
- [ ] The v1 runtime does not require Telegram account linking, wallet
      signatures, or a TAUNT JWT
- [ ] The bot handles inbound Telegram updates and outbound Telegram Bot API
      responses without adding itself to gameplay settlement paths
- [ ] Bot-specific failures are logged and observable without becoming a hard
      dependency for `/auth`, game creation, or settlement workers
- [ ] The `telegram/` service has explicit environment/config entries for the bot
      token, webhook secret, `BACKEND_URL`, and canonical public app URL

### FR-2: V1 Command Contract

The bot supports a fixed set of stateless commands. Responses may use Telegram
message formatting and inline URL buttons, but each command resolves entirely
from public data, static content, or server-side reads available to the backend.

**Command set:**

| Command | Behavior |
|---------|----------|
| `/start` | Return short welcome text plus canonical platform link and waitlist/support links |
| `/profile <taunt_username>` | Return the player's public profile link if the identifier resolves |
| `/referral <taunt_username>` | Return that player's referral link if a code exists; otherwise return a friendly "not set up yet" response |
| `/games` | Return links to the current game entry surfaces: `/flip-you`, `/pot-shot`, `/close-call` |
| `/wen` | Return active Dogpile status if active, otherwise the next scheduled window countdown |
| `/therapy` | Return a curated static list of gambling-support resources |
| `/ngmi` | Return one random line from an allowlisted static set |

**Acceptance Criteria:**
- [ ] All seven v1 commands are implemented and documented exactly once in the
      bot command registry
- [ ] Commands work in both direct messages and group chats
- [ ] Unknown commands and missing required arguments return a short help-style
      response rather than a server error
- [ ] `/profile` accepts a TAUNT username or public identifier and resolves
      through the public profile contract
- [ ] `/referral` never requires the target player to authenticate during the
      command flow
- [ ] `/games` returns canonical URLs based on the public app URL plus the
      frontend routes `/flip-you`, `/pot-shot`, and `/close-call`
- [ ] `/therapy` uses a static allowlist of HTTPS resources controlled by the
      backend code/config, not user-generated content
- [ ] `/ngmi` chooses from a reviewed allowlist and excludes slurs, threats, or
      wallet-specific personalization

### FR-3: Public Data And Link Contracts

V1 intentionally reuses existing contracts where they already exist, and it
defines narrow new contracts where the current backend cannot serve the bot
without authenticated player context.

**Locked contract decisions for v1:**

1. **Public profile** reuses existing `GET /public-profile/:identifier`.
2. **Referral resolution** needs a new public/server-side resolver because the
   current referral routes are JWT-gated.
3. **Dogpile status** cannot depend on end-user JWTs even though the current app
   wiring gates `/dogpile/*`; the bot needs an unauthenticated internal read path
   or direct DB-backed helper.
4. **Link building** in the bot must use one canonical `PUBLIC_APP_URL`-style
   config so replies do not hardcode environments in message code.

**Acceptance Criteria:**
- [ ] `/profile` is backed by the existing public profile response shape:
      `userId`, `username`, `avatarUrl`, `heatMultiplier`, `stats`, `createdAt`
- [ ] v1 defines a resolver for "player identifier -> referral URL or no-code
      state" that does not require an end-user JWT
- [ ] v1 defines a resolver for Dogpile current/next-window data that does not
      require an end-user JWT
- [ ] The Telegram service can build canonical referral and game links from one
      environment-owned public app base URL
- [ ] Referral links remain canonical to the referral spec format
      `taunt.bet/r/{CODE}` (or the environment-equivalent host in non-prod)
- [ ] The spec documents that the existing `createDogpileRoutes()` response shape
      is usable, but `index.ts` currently applies JWT middleware to `/dogpile/*`
      and must be adjusted or bypassed for bot use

### FR-4: Challenge Over Telegram Share Flow

"Challenge over Telegram" in v1 is a **webapp share action**, not a bot-issued
message. When a player taps the Telegram share button in the webapp, the client
opens Telegram's standard share URL with prefilled text and a canonical TAUNT
link. Telegram then lets the user choose the target chat/group and send the
message as themselves.

This is the right v1 boundary because Telegram does not allow the bot to
arbitrarily open a chat picker and post into a chosen chat on the user's behalf.

**Locked contract decisions for v1:**

- The share action uses Telegram's regular share flow, not bot inline mode.
- The shared message is user-authored share text plus a TAUNT URL; it is not a
  bot-authored rich challenge card.
- Because the current reference webapp router mounts only the base game routes,
  v1 share URLs must target the canonical game entry surfaces:
  - `/flip-you`
  - `/pot-shot`
  - `/close-call`
- For Flip You and Pot Shot, the share text may include the current 16-character
  match identifier as informational context, but cold-load match-specific web
  routes are deferred until the separate webapp explicitly supports them.

**Acceptance Criteria:**
- [ ] The spec defines one canonical frontend-owned share URL builder based on
      `https://t.me/share/url?url=<encoded_url>&text=<encoded_text>`
- [ ] Share text includes game context plus a direct call to action, but does not
      claim the bot posted the message
- [ ] The shared TAUNT URL opens the intended base game surface in the webapp
- [ ] Flip You and Pot Shot share text may include the current 16-character match
      identifier, but the v1 URL contract remains the base game route
- [ ] Direct cold-load match URLs are explicitly deferred until the separate
      webapp registers match-specific routes
- [ ] The share flow works without Telegram account linking, bot membership, or a
      Telegram webhook round trip

### FR-5: Safety, Abuse Controls, And Operational Constraints

The bot is a public ingress surface. Even though its command set is simple, v1
must constrain abuse and keep message output deterministic.

**Acceptance Criteria:**
- [ ] Telegram webhook requests are validated with a shared secret or equivalent
      Telegram-supported verification mechanism before command handling
- [ ] Per-chat or per-user rate limiting is applied to repeated command traffic
- [ ] Bot replies do not expose wallet addresses, private transactions, pending
      claims, or any data that currently requires a TAUNT JWT
- [ ] Static command content (`/therapy`, `/ngmi`, `/start`) is stored in code or
      configuration under review control rather than editable user content
- [ ] Structured logging captures command name, chat type, success/failure, and
      resolver source without logging secrets or full raw webhook bodies

### FR-6: Explicit V2 Deferrals And Non-Goals

V1 is intentionally not a Telegram identity or gameplay transport layer. The
following items are deferred so the implementation stays small and aligned with
the current product checklist.

**Acceptance Criteria:**
- [ ] V1 does not implement Telegram account linking to TAUNT accounts
- [ ] V1 does not implement `/stats`
- [ ] V1 does not implement `/challenge @tg_user <game>`
- [ ] V1 does not depend on inline-mode share cards, `switch_inline_query`, or a
      Telegram Web App flow
- [ ] V1 does not require the bot to join a target group before a user can share
      a challenge link from the webapp

---

## Success Criteria

- A Telegram user can use the command bot without linking a wallet
- A TAUNT player can share a challenge link to Telegram from the webapp with one
  tap using standard Telegram share UX
- The Telegram service reuses the existing public profile contract and introduces
  only the minimum new contract surface needed for referral and Dogpile reads
- V1 stays small enough to ship without a second Telegram identity system or a
  complex Telegram-specific backend extension

---

## Dependencies

- Telegram Bot API webhook/update contract
- Existing backend public data contracts plus the new `telegram/` service
- Public profile lookup contract in `backend/src/routes/public-profile.ts`
- Referral link format from `docs/specs/300-referral-system/spec.md`
- Canonical web routes in `webapp/src/lib/routes.ts`

## Assumptions

- Frontend UI work remains in the separate webapp repo; this spec only defines
  the link/data contract for Telegram sharing
- The bot is allowed to return formatted text and inline URL buttons, but not to
  impersonate a user or post into arbitrary chats on the user's behalf
- The dedicated `telegram/` service is small enough to own only Telegram
  concerns while delegating public game/profile data reads to the backend
- The public app base URL differs by environment and must not be hardcoded in
  command handlers

---

## Validation Plan

| # | Acceptance Criterion | Validation Method | Evidence Required |
|---|---------------------|-------------------|-------------------|
| 1 | V1 runtime boundary is separate and stateless | Inspect `telegram/` service wiring and config | File references for bot module, config, and startup wiring |
| 2 | Command registry matches the v1 command set | Read command handler/dispatcher tests | Test output plus command table reference |
| 3 | `/profile` uses only public data | Call command handler with public identifier fixture | Response snapshot with no wallet/private data |
| 4 | `/referral` works without JWT | Call public/server-side resolver for player with and without code | Response snapshots for both states |
| 5 | `/wen` works without JWT | Call Dogpile resolver against active/scheduled/null fixtures | Response snapshots showing each state |
| 6 | Telegram share URL builder is canonical | Unit-test generated share links for Flip You, Pot Shot, and Close Call using base game routes and share-text context | Assertions against encoded `t.me/share/url` output |
| 7 | Static content is controlled and safe | Inspect allowlists for `/therapy` and `/ngmi` | File references and tests |
| 8 | Abuse controls are in place | Exercise webhook verification and rate limit tests | Passing tests plus log-safe assertions |

---

## Completion Signal

### Implementation Checklist
- [x] [docs] Add `docs/specs/302-telegram-bot/spec.md`
- [x] [docs] Add spec 302 to the `docs/SCOPE.md` spec index
- [ ] [telegram] Add bot config for token, webhook verification, backend base URL, and public app URL
- [ ] [telegram] Add the Telegram webhook/runtime service in the `telegram/` submodule
- [ ] [telegram] Implement the v1 command registry and handlers
- [ ] [backend] Add a public/server-side referral resolver for stateless bot use
- [ ] [backend] Add a Dogpile resolver path/helper that does not depend on end-user JWTs
- [ ] [web-contract] Document the canonical frontend-owned Telegram share URL builder and route mapping for Flip You, Pot Shot, and Close Call
- [ ] [test] Add Telegram-service tests for command parsing and command responses, plus backend tests for public referral and Dogpile reads
- [ ] [test] Add local deterministic E2E coverage in `e2e/local/**` only if a browser-accessible share-launch surface is added in this repo; otherwise mark N/A with evidence because the webapp lives elsewhere
- [ ] [test] Add visual coverage in `e2e/visual/**` only if this repo gains an owned browser surface for Telegram launch; otherwise mark N/A with evidence
- [ ] [test] Mark devnet real-provider E2E N/A unless the bot starts depending on on-chain state beyond existing backend reads

### Testing Requirements

The agent MUST complete ALL before outputting the completion signal:

#### Code Quality
- [ ] All existing tests pass
- [ ] New tests added for new functionality
- [ ] No lint errors

#### Functional Verification
- [ ] All acceptance criteria verified
- [ ] Edge cases handled
- [ ] Error states handled

#### Integration Verification
- [ ] API/contracts documented for public profile, referral resolution, Dogpile resolution, and Telegram share URL generation
- [ ] Webhook verification and rate limiting tested end-to-end at the handler level
- [ ] Non-goals verified: no Telegram account linking or JWT-dependent bot flows in v1

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
`/gap-analysis 302 --non-interactive` which:
1. Audits every FR acceptance criterion against the codebase
2. Writes `docs/specs/302-telegram-bot/gap-analysis.md` with inventory + audit + recommendations
3. Annotates FR checkboxes with HTML comment evidence (`<!-- satisfied: ... -->`)
4. Commits everything together with the completion commit
