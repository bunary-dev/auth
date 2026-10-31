import { describe, expect, setSystemTime, test } from "bun:test";
import { base64url, EncryptJWT, jwtDecrypt } from "jose";
import { createCookieJar } from "../src/cookies.js";
import { createSessionGuard } from "../src/guards/session.js";
import { createAuthManager } from "../src/manager.js";
import type { CookieJar } from "../src/types.js";
import {
	cookieHeaderFrom,
	createMemoryProvider,
	SESSION_SECRET,
} from "./helpers.js";

const key = new TextEncoder().encode(SESSION_SECRET);

function requestWithCookie(cookie?: string): Request {
	return new Request("http://localhost/", {
		headers: cookie ? { cookie } : {},
	});
}

async function sessionCookieFor(
	claims: Record<string, unknown>,
	opts: { exp?: number; secret?: Uint8Array } = {},
): Promise<string> {
	const jwt = new EncryptJWT(claims)
		.setProtectedHeader({ alg: "dir", enc: "A256GCM" })
		.setIssuedAt();
	if (opts.exp !== undefined) jwt.setExpirationTime(opts.exp);
	else jwt.setExpirationTime("1h");
	return `bunary_session=${await jwt.encrypt(opts.secret ?? key)}`;
}

async function setup(overrides: Record<string, unknown> = {}) {
	const provider = await createMemoryProvider();
	const guard = createSessionGuard({
		provider,
		secret: SESSION_SECRET,
		...overrides,
	});
	const manager = createAuthManager({
		defaultGuard: "session",
		guards: { session: guard },
	});
	return { provider, guard, manager };
}

describe("createSessionGuard() construction", () => {
	test("defaults the name to session", async () => {
		const { guard } = await setup();
		expect(guard.name).toBe("session");
	});

	test("throws without a secret", async () => {
		const provider = await createMemoryProvider();
		expect(() =>
			createSessionGuard({ provider } as unknown as Parameters<
				typeof createSessionGuard
			>[0]),
		).toThrow(/secret/);
	});

	test("throws when the secret is shorter or longer than 32 bytes", async () => {
		const provider = await createMemoryProvider();
		for (const secret of ["", "short", "x".repeat(31), new Uint8Array(16)]) {
			expect(() => createSessionGuard({ provider, secret })).toThrow(
				/32 bytes/,
			);
		}
		expect(() =>
			createSessionGuard({ provider, secret: "x".repeat(33) }),
		).toThrow(/32 bytes/);
		expect(() =>
			createSessionGuard({ provider, secret: new Uint8Array(32) }),
		).not.toThrow();
	});

	test("throws without a provider", () => {
		expect(() =>
			createSessionGuard({ secret: SESSION_SECRET } as unknown as Parameters<
				typeof createSessionGuard
			>[0]),
		).toThrow(/provider/);
	});

	test("throws for a non-positive or non-integer lifetime", async () => {
		const provider = await createMemoryProvider();
		for (const lifetimeSeconds of [0, -1, 1.5, Number.NaN, Infinity]) {
			expect(() =>
				createSessionGuard({
					provider,
					secret: SESSION_SECRET,
					lifetimeSeconds,
				}),
			).toThrow(/lifetimeSeconds/);
		}
	});

	// Injection cases carried over from #69
	test("rejects cookie names that are not RFC 6265 tokens", async () => {
		const provider = await createMemoryProvider();
		for (const cookieName of [
			"",
			"a;b",
			"a=b",
			"a\r\nSet-Cookie: x=y",
			"a b",
			"a,b",
			"x; Domain=evil.com;",
			"a\nb",
		]) {
			expect(() =>
				createSessionGuard({ provider, secret: SESSION_SECRET, cookieName }),
			).toThrow(/cookieName/);
		}
		expect(() =>
			createSessionGuard({
				provider,
				secret: SESSION_SECRET,
				cookieName: "app_session-1",
			}),
		).not.toThrow();
	});

	test("rejects invalid paths", async () => {
		const provider = await createMemoryProvider();
		for (const path of [
			"/; Domain=evil.com",
			"/\r\nX: y",
			"/\x00",
			"/\x7f",
			"relative",
		]) {
			expect(() =>
				createSessionGuard({ provider, secret: SESSION_SECRET, path }),
			).toThrow(/path/);
		}
		expect(() =>
			createSessionGuard({
				provider,
				secret: SESSION_SECRET,
				path: "/app/sub",
			}),
		).not.toThrow();
	});
});

