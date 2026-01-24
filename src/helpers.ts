/**
 * Global auth helper functions for accessing authentication state.
 */
import type { AuthManagerInterface, AuthUser } from "./types.js";

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
 * Get the current authenticated user from the global auth manager.
 *
 * @returns The authenticated user or null if not authenticated
 * @throws If no auth manager has been set
 *
 * @example
 * ```ts
 * app.get("/profile", () => {
 *   const user = auth();
 *   if (!user) {
 *     return new Response("Unauthorized", { status: 401 });
 *   }
 *   return { user };
 * });
 * ```
 */
export function auth(): AuthUser | null {
	if (!globalAuthManager) {
		throw new Error(
			"Auth manager not initialized. Call setAuthManager() before using auth().",
		);
	}
	return globalAuthManager.user();
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
