import { useCallback, useEffect, useState } from "react"
import { useAccount, usePublicClient, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi"
import { isAddress, keccak256, toBytes } from "viem"
import { chainPassTicketAbi, monadTestnet } from "@chainpass/shared"
import { getContractAddress } from "../lib/contract"
import { formatWriteContractError } from "../lib/walletError"
import { parseAbiItem } from "viem"
import { env } from "../lib/env"
import { fetchLogsChunked } from "../lib/chainLogs"

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

const OPERATOR_NAMES_KEY = 'chainpass_operator_names'
function getOperatorNames(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(OPERATOR_NAMES_KEY) ?? '{}') } catch { return {} }
}
function saveOperatorName(addr: string, name: string) {
  if (!name.trim()) return
  const n = getOperatorNames()
  n[addr.toLowerCase()] = name.trim()
  localStorage.setItem(OPERATOR_NAMES_KEY, JSON.stringify(n))
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
  const [minters, setMinters]     = useState<{ address: string; active: boolean }[]>([])
  const [operatorNames, setOperatorNames] = useState<Record<string, string>>(() => getOperatorNames())
  const [newOperatorName, setNewOperatorName] = useState("")
  const [loadingRoles, setLoadingRoles] = useState(false)

  const loadRoles = useCallback(async () => {
    if (!publicClient || !contractAddress) return
    setLoadingRoles(true)
    try {
      // Scan from contract deploy block → head in chunks. A 0→latest scan against
      // Monad's public RPC returns HTTP 413; chunked helper paginates + swallows
      // failures so partial results still render.
      const latest = await publicClient.getBlockNumber()
      const from = env.contractDeployBlock
      const [opLogs, grantLogs, revokeLogs] = await Promise.all([
        fetchLogsChunked(
          (fromBlock, toBlock) =>
            publicClient.getLogs({ address: contractAddress, event: OPERATOR_APPROVED_EVENT, fromBlock, toBlock }),
          from, latest,
        ),
        fetchLogsChunked(
          (fromBlock, toBlock) =>
            publicClient.getLogs({ address: contractAddress, event: ROLE_GRANTED_EVENT, fromBlock, toBlock }),
          from, latest,
        ),
        fetchLogsChunked(
          (fromBlock, toBlock) =>
            publicClient.getLogs({ address: contractAddress, event: ROLE_REVOKED_EVENT, fromBlock, toBlock }),
          from, latest,
        ),
      ])

      // Latest state per operator address
      const opMap = new Map<string, boolean>()
      for (const l of opLogs) {
        if (l.args.operator) opMap.set(l.args.operator.toLowerCase(), l.args.approved!)
      }
      setOperators([...opMap.entries()].map(([address, approved]) => ({ address, approved })))

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
          sub="Transport operators with named identities. Approve addresses that can be assigned to tickets at purchase."
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
            {operators.map((op) => {
              const opName = operatorNames[op.address.toLowerCase()]
              return (
                <li key={op.address} className="flex items-center justify-between gap-3 rounded-xl border border-outline-variant/10 bg-surface-container-high px-3.5 py-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${op.approved ? "bg-tertiary" : "bg-outline-variant/40"}`} />
                    <div className="min-w-0">
                      <p className="font-headline text-xs font-semibold text-white truncate">
                        {opName || "Unnamed"}
                      </p>
                      <a href={`${explorerBase}/${op.address}`} target="_blank" rel="noreferrer"
                        className="font-mono text-[10px] text-on-surface-variant hover:text-primary truncate block">
                        {op.address.slice(0, 10)}…{op.address.slice(-6)}
                      </a>
                    </div>
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
              )
            })}
          </ul>
        )}

        {/* Add operator */}
        <div className="space-y-2">
          <input
            type="text"
            value={newOperatorName}
            onChange={(e) => setNewOperatorName(e.target.value)}
            placeholder="Operator name (e.g. NRC — Nigerian Railway Corporation)"
            disabled={busy}
            className="w-full rounded-xl border border-outline-variant/25 bg-surface-container-high px-3.5 py-2.5 text-sm text-white placeholder:text-on-surface-variant/40 focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors disabled:opacity-50"
          />
          <div className="flex gap-2">
            <div className="flex-1">
              <AddressInput value={newOperator} onChange={setNewOperator}
                placeholder="0x… operator address" disabled={busy} />
            </div>
            <button type="button" disabled={busy || !isAddress(newOperator)}
              onClick={() => {
                void approveOperator(newOperator, true)
                saveOperatorName(newOperator, newOperatorName)
                setOperatorNames(getOperatorNames())
                setNewOperatorName("")
                setNewOperator("")
              }}
              className="shrink-0 rounded-xl bg-primary px-4 py-2.5 font-headline text-xs font-bold text-white shadow-sm transition-all hover:bg-primary/80 disabled:opacity-40 disabled:cursor-not-allowed">
              Approve
            </button>
          </div>
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
