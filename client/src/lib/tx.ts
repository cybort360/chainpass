import { decodeEventLog, parseAbiItem, type Log } from "viem"
import { chainPassTicketAbi } from "@hoppr/shared"

/**
 * ERC-721 standard Transfer event. We fall back to this when the custom
 * `TicketMinted` event cannot be decoded from the receipt logs — which has
 * happened in the wild when RPCs return logs in odd shapes or the ABI drifts
 * slightly between the contract deploy and the client bundle. A mint always
 * emits exactly one `Transfer(address(0), to, tokenId)` from the contract
 * (OpenZeppelin base), so it's a reliable last-resort source of the tokenId.
 */
const ERC721_TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
)

export function extractMintedTokenIdFromReceipt(
  logs: readonly Log[],
  contractAddress: `0x${string}`,
): bigint | null {
  const ca = contractAddress.toLowerCase()

  // Pass 1 — preferred: decode the custom TicketMinted event.
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

  // Pass 2 — fallback: look for a mint Transfer (from = 0x0) on our contract.
  for (const log of logs) {
    if (!log.address || log.address.toLowerCase() !== ca) continue
    try {
      const decoded = decodeEventLog({
        abi: [ERC721_TRANSFER_EVENT],
        eventName: "Transfer",
        data: log.data,
        topics: log.topics,
      })
      const args = decoded.args as { from?: `0x${string}`; tokenId?: bigint }
      if (args.from && args.from.toLowerCase() === "0x0000000000000000000000000000000000000000"
        && typeof args.tokenId === "bigint") {
        return args.tokenId
      }
    } catch {
      continue
    }
  }

  return null
}
