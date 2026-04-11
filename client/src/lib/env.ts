const raw = import.meta.env

function optionalAddress(value: string | undefined): `0x${string}` | undefined {
  if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) return undefined
  return value as `0x${string}`
}

export const env = {
  apiUrl: (raw.VITE_CHAINPASS_API_URL as string | undefined) ?? "http://localhost:3001",
  contractAddress: optionalAddress(raw.VITE_CHAINPASS_CONTRACT_ADDRESS as string | undefined),
  privyAppId: (raw.VITE_PRIVY_APP_ID as string | undefined) ?? "",
  privyClientId: (raw.VITE_PRIVY_CLIENT_ID as string | undefined) ?? "",
  /** Operator address stored on tickets at mint (demo default). */
  defaultOperator: optionalAddress(raw.VITE_DEFAULT_OPERATOR_ADDRESS as string | undefined) ?? "0x0000000000000000000000000000000000000000",
}
