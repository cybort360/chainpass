import { decodeEventLog, type Log } from "viem"
import { chainPassTicketAbi } from "@chainpass/shared"

export function extractMintedTokenIdFromReceipt(
  logs: readonly Log[],
  contractAddress: `0x${string}`,
): bigint | null {
  const ca = contractAddress.toLowerCase()
  for (const log of logs) {
    if (!log.address || log.address.toLowerCase() !== ca) continue
    try {
      const decoded = decodeEventLog({
        abi: chainPassTicketAbi,
        eventName: "TicketMinted",
        data: log.data,
        topics: log.topics,
      })
      const args = decoded.args as { tokenId?: bigint }
      const tokenId = args.tokenId
      if (typeof tokenId === "bigint") return tokenId
    } catch {
      continue
    }
  }
  return null
}
