/**
 * Represents an authenticated user in the system.
 *
 * This is a flexible interface that can be extended by applications
 * to include additional user properties.
 *
 * @example
 * ```ts
 * interface MyUser extends AuthUser {
 *   email: string;
 *   roles: string[];
 * }
 * ```
 */
export interface AuthUser {
	/** Unique identifier for the user */
	id: string | number;
	/** Additional user properties */
	[key: string]: unknown;
}

/**
 * Credentials passed to `attempt()`, e.g. `{ email, password }`.
 *
 * The shape is up to your user provider (or, for the Basic guard,
 * `{ username, password }`).
 */
export type Credentials = Record<string, unknown>;

/**
 * Looks users up for guards that log users in (Laravel's `UserProvider`).
 *
 * @example
 * ```ts
 * interface User extends AuthUser { email: string; passwordHash: string }
 * // passwordHash from `await Bun.password.hash(password)`
 * const users = new Map<number, User>([[1, { id: 1, email: "ada@example.com", passwordHash }]]);
 *
 * const provider: UserProvider<User> = {
 *   retrieveById: (id) => users.get(Number(id)) ?? null,
 *   retrieveByCredentials: (c) =>
 *     [...users.values()].find((u) => u.email === c.email) ?? null,
 *   validateCredentials: (user, c) =>
 *     typeof c.password === "string" &&
 *     Bun.password.verify(c.password, user.passwordHash),
 * };
 * ```
 */
export interface UserProvider<TUser extends AuthUser = AuthUser> {
	/** Find a user by their identifier, or return null. */
	retrieveById(id: AuthUser["id"]): Promise<TUser | null> | TUser | null;

	/**
	 * Find a user matching the credentials, ignoring the password
	 * (e.g. look up by email). Return null if there is none.
	 */
	retrieveByCredentials(
		credentials: Credentials,
	): Promise<TUser | null> | TUser | null;

	/** Check the credentials (e.g. the password) against the user. */
	validateCredentials(
		user: TUser,
		credentials: Credentials,
	): Promise<boolean> | boolean;
}

/**
 * Options accepted by `CookieJar.set()` / `CookieJar.delete()`.
 *
 * A subset of `@bunary/http`'s `CookieSerializeOptions`.
 */
export interface CookieOptions {
	path?: string;
	domain?: string;
	maxAge?: number;
	expires?: Date;
	httpOnly?: boolean;
	secure?: boolean;
	sameSite?: "lax" | "strict" | "none";
	partitioned?: boolean;
}

/**
 * Per-request cookie access used by the session guard.
 *
 * Structurally compatible with `@bunary/http`'s `ctx.cookies` (`CookieJar`),
 * so that jar can be passed straight through.
 */
export interface CookieJar {
	/** Read a cookie from the request, or `undefined` if it was not sent. */
	get(name: string): string | undefined;
	/** Queue a `Set-Cookie` header for the response. */
	set(name: string, value: string, options?: CookieOptions): void;
	/** Queue a `Set-Cookie` header that expires the cookie. */
	delete(name: string, options?: CookieOptions): void;
}

/**
 * Result of a successful `attempt()`.
 *
 * `token` is set by guards that issue tokens (the JWT guard).
 */
export interface AttemptResult<TUser extends AuthUser = AuthUser> {
	user: TUser;
	token?: string;
}

/**
 * Authentication guard that validates requests and extracts user information.
 *
 * Guards are responsible for:
 * - Extracting credentials from requests (e.g., JWT from Authorization header)
 * - Validating those credentials
 * - Returning the authenticated user or null
 *
 * @example
 * ```ts
 * const jwtGuard: Guard = {
 *   name: "jwt",
 *   async authenticate(request) {
 *     const token = request.headers.get("Authorization")?.replace("Bearer ", "");
 *     if (!token) return null;
 *     // Validate token and return user
 *     return { id: 1, name: "John" };
 *   }
 * };
 * ```
 */
export interface Guard {
	/** Unique name for this guard */
	name: string;

	/**
	 * Authenticate a request and return the user if valid.
	 *
	 * @param request - The incoming HTTP request
	 * @returns The authenticated user or null if authentication fails
	 */
	authenticate(
		request: Request,
		input?: GuardInput,
	): Promise<AuthUser | null> | AuthUser | null;

	/**
	 * Check credentials and log the user in. Return null when they don't match.
	 * Optional; guards without it make `AuthContext.attempt()` throw.
	 */
	attempt?(
		credentials: Credentials,
		input: GuardInput,
	): Promise<AttemptResult | null>;

	/**
	 * Log a known user in (write the session, or issue a token and return it).
	 * Optional; guards without it make `AuthContext.login()` throw.
	 */
	login?(user: AuthUser, input: GuardInput): Promise<string | undefined>;

