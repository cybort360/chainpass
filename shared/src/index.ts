export const CHAINPASS_SHARED_VERSION = "0.0.0" as const;

export { chainPassTicketAbi } from "./abis/chainPassTicketAbi.js";
export { monadTestnet } from "./chain.js";
export {
  CHAINPASS_ROUTE_LABEL_NAMESPACE,
  newRouteIdDecimalFromUuid,
  stableRouteIdDecimalForLabel,
} from "./routeId.js";
