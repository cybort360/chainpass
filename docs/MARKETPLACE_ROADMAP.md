# ChainPass Transit Marketplace — Build Roadmap

**Owner:** ChainPass
**Target:** Multi-operator intercity transit marketplace (Nigeria-first)
**Customer tiers:** Private intercity (ABC, GIGM, Chisco, GIG, Libra), concessioned urban (BRT), rail (NRC — later)
**Timeline:** ~12–14 weeks to pilot-ready with a small team (1 full-stack, 1 contract, 1 design, 0.5 BD)
**Chain:** Monad
**Settlement asset:** USDC (rider holds USDC; displayed as ₦ at live FX)
**Wallet model:** Smart wallets via Privy/Dynamic, gasless via Pimlico paymaster
**On-ramp:** Nigerian card → USDC via Yellow Card (or equivalent)

---

## 1. Target customer & scope

Nigerian institutional transit operators. Three tiers, different sales motions.

| Tier | Examples | Sales cycle | Priority |
|---|---|---|---|
| **Private intercity** | ABC Transport, GIGM, Chisco, GIG, Libra | 1–3 months | ★ Primary — lead with these |
| **Concessioned urban** | Primero (Lagos BRT), AUMTCO (Abuja) | 3–6 months | ★ Second wave |
| **State-owned rail** | NRC | 6–18 months | ☆ Only after case studies from Tier 1 |

**Explicitly out of scope for v1:**
- Informal transit (danfo, okada, keke) — different UX, different price point, different trust model
- International routes (Lagos → Accra etc.) — adds currency, regulatory, and visa surface
- Freight / parcels — separate product

---

## 2. Architecture at a glance

```
┌─────────────────────────────────────────────────────────────────┐
│ Rider app (React)                                               │
│   Privy auth → smart wallet → operator picker → schedule →      │
│   seat → gasless mint → QR ticket                               │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────────┐
│ ChainPass API (Express/Postgres)                                │
│   Operator CRUD, schedule CRUD, reservation holds,              │
│   paymaster policy, on-ramp webhooks, indexer                   │
└─────────────────────────────┬───────────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────────┐
│ Monad smart contracts                                           │
│   OperatorRegistry, ScheduleRegistry, TicketNFT v2,             │
│   Paymaster, EntryPoint (ERC-4337)                              │
└─────────────────────────────────────────────────────────────────┘
       ↑                                           ↑
┌──────┴──────┐                           ┌────────┴────────┐
│ Yellow Card │  NGN card → USDC          │ Pimlico bundler │
│   on-ramp   │                           │   + paymaster   │
└─────────────┘                           └─────────────────┘
```

---

## 3. Phase-by-phase build plan

Each phase has a goal, a checklist, and an exit criterion. At the end of every phase: GREEN (proceed), YELLOW (fix-forward in parallel), or RED (stop and reassess).

### Phase 0 — Verify & decide (Week 1)

**Goal:** Kill dead-end assumptions before writing code.

**Checkpoints (all must be GREEN before Phase 1):**

- [ ] Pimlico production paymaster + bundler live on Monad mainnet with acceptable SLA
- [ ] Yellow Card (or fallback: Onramp Money) accepts Nigerian cards and delivers USDC to a Monad address; decline rate <15% on a 10-card test
- [ ] Privy (or Dynamic) SDK supports Monad; email + passkey flow tested end-to-end on a burner phone
- [ ] Legal memo drafted: MSB-equivalent licensing for Nigeria; CBN stance on crypto acquiring; SEC stance on NFT tickets
- [ ] Merchant-of-Record decision: does the card receipt say "CHAINPASS" or "YELLOWCARD"? Confirmed with provider.
- [ ] Refund policy template approved (e.g. 100% up to T-24h, 50% T-24h to T-2h, 0% after T-2h; per-operator override)
- [ ] KYC tier policy approved (tiered by daily spend limits)
- [ ] FX spread policy approved (what we charge on top-up, what we pass through, what we keep)

**Deliverable:** 2-page decision memo + a signed internal commitment to the stack. Do not start Phase 1 if any checkpoint is red — pivot first.

---

### Phase 1 — Multi-tenant foundation (Weeks 2–3)

**Goal:** Data model supports N operators. Existing product keeps working under "operator #1."

- [ ] Migration: `operators` table (`id`, `slug`, `name`, `admin_wallet`, `treasury_wallet`, `status`, `logo_url`, `contact_email`, `created_at`)
- [ ] Migration: add `operator_id` FK to `route_labels`, `burners`, `schedules`, `mints` (nullable → backfill → NOT NULL)
- [ ] Backfill: insert "ChainPass Transit" as operator #1; attach all current rows
- [ ] API middleware: every authenticated endpoint scoped by caller's operator (`/routes`, `/burners`, `/schedules`)
- [ ] API: `GET /operators` (public directory), `GET /operators/:slug` (public detail)
- [ ] Client: new operator-picker screen behind a feature flag; single-operator UX unchanged until toggled
- [ ] Tests: existing 49 API tests green; add ~10 tests for cross-operator isolation (must return 403 on cross-operator reads/writes)

