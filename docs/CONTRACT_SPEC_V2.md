# Hoppr Contract v2 — Specification

**Target chain:** Monad mainnet
**Solidity:** ^0.8.24
**Standards:** ERC-721 (tickets), ERC-2771 (meta-tx), ERC-4337 (account abstraction via EntryPoint)
**Owner:** Hoppr contract team
**Status:** Draft — subject to audit review

---

## 1. Objectives

1. **Multi-operator**: N operators on one platform, each with their own routes, schedules, burners, and treasury.
2. **Seat-level issuance**: Each ticket is a specific seat on a specific departure, not just "a ride on this route."
3. **Refundable**: Riders can cancel within operator-defined windows; operators can cancel entire schedules.
4. **Gasless**: All user-facing methods sponsor-able via ERC-4337 paymaster or EIP-2771 forwarder.
5. **USDC-denominated**: All prices and payouts in USDC (6 decimals).
6. **Auditable**: Clean events for indexer reconstruction of all state.

---

## 2. Contracts

### 2.1 `OperatorRegistry`

Source of truth for who can register routes/schedules and who receives revenue.

**Storage:**

```solidity
struct Operator {
  address admin;          // can register routes, schedules, burners
  address treasury;       // receives USDC payouts
  bytes32 slug;           // unique, short, URL-safe identifier
  bool    active;         // platform can suspend
}

mapping(uint256 => Operator) public operators;
mapping(bytes32 => uint256) public operatorBySlug;
uint256 public nextOperatorId;
```

**Methods:**

```solidity
function registerOperator(
  address admin,
  address treasury,
  bytes32 slug
) external onlyRole(PLATFORM_ADMIN) returns (uint256 operatorId);

function updateOperatorTreasury(uint256 operatorId, address newTreasury)
  external onlyOperatorAdmin(operatorId);

function suspendOperator(uint256 operatorId)
  external onlyRole(PLATFORM_ADMIN);

function reactivateOperator(uint256 operatorId)
  external onlyRole(PLATFORM_ADMIN);
```

**Events:**

```solidity
event OperatorRegistered(uint256 indexed operatorId, address indexed admin, bytes32 slug);
event OperatorTreasuryUpdated(uint256 indexed operatorId, address newTreasury);
event OperatorStatusChanged(uint256 indexed operatorId, bool active);
```

---

### 2.2 `RouteRegistry`

Routes are scoped to an operator.

**Storage:**

```solidity
struct Route {
  uint256 operatorId;
  string  name;           // e.g. "Lagos → Abuja Express"
  bytes8  shortCode;      // 1–8 uppercase alphanumeric, per-operator unique
  bool    active;
}

mapping(uint256 => Route) public routes;  // routeId → Route
mapping(uint256 => mapping(bytes8 => uint256)) public routeByShortCode; // operatorId → shortCode → routeId
```

**Methods:**

```solidity
function createRoute(
  uint256 operatorId,
  string calldata name,
  bytes8 shortCode
) external onlyOperatorAdmin(operatorId) returns (uint256 routeId);

function updateRoute(uint256 routeId, string calldata name, bytes8 shortCode)
  external onlyOperatorAdmin(routes[routeId].operatorId);

function setRouteActive(uint256 routeId, bool active)
  external onlyOperatorAdmin(routes[routeId].operatorId);
```

---

### 2.3 `ScheduleRegistry`

A schedule is a specific departure of a specific route.

**Storage:**

```solidity
struct Schedule {
  uint256 routeId;
  uint64  departureAt;    // unix seconds
  uint16  capacity;       // total seats
  uint256 priceUSDC;      // 6 decimals
  uint32  refundCutoffSec; // how many seconds before departure refunds are blocked
  uint16  refundFeeBps;    // basis points fee on refund (0..10000)
  bool    cancelled;
}

mapping(uint256 => Schedule) public schedules;
mapping(uint256 => uint256)  public scheduleSeatsSold;  // scheduleId → count
uint256 public nextScheduleId;
```

**Methods:**

```solidity
function createSchedule(
  uint256 routeId,
  uint64 departureAt,
  uint16 capacity,
  uint256 priceUSDC,
  uint32 refundCutoffSec,
  uint16 refundFeeBps
) external onlyOperatorAdmin(routes[routeId].operatorId) returns (uint256 scheduleId);

function cancelSchedule(uint256 scheduleId)
  external onlyOperatorAdmin(routes[schedules[scheduleId].routeId].operatorId);
// Cancelling a schedule triggers refund eligibility for all minted tickets on it.
```

**Events:**

```solidity
event ScheduleCreated(uint256 indexed scheduleId, uint256 indexed routeId, uint64 departureAt, uint256 priceUSDC);
event ScheduleCancelled(uint256 indexed scheduleId);
```

---

### 2.4 `TicketNFT` (ERC-721)

The user-facing NFT. One token per (scheduleId, seatId).

**Storage:**

