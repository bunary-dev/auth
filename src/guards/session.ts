import { EncryptJWT, jwtDecrypt } from "jose";
import { createCookieJar, isCookieName, isCookiePath } from "../cookies.js";
import type {
	AttemptResult,
	AuthCookieJar,
	AuthUser,
	CookieOptions,
	Credentials,
	Guard,
	GuardInput,
	UserProvider,
} from "../types.js";

/**
 * Options for creating a session guard.
 */
export interface SessionGuardOptions {
	/**
	 * Name of the guard (defaults to "session").
	 */
	name?: string;

	/**
	 * Looks users up by id (on every authenticated request) and by
	 * credentials (in `attempt()`).
	 */
	provider: UserProvider;

	/**
	 * Key that encrypts the session cookie: exactly 32 bytes (a string is
	 * UTF-8 encoded). Generate one with
	 * `crypto.getRandomValues(new Uint8Array(32))`.
	 */
	secret: string | Uint8Array;

	/**
	 * Name of the session cookie (defaults to "bunary_session").
	 * Must be an RFC 6265 token.
	 */
	cookieName?: string;

	/**
	 * Session lifetime in seconds (defaults to 7200, two hours). Sets both the
	 * session's `exp` claim and the cookie's `Max-Age`.
	 */
	lifetimeSeconds?: number;

	/**
	 * Send the cookie only over HTTPS (defaults to true). Set to false for
	 * local development over plain HTTP.
	 */
	secure?: boolean;

	/**
	 * Cookie path (defaults to "/").
	 */
	path?: string;
}

const KEY_LENGTH = 32;

/**
 * Create a cookie session guard.
 *
 * The session is an encrypted JWT (jose, `dir` + `A256GCM`) holding the user
 * id and an `exp`, stored in an `HttpOnly`, `SameSite=Lax` cookie. Every
 * request decrypts the cookie and loads the user with
 * `provider.retrieveById()`. A missing, modified, forged or expired cookie
 * authenticates nobody.
 *
 * @param options - Guard configuration
 * @returns A guard supporting `attempt()`, `login()` and `logout()`
 * @throws {Error} If `provider` is missing, `secret` is not 32 bytes, or
 *   `cookieName`, `path` or `lifetimeSeconds` is invalid
 *
 * @example
 * ```ts
 * import { createAuth, createSessionGuard } from "@bunary/auth";
 *
 * router.use(createAuth({
 *   defaultGuard: "session",
 *   guards: {
 *     session: createSessionGuard({
 *       provider: users,
 *       secret: process.env.SESSION_SECRET!, // 32 bytes
 *     }),
 *   },
 * }));
 *
 * router.post("/login", async (ctx) => {
 *   const result = await ctx.locals.auth.attempt(await ctx.json());
 *   return result ? { ok: true } : new Response(null, { status: 401 });
 * });
 * ```
 */
export function createSessionGuard(options: SessionGuardOptions): Guard {
	const { provider } = options;
	if (!provider) {
		throw new Error("createSessionGuard: `provider` is required");
	}
	if (options.secret === undefined || options.secret === null) {
		throw new Error("createSessionGuard: `secret` is required");
	}
	const key =
		typeof options.secret === "string"
			? new TextEncoder().encode(options.secret)
			: options.secret;
	if (key.length !== KEY_LENGTH) {
		throw new Error(
			`createSessionGuard: \`secret\` must be exactly ${KEY_LENGTH} bytes, got ${key.length}`,
		);
	}

	const cookieName = options.cookieName ?? "bunary_session";
	if (!isCookieName(cookieName)) {
		throw new Error(
			`createSessionGuard: \`cookieName\` must be an RFC 6265 token, got ${JSON.stringify(cookieName)}`,
		);
	}
	const path = options.path ?? "/";
	if (!isCookiePath(path)) {
		throw new Error(
			`createSessionGuard: \`path\` must start with "/" and contain no ";" or control characters, got ${JSON.stringify(path)}`,
		);
	}
	const lifetimeSeconds = options.lifetimeSeconds ?? 7200;
	if (!Number.isSafeInteger(lifetimeSeconds) || lifetimeSeconds <= 0) {
		throw new Error(
			"createSessionGuard: `lifetimeSeconds` must be a positive integer",
		);
	}

	const cookieOptions: CookieOptions = {
		httpOnly: true,
		sameSite: "lax",
		secure: options.secure ?? true,
		path,
	};

	function jarFor(
		input: GuardInput | undefined,
		request: Request,
	): AuthCookieJar {
		return input?.cookies ?? createCookieJar(request);
	}

	async function writeSession(user: AuthUser, input: GuardInput) {
		const now = Math.floor(Date.now() / 1000);
		const token = await new EncryptJWT({ uid: user.id })
			.setProtectedHeader({ alg: "dir", enc: "A256GCM" })
			.setIssuedAt(now)
			.setExpirationTime(now + lifetimeSeconds)
			.encrypt(key);
		jarFor(input, input.request).set(cookieName, token, {
			...cookieOptions,
			maxAge: lifetimeSeconds,
		});
	}

	return {
		name: options.name ?? "session",

		async authenticate(request, input): Promise<AuthUser | null> {
			const token = jarFor(input, request).get(cookieName);
			if (!token) {
				return null;
			}

			let uid: unknown;
			try {
				const { payload } = await jwtDecrypt(token, key, {
					keyManagementAlgorithms: ["dir"],
					contentEncryptionAlgorithms: ["A256GCM"],
					requiredClaims: ["exp"],
				});
				uid = payload.uid;
			} catch {
				// Modified, forged, malformed or expired session
				return null;
			}
			if (typeof uid !== "string" && typeof uid !== "number") {
				return null;
			}

			return (await provider.retrieveById(uid)) ?? null;
		},

		async attempt(
			credentials: Credentials,
			input: GuardInput,
		): Promise<AttemptResult | null> {
			const user = await provider.retrieveByCredentials(credentials);
			if (!user || !(await provider.validateCredentials(user, credentials))) {
				return null;
			}
			await writeSession(user, input);
			return { user };
		},

		async login(user: AuthUser, input: GuardInput): Promise<undefined> {
			await writeSession(user, input);
			return undefined;
		},

		logout(input: GuardInput): void {
			jarFor(input, input.request).delete(cookieName, cookieOptions);
		},
	};
}
