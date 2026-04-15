# Phase 0 — Verify & Decide (Week 1)

**Goal:** Kill dead-end assumptions before writing a line of code.
**Duration:** 5 working days.
**Exit:** a signed decision memo (section 5) with all checkpoints GREEN.

If any checkpoint comes back RED, we stop and reassess the architecture before starting Phase 1. This is the cheapest week in the entire project — use it.

---

## 1. Checkpoint summary

| # | Checkpoint | Owner | Evidence needed | Target completion |
|---|---|---|---|---|
| C1 | Pimlico paymaster + bundler on Monad mainnet | Eng | Live endpoint + reference customer | Day 2 |
| C2 | Yellow Card: NGN card → USDC on Monad | Eng + BD | 10-card test, <15% decline | Day 4 |
| C3 | Privy smart wallet on Monad | Eng | Working end-to-end auth → wallet address → signed tx | Day 2 |
| C4 | Legal memo: Nigerian regulatory posture | Legal | Written memo from counsel | Day 5 |
| C5 | Merchant-of-Record decision | BD + Legal | Confirmed from on-ramp provider | Day 4 |
| C6 | Refund policy template | Product | Approved template | Day 3 |
| C7 | KYC tier policy | Product + Legal | Tiered matrix | Day 4 |
| C8 | FX spread policy | Finance | Documented spread + pass-through rules | Day 3 |
| C9 | One operator meeting booked for Phase 1 | BD | Confirmed calendar | Day 5 |

---

## 2. Vendor verification emails

### 2.1 Pimlico (paymaster + bundler)

**To:** bd@pimlico.io (plus your account rep if you have one)
**Subject:** Monad mainnet readiness — production paymaster for Nigerian transit app

---

Hi team,

We're ChainPass, building a multi-operator transit ticketing marketplace on Monad for the Nigerian market. Our architecture depends on ERC-4337 smart wallets with sponsored gas, and we're evaluating Pimlico as our primary paymaster + bundler provider.

Before we commit, we need to confirm a few things:

1. **Monad mainnet status.** Is your paymaster and bundler infrastructure fully live on Monad mainnet (not just testnet)? What's your current uptime SLA on Monad specifically?
2. **Reference customer.** Can you share one production-grade customer running on Monad today, ideally with volume > 10k UserOps/day?
3. **Verifying paymaster.** We plan to run our own off-chain policy server that signs UserOps, with your verifying paymaster contract on-chain. Is this your recommended pattern for our use case?
4. **Pricing.** What's the pricing model on Monad — flat fee per UserOp, percentage of gas, or subscription?
5. **Failover.** If your bundler has a regional outage, what's the recovery path? Can we run a backup bundler with your infrastructure as failover, or is self-hosted the answer?
6. **Rate limits.** What are the rate limits on the sponsorship API? We expect bursty peaks (end-of-month, holidays) around 10x baseline.

We're in an evaluation sprint — would value a 30-minute call this week with someone technical.

Best,
[Name]
ChainPass Transit

---

### 2.2 ZeroDev (backup paymaster + smart wallet SDK)

**To:** bd@zerodev.app
**Subject:** Monad mainnet smart wallet + paymaster — evaluation for Nigerian transit

---

Hi team,

ChainPass is building a transit marketplace on Monad and evaluating smart-wallet + paymaster stacks. We're comparing ZeroDev against Pimlico, and want to understand where ZeroDev is strongest for our profile.

Quick questions:

1. Is Kernel smart account + ZeroDev paymaster fully production on Monad mainnet?
2. Do you support email/phone + passkey login natively, or do we pair with Privy/Dynamic?
3. Pricing on Monad?
4. Session keys — do you support scoped session keys (e.g. "this session can only mint tickets, not transfer USDC")? We want to avoid a signing prompt per ticket.
5. Any production reference on Monad?

A 30-minute call this week would help.

Best,
[Name]

---

### 2.3 Yellow Card (on-ramp)

**To:** api@yellowcard.io / bd@yellowcard.io
**Subject:** NGN card → USDC on Monad — API evaluation for ChainPass Transit

---

Hi team,

ChainPass is building a transit ticketing marketplace for Nigerian institutional operators (ABC Transport, GIGM, Chisco, etc.). Our users will top up with Nigerian debit cards and receive USDC on Monad to purchase tickets.

We need to evaluate your API for:

