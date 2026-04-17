import type { PublicClient } from "viem"
import { chainPassTicketAbi } from "@chainpass/shared"
import type { RiderPassEventRow } from "./api"

const MAX_TOKENS = 200

/**
 * Read active ticket NFTs for `holder` directly from the contract (no indexer).
 * Uses individual readContract calls — avoids multicall batch limits / partial failures on some RPCs.
 * Returns null only on unexpected errors; [] if balance is zero.
 */
export async function fetchActivePassesFromChain(
  client: PublicClient,
  contract: `0x${string}`,
  holder: `0x${string}`,
): Promise<RiderPassEventRow[] | null> {
  try {
    const balance = await client.readContract({
      address: contract,
      abi: chainPassTicketAbi,
      functionName: "balanceOf",
      args: [holder],
    })

    const n = Number(balance as bigint)
    if (n === 0) return []
    const count = Math.min(n, MAX_TOKENS)

    const out: RiderPassEventRow[] = []

    for (let i = 0; i < count; i++) {
      const tokenId = await client.readContract({
        address: contract,
        abi: chainPassTicketAbi,
        functionName: "tokenOfOwnerByIndex",
        args: [holder, BigInt(i)],
      })

      const tid = tokenId as bigint
      const [routeId, validUntil, seatClassRaw] = await Promise.all([
        client.readContract({
          address: contract,
          abi: chainPassTicketAbi,
          functionName: "routeOf",
          args: [tid],
        }),
        client.readContract({
          address: contract,
          abi: chainPassTicketAbi,
          functionName: "validUntil",
          args: [tid],
        }),
        client.readContract({
          address: contract,
          abi: chainPassTicketAbi,
          functionName: "seatClassOf",
          args: [tid],
        }),
      ])

      out.push({
        id: Number(tid % 1_000_000_000n),
        event_type: "mint",
        tx_hash: "",
        token_id: tid.toString(),
        route_id: String(routeId as bigint),
        block_number: "",
        valid_until_epoch: String(validUntil as bigint),
        created_at: new Date().toISOString(),
        seat_class: (seatClassRaw as number) === 1 ? "Business" : "Economy",
      })
    }

    return out
  } catch {
    return null
  }
}

// Burn history used to be scanned from chain logs here with a chunked getLogs
// helper. That path is gone — the indexer writes every TicketBurned to
// ticket_events server-side and `fetchMyPasses()` returns it. Scanning from
// the browser tripped HTTP 413 on Monad's public RPC and ate through free-tier
// getLogs budgets on Alchemy/QuickNode.