describe("session guard authenticate()", () => {
	test("no cookie authenticates nobody", async () => {
		const { guard } = await setup();
		expect(await guard.authenticate(requestWithCookie())).toBeNull();
	});

	test("a valid session cookie authenticates the user via retrieveById", async () => {
		const { guard } = await setup();
		const cookie = await sessionCookieFor({ uid: 1 });
		const user = await guard.authenticate(requestWithCookie(cookie));
		expect(user?.id).toBe(1);
		expect(user?.email).toBe("ada@example.com");
	});

	test("reads the cookie from the jar passed in the guard input", async () => {
		const { guard } = await setup();
		const cookie = await sessionCookieFor({ uid: 2 });
		const request = requestWithCookie();
		const cookies: CookieJar = {
			get: (name) =>
				name === "bunary_session" ? cookie.split("=")[1] : undefined,
			set() {},
			delete() {},
		};
		const user = await guard.authenticate(request, { request, cookies });
		expect(user?.id).toBe(2);
	});

	test("a session for an unknown user authenticates nobody", async () => {
		const { guard } = await setup();
		const cookie = await sessionCookieFor({ uid: 99 });
		expect(await guard.authenticate(requestWithCookie(cookie))).toBeNull();
	});

	// #44
	test("a modified session cookie authenticates nobody", async () => {
		const { guard } = await setup();
		const cookie = await sessionCookieFor({ uid: 1 });
		const [name, token] = cookie.split("=") as [string, string];
		const parts = token.split(".");
		// Flip a byte of the ciphertext, then of the auth tag
		for (const index of [3, 4]) {
			const tampered = [...parts];
			const bytes = base64url.decode(tampered[index] as string);
			bytes[0] = (bytes[0] as number) ^ 0x01;
			tampered[index] = base64url.encode(bytes);
			expect(
				await guard.authenticate(
					requestWithCookie(`${name}=${tampered.join(".")}`),
				),
			).toBeNull();
		}
		// Truncated and garbage values
		for (const value of [token.slice(0, -2), "garbage", "a.b.c.d.e", ""]) {
			expect(
				await guard.authenticate(requestWithCookie(`${name}=${value}`)),
			).toBeNull();
		}
	});

	test("a forged session cookie authenticates nobody", async () => {
		const { guard } = await setup();
		// Encrypted with another key
		const otherKey = new TextEncoder().encode(
			"ffffffffffffffffffffffffffffffff",
		);
		const forged = await sessionCookieFor({ uid: 1 }, { secret: otherKey });
		expect(await guard.authenticate(requestWithCookie(forged))).toBeNull();

		// A signed (not encrypted) JWT, and an unsecured one
		const signed = `bunary_session=${[
			base64url.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })),
			base64url.encode(JSON.stringify({ uid: 1, exp: 9999999999 })),
			"sig",
		].join(".")}`;
		expect(await guard.authenticate(requestWithCookie(signed))).toBeNull();
		const unsecured = `bunary_session=${[
			base64url.encode(JSON.stringify({ alg: "none" })),
			base64url.encode(JSON.stringify({ uid: 1, exp: 9999999999 })),
			"",
		].join(".")}`;
		expect(await guard.authenticate(requestWithCookie(unsecured))).toBeNull();
	});

	test("a session encrypted with another enc authenticates nobody", async () => {
		const { guard } = await setup();
		const jwt = await new EncryptJWT({ uid: 1 })
			.setProtectedHeader({ alg: "dir", enc: "A128CBC-HS256" })
			.setExpirationTime("1h")
			.encrypt(key);
		expect(
			await guard.authenticate(requestWithCookie(`bunary_session=${jwt}`)),
		).toBeNull();
	});

	test("an expired session authenticates nobody", async () => {
		const { guard } = await setup();
		const now = Math.floor(Date.now() / 1000);
		const expired = await sessionCookieFor({ uid: 1 }, { exp: now - 1 });
		expect(await guard.authenticate(requestWithCookie(expired))).toBeNull();
		const atExp = await sessionCookieFor({ uid: 1 }, { exp: now });
		expect(await guard.authenticate(requestWithCookie(atExp))).toBeNull();
	});

	test("a session without exp authenticates nobody", async () => {
		const { guard } = await setup();
		const jwt = await new EncryptJWT({ uid: 1 })
			.setProtectedHeader({ alg: "dir", enc: "A256GCM" })
			.encrypt(key);
		expect(
			await guard.authenticate(requestWithCookie(`bunary_session=${jwt}`)),
		).toBeNull();
	});

	test("a session without a string or number uid authenticates nobody", async () => {
		const { guard } = await setup();
		for (const uid of [undefined, null, { id: 1 }, [1], true]) {
			const cookie = await sessionCookieFor({ uid });
			expect(await guard.authenticate(requestWithCookie(cookie))).toBeNull();
		}
	});

	test("honours a custom cookie name", async () => {
		const { guard } = await setup({ cookieName: "app_sid" });
		const cookie = (await sessionCookieFor({ uid: 1 })).replace(
			"bunary_session",
			"app_sid",
		);
		expect((await guard.authenticate(requestWithCookie(cookie)))?.id).toBe(1);
		expect(
			await guard.authenticate(
				requestWithCookie(await sessionCookieFor({ uid: 1 })),
			),
		).toBeNull();
	});
});