1. **Chain support.** Do you settle USDC to Monad mainnet today? If not, what's the roadmap?
2. **Nigerian card decline rate.** What's your current decline rate for cards issued by GTBank, Access, UBA, Zenith, First Bank? We need <15% to proceed.
3. **Merchant-of-Record.** What appears on the cardholder's bank statement after a top-up? We want to co-brand as "CHAINPASS" if possible.
4. **KYC flow.** What KYC is required at what top-up tiers? We want a tiered approach (₦5k/day anonymous, ₦50k/day with BVN, higher with full KYC).
5. **Webhook reliability.** Top-up confirmation webhooks — what's the retry policy, signature scheme, and p99 latency?
6. **Chargebacks.** Your policy on card chargebacks — who bears the loss, us or you? What's the dispute timeline?
7. **Pricing.** Spread on NGN → USDC, plus any per-transaction fees.
8. **Failed top-up handling.** If a card is charged but USDC delivery fails (chain issue, KYC flag), what's the reversal path and timeline?

For our evaluation sprint, we'd like to run **10 test top-ups** this week with real Nigerian cards from different banks. Can we get sandbox + production credentials scoped for this?

Best,
[Name]
ChainPass Transit

---

### 2.4 Privy (wallet auth)

**To:** sales@privy.io
**Subject:** Monad smart wallet + phone/email auth — evaluation

---

Hi team,

Building a transit app on Monad targeting Nigerian institutional operators. Non-crypto-native users — must sign in with phone or email, no seed phrases, no MetaMask.

Questions:

1. Do you support Monad mainnet in production? Smart wallet provisioning, signing?
2. Phone-number auth for Nigerian numbers — any known issues with Nigerian SMS providers?
3. Embedded vs external smart wallet — do you prefer we use your embedded wallet paired with a ZeroDev / Pimlico paymaster, or something else?
4. Session keys — can a user grant a time-bound permission so we don't prompt on every mint?
5. Pricing on Monad?

A 30-minute call would help. We'd like to decide within 5 business days.

Best,
[Name]

---

### 2.5 Onramp Money (backup on-ramp)

**To:** support@onramp.money
**Subject:** NGN card → USDC on Monad — evaluation

---

