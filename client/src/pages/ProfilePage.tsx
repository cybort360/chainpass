import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useAccount, usePublicClient } from "wagmi"
import { monadTestnet } from "@chainpass/shared"
import { Button } from "../components/ui/Button"
import { fetchMyPasses, type MyPassesResponse } from "../lib/api"
import { getContractAddress } from "../lib/contract"
import { fetchActivePassesFromChain } from "../lib/onchainPasses"
import { routeMetaForRouteId, shortenNumericId } from "../lib/passDisplay"

const REFETCH_MS = 8000
const explorerTxBase = `${monadTestnet.blockExplorers.default.url}/tx`

export function ProfilePage() {
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const [data, setData] = useState<MyPassesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(
    async (mode: "initial" | "poll" | "manual") => {
      if (!address) return
      if (mode === "manual") setRefreshing(true)
      if (mode === "initial") setLoading(true)

      const ticket = getContractAddress()
      const api = await fetchMyPasses(address)
      const used = api?.used ?? []

      /** With VITE_CHAINPASS_CONTRACT_ADDRESS set, active passes are chain-only (indexer can lag). */
      if (ticket && publicClient) {
        const chainActive = await fetchActivePassesFromChain(publicClient, ticket, address)
        if (chainActive === null) {
          setErr("Could not read NFTs from the chain (RPC error). Check your connection.")
          setData({ holder: address, active: [], used })
        } else {
          setErr(null)
          setData({ holder: address, active: chainActive, used })
        }
      } else {
        const active = api?.active ?? []
        if (!api) {
          setErr("Could not load passes. Set VITE_CHAINPASS_CONTRACT_ADDRESS or run the API.")
          setData(null)
        } else {
          setErr(null)
          setData({ holder: address, active, used })
        }
      }
      setLastUpdated(new Date())
      setLoading(false)
      setRefreshing(false)
    },
    [address, publicClient],
  )

  useEffect(() => {
    if (!isConnected || !address) return
    const id = window.setTimeout(() => {
      void load("initial")
    }, 0)
    return () => window.clearTimeout(id)
  }, [isConnected, address, load])

  useEffect(() => {
    if (!isConnected || !address) return
    const id = window.setInterval(() => {
      void load("poll")
    }, REFETCH_MS)
    return () => window.clearInterval(id)
  }, [isConnected, address, load])

  if (!isConnected || !address) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="font-headline text-xs font-bold uppercase tracking-[0.2em] text-primary">Profile</p>
        <h1 className="mt-2 font-headline text-3xl font-bold text-white">My passes</h1>
        <p className="mt-4 text-on-surface-variant">
          Connect your wallet to see active tickets from the contract and burned history when the API is available.
        </p>
        <p className="mt-8 text-sm text-tertiary">Use the connect button in the header.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl">
      <p className="font-headline text-xs font-bold uppercase tracking-[0.2em] text-primary">Profile</p>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-headline text-3xl font-bold text-white">My passes</h1>
          <p className="mt-2 text-sm text-on-surface-variant">
            Active passes are read directly from the contract. Used (burned) list comes from the API when it is running.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {lastUpdated ? (
            <p className="text-xs text-on-surface-variant">Updated {lastUpdated.toLocaleTimeString()}</p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={refreshing || loading}
            onClick={() => void load("manual")}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      {loading ? <p className="mt-10 text-on-surface-variant">Loading…</p> : null}
      {err ? <p className="mt-6 rounded-xl bg-error/10 p-4 text-sm text-error">{err}</p> : null}

      {data && !loading ? (
        <div className="mt-10 space-y-10">
          <section>
            <h2 className="font-headline text-lg font-bold text-white">Active</h2>
            {data.active.length === 0 ? (
              <p className="mt-3 text-sm text-on-surface-variant">No active passes for this wallet.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {data.active.map((row) => (
                  <li
                    key={`a-${row.token_id}-${row.tx_hash || "chain"}`}
                    className="flex flex-col gap-2 rounded-2xl border border-outline-variant/20 bg-surface-container p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-headline text-base font-semibold leading-snug text-white">
                        {routeMetaForRouteId(row.route_id ?? undefined)?.name ??
                          (row.route_id ? `Route ${shortenNumericId(row.route_id)}` : "Transit pass")}
                      </p>
                      <p
                        className="mt-1 font-mono text-xs text-on-surface-variant"
                        title={`Full token id: ${row.token_id}`}
                      >
                        Token #{shortenNumericId(row.token_id)}
                      </p>
                      <p className="mt-1 text-xs text-on-surface-variant">
                        {row.block_number ? `Block ${row.block_number}` : "On-chain (live)"}
                        {row.valid_until_epoch ? ` · valid until ${row.valid_until_epoch}` : null}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <Link
                        to={`/pass/${row.token_id}`}
                        className="font-headline text-sm font-semibold text-primary hover:underline"
                      >
                        Open pass
                      </Link>
                      {row.tx_hash ? (
                        <a
                          href={`${explorerTxBase}/${row.tx_hash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-on-surface-variant hover:text-primary"
                        >
                          Tx ↗
                        </a>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="font-headline text-lg font-bold text-white">Used (burned)</h2>
            {data.used.length === 0 ? (
              <p className="mt-3 text-sm text-on-surface-variant">No burned passes recorded for this wallet yet.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {data.used.map((row) => (
                  <li
                    key={`u-${row.id}-${row.tx_hash}`}
                    className="flex flex-col gap-2 rounded-2xl border border-outline-variant/20 bg-surface-container-low p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-headline text-base font-semibold leading-snug text-on-surface-variant">
                        {(routeMetaForRouteId(row.route_id ?? undefined)?.name ??
                          (row.route_id ? `Route ${shortenNumericId(row.route_id)}` : "Transit pass")) + " · burned"}
                      </p>
                      <p
                        className="mt-1 font-mono text-xs text-on-surface-variant/90"
                        title={`Full token id: ${row.token_id}`}
                      >
                        Token #{shortenNumericId(row.token_id)}
                      </p>
                      <p className="mt-1 text-xs text-on-surface-variant">
                        Block {row.block_number}
                      </p>
                    </div>
                    <a
                      href={`${explorerTxBase}/${row.tx_hash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-primary hover:underline"
                    >
                      View tx ↗
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}

      <p className="mt-10 text-center text-xs text-on-surface-variant">
        <Link to="/routes" className="text-primary hover:underline">
          Browse routes
        </Link>
      </p>
    </div>
  )
}
