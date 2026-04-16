/**
 * Chunked `eth_getLogs` helper.
 *
 * Why this exists: public Monad testnet RPC (testnet-rpc.monad.xyz) rejects
 * wide scans with HTTP 413 "Content Too Large". Any direct call that does
 * `fromBlock: 0n, toBlock: "latest"` on a chain with millions of blocks will
 * fail. Callers pass a factory closing over their static `getLogs` params
 * (address, event, args) and we vary the block range across chunks.
 *
 * Chunks run with bounded concurrency so total wall-clock time stays reasonable
 * even when the configured range is large. Failing chunks are swallowed —
 * callers can degrade gracefully (e.g. fall back to indexer / API) without
 * losing results from chunks that did succeed.
 */

/** Conservative default. Most public RPCs accept up to 10k blocks per getLogs call. */
const DEFAULT_CHUNK_SIZE = 10_000n

/**
 * How many chunk requests we allow in flight simultaneously.
 * Kept low (2) because two call sites (burn + mint scans) run in parallel, so the
 * effective concurrency against Monad's public RPC is 2× this number. Higher values
 * trigger HTTP 429 rate limits on testnet-rpc.monad.xyz.
 */
const DEFAULT_CONCURRENCY = 2

export async function fetchLogsChunked<T>(
  fetchRange: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>,
  fromBlock: bigint,
  toBlock: bigint,
  options: { chunkSize?: bigint; concurrency?: number } = {},
): Promise<T[]> {
  if (fromBlock > toBlock) return []

  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY

  // Build the full list of (from, to) chunk boundaries up front so workers
  // can pick them off a shared index without having to coordinate.
  const chunks: Array<{ from: bigint; to: bigint }> = []
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = start + chunkSize - 1n > toBlock ? toBlock : start + chunkSize - 1n
    chunks.push({ from: start, to: end })
  }

  const results: T[][] = new Array(chunks.length)
  let nextIndex = 0
  async function worker(): Promise<void> {
    while (nextIndex < chunks.length) {
      const i = nextIndex++
      const { from, to } = chunks[i]
      try {
        results[i] = await fetchRange(from, to)
      } catch {
        // Silently drop this chunk — caller decides how to handle partial data.
        results[i] = []
      }
    }
  }

  const workerCount = Math.min(concurrency, chunks.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  return results.flat()
}