```solidity
struct Ticket {
  uint256 scheduleId;
  uint16  seatId;
  uint64  mintedAt;
  bool    refunded;       // marks historical tickets post-refund (burn also used)
  bool    boarded;        // set by burner scan
}

mapping(uint256 => Ticket) public tickets;                        // tokenId → Ticket
mapping(uint256 => mapping(uint16 => uint256)) public seatToTokenId; // scheduleId → seatId → tokenId
uint256 public nextTokenId;
```

**Mint — signed-claim pattern:**

```solidity
struct SeatClaim {
  uint256 scheduleId;
  uint16  seatId;
  address buyer;
  uint64  expiresAt;
  uint256 nonce;
}

mapping(uint256 => bool) public usedNonces;

function mintSeat(SeatClaim calldata claim, bytes calldata operatorSig) external;
function batchMintSeats(SeatClaim[] calldata claims, bytes[] calldata sigs) external;
```

**Mint invariants:**
1. `block.timestamp < claim.expiresAt`
2. `!usedNonces[claim.nonce]`
3. `seatToTokenId[scheduleId][seatId] == 0`
4. `claim.seatId < schedule.capacity`
5. `!schedule.cancelled`
6. `block.timestamp < schedule.departureAt`
7. Signature recovers to `operators[routeOwnerId].admin` (the operator admin's signer)
8. Caller has approved `schedule.priceUSDC` to this contract

Mint transfers USDC from buyer → operator treasury in the same tx.

**Refund:**

```solidity
function cancelTicket(uint256 tokenId) external;
```

- Callable by the ticket owner.
- Requires `block.timestamp + schedule.refundCutoffSec < schedule.departureAt` (i.e. still within refund window).
- Burns the NFT, clears `seatToTokenId`, refunds `priceUSDC * (10000 - refundFeeBps) / 10000` from operator treasury.
- Refund fee remains with operator (compensation for cancellation).

**Schedule-level refund** (operator cancels a whole departure):

```solidity
function refundCancelledSchedule(uint256 scheduleId, uint256[] calldata tokenIds) external;
```

- Callable by anyone once `schedule.cancelled == true`.
- Full refund (no fee) per token.
- Batched for gas efficiency.

**Boarding:**

```solidity
function markBoarded(uint256 tokenId)
  external onlyBurner(operatorOf(tokenId));
```

- Callable only by a burner registered for this operator.
- Flips `ticket.boarded = true`.
- Idempotent (re-calling is a no-op, or reverts — pick one during audit).

**Events:**

```solidity
event SeatMinted(uint256 indexed tokenId, uint256 indexed scheduleId, uint16 seatId, address indexed buyer, uint256 priceUSDC);
event TicketCancelled(uint256 indexed tokenId, uint256 indexed scheduleId, uint16 seatId, uint256 refundAmount);
event TicketBoarded(uint256 indexed tokenId, address indexed burner);
```

---

### 2.5 `BurnerRegistry`

Scoped per-operator.

```solidity
mapping(uint256 => mapping(address => bool)) public burnerOf; // operatorId → burner → active

function grantBurner(uint256 operatorId, address burner)
  external onlyOperatorAdmin(operatorId);

function revokeBurner(uint256 operatorId, address burner)
  external onlyOperatorAdmin(operatorId);

function isBurner(uint256 operatorId, address burner) external view returns (bool);
```

---

### 2.6 `Paymaster` (ERC-4337)

Standard verifying paymaster. Off-chain signer (policy server) signs approval; on-chain paymaster verifies.

```solidity
function validatePaymasterUserOp(
  UserOperation calldata userOp,
  bytes32 userOpHash,
  uint256 maxCost
) external returns (bytes memory context, uint256 validationData);
```

The paymaster's verifying key is held by Hoppr's policy server. All signing, rate-limiting, and policy happens off-chain (see `paymaster-policy.md` in Phase 3 docs).

On-chain checks:
- Signature recovers to the authorized off-chain signer
- `validUntil` / `validAfter` window respected

---

## 3. Roles

| Role | Who | Powers |
|---|---|---|
| `PLATFORM_ADMIN` | Hoppr team multisig | Register/suspend operators, upgrade contracts (if upgradeable), pause system |
| `operators[id].admin` | Operator's chosen admin wallet | Create/update routes + schedules, manage burners, cancel schedules |
| `burnerOf[id][addr]` | Scanner devices | Mark tickets boarded |
| `ticket.ownerOf` | Rider | Cancel within window, transfer |

No role has the power to mint a ticket directly — all mints require an operator signature over a seat claim.

---

## 4. Signature scheme

EIP-712 typed data.

```
Domain:
  name: "Hoppr"
  version: "2"
  chainId: <monad chainId>
  verifyingContract: <TicketNFT address>

Type: SeatClaim
  uint256 scheduleId
  uint16  seatId
  address buyer
  uint64  expiresAt
  uint256 nonce
```

The operator's admin wallet signs `SeatClaim`s off-chain (via the operator backend) after reserving a seat for the rider. The rider submits the signed claim as part of `mintSeat`.

**Why this pattern:** lets the rider submit the mint (paymaster-friendly for smart wallets) while the operator retains authority over who can claim which seat.

---

## 5. USDC integration

- Single USDC address configured at deploy time (the Monad-native USDC)
- All prices in USDC's 6 decimals
- `mintSeat` uses `USDC.transferFrom(buyer, operator.treasury, priceUSDC)` — requires prior approval
  - Smart-wallet UX: approval + mint batched into a single UserOp
- `cancelTicket` uses `USDC.transferFrom(operator.treasury, buyer, refundAmount)` — requires operator treasury to have pre-approved the ticket contract for refunds
  - Operator onboarding step: approve `type(uint256).max` to ticket contract from treasury

---

## 6. Upgradeability

**Decision required at design review:** UUPS proxy vs immutable.

**Recommendation: UUPS proxy** for v2, with an immediate roadmap to renounce upgrade rights once the contract has been stable in production for 6 months.

Rationale: Monad is new; ecosystem primitives (USDC address, EntryPoint address) may change. Upgradeability is insurance. Renouncing later is a credibility event we can announce.

---

## 7. Test surface

Target: >95% line coverage. Minimum test cases:

### OperatorRegistry
- Register operator, verify state
- Duplicate slug rejected
- Only platform admin can register
- Treasury update only by operator admin
- Suspension blocks route creation + minting

### RouteRegistry
- Create route, verify state
- Duplicate short code (per operator) rejected
- Same short code OK across operators
- Only operator admin can create/update

### ScheduleRegistry
- Create schedule, verify state
- Cancel schedule, verify state + event
- Past departure cannot be created
- Zero capacity rejected
- Zero price allowed (for comp tickets)
- Only operator admin can cancel

### TicketNFT — mint
- Valid claim mints successfully; USDC moves; seat marked sold
- Expired claim rejected
- Replayed nonce rejected
- Seat-taken claim rejected
- Claim on cancelled schedule rejected
- Claim post-departure rejected
- Invalid signature rejected
- Seat out of range (≥capacity) rejected
- Insufficient USDC allowance rejected

### TicketNFT — cancel
- In-window cancellation refunds minus fee; NFT burned; seat freed
- Out-of-window cancellation rejected
- Non-owner cancellation rejected
- Already-cancelled ticket rejected (double-refund protection)

### TicketNFT — schedule cancellation refund
- Cancelled schedule enables full refund
- Batch refund works across many tokens
- Double-refund protected

### TicketNFT — boarding
- Registered burner marks boarded
- Non-burner rejected
- Burner for other operator rejected
- Post-refund ticket cannot be boarded

### Paymaster
- Valid signed UserOp accepted
- Expired signature rejected
- Tampered UserOp rejected
- Wrong signer rejected

### Meta-transactions
- EIP-2771 forwarder path works for all user-facing methods
- `_msgSender()` correctly resolves to the claim buyer

### Integration
- End-to-end: operator registered → route created → schedule created → rider mints → rider transfers → new owner boards
- End-to-end with refund: rider mints → rider cancels → seat available again
- End-to-end with schedule cancel: operator creates → riders mint → operator cancels → all riders refund

---

## 8. Gas budgets (informational, to be measured on Monad)

| Operation | Target gas |
|---|---|
| `registerOperator` | < 150k |
| `createRoute` | < 120k |
| `createSchedule` | < 130k |
| `mintSeat` | < 220k |
| `cancelTicket` | < 130k |
| `markBoarded` | < 70k |

These are indicative. Measure on Monad testnet; if significantly higher, profile before mainnet.

---

## 9. Open questions for audit review

1. Reentrancy posture on `cancelTicket` (USDC transfer + state update ordering)
2. Whether `markBoarded` should revert on re-call or be idempotent
3. Whether to support partial refunds (rider cancels N of M tickets they hold for a group)
4. Whether operator-signed claims should use the operator's admin key or a dedicated "signer" key (rotating)
5. How to handle operator treasury key compromise (admin rotation path)
6. Whether ticket transfers should be restricted (e.g. frozen N hours before departure to prevent scalping)

---

## 10. Deployment checklist

- [ ] Testnet deployed; contracts verified on explorer
- [ ] Full test suite run on forked mainnet
- [ ] Audit report received and all Critical / High findings resolved
- [ ] Multisig configured for `PLATFORM_ADMIN`
- [ ] USDC address confirmed for Monad mainnet
- [ ] EntryPoint address confirmed for Monad mainnet
- [ ] Paymaster signer key stored in HSM / KMS (not in env vars)
- [ ] Mainnet deployed; contracts verified on explorer
- [ ] Paymaster funded with MON (7+ days runway)
- [ ] Operator #1 registered on mainnet; treasury approval set
- [ ] One end-to-end mainnet test mint completed successfully
