import { createAuthManager } from "./manager.js";
import type { AuthConfig } from "./types.js";

/**
 * Minimal RequestContext interface for middleware compatibility.
 * This matches @bunary/http's RequestContext without creating a dependency.
 */
interface RequestContext {
	request: Request;
	params: Record<string, string>;
	query: URLSearchParams;
	locals: Record<string, unknown>;
}

/**
 * Middleware function type compatible with @bunary/http.
 */
type Middleware = (
	ctx: RequestContext,
	next: () => Promise<Response | object | string | null | undefined>,
) =>
	| Promise<Response | object | string | null | undefined>
	| Response
	| object
	| string
	| null
	| undefined;

/**
 * Create app-scoped authentication middleware.
 *
 * This factory creates a middleware function that attaches an `AuthContext`
 * to `ctx.locals.auth` for each request. This allows multiple apps in the
 * same process to have different auth configurations without global state.
 *
 * @param config - Authentication configuration (guards and default guard)
 * @returns Middleware function that attaches auth context to request
 *
 * @example
 * ```ts
 * import { createApp } from "@bunary/http";
 * import { createAuth, createJwtGuard } from "@bunary/auth";
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
export function createAuth(config: AuthConfig): Middleware {
	const manager = createAuthManager(config);

	return async (ctx: RequestContext, next) => {
		// Create request-scoped auth context
		const authContext = manager.createContext({ request: ctx.request });

		// Attach to request context locals (per-request storage)
		ctx.locals.auth = authContext;

		// Continue to next middleware/handler
		return await next();
	};
}
