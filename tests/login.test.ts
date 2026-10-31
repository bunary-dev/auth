import { describe, expect, test } from "bun:test";
import { decodeProtectedHeader, generateKeyPair, jwtVerify } from "jose";
import { createBasicGuard } from "../src/guards/basic.js";
import { createJwtGuard } from "../src/guards/jwt.js";
import { createAuthManager } from "../src/manager.js";
import type { Guard } from "../src/types.js";
import { createMemoryProvider } from "./helpers.js";

const JWT_SECRET = "jwt-test-secret-that-is-long-enough";
const secretKey = new TextEncoder().encode(JWT_SECRET);
const request = () => new Request("http://localhost/");

function contextFor(guard: Guard) {
	return createAuthManager({
		defaultGuard: guard.name,
		guards: { [guard.name]: guard },
	}).createContext({ request: request() });
}

describe("JWT guard login semantics", () => {
	test("attempt() returns the user and a signed token with exp", async () => {
		const provider = await createMemoryProvider();
		const guard = createJwtGuard({
			secret: JWT_SECRET,
			provider,
			issuer: "my-app",
			audience: "api",
		});
		const auth = contextFor(guard);
		const result = await auth.attempt({
			email: "ada@example.com",
			password: "correct horse",
		});
		expect(result).not.toBe(false);
		if (result === false) return;
		expect(result.user.id).toBe(1);
		expect(auth.user()?.id).toBe(1);
		expect(typeof result.token).toBe("string");

		const { payload, protectedHeader } = await jwtVerify(
			result.token as string,
			secretKey,
			{ issuer: "my-app", audience: "api" },
		);
		expect(protectedHeader.alg).toBe("HS256");
		expect(payload.sub).toBe("1");
		expect((payload.exp as number) - (payload.iat as number)).toBe(3600);
		expect(JSON.stringify(payload)).not.toContain("passwordHash");

		// The token authenticates against the same guard
		const next = createAuthManager({
			defaultGuard: "jwt",
			guards: { jwt: guard },
		}).createContext({
			request: new Request("http://localhost/", {
				headers: { Authorization: `Bearer ${result.token}` },
			}),
		});
		expect((await next.authenticate())?.id).toBe("1");
	});

	test("attempt() with bad credentials returns false", async () => {
		const provider = await createMemoryProvider();
		const auth = contextFor(createJwtGuard({ secret: JWT_SECRET, provider }));
		expect(
			await auth.attempt({ email: "ada@example.com", password: "nope" }),
		).toBe(false);
		expect(
			await auth.attempt({ email: "nobody@example.com", password: "x" }),
		).toBe(false);
		expect(auth.check()).toBe(false);
	});

	test("login(user) returns a token and sets the user", async () => {
		const auth = contextFor(
			createJwtGuard({ secret: JWT_SECRET, ttlSeconds: 120 }),
		);
		const token = await auth.login({ id: 7, name: "Grace" });
		expect(typeof token).toBe("string");
		expect(auth.user()?.id).toBe(7);
		const { payload } = await jwtVerify(token as string, secretKey);
		expect(payload.sub).toBe("7");
		expect((payload.exp as number) - (payload.iat as number)).toBe(120);
	});

	test("signs with the first configured algorithm", async () => {
		const auth = contextFor(
			createJwtGuard({ secret: JWT_SECRET, algorithms: ["HS512", "HS256"] }),
		);
		const token = (await auth.login({ id: 1 })) as string;
		expect(decodeProtectedHeader(token).alg).toBe("HS512");
	});

	test("signs asymmetric tokens with signingKey", async () => {
		const { publicKey, privateKey } = await generateKeyPair("ES256");
		const guard = createJwtGuard({
			key: publicKey,
			signingKey: privateKey,
			algorithms: ["ES256"],
		});
		const token = (await contextFor(guard).login({ id: "u1" })) as string;
		expect(decodeProtectedHeader(token).alg).toBe("ES256");
		const verified = await guard.authenticate(
			new Request("http://localhost/", {
				headers: { Authorization: `Bearer ${token}` },
			}),
		);
		expect(verified?.id).toBe("u1");
	});

	test("login() throws without a signing key", async () => {
		const { publicKey } = await generateKeyPair("RS256");
		const auth = contextFor(
			createJwtGuard({ key: publicKey, algorithms: ["RS256"] }),
		);
		await expect(auth.login({ id: 1 })).rejects.toThrow(/signingKey/);
	});

	test("attempt() throws without a provider", async () => {
		const auth = contextFor(createJwtGuard({ secret: JWT_SECRET }));
		await expect(auth.attempt({ email: "a", password: "b" })).rejects.toThrow(
			/provider/,
		);
	});

	test("rejects signingKey combined with secret, and a bad ttlSeconds", async () => {
		const { privateKey } = await generateKeyPair("ES256");
		expect(() =>
			createJwtGuard({ secret: JWT_SECRET, signingKey: privateKey }),
		).toThrow(/signingKey/);
		for (const ttlSeconds of [0, -5, 1.5, Number.NaN]) {
			expect(() => createJwtGuard({ secret: JWT_SECRET, ttlSeconds })).toThrow(
				/ttlSeconds/,
			);
		}
	});

	test("logout() only clears the request's user (tokens are stateless)", async () => {
		const auth = contextFor(createJwtGuard({ secret: JWT_SECRET }));
		await auth.login({ id: 1 });
		await auth.logout();
		expect(auth.user()).toBeNull();
		expect(auth.guest()).toBe(true);
	});
});

describe("Basic guard login semantics", () => {
	const basic = createBasicGuard({
		async verify(username, password) {
			if (username === "admin" && password === "secret") {
				return { id: 1, username };
			}
			return null;
		},
	});

	test("attempt() verifies username/password for this request only", async () => {
		const auth = contextFor(basic);
		const result = await auth.attempt({
			username: "admin",
			password: "secret",
		});
		expect(result).toEqual({ user: { id: 1, username: "admin" } });
		expect(auth.check()).toBe(true);
	});

	test("attempt() with bad or missing credentials returns false", async () => {
		const auth = contextFor(basic);
		expect(await auth.attempt({ username: "admin", password: "nope" })).toBe(
			false,
		);
		expect(await auth.attempt({ username: "admin" })).toBe(false);
		expect(auth.check()).toBe(false);
	});

	test("login() throws a clear error", async () => {
		const auth = contextFor(basic);
		await expect(auth.login({ id: 1 })).rejects.toThrow(/stateless/);
		expect(auth.check()).toBe(false);
	});

	test("logout() throws a clear error", async () => {
		const auth = contextFor(basic);
		await expect(auth.logout()).rejects.toThrow(/stateless/);
	});
});

describe("custom guards without login methods", () => {
	const custom: Guard = { name: "custom", authenticate: () => ({ id: 1 }) };

	test("attempt() and login() throw naming the guard", async () => {
		const auth = contextFor(custom);
		await expect(auth.attempt({})).rejects.toThrow(
			'Guard "custom" does not support attempt()',
		);
		await expect(auth.login({ id: 1 })).rejects.toThrow(
			'Guard "custom" does not support login()',
		);
	});

	test("logout() clears the user", async () => {
		const auth = contextFor(custom);
		await auth.authenticate();
		expect(auth.check()).toBe(true);
		await auth.logout();
		expect(auth.check()).toBe(false);
	});
});
