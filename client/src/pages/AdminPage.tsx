import { useCallback, useEffect, useMemo, useState } from "react"
import { useAccount, usePublicClient, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi"
import { isAddress, keccak256, toBytes } from "viem"
import { chainPassTicketAbi, monadTestnet } from "@chainpass/shared"
import { getContractAddress } from "../lib/contract"
import { formatWriteContractError } from "../lib/walletError"
import { parseAbiItem } from "viem"

const BURNER_ROLE  = keccak256(toBytes("BURNER_ROLE"))
const MINTER_ROLE  = keccak256(toBytes("MINTER_ROLE"))
const ADMIN_ROLE   = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`

const explorerBase = `${monadTestnet.blockExplorers.default.url}/address`

const OPERATOR_APPROVED_EVENT = parseAbiItem(
  "event OperatorApproved(address indexed operator, bool approved)"
)
const ROLE_GRANTED_EVENT = parseAbiItem(
  "event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)"
)
const ROLE_REVOKED_EVENT = parseAbiItem(
  "event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)"
)

function shortenAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function AddressInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  const valid = value === "" || isAddress(value)
  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "0x…"}
        disabled={disabled}
        className={`w-full rounded-xl border px-3.5 py-2.5 font-mono text-sm text-white placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-1 transition-colors disabled:opacity-50 ${
          valid
            ? "border-outline-variant/25 bg-surface-container-high focus:border-primary/60 focus:ring-primary/30"
            : "border-error/50 bg-error/5 focus:border-error/60 focus:ring-error/30"
        }`}
      />
      {value && !valid && (
        <p className="mt-1 text-[10px] text-error">Invalid address</p>
      )}
    </div>
  )
}

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-4">
      <h2 className="font-headline text-base font-bold text-white">{title}</h2>
      {sub && <p className="mt-0.5 text-xs text-on-surface-variant">{sub}</p>}
    </div>
  )
}

export function AdminPage() {
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const contractAddress = getContractAddress()

  // ── Check if connected wallet is admin ──────────────────────────────────
  const { data: isAdminRaw } = useReadContract({
    address: contractAddress ?? undefined,
    abi: chainPassTicketAbi,
    functionName: "hasRole",
    args: [ADMIN_ROLE, address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: !!contractAddress && !!address },
  })
  const isAdmin = Boolean(isAdminRaw)

  // ── Approved operators (from chain events) ──────────────────────────────
  const [operators, setOperators] = useState<{ address: string; approved: boolean }[]>([])
  const [burners, setBurners]     = useState<{ address: string; active: boolean }[]>([])
  const [minters, setMinters]     = useState<{ address: string; active: boolean }[]>([])
  const [loadingRoles, setLoadingRoles] = useState(false)

  const loadRoles = useCallback(async () => {
    if (!publicClient || !contractAddress) return
    setLoadingRoles(true)
    try {
      const [opLogs, grantLogs, revokeLogs] = await Promise.all([
        publicClient.getLogs({ address: contractAddress, event: OPERATOR_APPROVED_EVENT, fromBlock: 0n, toBlock: "latest" }),
        publicClient.getLogs({ address: contractAddress, event: ROLE_GRANTED_EVENT, fromBlock: 0n, toBlock: "latest" }),
        publicClient.getLogs({ address: contractAddress, event: ROLE_REVOKED_EVENT, fromBlock: 0n, toBlock: "latest" }),
      ])

      // Latest state per operator address
      const opMap = new Map<string, boolean>()
      for (const l of opLogs) {
        if (l.args.operator) opMap.set(l.args.operator.toLowerCase(), l.args.approved!)
      }
      setOperators([...opMap.entries()].map(([address, approved]) => ({ address, approved })))

      // Burners
      const burnerMap = new Map<string, boolean>()
      for (const l of grantLogs) {
        if (l.args.role?.toLowerCase() === BURNER_ROLE.toLowerCase() && l.args.account)
          burnerMap.set(l.args.account.toLowerCase(), true)
      }
      for (const l of revokeLogs) {
        if (l.args.role?.toLowerCase() === BURNER_ROLE.toLowerCase() && l.args.account)
          burnerMap.set(l.args.account.toLowerCase(), false)
      }
      setBurners([...burnerMap.entries()].map(([address, active]) => ({ address, active })))

      // Minters
      const minterMap = new Map<string, boolean>()
      for (const l of grantLogs) {
        if (l.args.role?.toLowerCase() === MINTER_ROLE.toLowerCase() && l.args.account)
          minterMap.set(l.args.account.toLowerCase(), true)
      }
      for (const l of revokeLogs) {
        if (l.args.role?.toLowerCase() === MINTER_ROLE.toLowerCase() && l.args.account)
          minterMap.set(l.args.account.toLowerCase(), false)
      }
      setMinters([...minterMap.entries()].map(([address, active]) => ({ address, active })))
    } catch {
      // silent
    }
    setLoadingRoles(false)
  }, [publicClient, contractAddress])

  useEffect(() => { void loadRoles() }, [loadRoles])

  // ── Write contract helpers ───────────────────────────────────────────────
  const { writeContractAsync, isPending } = useWriteContract()
  const [pendingHash, setPendingHash] = useState<`0x${string}` | undefined>()
  const { isLoading: confirming } = useWaitForTransactionReceipt({ hash: pendingHash })
  const [txError, setTxError] = useState<string | null>(null)

  const busy = isPending || confirming

  async function send(fn: () => Promise<`0x${string}`>) {
    setTxError(null)
    try {
      const hash = await fn()
      setPendingHash(hash)
      // reload roles after confirmation
      setTimeout(() => { void loadRoles() }, 3000)
    } catch (e) {
      setTxError(formatWriteContractError(e as Error))
    }
  }

  // ── Operator section ─────────────────────────────────────────────────────
  const [newOperator, setNewOperator] = useState("")

  async function approveOperator(addr: string, approved: boolean) {
    if (!contractAddress) return
    await send(() => writeContractAsync({
      address: contractAddress,
      abi: chainPassTicketAbi,
      functionName: "setOperatorApproved",
      args: [addr as `0x${string}`, approved],
    }))
  }

  // ── Burner section ───────────────────────────────────────────────────────
  const [newBurner, setNewBurner] = useState("")

  async function grantBurner(addr: string) {
    if (!contractAddress) return
    await send(() => writeContractAsync({
      address: contractAddress,
      abi: chainPassTicketAbi,
      functionName: "grantRole",
      args: [BURNER_ROLE, addr as `0x${string}`],
    }))
  }

  async function revokeBurner(addr: string) {
    if (!contractAddress) return
    await send(() => writeContractAsync({
      address: contractAddress,
      abi: chainPassTicketAbi,
      functionName: "revokeRole",
      args: [BURNER_ROLE, addr as `0x${string}`],
    }))
  }

  // ── Minter section ───────────────────────────────────────────────────────
  const [newMinter, setNewMinter] = useState("")

  async function grantMinter(addr: string) {
    if (!contractAddress) return
    await send(() => writeContractAsync({
      address: contractAddress,
      abi: chainPassTicketAbi,
      functionName: "grantRole",
      args: [MINTER_ROLE, addr as `0x${string}`],
    }))
  }

  async function revokeMinter(addr: string) {
    if (!contractAddress) return
    await send(() => writeContractAsync({
      address: contractAddress,
      abi: chainPassTicketAbi,
      functionName: "revokeRole",
      args: [MINTER_ROLE, addr as `0x${string}`],
    }))
  }

  // ── Not connected / not admin guard ─────────────────────────────────────
  if (!isConnected || !address) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="font-headline text-[10px] font-bold uppercase tracking-[0.25em] text-primary">Admin</p>
        <h1 className="mt-1.5 font-headline text-3xl font-bold text-white">Admin panel</h1>
        <div className="mt-8 rounded-2xl border border-outline-variant/20 bg-surface-container p-8 text-center">
          <p className="font-headline text-sm font-semibold text-white">Connect your wallet</p>
          <p className="mt-1 text-xs text-on-surface-variant">Admin panel requires a connected wallet with DEFAULT_ADMIN_ROLE.</p>
        </div>
      </div>
    )
  }

  if (contractAddress && !isAdmin) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="font-headline text-[10px] font-bold uppercase tracking-[0.25em] text-primary">Admin</p>
        <h1 className="mt-1.5 font-headline text-3xl font-bold text-white">Admin panel</h1>
        <div className="mt-8 rounded-2xl border border-error/20 bg-error/5 p-8 text-center">
          <span className="material-symbols-outlined mb-3 text-3xl text-error" aria-hidden>lock</span>
          <p className="font-headline text-sm font-semibold text-white">Access denied</p>
          <p className="mt-1 text-xs text-on-surface-variant">
            Connected wallet <span className="font-mono text-on-surface-variant/70">{shortenAddr(address)}</span> does not have DEFAULT_ADMIN_ROLE.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* Header */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-headline text-[10px] font-bold uppercase tracking-[0.25em] text-primary">Admin</p>
          <h1 className="mt-1.5 font-headline text-3xl font-bold text-white">Admin panel</h1>
          <p className="mt-1 text-xs text-on-surface-variant">
            Connected as <a href={`${explorerBase}/${address}`} target="_blank" rel="noreferrer"
              className="font-mono text-primary hover:underline">{shortenAddr(address)}</a>
          </p>
        </div>
        <button type="button" onClick={() => void loadRoles()} disabled={loadingRoles}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-outline-variant/30 bg-surface-container px-3 font-headline text-xs font-semibold text-on-surface-variant hover:border-primary/40 hover:text-white disabled:opacity-50 transition-colors">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={loadingRoles ? "animate-spin" : ""} aria-hidden>
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Tx error */}
      {txError && (
        <div className="rounded-xl border border-error/30 bg-error/10 px-4 py-3">
          <p className="text-xs text-error break-words">{txError}</p>
        </div>
      )}

      {/* Confirming banner */}
      {confirming && (
        <div className="flex items-center gap-2.5 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary shrink-0" />
          <p className="text-xs text-primary">Waiting for confirmation…</p>
        </div>
      )}

      {/* ── Operators ─────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-outline-variant/15 bg-surface-container p-5">
        <SectionHeader
          title="Operators"
          sub="Operators are addresses that can be assigned to tickets at purchase time. Approve any wallet that should act as a transport operator."
        />

        {/* Current operators */}
        {loadingRoles ? (
          <div className="space-y-2 mb-4">
            {[1,2].map(i => <div key={i} className="skeleton h-10 w-full rounded-xl" />)}
          </div>
        ) : operators.length === 0 ? (
          <p className="mb-4 text-xs text-on-surface-variant/60">No operators registered yet.</p>
        ) : (
          <ul className="mb-4 space-y-2">
            {operators.map((op) => (
              <li key={op.address} className="flex items-center justify-between gap-3 rounded-xl border border-outline-variant/10 bg-surface-container-high px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${op.approved ? "bg-tertiary" : "bg-outline-variant/40"}`} />
                  <a href={`${explorerBase}/${op.address}`} target="_blank" rel="noreferrer"
                    className="font-mono text-xs text-on-surface-variant hover:text-primary truncate">
                    {op.address}
                  </a>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`font-headline text-[10px] font-bold uppercase ${op.approved ? "text-tertiary" : "text-on-surface-variant/40"}`}>
                    {op.approved ? "Approved" : "Revoked"}
                  </span>
                  <button type="button" disabled={busy}
                    onClick={() => void approveOperator(op.address, !op.approved)}
                    className={`rounded-lg px-2.5 py-1 font-headline text-[10px] font-bold transition-colors disabled:opacity-50 ${
                      op.approved
                        ? "border border-error/30 text-error hover:bg-error/10"
                        : "border border-tertiary/30 text-tertiary hover:bg-tertiary/10"
                    }`}>
                    {op.approved ? "Revoke" : "Approve"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Add operator */}
        <div className="flex gap-2">
          <div className="flex-1">
            <AddressInput value={newOperator} onChange={setNewOperator}
              placeholder="0x… operator address" disabled={busy} />
          </div>
          <button type="button" disabled={busy || !isAddress(newOperator)}
            onClick={() => { void approveOperator(newOperator, true); setNewOperator("") }}
            className="shrink-0 rounded-xl bg-primary px-4 py-2.5 font-headline text-xs font-bold text-white shadow-sm transition-all hover:bg-primary/80 disabled:opacity-40 disabled:cursor-not-allowed">
            Approve
          </button>
        </div>
      </section>

      {/* ── Burners (Gate/Conductors) ──────────────────────────────────────── */}
      <section className="rounded-2xl border border-outline-variant/15 bg-surface-container p-5">
        <SectionHeader
          title="Conductors (Burner Role)"
          sub="Burners can validate and burn tickets at the gate. Grant this role to conductor wallets."
        />

        {loadingRoles ? (
          <div className="space-y-2 mb-4">
            {[1].map(i => <div key={i} className="skeleton h-10 w-full rounded-xl" />)}
          </div>
        ) : burners.length === 0 ? (
          <p className="mb-4 text-xs text-on-surface-variant/60">No burners registered yet.</p>
        ) : (
          <ul className="mb-4 space-y-2">
            {burners.map((b) => (
              <li key={b.address} className="flex items-center justify-between gap-3 rounded-xl border border-outline-variant/10 bg-surface-container-high px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${b.active ? "bg-amber-400" : "bg-outline-variant/40"}`} />
                  <a href={`${explorerBase}/${b.address}`} target="_blank" rel="noreferrer"
                    className="font-mono text-xs text-on-surface-variant hover:text-primary truncate">
                    {b.address}
                  </a>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`font-headline text-[10px] font-bold uppercase ${b.active ? "text-amber-400" : "text-on-surface-variant/40"}`}>
                    {b.active ? "Active" : "Revoked"}
                  </span>
                  <button type="button" disabled={busy}
                    onClick={() => void (b.active ? revokeBurner(b.address) : grantBurner(b.address))}
                    className={`rounded-lg px-2.5 py-1 font-headline text-[10px] font-bold transition-colors disabled:opacity-50 ${
                      b.active
                        ? "border border-error/30 text-error hover:bg-error/10"
                        : "border border-amber-400/30 text-amber-400 hover:bg-amber-400/10"
                    }`}>
                    {b.active ? "Revoke" : "Grant"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2">
          <div className="flex-1">
            <AddressInput value={newBurner} onChange={setNewBurner}
              placeholder="0x… conductor wallet" disabled={busy} />
          </div>
          <button type="button" disabled={busy || !isAddress(newBurner)}
            onClick={() => { void grantBurner(newBurner); setNewBurner("") }}
            className="shrink-0 rounded-xl bg-amber-500/80 px-4 py-2.5 font-headline text-xs font-bold text-white shadow-sm transition-all hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed">
            Grant
          </button>
        </div>
      </section>

      {/* ── Minters ───────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-outline-variant/15 bg-surface-container p-5">
        <SectionHeader
          title="Minters"
          sub="Minters can issue free tickets (promo / backend). Grant sparingly."
        />

        {loadingRoles ? (
          <div className="space-y-2 mb-4">
            <div className="skeleton h-10 w-full rounded-xl" />
          </div>
        ) : minters.length === 0 ? (
          <p className="mb-4 text-xs text-on-surface-variant/60">No minters registered yet.</p>
        ) : (
          <ul className="mb-4 space-y-2">
            {minters.map((m) => (
              <li key={m.address} className="flex items-center justify-between gap-3 rounded-xl border border-outline-variant/10 bg-surface-container-high px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${m.active ? "bg-primary" : "bg-outline-variant/40"}`} />
                  <a href={`${explorerBase}/${m.address}`} target="_blank" rel="noreferrer"
                    className="font-mono text-xs text-on-surface-variant hover:text-primary truncate">
                    {m.address}
                  </a>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`font-headline text-[10px] font-bold uppercase ${m.active ? "text-primary" : "text-on-surface-variant/40"}`}>
                    {m.active ? "Active" : "Revoked"}
                  </span>
                  <button type="button" disabled={busy}
                    onClick={() => void (m.active ? revokeMinter(m.address) : grantMinter(m.address))}
                    className={`rounded-lg px-2.5 py-1 font-headline text-[10px] font-bold transition-colors disabled:opacity-50 ${
                      m.active
                        ? "border border-error/30 text-error hover:bg-error/10"
                        : "border border-primary/30 text-primary hover:bg-primary/10"
                    }`}>
                    {m.active ? "Revoke" : "Grant"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2">
          <div className="flex-1">
            <AddressInput value={newMinter} onChange={setNewMinter}
              placeholder="0x… minter address" disabled={busy} />
          </div>
          <button type="button" disabled={busy || !isAddress(newMinter)}
            onClick={() => { void grantMinter(newMinter); setNewMinter("") }}
            className="shrink-0 rounded-xl bg-primary/80 px-4 py-2.5 font-headline text-xs font-bold text-white shadow-sm transition-all hover:bg-primary disabled:opacity-40 disabled:cursor-not-allowed">
            Grant
          </button>
        </div>
      </section>
    </div>
  )
}
