/**
 * `@bunary/core` integration: the `auth` config key, `authProvider`,
 * `AuthToken` and middleware that resolves the manager from the app.
 *
 * Shipped as the `@bunary/auth/provider` subpath so the main entry never
 * imports `@bunary/core`, which is an optional peer.
 */

import {
	type Application,
	BunaryError,
	createToken,
	defineProvider,
	type Provider,
	type Token,
} from "@bunary/core";
import { authContextMiddleware } from "./appScoped.js";
import { createAuthManager } from "./manager.js";
import type {
	AuthConfig,
	AuthContext,
	AuthManagerInterface,
	AuthMiddleware,
	AuthRequestContext,
	AuthUser,
} from "./types.js";

declare module "@bunary/core" {
	interface BunaryConfig {
		/** Guards, default guard and user provider read by `authProvider` */
		auth?: AuthConfig;
	}
}

/**
 * Container token the auth manager is bound under by {@link authProvider}.
 *
 * @example
 * ```ts
 * import { AuthToken } from "@bunary/auth/provider";
 *
 * const manager = app.get(AuthToken);
 * const auth = manager.createContext({ request });
 * await auth.authenticate();
 * ```
 */
export const AuthToken: Token<AuthManagerInterface> =
	createToken<AuthManagerInterface>("auth.manager");

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate the `auth` configuration namespace, throwing a core `BunaryError`
 * the way core reports a bad config. Runs during `register()` so a typo
 * fails at boot rather than at the first request.
 */
function assertAuthConfig(value: unknown): asserts value is AuthConfig {
	if (value === undefined) {
		throw new BunaryError('BunaryConfig: "auth" is required by authProvider');
	}
	if (!isObject(value)) {
		throw new BunaryError('BunaryConfig: "auth" must be an object');
	}

	const { defaultGuard, guards, provider } = value;

	if (typeof defaultGuard !== "string" || defaultGuard === "") {
		throw new BunaryError(
			'BunaryConfig: "auth.defaultGuard" must be a non-empty string',
		);
	}
	if (!isObject(guards)) {
		throw new BunaryError('BunaryConfig: "auth.guards" must be an object');
	}
	for (const [name, guard] of Object.entries(guards)) {
		if (!isObject(guard) || typeof guard.authenticate !== "function") {
			throw new BunaryError(
				`BunaryConfig: "auth.guards.${name}" must be a guard (an object with authenticate())`,
			);
		}
	}
	if (!Object.hasOwn(guards, defaultGuard)) {
		throw new BunaryError(
			`BunaryConfig: "auth.defaultGuard" is "${defaultGuard}", which is not in "auth.guards"`,
		);
	}
	if (
		provider !== undefined &&
		(!isObject(provider) ||
			typeof provider.retrieveById !== "function" ||
			typeof provider.retrieveByCredentials !== "function" ||
			typeof provider.validateCredentials !== "function")
	) {
		throw new BunaryError(
			'BunaryConfig: "auth.provider" must be a user provider (retrieveById, retrieveByCredentials and validateCredentials)',
		);
	}
}

/**
 * Core service provider: reads the `auth` config key, builds the auth
 * manager and binds it under {@link AuthToken}.
 *
 * The config is validated in `register()`, so a missing or invalid `auth`
 * key makes `app.boot()` reject with a `BunaryError`.
 *
 * @example
 * ```ts
 * import { createApp } from "@bunary/core";
 * import { createJwtGuard } from "@bunary/auth";
 * import { AuthToken, authProvider } from "@bunary/auth/provider";
 *
 * const app = createApp({
 *   config: {
 *     app: { name: "my-api" },
 *     auth: {
 *       defaultGuard: "jwt",
 *       guards: { jwt: createJwtGuard({ secret: process.env.JWT_SECRET! }) },
 *     },
 *   },
 *   providers: [authProvider],
 * });
 *
 * await app.boot();
 * app.get(AuthToken).guard().name; // "jwt"
 * ```
 */
export const authProvider: Provider = defineProvider({
	name: "@bunary/auth",
	register(app) {
		const config = app.config.get("auth");
		assertAuthConfig(config);
		app.set(AuthToken, createAuthManager(config));
	},
});

/**
 * Options for {@link authMiddleware} and {@link requireAuth}.
 */
