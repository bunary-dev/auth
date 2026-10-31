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
import { createCookieJar } from "./cookies.js";
import type {
	AttemptResult,
	AuthConfig,
	AuthManagerInterface,
	AuthUser,
	Credentials,
	Guard,
	GuardInput,
	UserProvider,
} from "./types.js";

export function createAuthManager(config: AuthConfig): AuthManagerInterface {
	// Copy guards so later mutation of the config object has no effect
	const guards = new Map<string, Guard>();
	for (const [name, guard] of Object.entries(config.guards)) {
		guards.set(name, guard);
	}

	const defaultGuardName = config.defaultGuard;
	const userProvider = config.provider;

	const manager: AuthManagerInterface = {
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
		 * Get the user provider from the config.
		 *
		 * @throws If the config has no `provider`
		 */
		provider(): UserProvider {
			if (!userProvider) {
				throw new Error(
					"No user provider configured: set `provider` in the auth config",
				);
			}
			return userProvider;
		},

		/**
		 * Create a request-scoped auth context.
		 *
		 * The returned object holds per-request state (current user) and is safe
		 * to use concurrently across multiple requests.
		 */
		createContext(input: GuardInput) {
			let currentUser: AuthUser | null = null;
			const guardInput: GuardInput = {
				request: input.request,
				cookies: input.cookies ?? createCookieJar(input.request),
			};

			return {
				guard: (name?: string) => this.guard(name),

				authenticate: async (guardName?: string): Promise<AuthUser | null> => {
					const guard = this.guard(guardName);
					const user = await guard.authenticate(input.request, guardInput);
					currentUser = user;
					return user;
				},

				user: (): AuthUser | null => currentUser,

				check: (): boolean => currentUser !== null,

				guest: (): boolean => currentUser === null,

				attempt: async (
					credentials: Credentials,
					guardName?: string,
				): Promise<AttemptResult | false> => {
					const guard = this.guard(guardName);
					if (!guard.attempt) {
						throw new Error(`Guard "${guard.name}" does not support attempt()`);
					}
					const result = await guard.attempt(credentials, guardInput);
					if (!result) {
						return false;
					}
					currentUser = result.user;
					return result;
				},

				login: async (
					user: AuthUser,
					guardName?: string,
				): Promise<string | undefined> => {
					const guard = this.guard(guardName);
					if (!guard.login) {
						throw new Error(`Guard "${guard.name}" does not support login()`);
					}
					const token = await guard.login(user, guardInput);
					currentUser = user;
					return token;
				},

				require: (): AuthUser => {
					if (!currentUser) {
						throw new Error("Unauthenticated");
					}
					return currentUser;
				},

				logout: async (guardName?: string): Promise<void> => {
					const guard = this.guard(guardName);
					if (guard.logout) {
						await guard.logout(guardInput);
					}
					currentUser = null;
				},
			};
		},
	};

	return manager;
}
