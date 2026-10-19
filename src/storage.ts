import type { AuthStorage } from "./types.js";

export type CookieStorageOptions = Readonly<{
	/**
	 * Prefix applied to all keys when stored in cookies.
	 * Defaults to `"bunary_"`.
	 */
	cookiePrefix?: string;
	/**
	 * Cookie path. Defaults to `"/"`.
	 */
	path?: string;
	/**
	 * Marks cookies as HttpOnly. Defaults to `true`.
	 */
	httpOnly?: boolean;
	/**
	 * Marks cookies as Secure. Defaults to `true`.
	 *
	 * **Important**: When `secure: true` (default), cookies are only sent over HTTPS.
	 * For local HTTP development (e.g., `http://localhost`), set `secure: false`.
	 */
	secure?: boolean;
	/**
	 * SameSite mode. Defaults to `"lax"`.
	 *
	 * **Note**: When `sameSite: "none"`, browsers require `Secure` to be set.
	 * This is automatically enforced (secure is overridden to `true`).
	 */
	sameSite?: "lax" | "strict" | "none";
}>;

/**
 * Create a cookie-backed AuthStorage.
 *
 * This is intentionally minimal (no signing/encryption). That can be added later
 * without changing the interface.
 */
export function createCookieStorage(
	options: CookieStorageOptions = {},
): AuthStorage {
	const prefix = options.cookiePrefix ?? "bunary_";
	const path = options.path ?? "/";
	if (prefix !== "") assertValidCookieName(prefix);
	assertValidCookiePath(path);
	const httpOnly = options.httpOnly ?? true;
	let secure = options.secure ?? true;
	const sameSite = options.sameSite ?? "lax";

	// Browsers require SameSite=None cookies to also set Secure
	if (sameSite === "none") {
		secure = true;
	}

	return {
		get(request: Request, key: string): string | null {
			const name = `${prefix}${key}`;
			assertValidCookieName(name);
			const cookies = parseCookieHeader(request.headers.get("cookie"));
			return cookies.get(name) ?? null;
		},

		set(
			response: Response,
			key: string,
			value: string,
			opts?: { ttlSeconds?: number },
		): void {
			const name = `${prefix}${key}`;
			assertValidCookieName(name);
			const maxAge = opts?.ttlSeconds;
			const cookie = serializeCookie(name, value, {
				path,
				httpOnly,
				secure,
				sameSite,
				maxAge,
			});
			response.headers.append("set-cookie", cookie);
		},

		clear(response: Response, key: string): void {
			const name = `${prefix}${key}`;
			assertValidCookieName(name);
			const cookie = serializeCookie(name, "", {
				path,
				httpOnly,
				secure,
				sameSite,
				maxAge: 0,
			});
			response.headers.append("set-cookie", cookie);
		},
	};
}

type CookieSerializeOptions = Readonly<{
	path: string;
	httpOnly: boolean;
	secure: boolean;
	sameSite: "lax" | "strict" | "none";
	maxAge?: number;
}>;

// RFC 6265 / RFC 2616 token: visible ASCII excluding separators
const COOKIE_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function assertValidCookieName(name: string): void {
	if (!COOKIE_NAME_RE.test(name)) {
		throw new Error(`Invalid cookie name: ${JSON.stringify(name)}`);
	}
}

function assertValidCookiePath(path: string): void {
	// Exclude ';' and control characters (0x00-0x1F, 0x7F)
	// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional CTL check
	if (path === "" || /[;\x00-\x1f\x7f]/.test(path)) {
		throw new Error(`Invalid cookie path: ${JSON.stringify(path)}`);
	}
}

function parseCookieHeader(header: string | null): Map<string, string> {
	const map = new Map<string, string>();
	if (!header) return map;

	// cookie header: "a=1; b=2"
	for (const part of header.split(";")) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const idx = trimmed.indexOf("=");
		if (idx === -1) continue;
		const name = trimmed.slice(0, idx).trim();
		let value = trimmed.slice(idx + 1).trim();
		if (!name) continue;
		if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
			value = value.slice(1, -1);
		}
		// Guard against invalid percent-encoding (e.g. stray %)
		let decoded: string;
		try {
			decoded = decodeURIComponent(value);
		} catch {
			decoded = value; // Fall back to raw value if decoding fails
		}
		map.set(name, decoded);
	}

	return map;
}

function serializeCookie(
	name: string,
	value: string,
	options: CookieSerializeOptions,
): string {
	const parts: string[] = [];
	parts.push(`${name}=${encodeURIComponent(value)}`);
	parts.push(`Path=${options.path}`);

	if (options.maxAge !== undefined) {
		// Validate maxAge is a finite number before serializing
		if (Number.isFinite(options.maxAge)) {
			parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
		}
		// Otherwise omit Max-Age (cookie becomes session-scoped)
	}

	if (options.httpOnly) parts.push("HttpOnly");
	if (options.secure) parts.push("Secure");

	// SameSite token casing is conventional
	const sameSite =
		options.sameSite === "lax"
			? "Lax"
			: options.sameSite === "strict"
				? "Strict"
				: "None";
	parts.push(`SameSite=${sameSite}`);

	return parts.join("; ");
}