**Exit criteria:** Staging deploy, end-user flow visually identical, cross-operator access attempts denied.

---

### Phase 2 — Smart contract v2 (Weeks 3–5, in parallel with Phase 1)

**Goal:** Contracts support multi-operator, schedules, seats, refunds, and gasless mints.

See `CONTRACT_SPEC_V2.md` for the full interface spec.

- [ ] Design doc finalised: interfaces, storage layout, upgradeability decision (proxy vs immutable)
- [ ] Implement `OperatorRegistry` (registerOperator, per-operator admin role, treasury address)
- [ ] Implement `ScheduleRegistry` (createSchedule, cancelSchedule, signed seat-claim scheme)
- [ ] Implement `TicketNFT v2` (mintSeat, batchMintSeats, cancelSeat, transferFrom, metadata)
- [ ] Refund logic: per-schedule time windows, per-operator fee schedule
- [ ] EIP-2771 trusted forwarder support (for meta-tx / paymaster path)
- [ ] Test suite: target >95% line coverage on contracts
- [ ] Internal audit pass + fix
- [ ] External audit (budget: $15k–30k, mid-tier firm, 1–2 weeks)
- [ ] Deploy to Monad testnet; burn-in for 7 days
- [ ] Deploy to Monad mainnet

**Gate before mainnet:** Audit clean + testnet stable >7 days.

---

### Phase 3 — Smart wallet + paymaster (Weeks 5–7)

**Goal:** User signs in with phone/email, gets a smart wallet, all transactions are gasless.

- [ ] Privy (or Dynamic) integrated: phone/email → passkey → smart wallet address provisioned
- [ ] Lazy deploy: smart wallet contract deployed on first on-chain action, not signup
- [ ] Paymaster policy server: `/paymaster/sponsor` endpoint with full policy checks (auth, rate limit, target allowlist, method allowlist, semantic checks, bundler simulation, signature)
- [ ] Paymaster contract funded with MON; ops script to top up and alert when <7 days runway
- [ ] Observability: Grafana dashboard — $ sponsored/day, success rate, per-operator breakdown
- [ ] Rate limits (rider: 20/day, operator: 200/day, admin: unlimited)
- [ ] Abuse protection: reject sponsorship of tx that would revert (balance/target/nonce checks)
- [ ] E2E test: new user signs up → mints a seat → zero prompts for gas token

**Exit:** 10 end-to-end runs, 100% success, no "approve gas" prompts anywhere in UX.

---

### Phase 4 — On-ramp + balance (Weeks 7–8)

**Goal:** User tops up with a Nigerian card. Sees ₦ balance. Never sees the word "USDC."

- [ ] Yellow Card integrated: initiate top-up → card form (hosted, PCI-safe) → webhook on completion
- [ ] Top-up UX: "Add ₦" button, amount entry, card form, confirmation, pending state
- [ ] Balance display: reads `USDC.balanceOf(smartWallet)`, rendered as "₦X" at live FX rate
- [ ] FX disclosure: show rate at top-up and at purchase (transparency vs deception)
- [ ] Transaction history: top-ups, ticket purchases, refunds — unified list
- [ ] Edge cases handled: pending, failed, refunded, disputed, partial
- [ ] Decline telemetry: log bank, amount, error code for every decline; feed into weekly review

**Exit:** Real card charge from a Nigerian bank card → USDC on Monad → displayed as naira. Decline rate measured across 10+ distinct test cards.

---

### Phase 5 — Booking flow (Weeks 8–10)

**Goal:** End-to-end rider purchase of a scheduled intercity trip with seat selection.

- [ ] Operator picker screen (featured + search)
- [ ] Route picker (origin/destination or route list, scoped to operator)
- [ ] Schedule picker (calendar + time slots, next 7/30 days)
- [ ] Seat selection grid (bus layout SVG, live availability via short-poll or WebSocket)
- [ ] Reservation hold (server-side 90s TTL, UI countdown)
- [ ] Payment confirmation screen (shows price, FX, refund policy)
- [ ] Gasless mint with paymaster; success state shows ticket
- [ ] Ticket display: QR, route, seat, departure time, operator branding
- [ ] Email + SMS confirmation on successful mint

**Exit:** 20 successful test bookings across 2 test operators. Median p50 < 2s from "confirm" to "ticket shown."

---

### Phase 6 — Operator portal (Weeks 9–11, in parallel with Phase 5)

**Goal:** Operators self-serve everything short of the initial approval.

