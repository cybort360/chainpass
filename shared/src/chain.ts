import { defineChain } from "viem";

/**
 * Monad testnet — use with createPublicClient / createWalletClient (indexer, scripts).
 * Block explorer matches [Monad docs](https://docs.monad.xyz/developer-essentials/testnets) (MonadVision).
 */
export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: {
      name: "MonadVision",
      url: "https://testnet.monadvision.com",
    },
  },
});