describe("session guard via the manager", () => {
	test("attempt() with valid credentials writes the session cookie", async () => {
		const { manager } = await setup();
		const request = requestWithCookie();
		const cookies = createCookieJar(request);
		const auth = manager.createContext({ request, cookies });

		const result = await auth.attempt({
			email: "ada@example.com",
			password: "correct horse",
		});
		expect(result).not.toBe(false);
		if (result === false) return;
		expect(result.user.id).toBe(1);
		expect(result.token).toBeUndefined();
		expect(auth.user()?.id).toBe(1);
		expect(auth.check()).toBe(true);
		expect(auth.guest()).toBe(false);

		const headers = cookies.headers();
		expect(headers).toHaveLength(1);
		const header = headers[0] as string;
		expect(header.startsWith("bunary_session=")).toBe(true);
		expect(header).toContain("HttpOnly");
		expect(header).toContain("SameSite=Lax");
		expect(header).toContain("Secure");
		expect(header).toContain("Path=/");
		expect(header).toContain("Max-Age=7200");

		// The cookie is a dir + A256GCM JWE with exp = iat + lifetime
		const token = header.split(";")[0]?.split("=")[1] as string;
		const { payload, protectedHeader } = await jwtDecrypt(token, key);
		expect(protectedHeader).toMatchObject({ alg: "dir", enc: "A256GCM" });
		expect(payload.uid).toBe(1);
		expect((payload.exp as number) - (payload.iat as number)).toBe(7200);
		// The password hash never leaves the server
		expect(JSON.stringify(payload)).not.toContain("$2");

		// The browser sends it back: the next request is authenticated
		const next = requestWithCookie(cookieHeaderFrom(headers));
		const nextAuth = manager.createContext({ request: next });
		expect((await nextAuth.authenticate())?.id).toBe(1);
	});

	test("attempt() with a wrong password returns false and sets no cookie", async () => {
		const { manager } = await setup();
		const request = requestWithCookie();
		const cookies = createCookieJar(request);
		const auth = manager.createContext({ request, cookies });
		expect(
			await auth.attempt({ email: "ada@example.com", password: "wrong" }),
		).toBe(false);
		expect(auth.check()).toBe(false);
		expect(auth.guest()).toBe(true);
		expect(cookies.headers()).toEqual([]);
	});

	test("attempt() with an unknown user returns false and sets no cookie", async () => {
		const { manager } = await setup();
		const request = requestWithCookie();
		const cookies = createCookieJar(request);
		const auth = manager.createContext({ request, cookies });
		expect(
			await auth.attempt({ email: "nobody@example.com", password: "x" }),
		).toBe(false);
		expect(auth.user()).toBeNull();
		expect(cookies.headers()).toEqual([]);
	});

	test("login(user) writes the session cookie without checking credentials", async () => {
		const { manager, provider } = await setup();
		const request = requestWithCookie();
		const cookies = createCookieJar(request);
		const auth = manager.createContext({ request, cookies });
		const user = provider.retrieveById(2);
		if (!user || user instanceof Promise) throw new Error("fixture");

		expect(await auth.login(user)).toBeUndefined();
		expect(auth.user()?.id).toBe(2);
		const headers = cookies.headers();
		expect(headers).toHaveLength(1);

		const next = manager.createContext({
			request: requestWithCookie(cookieHeaderFrom(headers)),
		});
		expect((await next.authenticate())?.id).toBe(2);
	});

	test("logout() clears the session cookie and the user", async () => {
		const { manager } = await setup();
		const request = requestWithCookie(await sessionCookieFor({ uid: 1 }));
		const cookies = createCookieJar(request);
		const auth = manager.createContext({ request, cookies });
		expect((await auth.authenticate())?.id).toBe(1);

		await auth.logout();
		expect(auth.user()).toBeNull();
		expect(auth.guest()).toBe(true);
		const headers = cookies.headers();
		expect(headers).toHaveLength(1);
		const header = headers[0] as string;
		expect(header.startsWith("bunary_session=;")).toBe(true);
		expect(header).toContain("Max-Age=0");
		expect(header).toContain("Path=/");
	});

	test("secure: false, a custom path and lifetime are applied to the cookie", async () => {
		const { manager } = await setup({
			secure: false,
			path: "/app",
			lifetimeSeconds: 60,
		});
		const request = requestWithCookie();
		const cookies = createCookieJar(request);
		const auth = manager.createContext({ request, cookies });
		await auth.attempt({ email: "ada@example.com", password: "correct horse" });
		const header = cookies.headers()[0] as string;
		expect(header).not.toContain("Secure");
		expect(header).toContain("Path=/app");
		expect(header).toContain("Max-Age=60");
		const token = header.split(";")[0]?.split("=")[1] as string;
		const { payload } = await jwtDecrypt(token, key);
		expect((payload.exp as number) - (payload.iat as number)).toBe(60);
	});

	test("a session expires after the configured lifetime", async () => {
		const { manager } = await setup({ lifetimeSeconds: 60 });
		const request = requestWithCookie();
		const cookies = createCookieJar(request);
		const auth = manager.createContext({ request, cookies });
		await auth.attempt({ email: "ada@example.com", password: "correct horse" });
		const cookie = cookieHeaderFrom(cookies.headers());

		try {
			setSystemTime(new Date(Date.now() + 61_000));
			const later = manager.createContext({
				request: requestWithCookie(cookie),
			});
			expect(await later.authenticate()).toBeNull();
		} finally {
			setSystemTime();
		}
	});
});
