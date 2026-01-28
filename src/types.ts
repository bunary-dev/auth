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
	authenticate(request: Request): Promise<AuthUser | null> | AuthUser | null;
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
	 * Get the authenticated user or throw.
	 */
	require(): AuthUser;

	/**
	 * Clear authentication state for this request.
	 */
	logout(): void;
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
	 * Create a request-scoped AuthContext.
	 *
	 * @param input - Request-scoped input for guards
	 * @returns A request-scoped auth context (isolated per request)
	 */
	createContext(input: GuardInput): AuthContext;
}

/**
 * Minimal storage abstraction for auth workflows (sessions/OAuth).
 *
 * The storage implementation is responsible for how values are persisted
 * (cookies, headers, database, etc.). The interface stays intentionally small.
 */
export interface AuthStorage {
	/**
	 * Read a value from the request (e.g. from cookies).
	 */
	get(request: Request, key: string): Promise<string | null> | string | null;

	/**
	 * Persist a value by mutating the response (e.g. adding `Set-Cookie`).
	 */
	set(
		response: Response,
		key: string,
		value: string,
		options?: { ttlSeconds?: number },
	): Promise<void> | void;

	/**
	 * Clear a stored value by mutating the response.
	 */
	clear(response: Response, key: string): Promise<void> | void;
}
