import type { HandlerResponse, Middleware, RequestContext } from "@bunary/http";
import { createCookieJar, withSetCookies } from "./cookies.js";
import { createAuthManager } from "./manager.js";
import type {
	AuthConfig,
	AuthContext,
	AuthManagerInterface,
	CookieJar,
} from "./types.js";

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
	return authContextMiddleware<TLocals>(() => manager);
}

/**
 * Build middleware that attaches a request-scoped `AuthContext` from the
 * resolved manager to `ctx.locals.auth`, runs `before` (which may
 * answer the request itself), then calls `next()`.
 *
 * Shared by `createAuth()` and the `@bunary/auth/provider` middleware.
 *
 * @internal
 */
export function authContextMiddleware<TLocals extends object>(
	resolveManager: (ctx: RequestContext<TLocals>) => AuthManagerInterface,
	before?: (
		auth: AuthContext,
		locals: Record<string, unknown>,
	) => Promise<HandlerResponse | undefined>,
): Middleware<TLocals> {
	return async (ctx, next) => {
		const manager = resolveManager(ctx);

		// @bunary/http >= 1.0 provides ctx.cookies and appends its Set-Cookie headers
		const httpCookies = (ctx as { cookies?: CookieJar }).cookies;
		const fallback = httpCookies ? undefined : createCookieJar(ctx.request);

		// Attach a request-scoped auth context to locals (per-request storage)
		const auth = manager.createContext({
			request: ctx.request,
			cookies: httpCookies ?? fallback,
		});
		const locals = ctx.locals as Record<string, unknown>;
		locals.auth = auth;

		const early = before ? await before(auth, locals) : undefined;
		const result = early !== undefined ? early : await next();
		return fallback ? withSetCookies(result, fallback.headers()) : result;
	};
}
