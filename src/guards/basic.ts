import type {
	AttemptResult,
	AuthUser,
	Credentials,
	Guard,
	GuardInput,
} from "../types.js";

/**
 * Options for creating a Basic Auth guard.
 */
export interface BasicGuardOptions {
	/**
	 * Name of the guard (defaults to "basic").
	 */
	name?: string;

	/**
	 * Verify function that checks username and password.
	 *
	 * @param username - The username from the Authorization header
	 * @param password - The password from the Authorization header
	 * @param request - The original HTTP request
	 * @returns The authenticated user if valid, or null if authentication fails
	 */
	verify: (
		username: string,
		password: string,
		request: Request,
	) => Promise<AuthUser | null> | AuthUser | null;
}

/**
 * Create a Basic Auth guard that parses `Authorization: Basic <base64>` headers.
 *
 * The guard extracts the username and password from the Basic Auth header
 * and calls the provided `verify` function to authenticate the user.
 *
 * The guard is stateless: `attempt({ username, password })` runs `verify`
 * and authenticates the current request only, while `login()` and
 * `logout()` throw because there is no session or token to write or clear.
 *
 * @param options - Guard configuration
 * @returns A guard that implements Basic Authentication
 *
 * @example
 * ```ts
 * import { createBasicGuard, createAuthManager } from "@bunary/auth";
 *
 * // Store only password hashes, e.g. created with `await Bun.password.hash(pw)`
 * const users = new Map([["admin", { id: 1, passwordHash: process.env.ADMIN_PASSWORD_HASH! }]]);
 *
 * const basicGuard = createBasicGuard({
 *   name: "admin",
 *   async verify(username, password) {
 *     const user = users.get(username);
 *     if (!user) return null;
 *     // Bun.password.verify compares against the hash in constant time
 *     if (!(await Bun.password.verify(password, user.passwordHash))) return null;
 *     return { id: user.id, username };
 *   }
 * });
 *
 * const manager = createAuthManager({
 *   defaultGuard: "admin",
 *   guards: { admin: basicGuard }
 * });
 * ```
 */
export function createBasicGuard(options: BasicGuardOptions): Guard {
	const guardName = options.name ?? "basic";

	return {
		name: guardName,
		async authenticate(request: Request): Promise<AuthUser | null> {
			const authHeader = request.headers.get("Authorization");
			if (!authHeader) {
				return null;
			}

			// Check for Basic scheme (case-insensitive)
			const basicMatch = /^Basic\s+/i.exec(authHeader);
			if (!basicMatch) {
				return null;
			}

			// Extract base64-encoded credentials
			const encoded = authHeader.slice(basicMatch[0].length).trim();
			if (!encoded) {
				return null;
			}

			// Decode base64
			let decoded: string;
			try {
				const binary = atob(encoded);
				const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
				decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
			} catch {
				// Invalid base64 or UTF-8 - return null (don't throw)
				return null;
			}

			// Split on first colon (username:password)
			// Password may contain colons, so only split on the first one
			const colonIndex = decoded.indexOf(":");
			if (colonIndex === -1) {
				// No colon separator - invalid format
				return null;
			}

			const username = decoded.slice(0, colonIndex);
			const password = decoded.slice(colonIndex + 1);

			// Call verify function
			return await options.verify(username, password, request);
		},

		async attempt(
			credentials: Credentials,
			input: GuardInput,
		): Promise<AttemptResult | null> {
			const { username, password } = credentials;
			if (typeof username !== "string" || typeof password !== "string") {
				return null;
			}
			const user = await options.verify(username, password, input.request);
			return user ? { user } : null;
		},

		async login(): Promise<never> {
			throw new Error(
				`Guard "${guardName}" is stateless (Basic auth): login() is not supported; credentials are sent with every request`,
			);
		},

		logout(): never {
			throw new Error(
				`Guard "${guardName}" is stateless (Basic auth): logout() is not supported; there is no session to clear`,
			);
		},
	};
}
