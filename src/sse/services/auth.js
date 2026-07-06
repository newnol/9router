diff3: invalid print range
import { getProviderConnections, validateApiKey, updateProviderConnection, getSettings } from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { formatRetryAfter, checkFallbackError, isModelLockActive, buildModelLockUpdate, getEarliestModelLockUntil } from "open-sse/services/accountFallback.js";
import { MAX_RATE_LIMIT_COOLDOWN_MS } from "open-sse/config/errorConfig.js";
import { resolveProviderId, FREE_PROVIDERS } from "@/shared/constants/providers.js";
import { sortByScore } from "open-sse/services/connectionScoring.js";
import { getInFlight, incrementInFlight, recordRequest } from "open-sse/services/inFlightTracker.js";
// Mutex to prevent race conditions during account selection
let selectionMutex = Promise.resolve();

/**
 * Get provider credentials from localDb
 * Filters out unavailable accounts and returns the selected account based on strategy
 * @param {string} provider - Provider name
 * @param {Set<string>|string|null} excludeConnectionIds - Connection ID(s) to exclude (for retry with next account)
 * @param {string|null} model - Model name for per-model rate limit filtering
 */
export async function getProviderCredentials(provider, excludeConnectionIds = null, model = null, options = {}) {
  // Normalize to Set for consistent handling
  const excludeSet = excludeConnectionIds instanceof Set
    ? excludeConnectionIds
    : (excludeConnectionIds ? new Set([excludeConnectionIds]) : new Set());
  const preferredConnectionId = options?.preferredConnectionId || null;
  // Acquire mutex to prevent race conditions
  const currentMutex = selectionMutex;
  let resolveMutex;
  selectionMutex = new Promise(resolve => { resolveMutex = resolve; });

  try {
    await currentMutex;

    // Resolve alias to provider ID (e.g., "kc" -> "kilocode")
    const providerId = resolveProviderId(provider);

    // For no-auth free providers: try proxy connections from DB first, fall back to settings
    let connections;
    if (FREE_PROVIDERS[providerId]?.noAuth) {
      connections = await getProviderConnections({ provider: providerId, isActive: true });
      if (connections.length > 0) {
        // Use proxy connections — each has its own proxyPoolId in providerSpecificData
      } else {
        // Old fallback: single virtual connection from settings
        const settings = await getSettings();
        const override = (settings.providerStrategies || {})[providerId] || {};
        const resolvedProxy = await resolveConnectionProxyConfig({ proxyPoolId: override.proxyPoolId || "" });
        return {
          id: "noauth",
          connectionName: "Public",
          isActive: true,
          accessToken: "public",
          providerSpecificData: {
            connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
            connectionProxyUrl: resolvedProxy.connectionProxyUrl,
            connectionNoProxy: resolvedProxy.connectionNoProxy,
            connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
            vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
          },
        };
      }
    } else {
      connections = await getProviderConnections({ provider: providerId, isActive: true });
    }
    log.debug("AUTH", `${provider} | total connections: ${connections.length}, excludeIds: ${excludeSet.size > 0 ? [...excludeSet].join(",") : "none"}, model: ${model || "any"}`);

    if (connections.length === 0) {
      log.warn("AUTH", `No credentials for ${provider}`);
      return null;
    }

    // Filter out model-locked and excluded connections
    // Also handle circuit breaker half-open state