export interface AuthMiddlewareOptions {
	/** Guard to authenticate with (defaults to the config's `defaultGuard`). */
	guard?: string;
	/**
	 * Application to resolve {@link AuthToken} from. Defaults to `ctx.app`,
	 * which `@bunary/http` sets on routers mounted on a core app.
	 */
	app?: Application;
}

/**
 * The request context {@link authMiddleware} and {@link requireAuth} accept:
 * an {@link AuthRequestContext} whose optional `app` is a core
 * `Application`. `@bunary/http`'s `RequestContext` fits without casts.
 *
 * @typeParam TLocals - Shape of `ctx.locals`
 */
export type AuthAppRequestContext<
	TLocals extends object = Record<string, unknown>,
> = AuthRequestContext<TLocals> & {
	/** Application to resolve {@link AuthToken} from */
	app?: Application;
};

/**
 * `ctx.locals` added by {@link authMiddleware}: the auth context and the
 * user, or `null` for a guest.
 */
export type AuthUserLocals<TUser extends AuthUser = AuthUser> = {
	/** Request-scoped auth context */
	auth: AuthContext;
	/** The authenticated user, or null */
	user: TUser | null;
};

/**
 * `ctx.locals` added by {@link requireAuth}: the user is always set.
 */
export type RequiredAuthLocals<TUser extends AuthUser = AuthUser> = {
	/** Request-scoped auth context */
	auth: AuthContext;
	/** The authenticated user */
	user: TUser;
};

/** RFC 9457 401 problem response. */
function unauthorized(): Response {
	return new Response(
		JSON.stringify({ type: "about:blank", title: "Unauthorized", status: 401 }),
		{
			status: 401,
			headers: { "content-type": "application/problem+json; charset=utf-8" },
		},
	);
}

function createMiddleware<TLocals extends object>(
	name: string,
	options: AuthMiddlewareOptions,
	required: boolean,
): AuthMiddleware<AuthAppRequestContext<TLocals>> {
	return authContextMiddleware<AuthAppRequestContext<TLocals>>(
		(ctx) => {
			const app = options.app ?? ctx.app;
			if (!app) {
				throw new Error(
					`${name}: no @bunary/core Application on ctx.app; mount the router with httpProvider() or pass { app }`,
				);
			}
			return app.get(AuthToken);
		},
		async (auth, locals) => {
			const user = await auth.authenticate(options.guard);
			locals.user = user;
			return required && !user ? unauthorized() : undefined;
		},
	);
}

/**
 * Middleware that resolves the auth manager from the app container,
 * authenticates the request and sets `ctx.locals.auth` and
 * `ctx.locals.user` (`null` for guests). Guests are passed through.
 *
 * @typeParam TLocals - Shape of `ctx.locals`; use {@link AuthUserLocals}
 * @param options - Guard name and, without `ctx.app`, the app
 * @throws (per request) If no app is available or `authProvider` was not booted
 *
 * @example
 * ```ts
 * import { authMiddleware, type AuthUserLocals } from "@bunary/auth/provider";
 *
 * router.use(authMiddleware<AuthUserLocals>());
 * router.get("/", (ctx) => ({ guest: ctx.locals.user === null }));
 * ```
 */
export function authMiddleware<
	TLocals extends object = Record<string, unknown>,
>(
	options: AuthMiddlewareOptions = {},
): AuthMiddleware<AuthAppRequestContext<TLocals>> {
	return createMiddleware<TLocals>("authMiddleware", options, false);
}

/**
 * Like {@link authMiddleware}, but answers guests with a 401 RFC 9457
 * problem response (`application/problem+json`) without calling the handler.
 *
 * @typeParam TLocals - Shape of `ctx.locals`; use {@link RequiredAuthLocals}
 * @param options - Guard name and, without `ctx.app`, the app
 *
 * @example
 * ```ts
 * import { requireAuth, type RequiredAuthLocals } from "@bunary/auth/provider";
 *
 * router.use(requireAuth<RequiredAuthLocals>({ guard: "jwt" }));
 * router.get("/me", (ctx) => ({ id: ctx.locals.user.id }));
 * ```
 */
export function requireAuth<TLocals extends object = Record<string, unknown>>(
	options: AuthMiddlewareOptions = {},
): AuthMiddleware<AuthAppRequestContext<TLocals>> {
	return createMiddleware<TLocals>("requireAuth", options, true);
}
