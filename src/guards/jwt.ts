import type { AuthUser, Guard } from "../types.js";

/**
 * Options for creating a JWT guard.
 */
export interface JwtGuardOptions {
	/**
	 * Name of the guard (defaults to "jwt").
	 */
	name?: string;

	/**
	 * Secret key for verifying JWT signatures (HS256).
	 * Can be a string or Uint8Array.
	 */
	secret: string | Uint8Array;

	/**
	 * Expected issuer (iss claim).
	 * If provided, tokens must have a matching issuer.
	 */
	issuer?: string;

	/**
	 * Expected audience (aud claim).
	 * Can be a single string or array of strings.
	 * If provided, tokens must have a matching audience.
	 */
	audience?: string | string[];

	/**
	 * Clock tolerance in seconds for exp/nbf validation.
	 * Defaults to 0. Useful for clock skew between servers.
	 */
	clockToleranceSeconds?: number;

	/**
	 * Require tokens to carry an `exp` claim; tokens without one are rejected.
	 * Defaults to true, so a validly signed token can't be accepted forever.
	 * Set to false only if you deliberately issue non-expiring tokens.
	 */
	requireExp?: boolean;

	/**
	 * Function to map JWT payload to AuthUser.
	 * Defaults to `{ id: payload.sub, ...customClaims }` if sub is present, where
	 * customClaims are the payload claims other than the registered ones
	 * (`iss`, `sub`, `aud`, `exp`, `nbf`, `iat`, `jti`).
	 *
	 * @param payload - The decoded JWT payload
	 * @returns The authenticated user or null if mapping fails
	 */
	mapUser?: (payload: Record<string, unknown>) => AuthUser | null;
}

/**
 * Create a JWT Bearer guard that verifies HS256-signed tokens.
 *
 * The guard extracts tokens from `Authorization: Bearer <jwt>` headers,
 * verifies the signature using WebCrypto, validates standard claims
 * (exp, nbf, iss, aud), and maps the payload to an AuthUser.
 *
 * @param options - Guard configuration
 * @returns A guard that implements JWT Bearer authentication
 * @throws {Error} If the secret is empty
 *
 * @example
 * ```ts
 * import { createJwtGuard, createAuthManager } from "@bunary/auth";
 *
 * const jwtGuard = createJwtGuard({
 *   secret: process.env.JWT_SECRET!,
 *   issuer: "my-app",
 *   audience: "api",
 *   mapUser: (payload) => ({
 *     id: payload.sub as string,
 *     email: payload.email as string,
 *   })
 * });
 *
 * const manager = createAuthManager({
 *   defaultGuard: "jwt",
 *   guards: { jwt: jwtGuard }
 * });
 * ```
 */
