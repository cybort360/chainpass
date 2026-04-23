import type { PublicClient } from "viem"
import { chainPassTicketAbi } from "@hoppr/shared"

/** Lifetime mint/burn counts from the deployed contract (`totalMinted` / `totalBurned`). */
export async function fetchTicketLifecycleTotals(
  client: PublicClient,
  contract: `0x${string}`,
): Promise<{ totalMinted: bigint; totalBurned: bigint } | null> {
  try {
    const [totalMinted, totalBurned] = await Promise.all([
      client.readContract({
        address: contract,
        abi: chainPassTicketAbi,
        functionName: "totalMinted",
      }),
      client.readContract({
        address: contract,
        abi: chainPassTicketAbi,
        functionName: "totalBurned",
      }),
    ])
    return { totalMinted: totalMinted as bigint, totalBurned: totalBurned as bigint }
  } catch {
    return null
  }
}
