import type { AuthCookieJar, AuthHandlerResult } from "./types.js";

/**
 * A {@link AuthCookieJar} that also returns its queued `Set-Cookie` values.
 */
export interface QueuedCookieJar extends AuthCookieJar {
	/** The queued `Set-Cookie` header values, one per `set()`/`delete()` call. */
	headers(): string[];
}

/**
 * Create a {@link AuthCookieJar} for a request, backed by Bun's `Bun.CookieMap`
 * (reading) and `Bun.Cookie` (serialising). `set()` and `delete()` throw
 * for names that are not RFC 6265 tokens, so a name can't inject attributes
 * or headers.
 *
 * `createAuth()` uses `ctx.cookies` when the context provides one and falls
 * back to this jar otherwise. Use it directly with `createAuthManager()`
 * when you have no framework jar, and copy `headers()` onto your response.
 *
 * @param request - The incoming request
 * @returns A cookie jar backed by the request's `Cookie` header
 *
 * @example
 * ```ts
 * const cookies = createCookieJar(request);
 * const auth = manager.createContext({ request, cookies });
 * await auth.attempt({ email, password });
 * const response = new Response("ok");
 * for (const value of cookies.headers()) response.headers.append("Set-Cookie", value);
 * ```
 */
export function createCookieJar(request: Request): QueuedCookieJar {
	let parsed: Bun.CookieMap | undefined;
	const queued: string[] = [];

	return {
		get(name) {
			parsed ??= new Bun.CookieMap(request.headers.get("cookie") ?? "");
			return parsed.get(name) ?? undefined;
		},
		set(name, value, options) {
			assertCookieName(name);
			queued.push(new Bun.Cookie(name, value, options).serialize());
		},
		delete(name, options) {
			assertCookieName(name);
			queued.push(
				new Bun.Cookie(name, "", {
					...options,
					maxAge: 0,
					expires: new Date(0),
				}).serialize(),
			);
		},
		headers() {
			return [...queued];
		},
	};
}

const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * Check that a cookie name is an RFC 6265 token, so it can't inject
 * attributes or headers.
 */
export function isCookieName(name: string): boolean {
	return COOKIE_NAME.test(name);
}

function assertCookieName(name: string): void {
	if (!isCookieName(name)) {
		throw new Error(
			`Invalid cookie name ${JSON.stringify(name)}: must be an RFC 6265 token`,
		);
	}
}

/**
 * Check that a cookie path is absolute and has no control characters or `;`
 * (RFC 6265 `path-value`).
 */
export function isCookiePath(path: string): boolean {
	if (!path.startsWith("/")) return false;
	for (let i = 0; i < path.length; i++) {
		const code = path.charCodeAt(i);
		if (code < 0x20 || code === 0x7f || code === 0x3b) return false;
	}
	return true;
}

/**
 * Append queued `Set-Cookie` values to a handler result, converting non-Response
 * results the way `@bunary/http` does. Immutable responses (e.g.
 * `Response.redirect()`) are copied rather than mutated.
 *
 * @internal
 */
export function withSetCookies(
	result: AuthHandlerResult,
	setCookies: string[],
): AuthHandlerResult {
	if (setCookies.length === 0) return result;

	const response = toResponse(result);
	const headers = new Headers(response.headers);
	for (const value of setCookies) headers.append("Set-Cookie", value);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

function toResponse(result: AuthHandlerResult): Response {
	if (result instanceof Response) return result;
	if (result === null || result === undefined) {
		return new Response(null, { status: 204 });
	}
	if (typeof result === "string" || typeof result === "number") {
		return new Response(String(result), {
			headers: { "Content-Type": "text/plain;charset=utf-8" },
		});
	}
	return Response.json(result);
}