- [ ] Operator signup: company details, contact, wallet connect, KYB document upload
- [ ] Admin approval queue (internal): review docs, approve/reject/request more
- [ ] Operator dashboard home: today's sales, upcoming departures, treasury balance
- [ ] Route CRUD (scoped to operator; extends existing OperatorPage)
- [ ] Schedule management: single + bulk (recurring) creation; cancel with auto-refund
- [ ] Burner management: add/remove scanner device keys
- [ ] Treasury & withdrawals: pull USDC to external wallet, or off-ramp to NGN bank
- [ ] Analytics: sales by route, refund rate, cancellation rate, settlement timeline

**Exit:** One operator (internal test or friendly partner) runs the full flow — 10 schedules, scan tickets, withdraw USDC — without support intervention.

---

### Phase 7 — Post-purchase flows (Weeks 11–12)

**Goal:** Everything after the mint.

- [ ] Rider-initiated refund (within window)
- [ ] Operator-initiated cancellation with auto-refund-all
- [ ] Ticket transfer (gift to another user)
- [ ] Ticket visible in third-party wallets (Rainbow, Zerion) — metadata standards compliant
- [ ] Scanner app: offline-capable scan, queue-and-reconcile when online
- [ ] Boarding status: scanned / boarded / no-show

---

### Phase 8 — Pilot hardening (Weeks 12–14)

**Goal:** Ready to put a real institutional operator on the platform without embarrassment.

- [ ] Operator training: PDF guide + 5-min screencast + scanner setup one-pager
- [ ] Support runbook: top 20 rider issues, top 10 operator issues, escalation paths
- [ ] Monitoring: uptime, API p95, paymaster runway, scan success rate, card decline rate
- [ ] On-call rotation + incident playbook
- [ ] Load test: booking flow at 10× expected peak
- [ ] Launch: one operator, one route, 30-day measured pilot

**Exit:** Signed pilot agreement with one Tier 1 operator; go-live date set.

---

## 4. Commercial model

- **Operator onboarding:** free (no setup fee)
- **Per-ticket platform fee:** 1.5% of ticket value
- **White-label option:** ₦500,000/month flat for operators who want their own branded app
- **Payout:** daily USDC to operator treasury
- **Optional off-ramp:** NGN to operator bank via Yellow Card rail, 1% spread

Target: undercut the incumbent stack (PayStack ~3% + booking platform fees) while delivering faster settlement and chargeback reduction.

---

## 5. Top risks

### R1 — Nigerian card decline rates
If Yellow Card's decline rate is >25% on Nigerian cards, on-ramp UX is broken regardless of how clean the wallet provisioning is.
**Mitigation:** Test 10 cards across GTB, Access, UBA, Zenith, First Bank in Phase 0. Have USSD-to-stablecoin (via local exchange API) as a backup rail.

### R2 — Monad bundler reliability
New chains have flaky infra. If Pimlico's bundler has an outage during pilot, riders can't board buses.
**Mitigation:** Budget for running a backup bundler in Phase 3–4 even if Pimlico is primary. Status-page alerts + failover config.

### R3 — Institutional sales latency
Engineering can ship all 14 weeks and still have zero customers if sales lags.
**Mitigation:** Start operator conversations in Week 1. Let LOIs drive priority — if ABC says "multi-passenger booking is non-negotiable," Phase 5 reshapes.

### R4 — Regulatory shift (CBN / SEC)
Nigerian crypto policy has whipsawed before. A sudden restriction on card-to-crypto rails could kill on-ramp overnight.
**Mitigation:** Operator treasury model (operator holds USDC, not rider) reduces exposure. Keep a fiat-only fallback architecture designed (even if not built).

### R5 — Contract exploit
A mint or refund exploit = irreversible fund loss + reputational death.
**Mitigation:** External audit before mainnet. Bug bounty post-launch. Per-operator daily mint/refund caps as a circuit breaker.

---

## 6. Success metrics for pilot

30-day pilot with one Tier 1 operator on one route. Success = all four:

| Metric | Target |
|---|---|
| Booking success rate (start → ticket in wallet) | ≥ 95% |
| Card top-up success rate | ≥ 80% |
| Scan success rate at boarding | ≥ 98% |
| Operator NPS (end of pilot) | ≥ 8/10 |

If any miss, extend pilot and fix root cause before scaling to operator #2.

---

## 7. What comes after pilot

- Operator #2 and #3 onboarded (different regions/corridors)
- Multi-passenger + group booking
- Corporate accounts (invoice billing)
- Loyalty / rewards program
- Route-discovery (rider types "Lagos to Abuja," sees all operators)
- Ticket resale marketplace (with operator-set rules)
- Open API for third-party booking integrations
- Expansion into concessioned urban (Lagos BRT) — requires state-level conversations
