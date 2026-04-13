import { parseAbiItem } from "viem"
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

const BURNED_EVENT  = parseAbiItem("event TicketBurned(address indexed from, uint256 indexed tokenId, uint256 routeId)")
const MINTED_EVENT  = parseAbiItem("event TicketMinted(address indexed to, uint256 indexed tokenId, uint256 routeId, uint64 validUntilEpoch, address operatorAddr, uint8 seatClass)")

/**
 * Read burned ticket history for `holder` directly from chain event logs.
 * Cross-references TicketMinted logs to recover validUntil and seatClass.
 * Returns [] on any error so the caller can fall back to API data.
 */
export async function fetchBurnedPassesFromChain(
  client: PublicClient,
  contract: `0x${string}`,
  holder: `0x${string}`,
): Promise<RiderPassEventRow[]> {
  try {
    const [burnLogs, mintLogs] = await Promise.all([
      client.getLogs({ address: contract, event: BURNED_EVENT,  args: { from: holder }, fromBlock: 0n, toBlock: "latest" }),
      client.getLogs({ address: contract, event: MINTED_EVENT,  args: { to:   holder }, fromBlock: 0n, toBlock: "latest" }),
    ])

    if (burnLogs.length === 0) return []

    // Map tokenId → mint log for cross-referencing validUntil / seatClass
    const mintMap = new Map(mintLogs.map((l) => [l.args.tokenId?.toString(), l]))

    // Fetch timestamps for unique blocks (burns are rare so this is cheap)
    const uniqueBlocks = [...new Set(burnLogs.map((l) => l.blockNumber!))]
    const blockArr = await Promise.all(uniqueBlocks.map((bn) => client.getBlock({ blockNumber: bn })))
    const blockTimeMap = new Map(uniqueBlocks.map((bn, i) => [bn.toString(), blockArr[i].timestamp]))

    return burnLogs.map((l) => {
      const tokenId = l.args.tokenId!
      const mint    = mintMap.get(tokenId.toString())
      const ts      = blockTimeMap.get(l.blockNumber!.toString()) ?? BigInt(Math.floor(Date.now() / 1000))
      return {
        id:               Number(tokenId % 1_000_000_000n),
        event_type:       "burn",
        tx_hash:          l.transactionHash ?? "",
        token_id:         tokenId.toString(),
        route_id:         l.args.routeId?.toString() ?? "",
        block_number:     l.blockNumber?.toString() ?? "",
        valid_until_epoch: mint?.args.validUntilEpoch?.toString() ?? null,
        created_at:       new Date(Number(ts) * 1000).toISOString(),
        seat_class:       mint?.args.seatClass === 1 ? "Business" : "Economy",
      } satisfies RiderPassEventRow
    })
  } catch {
    return []
  }
}