(Same structure as Yellow Card email above. Keep this conversation warm as a fallback in case Yellow Card economics or decline rates don't work for us.)

---

## 3. Card decline-rate test plan

**Objective:** Prove we can take money from a Nigerian rider using their normal debit card with <15% decline rate.

**Setup:**
- Coordinate with Yellow Card for test credentials (section 2.3)
- Recruit 10 testers from different Nigerian banks
- Small amounts to avoid CBN daily limit issues

**Test matrix:**

| Tester | Bank | Card type | Amount | Result | Decline reason (if any) |
|---|---|---|---|---|---|
| 1 | GTBank | Verve | ₦2,000 | | |
| 2 | GTBank | Mastercard | ₦5,000 | | |
| 3 | Access | Verve | ₦2,000 | | |
| 4 | Access | Visa | ₦10,000 | | |
| 5 | UBA | Verve | ₦5,000 | | |
| 6 | UBA | Mastercard | ₦15,000 | | |
| 7 | Zenith | Visa | ₦5,000 | | |
| 8 | Zenith | Mastercard | ₦20,000 | | |
| 9 | First Bank | Verve | ₦3,000 | | |
| 10 | Fidelity / Sterling | any | ₦5,000 | | |

**Measurement:**
- Success = USDC arrives in the target Monad address within 5 minutes, no rider intervention needed
- Partial = card charged but USDC takes >5 minutes, or requires KYC upload mid-flow
- Decline = card rejected, or charge reversed within 24h

**Decision rule:**
- **≥85% success:** proceed with Yellow Card as primary
- **60–85% success:** investigate failures; if fixable, proceed; if not, run same test on Onramp Money before committing
- **<60% success:** block Phase 1, escalate — the entire architecture may need rethinking (local PSP + custodial model)

**Budget:** ₦100k total for test charges. All refunded to testers at end of week.

---

## 4. Legal memo — questions for counsel

Send to a Nigerian fintech-specialised law firm (e.g. Olaniwun Ajayi, Templars, Banwo & Ighodalo). Budget ₦500k–₦1.5M for the memo.

### 4.1 Licensing

1. Does our model require a Payment Service Provider (PSP) or Payment Solution Service Provider (PSSP) licence from the CBN?
2. Does the operator treasury holding USDC constitute "engaging in crypto business" under current CBN circulars?
3. If riders hold USDC in smart wallets we control the infrastructure for, are we a custodian under Nigerian law? Does this trigger SEC registration?
4. Yellow Card is a licensed VASP — does our use of their API insulate us, or do we still need our own licence?

### 4.2 Tickets as securities / instruments

1. Are ERC-721 tickets, as designed, classified as securities, utility tokens, or transport tickets under Nigerian law?
2. Does secondary-market transferability (rider → rider) change this classification?
3. Are we required to register the NFT issuance with the SEC?

### 4.3 Consumer protection

1. Refund rules under the Federal Competition and Consumer Protection Commission (FCCPC) — are our proposed refund windows compliant?
2. Chargeback handling — what are operator and platform liabilities if a rider disputes a card charge after using the ticket?
3. Data protection (NDPR) — what registrations and notifications are required?

### 4.4 Operator contracts

1. Draft a template operator agreement covering: platform fee, settlement, data ownership, termination, SLA, liability caps.
2. KYB requirements we must verify before onboarding an operator.
3. Liability structure if an operator cancels a schedule and can't fund refunds.

### 4.5 Cross-chain & FX

1. Any restrictions on USDC-NGN conversion that apply to us (as platform) separate from the rider's transaction?
2. Tax treatment of platform fees earned in USDC.

**Deliverable from counsel:** written memo, 5–10 pages, covering the above with concrete recommendations (not "it depends"). Timeline: 5 business days.

---

## 5. Decision memo (template — to be signed by end of Week 1)

### 5.1 Stack commitment

| Layer | Decision | Alternative considered | Reason |
|---|---|---|---|
| Chain | Monad mainnet | Base, Polygon | [fill] |
| Smart wallet SDK | Privy / ZeroDev | [fill] | [fill] |
| Paymaster + bundler | Pimlico / ZeroDev | [fill] | [fill] |
| On-ramp | Yellow Card | Onramp Money | [fill] |
| Settlement asset | USDC | cNGN | Liquidity; Monad availability |
| Stablecoin address | [Monad USDC address] | — | Canonical |

### 5.2 Merchant-of-Record on card receipts

- [ ] Rider's bank statement will show: `__________________`
- [ ] Confirmed with on-ramp provider on date: `__________________`

### 5.3 Refund policy (default template — operators can override)

| Window | Refund amount |
|---|---|
| > 24h before departure | 100% minus ₦500 processing |
| 24h – 2h before departure | 50% |
| < 2h before departure | 0% |
| Operator cancels schedule | 100%, no fee |

### 5.4 KYC tier policy

| Tier | Top-up limit / day | Total balance cap | Requirements |
|---|---|---|---|
| Tier 0 (no KYC) | ₦5,000 | ₦20,000 | Phone + OTP |
| Tier 1 | ₦50,000 | ₦200,000 | + BVN |
| Tier 2 | ₦500,000 | ₦2,000,000 | + ID document (NIN/passport/driver's) |

Values to be confirmed with legal counsel (section 4) before committing.

### 5.5 FX spread policy

- **Top-up:** Yellow Card's quoted rate passes through unchanged to the rider. We do **not** add a spread on top-up.
- **Off-ramp (operator → NGN bank):** 1% spread, disclosed in operator dashboard.
- **Rate display:** Rider sees the exact naira amount charged, no hidden spread.
- **Rate lock:** At booking, we lock the NGN price for the reservation window (90s). If FX moves adversely during hold, we absorb the delta.

### 5.6 Hard constraints locked for Phase 1+

- **No hardcoded routes.** All routes come from on-chain + DB, no frontend constants.
- **Every protected endpoint is operator-scoped.** No exceptions.
- **All user-facing transactions are gasless.** No rider ever sees a "pay gas" prompt.
- **All prices are rendered in naira.** Riders never see "USDC" unless they opt into an advanced view.

### 5.7 Checkpoint status (sign-off)

| Checkpoint | Status | Notes |
|---|---|---|
| C1 Pimlico live on Monad | [ ] GREEN / [ ] YELLOW / [ ] RED | |
| C2 Yellow Card decline rate | [ ] GREEN / [ ] YELLOW / [ ] RED | Result: ___% success |
| C3 Privy smart wallet | [ ] GREEN / [ ] YELLOW / [ ] RED | |
| C4 Legal memo received | [ ] GREEN / [ ] YELLOW / [ ] RED | |
| C5 MoR confirmed | [ ] GREEN / [ ] YELLOW / [ ] RED | |
| C6 Refund policy approved | [ ] GREEN / [ ] YELLOW / [ ] RED | |
| C7 KYC tier approved | [ ] GREEN / [ ] YELLOW / [ ] RED | |
| C8 FX spread approved | [ ] GREEN / [ ] YELLOW / [ ] RED | |
| C9 Operator meeting booked | [ ] GREEN / [ ] YELLOW / [ ] RED | |

**Decision:** All GREEN → start Phase 1 on Monday of Week 2.
Any RED → reconvene to replan before touching code.

Signed (founder / lead): ______________________
Date: ______________________

---

## 6. Operator outreach (parallel track)

Engineering alone doesn't get us to pilot — we need an operator champion in Week 1, not Week 12.

### 6.1 Target list (prioritised)

| # | Operator | Why them | Warm intro available? |
|---|---|---|---|
| 1 | GIGM | Tech-forward, already digitised | [fill] |
| 2 | ABC Transport | Market leader, volume | [fill] |
| 3 | Chisco | Multi-route network | [fill] |
| 4 | GIG Logistics (passenger arm) | Brand strength | [fill] |
| 5 | Libra Motors | Lagos–SE corridor | [fill] |
| 6 | Young Shall Grow | Volume | [fill] |
| 7 | Cross Country | Regional | [fill] |

### 6.2 First-email template

**Subject:** Lower card processing fees for ABC Transport — 20-minute call?

Hi [name],

I'm [name] at ChainPass Transit. We've built a ticketing platform that delivers three things to operators like ABC:

1. **1.5% flat per-ticket fee** (vs the 2.5–4% total you're likely paying today across PayStack + your booking platform)
2. **Instant settlement** — money in your treasury the moment a ticket is sold, no T+2 delay
3. **Tickets that can't be faked** — every ticket is cryptographically verified at boarding

We're opening a pilot program with 2–3 operators this quarter. No setup fee, no monthly fee, 30-day commitment. If the numbers don't beat your current setup, we walk away.

Would a 20-minute call next week work? I can come to your office if you're in Lagos.

[Name]
[Phone]
[Email]

**Attach:** `OPERATOR_PITCH.md` exported as PDF.

### 6.3 What "success" for Week 1 operator outreach looks like

- [ ] 7 emails sent
- [ ] 3 responses
- [ ] 1 confirmed meeting for Week 2 or 3
- [ ] 1 pilot route identified (even if meeting not yet held)

---

## 7. Week 1 timeline

| Day | Engineering | BD / Product | Legal / Finance |
|---|---|---|---|
| Mon | Send Pimlico + Privy + ZeroDev emails | Send 7 operator outreach emails | Engage counsel, send brief |
| Tue | Pimlico + Privy calls; set up test environment | Follow up on operator emails | |
| Wed | Begin Privy smart wallet E2E test on Monad | Yellow Card call + credentials | Refund/KYC/FX drafts from product |
| Thu | Yellow Card integration scaffolding; recruit 10 testers | Any operator meetings that materialise | MoR confirmation |
| Fri | Run 10-card decline test; write checkpoint results | Close week with operator pipeline review | Legal memo received; decision memo assembled and signed |

---

## 8. What happens if something goes RED

- **C1 RED (Pimlico not ready):** Shift to ZeroDev. If both are not ready, shift to EIP-2771 meta-tx pattern (simpler, no 4337, runs on our own relayer). Phase 3 reshapes.
- **C2 RED (card decline rates):** Fall back to Onramp Money. If also bad, consider USSD-to-stablecoin via a local exchange (Busha, Quidax) or a custodial naira balance model (with the licensing implications that creates).
- **C3 RED (Privy on Monad):** Switch to Dynamic or a direct Kernel integration. Worst case, WalletConnect + EOA (ugly for our audience but functional).
- **C4 RED (legal blocker):** Whole programme pauses until we understand the gap. Do not code past this.
- **C9 RED (no operator meetings):** Do not start Phase 1. If we can't get one operator to take a meeting, the engineering work is speculative. Pivot BD approach — maybe warmer intros via transport associations, maybe advisor/investor network.

---

**Bottom line:** Phase 0 is cheap. Phase 1–8 is expensive. Every day of Phase 0 saves a week downstream.
