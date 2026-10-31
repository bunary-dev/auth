/**
 * @bunary/auth - Authentication guards and helpers for Bunary
 *
 * A Bun-first authentication system inspired by Laravel's auth guards.
 *
 * @example
 * ```ts
 * import { createApp } from "@bunary/http";
 * import { createAuth, createJwtGuard } from "@bunary/auth";
 * import type { AuthLocals } from "@bunary/auth";
 *
 * const app = createApp<AuthLocals>();
 *
 * // Attach a request-scoped auth context to ctx.locals.auth
 * app.use(createAuth<AuthLocals>({
 *   defaultGuard: "jwt",
 *   guards: {
 *     jwt: createJwtGuard({ secret: process.env.JWT_SECRET! })
 *   }
 * }));
 *
 * // Access auth in route handlers
 * app.get("/profile", async (ctx) => {
 *   const user = await ctx.locals.auth.authenticate();
 *   if (!user) return new Response("Unauthorized", { status: 401 });
 *   return { user };
 * });
 * ```
 */

// App-scoped integration
export { createAuth } from "./appScoped.js";
export type { QueuedCookieJar } from "./cookies.js";
// Cookies
export { createCookieJar } from "./cookies.js";
export type { BasicGuardOptions } from "./guards/basic.js";
// Guards
export { createBasicGuard } from "./guards/basic.js";
export type { JwtGuardOptions } from "./guards/jwt.js";
export { createJwtGuard } from "./guards/jwt.js";
export type { SessionGuardOptions } from "./guards/session.js";
export { createSessionGuard } from "./guards/session.js";
// Auth Manager
export { createAuthManager } from "./manager.js";
// Types
export type {
	AttemptResult,
	AuthConfig,
	AuthContext,
	AuthLocals,
	AuthManagerInterface,
	AuthUser,
	CookieJar,
	CookieOptions,
	Credentials,
	Guard,
	GuardInput,
	UserProvider,
} from "./types.js";
