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
 * await authManager.authenticate(request);
 * if (authManager.check()) {
 *   const user = authManager.user();
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
	 * Authenticate a request using the specified or default guard.
	 *
	 * @param request - The incoming HTTP request
	 * @param guardName - Optional guard name to use
	 * @returns The authenticated user or null
	 */
	authenticate(request: Request, guardName?: string): Promise<AuthUser | null>;

	/**
	 * Get the currently authenticated user.
	 *
	 * @returns The authenticated user or null
	 */
	user(): AuthUser | null;

	/**
	 * Check if a user is currently authenticated.
	 *
	 * @returns true if authenticated, false otherwise
	 */
	check(): boolean;

	/**
	 * Clear the current authentication state.
	 */
	logout(): void;
}
