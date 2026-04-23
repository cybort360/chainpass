# Hoppr for Transit Operators

**Audience:** Head of Operations / COO / MD at private intercity operators (ABC, GIGM, Chisco, GIG, Libra, etc.)
**Format:** First-meeting document. Hand this over, walk through it in 20 minutes.
**Goal:** Leave the meeting with a second meeting booked and a pilot route identified.

---

## The problem you're already paying for

Every ticket you sell today costs you:

| Cost line | Typical rate |
|---|---|
| Payment processor (card acquiring) | 1.4% + ₦100 |
| Booking platform or in-house dev team | ₦500k–₦2M/month |
| Chargeback handling (fraud, disputes) | 0.3–1.2% of revenue |
| Settlement delay (T+2 or T+3 to your bank) | Cash flow drag |
| Double-booking refunds | Reputation + operational cost |

Realistic total: **2.5–4% of revenue plus a standing ops burden.**

And the things you can't easily solve today:

- A rider shows up with a screenshot, not a real ticket — how do you know?
- A driver collects cash for an "empty seat" that was actually sold online
- Chargebacks hit your account 45 days later, you've already paid the driver
- Your booking platform goes down at peak — you can't take payments
- Scaling to a new terminal means retraining staff on the software

---

## What Hoppr gives you

### 1. Lower per-ticket cost

**1.5% flat**, no monthly fee, no setup fee. That's **40–60% cheaper** than your current payment + platform stack.

### 2. Instant, auditable settlement

USDC lands in your treasury wallet **the moment a ticket is sold**. No T+2. No reconciliation spreadsheets. Every kobo is on a public ledger — if your accountant wants proof of a sale, it's a link.

Want naira in your bank instead? One tap, 1% spread via our Yellow Card rail, NGN at your bank same day.

### 3. Tickets that can't be faked

Each ticket is a unique cryptographic token on the Monad blockchain. Your driver's scanner verifies authenticity in under a second, even offline. A screenshot is worthless — the scanner checks the actual ticket, not a picture of one.

### 4. No more double-bookings

Seats are reserved at the database level the moment a rider starts payment. Two riders cannot buy the same seat. Ever. If a reservation expires or fails, the seat releases automatically.

### 5. Your passengers don't need crypto wallets

They sign up with phone or email, pay with their normal debit card. They see prices in naira. They never hear the words "blockchain" or "USDC." The crypto rails are our problem, not theirs.

### 6. Your drivers don't need expensive hardware

A ₦30,000 Android phone running our scanner app. Works offline at the park, syncs when it has signal. Drivers learn it in 15 minutes.

### 7. You keep control

- Your routes, your schedules, your prices — managed in your operator dashboard
- Your refund policy (set per-route or per-schedule)
- Your brand (white-label option available)
- You can export all your data any time, in CSV or via API

---

## How it works (for your operation)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1.  Your ops team creates schedules in the Hoppr dashboard. │
│     "Lagos → PH, 08:00, 60 seats, ₦8,500, refundable till       │
│      2 hours before departure."                                 │
├─────────────────────────────────────────────────────────────────┤
│ 2.  Passengers book on your website, our app, or both.          │
│     Pay with card. Get a ticket on their phone.                 │
├─────────────────────────────────────────────────────────────────┤
│ 3.  USDC lands in your treasury wallet within seconds.          │
│     Your dashboard shows live sales, live revenue.              │
├─────────────────────────────────────────────────────────────────┤
│ 4.  At the park, your driver scans the ticket QR.               │
│     Scanner shows: seat number, passenger name, boarded ✓       │
├─────────────────────────────────────────────────────────────────┤
│ 5.  End of day, you withdraw to your bank in naira,             │
│     or keep USDC as a hedge.                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## What we're asking for: a 30-day pilot

One route, 30 days, agreed success metrics. If the numbers don't beat your current setup, we walk away, you keep the data.

**What we'll need from you:**

1. One route (ideally a daily-runner like Lagos → Abuja, Lagos → PH, Lagos → Benin)
2. A point person (operations lead) with ~2 hours/week for the pilot
3. 2–3 scanner devices (we supply or you buy, your call)
4. Approval to run a parallel booking channel on that route for 30 days

**What we bring:**

1. Full platform onboarding (your routes, schedules, pricing in the dashboard)
2. Operator dashboard training (1-hour session, screencast, PDF guide)
3. Driver scanner training (15 min per driver, in-person if you're in Lagos/Abuja)
4. Daily check-ins for week 1, weekly for weeks 2–4
5. 24/7 support hotline dedicated to your pilot

---

## Success metrics we'll measure together

| Metric | Pilot target | Why it matters |
|---|---|---|
| Booking completion rate | ≥ 95% | Rider paid → rider has ticket |
| Card payment success rate | ≥ 80% | Nigerian bank cards don't get declined |
| Scan success rate at boarding | ≥ 98% | Drivers are not fighting the tech |
| Settlement accuracy | 100% | Every naira accounted for |
| Chargeback rate | < 0.1% | Fraud reduction vs your baseline |
| Your NPS (at day 30) | ≥ 8/10 | Would you recommend to another operator |

At the end of day 30, we sit together and look at the numbers. You decide: expand to more routes, stay on one, or walk.

---

## Commercial terms (pilot)

- **No setup fee**
- **No monthly fee**
- **1.5% per ticket sold** (deducted from settlement)
- **1% off-ramp to NGN bank** (only if you use it; holding USDC is free)
- **No minimum volume commitment** during pilot
- **Data export on demand** — you own your data

Post-pilot pricing remains 1.5% per ticket sold. White-label (your own branded app) is ₦500,000/month flat, optional.

---

## Common questions

**"Is this legal in Nigeria?"**
Yes. We operate as a payments and ticketing platform. Card processing is handled by our licensed partner (Yellow Card). We're not asking you or your passengers to hold or trade cryptocurrency — the blockchain is backend plumbing, like how your bank uses SWIFT.

**"What if Hoppr goes down?"**
Your data and your tickets are on a public blockchain, not locked in our database. If we disappeared tomorrow, your issued tickets are still valid, and any developer could build you a new scanner. You're not locked in.

**"What if CBN changes crypto rules again?"**
Our architecture separates the passenger experience (naira, card, normal) from the backend ledger. Even in a restrictive regulatory environment, the operator-facing experience is unaffected. We've designed a fiat-only fallback mode for this scenario.

**"Our IT team says blockchain is too complex."**
Your IT team doesn't touch the blockchain. They touch a dashboard and an API — same as any other SaaS. The complexity is ours.

**"What about our existing booking website?"**
You keep it. We offer a widget you embed on your site (your branding, our rails), or an API if your developers want to integrate deeper. You don't have to move to our app.

**"What's the catch?"**
Honest answer: we're a new company. You're betting on us staying around. We mitigate this with:
- Your data is exportable and owned by you
- Your tickets are on a public blockchain, not our servers
- Pilot has no lock-in — walk at day 30 if it doesn't work
- We're happy to discuss escrow/source-code arrangements for larger contracts

---

## Next steps

1. **Meeting #2, within 2 weeks** — we come back with a pilot plan tailored to your chosen route (pricing, schedule times, refund policy drafted from your current rules)
2. **Pilot kickoff, within 4 weeks** — dashboard access, scanner training, passenger-facing launch
3. **Day 30 review** — we sit together with the numbers

---

**Contact**
Hoppr Transit
[contact email]
[contact phone]
[website]
