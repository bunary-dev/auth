/**
 * @bunary/auth - Authentication guards and helpers for Bunary
 *
 * A Bun-first authentication system inspired by Laravel's auth guards.
 *
 * @example
 * ```ts
 * import { createAuthManager, setAuthManager, auth } from "@bunary/auth";
 *
 * const authManager = createAuthManager({
 *   defaultGuard: "jwt",
 *   guards: {
 *     jwt: {
 *       name: "jwt",
 *       async authenticate(request) {
 *         const token = request.headers.get("Authorization")?.replace("Bearer ", "");
 *         if (!token) return null;
 *         // Validate and decode JWT
 *         return { id: 1, name: "John" };
 *       }
 *     }
 *   }
 * });
 *
 * setAuthManager(authManager);
 *
 * // In a route handler
 * const ctx = auth({ request });
 * await ctx.authenticate();
 * const user = ctx.user();
 * ```
 */

// Types
export type {
	AuthUser,
	Guard,
	AuthConfig,
	GuardInput,
	AuthContext,
	AuthManagerInterface,
} from "./types.js";

// Auth Manager
export { createAuthManager } from "./manager.js";

// Helpers
export {
	auth,
	setAuthManager,
	getAuthManager,
	clearAuthManager,
} from "./helpers.js";
