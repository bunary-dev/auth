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
} from "./types.js";

export function createAuthManager(config: AuthConfig): AuthManagerInterface {
	let currentUser: AuthUser | null = null;

	return {
		/**
		 * Get a guard by name.
		 *
		 * @param name - The guard name (uses default if not specified)
		 * @returns The requested guard
		 * @throws If the guard doesn't exist
		 */
		guard(name?: string): Guard {
			const guardName = name ?? config.defaultGuard;
			const guard = config.guards[guardName];

			if (!guard) {
				throw new Error(`Guard "${guardName}" is not defined`);
			}

			return guard;
		},

		/**
		 * Authenticate a request using the specified or default guard.
		 *
		 * @param request - The incoming HTTP request
		 * @param guardName - Optional guard name to use
		 * @returns The authenticated user or null
		 */
		async authenticate(
			request: Request,
			guardName?: string,
		): Promise<AuthUser | null> {
			const guard = this.guard(guardName);
			const user = await guard.authenticate(request);
			currentUser = user;
			return user;
		},

		/**
		 * Get the currently authenticated user.
		 *
		 * @returns The authenticated user or null
		 */
		user(): AuthUser | null {
			return currentUser;
		},

		/**
		 * Check if a user is currently authenticated.
		 *
		 * @returns true if authenticated, false otherwise
		 */
		check(): boolean {
			return currentUser !== null;
		},

		/**
		 * Clear the current authentication state.
		 */
		logout(): void {
			currentUser = null;
		},
	};
}