export function createJwtGuard(options: JwtGuardOptions): Guard {
	if (options.secret.length === 0) {
		throw new Error("createJwtGuard: `secret` must not be empty");
	}

	const guardName = options.name ?? "jwt";
	const requireExp = options.requireExp ?? true;
	const clockTolerance = options.clockToleranceSeconds ?? 0;
	const now = () => Math.floor(Date.now() / 1000);

	// Import HMAC key once per guard instance (reused across requests)
	const encoder = new TextEncoder();
	// Ensure keyData is a Uint8Array backed by ArrayBuffer (not ArrayBufferLike)
	let keyData: Uint8Array<ArrayBuffer>;
	if (typeof options.secret === "string") {
		keyData = encoder.encode(options.secret);
	} else {
		// Create a new ArrayBuffer-backed Uint8Array by copying the data
		// This ensures TypeScript sees it as Uint8Array<ArrayBuffer>, not Uint8Array<ArrayBufferLike>
		// Create a new ArrayBuffer and copy the data to ensure ArrayBuffer backing
		const buffer = new ArrayBuffer(options.secret.length);
		keyData = new Uint8Array(buffer);
		keyData.set(options.secret);
	}
	const cryptoKeyPromise = crypto.subtle.importKey(
		"raw",
		keyData,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify"],
	);
	// Failures surface per-request in verifyHS256 (which returns false); this
	// prevents an unhandled rejection when no request has awaited it yet.
	cryptoKeyPromise.catch(() => {});

	return {
		name: guardName,
		async authenticate(request: Request): Promise<AuthUser | null> {
			const authHeader = request.headers.get("Authorization");
			if (!authHeader) {
				return null;
			}

			// Check for Bearer scheme (case-insensitive)
			const bearerMatch = /^Bearer\s+/i.exec(authHeader);
			if (!bearerMatch) {
				return null;
			}

			// Extract token
			const token = authHeader.slice(bearerMatch[0].length).trim();
			if (!token) {
				return null;
			}

			// Parse JWT (header.payload.signature)
			const parts = token.split(".");
			if (parts.length !== 3) {
				return null;
			}

			const [encodedHeader, encodedPayload, encodedSignature] = parts;
			if (!encodedHeader || !encodedPayload || !encodedSignature) {
				return null;
			}

			// Decode header and payload
			let header: unknown;
			let payload: unknown;

			try {
				header = JSON.parse(base64UrlDecode(encodedHeader));
				payload = JSON.parse(base64UrlDecode(encodedPayload));
			} catch {
				// Invalid base64 or JSON - return null (don't throw)
				return null;
			}

			// Header and payload must be plain (non-null, non-array) objects
			if (!isPlainObject(header) || !isPlainObject(payload)) {
				return null;
			}

			// Verify algorithm (must be HS256)
			if (header.alg !== "HS256") {
				return null;
			}

			// Verify signature
			const signatureValid = await verifyHS256(
				`${encodedHeader}.${encodedPayload}`,
				encodedSignature,
				cryptoKeyPromise,
			);
			if (!signatureValid) {
				return null;
			}

			// Validate exp (expiration)
			if (requireExp && payload.exp === undefined) {
				return null;
			}
			if (payload.exp !== undefined) {
				const exp = typeof payload.exp === "number" ? payload.exp : null;
				if (exp === null || now() >= exp + clockTolerance) {
					return null;
				}
			}

			// Validate nbf (not before)
			if (payload.nbf !== undefined) {
				const nbf = typeof payload.nbf === "number" ? payload.nbf : null;
				if (nbf === null || now() < nbf - clockTolerance) {
					return null;
				}
			}

			// Validate iss (issuer)
			if (options.issuer !== undefined) {
				if (payload.iss !== options.issuer) {
					return null;
				}
			}

			// Validate aud (audience)
			if (options.audience !== undefined) {
				const tokenAud = payload.aud;
				if (tokenAud === undefined) {
					return null;
				}

				const expectedAuds = Array.isArray(options.audience)
					? options.audience
					: [options.audience];
				const tokenAuds = Array.isArray(tokenAud) ? tokenAud : [tokenAud];

				// Check if any expected audience matches any token audience
				const matches = expectedAuds.some((expected) =>
					tokenAuds.some((tokenAud) => tokenAud === expected),
				);
				if (!matches) {
					return null;
				}
			}

			// Map payload to user
			if (options.mapUser) {
				try {
					return options.mapUser(payload);
				} catch {
					// Mapper threw - return null (don't throw)
					return null;
				}
			}

			// Default mapping: use sub as id, plus non-registered claims
			// Set id last to ensure sub always wins over a payload `id` claim
			if (payload.sub !== undefined) {
				const sub = payload.sub;
				// Validate sub is a string or number
				if (typeof sub !== "string" && typeof sub !== "number") {
					return null;
				}
				const claims: Record<string, unknown> = {};
				for (const [key, value] of Object.entries(payload)) {
					if (!REGISTERED_CLAIMS.has(key)) {
						claims[key] = value;
					}
				}
				return {
					...claims,
					id: sub,
				} as AuthUser;
			}

			// No sub claim and no custom mapper - return null
			return null;
		},
	};
}

/**
 * RFC 7519 registered claim names, excluded from the default user mapping.
 */
const REGISTERED_CLAIMS = new Set([
	"iss",
	"sub",
	"aud",
	"exp",
	"nbf",
	"iat",
	"jti",
]);

/**
 * Check that a parsed JSON value is a non-null, non-array object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Decode base64url-encoded string (UTF-8).
 */
function base64UrlDecode(str: string): string {
	// Decode to Uint8Array first, then decode UTF-8
	const bytes = base64UrlDecodeToUint8Array(str);
	const decoder = new TextDecoder("utf-8");
	return decoder.decode(bytes);
}

/**
 * Verify HS256 signature using WebCrypto.
 *
 * @param message - The message to verify (header.payload)
 * @param encodedSignature - Base64url-encoded signature
 * @param cryptoKeyPromise - Promise resolving to the imported CryptoKey
 * @returns True if signature is valid, false otherwise
 */
async function verifyHS256(
	message: string,
	encodedSignature: string,
	cryptoKeyPromise: Promise<CryptoKey>,
): Promise<boolean> {
	try {
		const encoder = new TextEncoder();
		const messageData = encoder.encode(message);

		// Decode signature
		const decodedSignature = base64UrlDecodeToUint8Array(encodedSignature);
		// Ensure signature is backed by ArrayBuffer (not ArrayBufferLike)
		// Create a new ArrayBuffer and copy the data to ensure ArrayBuffer backing
		const signatureBuffer = new ArrayBuffer(decodedSignature.length);
		const signature: Uint8Array<ArrayBuffer> = new Uint8Array(signatureBuffer);
		signature.set(decodedSignature);

		// Get the imported key (reused across requests)
		const cryptoKey = await cryptoKeyPromise;

		// Verify signature
		return await crypto.subtle.verify(
			"HMAC",
			cryptoKey,
			signature,
			messageData,
		);
	} catch {
		// Invalid signature or key - return false (don't throw)
		return false;
	}
}

/**
 * Decode base64url-encoded string to Uint8Array.
 */
function base64UrlDecodeToUint8Array(str: string): Uint8Array {
	const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
	const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}
