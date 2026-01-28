/**
 * Create an AuthManager instance for managing authentication.
 *
 * @param config - Configuration with guards and default guard name
 * @returns AuthManager instance
 *
 * @example
 * ```ts
 * import { createAuthManager } from "@bunary/auth";
 *
 * const authManager = createAuthManager({
 *   defaultGuard: "jwt",
 *   guards: {
 *     jwt: {
 *       name: "jwt",
 *       async authenticate(request) {
 *         const token = request.headers.get("Authorization")?.replace("Bearer ", "");
 *         if (!token) return null;
 *         return { id: 1, name: "John" };
 *       }
 *     }
 *   }
 * });
 * ```
 */
import type {
	AuthConfig,
	AuthManagerInterface,
	AuthUser,
	Guard,
	GuardInput,
} from "./types.js";

export function createAuthManager(config: AuthConfig): AuthManagerInterface {
	// Store guards internally so they can be modified by plugins
	const guards = new Map<string, Guard>();
	for (const [name, guard] of Object.entries(config.guards)) {
		guards.set(name, guard);
	}

	const defaultGuardName = config.defaultGuard;

	return {
		/**
		 * Get a guard by name.
		 *
		 * @param name - The guard name (uses default if not specified)
		 * @returns The requested guard
		 * @throws If the guard doesn't exist
		 */
		guard(name?: string): Guard {
			const guardName = name ?? defaultGuardName;
			const guard = guards.get(guardName);

			if (!guard) {
				throw new Error(`Guard "${guardName}" is not defined`);
			}

			return guard;
		},

		/**
		 * Create a request-scoped auth context.
		 *
		 * The returned object holds per-request state (current user) and is safe
		 * to use concurrently across multiple requests.
		 */
		createContext(input: GuardInput) {
			let currentUser: AuthUser | null = null;

			return {
				guard: (name?: string) => this.guard(name),

				authenticate: async (guardName?: string): Promise<AuthUser | null> => {
					const guard = this.guard(guardName);
					const user = await guard.authenticate(input.request);
					currentUser = user;
					return user;
				},

				user: (): AuthUser | null => currentUser,

				check: (): boolean => currentUser !== null,

				require: (): AuthUser => {
					if (!currentUser) {
						throw new Error("Unauthenticated");
					}
					return currentUser;
				},

				logout: (): void => {
					currentUser = null;
				},
			};
		},
		// Internal: expose guards map for plugin installation
		_guards: guards,
	} as AuthManagerInterface & { _guards: Map<string, Guard> };
}
