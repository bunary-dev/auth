/**
 * @bunary/auth - Authentication guards and helpers for Bunary
 *
 * A Bun-first authentication system inspired by Laravel's auth guards.
 *
 * @example
 * ```ts
 * import { createApp } from "@bunary/http";
 * import { createAuth, createJwtGuard } from "@bunary/auth";
 * import type { AuthContext } from "@bunary/auth";
 *
 * const app = createApp();
 *
 * // Create app-scoped auth middleware
 * const authMiddleware = createAuth({
 *   defaultGuard: "jwt",
 *   guards: {
 *     jwt: createJwtGuard({ secret: process.env.JWT_SECRET! })
 *   }
 * });
 *
 * // Use middleware to attach auth context
 * app.use(authMiddleware);
 *
 * // Access auth in route handlers
 * app.get("/profile", (ctx) => {
 *   const auth = ctx.locals.auth as AuthContext;
 *   if (!auth.check()) {
 *     return new Response(JSON.stringify({ error: "Unauthorized" }), {
 *       status: 401,
 *       headers: { "Content-Type": "application/json" }
 *     });
 *   }
 *   return { user: auth.user() };
 * });
 * ```
 */

// App-scoped integration
export { createAuth } from "./appScoped.js";
export type { BasicGuardOptions } from "./guards/basic.js";
export { createBasicGuard } from "./guards/basic.js";
export type { JwtGuardOptions } from "./guards/jwt.js";
// Guards
export { createJwtGuard } from "./guards/jwt.js";
// Helpers
export {
	auth,
	clearAuthManager,
	getAuthManager,
	setAuthManager,
} from "./helpers.js";
// Auth Manager
export { createAuthManager } from "./manager.js";
// Plugins
export { installAuthPlugin } from "./plugin.js";
// Storage
export { createCookieStorage } from "./storage.js";
// Types
export type {
	AuthConfig,
	AuthContext,
	AuthManagerInterface,
	AuthPlugin,
	AuthPluginRouter,
	AuthStorage,
	AuthUser,
	Guard,
	GuardInput,
	InstallableAuthManager,
} from "./types.js";
