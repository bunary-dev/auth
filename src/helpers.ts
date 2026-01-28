/**
 * Global auth helper functions for accessing authentication state.
 */
import type { AuthContext, AuthManagerInterface, GuardInput } from "./types.js";

let globalAuthManager: AuthManagerInterface | null = null;

/**
 * Set the global auth manager instance.
 *
 * This must be called before using the `auth()` helper.
 *
 * @param manager - The AuthManager instance to use globally
 *
 * @example
 * ```ts
 * import { createAuthManager, setAuthManager } from "@bunary/auth";
 *
 * const authManager = createAuthManager({ ... });
 * setAuthManager(authManager);
 * ```
 */
export function setAuthManager(manager: AuthManagerInterface): void {
	globalAuthManager = manager;
}

/**
 * Create a request-scoped AuthContext using the global auth manager.
 *
 * @param input - Request-scoped input for guards
 * @returns A request-scoped auth context
 * @throws If no auth manager has been set
 *
 * @example
 * ```ts
 * const ctx = auth({ request });
 * await ctx.authenticate();
 * return ctx.user();
 * ```
 */
export function auth(input: GuardInput): AuthContext {
	if (!globalAuthManager) {
		throw new Error(
			"Auth manager not initialized. Call setAuthManager() before using auth().",
		);
	}
	return globalAuthManager.createContext(input);
}

/**
 * Get the global auth manager instance.
 *
 * @returns The global auth manager or null if not set
 */
export function getAuthManager(): AuthManagerInterface | null {
	return globalAuthManager;
}

/**
 * Clear the global auth manager (useful for testing).
 */
export function clearAuthManager(): void {
	globalAuthManager = null;
}
