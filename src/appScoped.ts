import type { Middleware } from "@bunary/http";
import { createCookieJar, withSetCookies } from "./cookies.js";
import { createAuthManager } from "./manager.js";
import type { AuthConfig, CookieJar } from "./types.js";

/**
 * Create app-scoped authentication middleware for `@bunary/http`.
 *
 * This factory creates a middleware function that attaches an `AuthContext`
 * to `ctx.locals.auth` for each request. This allows multiple apps in the
 * same process to have different auth configurations without global state.
 *
 * Guards that write cookies (the session guard) use `ctx.cookies` when
 * `@bunary/http` provides it. Otherwise the middleware keeps its own
 * per-request jar and appends the queued `Set-Cookie` headers to the
 * response returned by `next()`.
 *
 * @typeParam TLocals - Shape of `ctx.locals`, matching `createApp<TLocals>()`.
 *   Use `AuthLocals` (or a type extending it) to get a typed `ctx.locals.auth`.
 * @param config - Authentication configuration (guards and default guard)
 * @returns `@bunary/http` middleware that attaches auth context to each request
 *
 * @example
 * ```ts
 * import { createApp } from "@bunary/http";
 * import { createAuth, createJwtGuard } from "@bunary/auth";
 * import type { AuthLocals } from "@bunary/auth";
 *
 * const app = createApp<AuthLocals>();
 *
 * app.use(createAuth<AuthLocals>({
 *   defaultGuard: "jwt",
 *   guards: {
 *     jwt: createJwtGuard({ secret: process.env.JWT_SECRET! })
 *   }
 * }));
 *
 * app.get("/profile", async (ctx) => {
 *   const user = await ctx.locals.auth.authenticate();
 *   if (!user) return new Response("Unauthorized", { status: 401 });
 *   return { user };
 * });
 * ```
 */
export function createAuth<TLocals extends object = Record<string, unknown>>(
	config: AuthConfig,
): Middleware<TLocals> {
	const manager = createAuthManager(config);

	return async (ctx, next) => {
		// @bunary/http >= 1.0 provides ctx.cookies and appends its Set-Cookie headers
		const httpCookies = (ctx as { cookies?: CookieJar }).cookies;
		const fallback = httpCookies ? undefined : createCookieJar(ctx.request);

		// Attach a request-scoped auth context to locals (per-request storage)
		(ctx.locals as Record<string, unknown>).auth = manager.createContext({
			request: ctx.request,
			cookies: httpCookies ?? fallback,
		});

		const result = await next();
		return fallback ? withSetCookies(result, fallback.headers()) : result;
	};
}
