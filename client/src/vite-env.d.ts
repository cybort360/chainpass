/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAINPASS_API_URL?: string
  readonly VITE_CHAINPASS_CONTRACT_ADDRESS?: string
  readonly VITE_PRIVY_APP_ID?: string
  /** Optional per-env app client from Privy dashboard. */
  readonly VITE_PRIVY_CLIENT_ID?: string
  readonly VITE_DEFAULT_OPERATOR_ADDRESS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
