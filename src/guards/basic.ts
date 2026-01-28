import type { AuthUser, Guard } from "../types.js";

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
 * @param options - Guard configuration
 * @returns A guard that implements Basic Authentication
 *
 * @example
 * ```ts
 * import { createBasicGuard, createAuthManager } from "@bunary/auth";
 *
 * const basicGuard = createBasicGuard({
 *   name: "admin",
 *   async verify(username, password) {
 *     if (username === "admin" && password === "secret") {
 *       return { id: 1, username: "admin" };
 *     }
 *     return null;
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
				decoded = atob(encoded);
			} catch {
				// Invalid base64 - return null (don't throw)
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
	};
}