	/**
	 * Log the current user out (e.g. clear the session cookie).
	 * Optional; without it `AuthContext.logout()` only clears the request's user.
	 */
	logout?(input: GuardInput): Promise<void> | void;
}

/**
 * Configuration for the AuthManager.
 *
 * @example
 * ```ts
 * const config: AuthConfig = {
 *   defaultGuard: "jwt",
 *   guards: {
 *     jwt: jwtGuard,
 *     api: apiKeyGuard,
 *   }
 * };
 * ```
 */
export interface AuthConfig {
	/** The name of the default guard to use when none is specified */
	defaultGuard: string;

	/** Named guards available for authentication */
	guards: Record<string, Guard>;

	/**
	 * The app's user provider, returned by `manager.provider()`.
	 * Guards still take their provider in their own options.
	 */
	provider?: UserProvider;
}

/**
 * Input passed to guards/auth contexts.
 *
 * Keep this minimal and explicit for MVP. Additional request-scoped fields
 * (like params/query) can be added later without introducing global state.
 */
export interface GuardInput {
	/** The incoming HTTP request */
	request: Request;

	/**
	 * Cookie jar for this request (e.g. `@bunary/http`'s `ctx.cookies`).
	 * The manager creates one from the request when omitted.
	 */
	cookies?: CookieJar;
}

/**
 * Request-scoped authentication context.
 *
 * This holds **per-request** authentication state (the current user),
 * and provides explicit methods for authentication.
 */
export interface AuthContext {
	/**
	 * Get a guard by name (or the default guard).
	 */
	guard(name?: string): Guard;

	/**
	 * Authenticate the request using the specified or default guard.
	 *
	 * Stores the user on this context (not globally).
	 */
	authenticate(guardName?: string): Promise<AuthUser | null>;

	/**
	 * Get the currently authenticated user for this request.
	 */
	user(): AuthUser | null;

	/**
	 * Returns true if the request is authenticated.
	 */
	check(): boolean;

	/**
	 * Returns true if the request is not authenticated.
	 */
	guest(): boolean;

	/**
	 * Look the user up by credentials and log them in with the guard
	 * (session: writes the cookie; JWT: issues a token; Basic: this request only).
	 *
	 * @returns The user (and token, for the JWT guard), or false when the
	 *   credentials don't match
	 * @throws If the guard does not support `attempt()`
	 */
	attempt(
		credentials: Credentials,
		guardName?: string,
	): Promise<AttemptResult | false>;

	/**
	 * Log a user in with the guard without checking credentials.
	 *
	 * @returns The issued token for the JWT guard, otherwise undefined
	 * @throws If the guard does not support `login()` (e.g. the Basic guard)
	 */
	login(user: AuthUser, guardName?: string): Promise<string | undefined>;

	/**
	 * Get the authenticated user or throw.
	 */
	require(): AuthUser;

	/**
	 * Log out: let the guard clear its state (the session guard clears its
	 * cookie), then clear the user for this request.
	 *
	 * @throws If the guard is stateless and has nothing to log out of (Basic)
	 */
	logout(guardName?: string): Promise<void>;
}

/**
 * The AuthManager interface for managing authentication state.
 *
 * @example
 * ```ts
 * const authManager = createAuthManager({
 *   defaultGuard: "jwt",
 *   guards: { jwt: jwtGuard }
 * });
 *
 * // In a request handler
 * const auth = authManager.createContext({ request });
 * await auth.authenticate();
 * if (auth.check()) {
 *   const user = auth.user();
 * }
 * ```
 */
export interface AuthManagerInterface {
	/**
	 * Get a guard by name.
	 *
	 * @param name - The guard name (uses default if not specified)
	 * @returns The requested guard
	 * @throws If the guard doesn't exist
	 */
	guard(name?: string): Guard;

	/**
	 * Get the user provider from `AuthConfig.provider`.
	 *
	 * @throws If the config has no `provider`
	 */
	provider(): UserProvider;

	/**
	 * Create a request-scoped AuthContext.
	 *
	 * @param input - Request-scoped input for guards
	 * @returns A request-scoped auth context (isolated per request)
	 */
	createContext(input: GuardInput): AuthContext;
}

/**
 * Shape of `ctx.locals` added by the `createAuth()` middleware.
 *
 * Pass it (or a type extending it) to `@bunary/http`'s `createApp<TLocals>()`
 * and to `createAuth<TLocals>()` to get a typed `ctx.locals.auth`.
 *
 * @example
 * ```ts
 * type Locals = AuthLocals & { requestId: string };
 * const app = createApp<Locals>();
 * app.use(createAuth<Locals>(config));
 * ```
 */
export type AuthLocals = {
	/** Request-scoped auth context attached by `createAuth()` */
	auth: AuthContext;
};
