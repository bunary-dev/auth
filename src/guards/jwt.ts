import {
	type CryptoKey,
	createRemoteJWKSet,
	type JWK,
	type JWTVerifyGetKey,
	type JWTVerifyOptions,
	jwtVerify,
	type KeyObject,
} from "jose";
import type { AuthUser, Guard } from "../types.js";

/**
 * Options for creating a JWT guard.
 *
 * Exactly one key source is required: `secret` (HMAC), `key` (a public key)
 * or `jwksUrl` (a remote JSON Web Key Set).
 */
export interface JwtGuardOptions {
	/**
	 * Name of the guard (defaults to "jwt").
	 */
	name?: string;

	/**
	 * Shared secret for HMAC algorithms (`HS256`, `HS384`, `HS512`).
	 * Can be a string (UTF-8 encoded) or Uint8Array. Must not be empty.
	 */
	secret?: string | Uint8Array;

	/**
	 * Public key for asymmetric algorithms (e.g. `RS256`, `PS256`, `ES256`,
	 * `EdDSA`), as a `CryptoKey`, Node `KeyObject` or public JWK.
	 * Requires `algorithms`.
	 */
	key?: CryptoKey | KeyObject | JWK;

	/**
	 * URL of a JSON Web Key Set (e.g. `https://issuer/.well-known/jwks.json`).
	 * Keys are fetched and cached by jose's `createRemoteJWKSet`.
	 * Requires `algorithms`.
	 */
	jwksUrl?: string | URL;

	/**
	 * Accepted `alg` header values. Tokens signed with any other algorithm are
	 * rejected. Defaults to `["HS256"]` with a `secret`; required with `key`
	 * or `jwksUrl`. HMAC algorithms are only allowed with `secret`, and
	 * asymmetric algorithms only with `key`/`jwksUrl`.
	 */
	algorithms?: string[];

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
	 * @param payload - The verified JWT payload
	 * @returns The authenticated user or null if mapping fails
	 */
	mapUser?: (payload: Record<string, unknown>) => AuthUser | null;
}

/**
 * Create a JWT Bearer guard.
 *
 * The guard extracts tokens from `Authorization: Bearer <jwt>` headers,
 * verifies them with jose's `jwtVerify` (signature, allowed algorithms,
 * exp, nbf, iss, aud), and maps the payload to an AuthUser. Any invalid,
 * malformed or unverifiable token yields `null`; the guard never throws
 * while authenticating.
 *
 * @param options - Guard configuration
 * @returns A guard that implements JWT Bearer authentication
 * @throws {Error} If the key configuration is invalid (no or several key
 *   sources, empty secret, missing/empty/mismatched `algorithms`)
 *
 * @example
 * ```ts
 * import { createJwtGuard } from "@bunary/auth";
 *
 * // HS256 with a shared secret
 * const jwtGuard = createJwtGuard({
 *   secret: process.env.JWT_SECRET!,
 *   issuer: "my-app",
 *   audience: "api",
 * });
 *
 * // RS256 against an identity provider's JWKS
 * const oidcGuard = createJwtGuard({
 *   jwksUrl: "https://login.example.com/.well-known/jwks.json",
 *   algorithms: ["RS256"],
 *   issuer: "https://login.example.com/",
 *   audience: "api",
 * });
 * ```
 */
export function createJwtGuard(options: JwtGuardOptions): Guard {
	const { secret, key, jwksUrl } = options;
	const sources = [secret, key, jwksUrl].filter((s) => s !== undefined);
	if (sources.length === 0) {
		throw new Error(
			"createJwtGuard: one of `secret`, `key` or `jwksUrl` is required",
		);
	}
	if (sources.length > 1) {
		throw new Error(
			"createJwtGuard: pass exactly one of `secret`, `key` or `jwksUrl`",
		);
	}
	if (secret !== undefined && secret.length === 0) {
		throw new Error("createJwtGuard: `secret` must not be empty");
	}

	const algorithms = options.algorithms ?? (secret ? ["HS256"] : undefined);
	if (!algorithms) {
		throw new Error(
			"createJwtGuard: `algorithms` is required with `key` or `jwksUrl`",
		);
	}
	if (algorithms.length === 0) {
		throw new Error("createJwtGuard: `algorithms` must not be empty");
	}
	for (const alg of algorithms) {
		if (alg.toLowerCase() === "none") {
			throw new Error('createJwtGuard: algorithm "none" is not allowed');
		}
		const isHmac = HMAC_ALGORITHMS.has(alg);
		if (secret !== undefined && !isHmac) {
			throw new Error(
				`createJwtGuard: \`secret\` only supports HS256, HS384 or HS512, got "${alg}"`,
			);
		}
		if (secret === undefined && isHmac) {
			throw new Error(
				`createJwtGuard: HMAC algorithm "${alg}" requires \`secret\`, not \`key\` or \`jwksUrl\``,
			);
		}
	}

	let verificationKey:
		| CryptoKey
		| KeyObject
		| JWK
		| Uint8Array
		| JWTVerifyGetKey;
	if (secret !== undefined) {
		verificationKey =
			typeof secret === "string" ? new TextEncoder().encode(secret) : secret;
	} else if (key !== undefined) {
		verificationKey = key;
	} else {
		verificationKey = createRemoteJWKSet(new URL(jwksUrl as string | URL));
	}

	const verifyOptions: JWTVerifyOptions = {
		algorithms,
		clockTolerance: options.clockToleranceSeconds ?? 0,
		requiredClaims: (options.requireExp ?? true) ? ["exp"] : [],
	};
	if (options.issuer !== undefined) verifyOptions.issuer = options.issuer;
	if (options.audience !== undefined) verifyOptions.audience = options.audience;

	const guardName = options.name ?? "jwt";

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

			const token = authHeader.slice(bearerMatch[0].length).trim();
			if (!token) {
				return null;
			}

			let payload: Record<string, unknown>;
			try {
				// Overloads differ for keys vs. key resolvers; both are handled at runtime
				const result = await jwtVerify(
					token,
					verificationKey as JWTVerifyGetKey,
					verifyOptions,
				);
				payload = result.payload;
			} catch {
				// Malformed, unverifiable or invalid token (or JWKS fetch failure)
				return null;
			}

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
			const sub = payload.sub;
			if (typeof sub !== "string" && typeof sub !== "number") {
				return null;
			}
			const claims: Record<string, unknown> = {};
			for (const [name, value] of Object.entries(payload)) {
				if (!REGISTERED_CLAIMS.has(name)) {
					claims[name] = value;
				}
			}
			return { ...claims, id: sub } as AuthUser;
		},
	};
}

const HMAC_ALGORITHMS = new Set(["HS256", "HS384", "HS512"]);

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
