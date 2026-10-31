import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { createJwtGuard } from "../src/guards/jwt.js";

describe("createJwtGuard", () => {
	const secret = "test-secret-key";

	test("returns a guard with default name 'jwt'", () => {
		const guard = createJwtGuard({
			secret,
		});

		expect(guard.name).toBe("jwt");
	});

	test("returns a guard with custom name", () => {
		const guard = createJwtGuard({
			name: "api-jwt",
			secret,
		});

		expect(guard.name).toBe("api-jwt");
	});

	test("returns null when Authorization header is missing", async () => {
		const guard = createJwtGuard({
			secret,
		});

		const request = new Request("http://localhost/test");
		const user = await guard.authenticate(request);

		expect(user).toBeNull();
	});

	test("returns null when Authorization header has wrong scheme", async () => {
		const guard = createJwtGuard({
			secret,
		});

		const request = new Request("http://localhost/test", {
			headers: { Authorization: "Basic dGVzdA==" },
		});
		const user = await guard.authenticate(request);

		expect(user).toBeNull();
	});

	test("returns null when token is missing after Bearer", async () => {
		const guard = createJwtGuard({
			secret,
		});

		const request = new Request("http://localhost/test", {
			headers: { Authorization: "Bearer " },
		});
		const user = await guard.authenticate(request);

		expect(user).toBeNull();
	});

	test("returns null when token has invalid format (not 3 parts)", async () => {
		const guard = createJwtGuard({
			secret,
		});

		const request = new Request("http://localhost/test", {
			headers: { Authorization: "Bearer invalid.token" },
		});
		const user = await guard.authenticate(request);

		expect(user).toBeNull();
	});

	test("returns null when token has invalid base64", async () => {
		const guard = createJwtGuard({
			secret,
		});

		// Create a 3-part token with invalid base64url in the header
		// This ensures we hit the base64/JSON decoding branch, not the parts.length check
		const request = new Request("http://localhost/test", {
			headers: {
				Authorization: "Bearer invalid.base64!!!.signature",
			},
		});
		const user = await guard.authenticate(request);

		expect(user).toBeNull();
	});

	test("returns null when token signature is invalid", async () => {
		const guard = createJwtGuard({
			secret,
		});

		// Create a token with wrong secret
		const wrongSecret = "wrong-secret";
		const token = await createTestJwt(
			{ sub: "123", exp: Math.floor(Date.now() / 1000) + 3600 },
			wrongSecret,
		);

		const request = new Request("http://localhost/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const user = await guard.authenticate(request);

		expect(user).toBeNull();
	});

	test("returns null when token is expired", async () => {
		const guard = createJwtGuard({
			secret,
		});

		// Create expired token
		const token = await createTestJwt(
			{ sub: "123", exp: Math.floor(Date.now() / 1000) - 3600 },
			secret,
		);

		const request = new Request("http://localhost/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const user = await guard.authenticate(request);

		expect(user).toBeNull();
	});

	test("returns null when token is not yet valid (nbf)", async () => {
		const guard = createJwtGuard({
			secret,
		});

		// Create token with nbf in the future
		const token = await createTestJwt(
			{
				sub: "123",
				exp: Math.floor(Date.now() / 1000) + 3600,
				nbf: Math.floor(Date.now() / 1000) + 1800,
			},
			secret,
		);

		const request = new Request("http://localhost/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const user = await guard.authenticate(request);

		expect(user).toBeNull();
	});

	test("returns null when issuer doesn't match", async () => {
		const guard = createJwtGuard({
			secret,
			issuer: "expected-issuer",
		});

		const token = await createTestJwt(
			{
				sub: "123",
				exp: Math.floor(Date.now() / 1000) + 3600,
				iss: "wrong-issuer",
			},
			secret,
		);

		const request = new Request("http://localhost/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const user = await guard.authenticate(request);

		expect(user).toBeNull();
	});

	test("returns null when audience doesn't match", async () => {
		const guard = createJwtGuard({
			secret,
			audience: "expected-audience",
		});

		const token = await createTestJwt(
			{
				sub: "123",
				exp: Math.floor(Date.now() / 1000) + 3600,
				aud: "wrong-audience",
			},
			secret,
		);

		const request = new Request("http://localhost/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const user = await guard.authenticate(request);

		expect(user).toBeNull();
	});

	test("returns user when token is valid", async () => {
		const guard = createJwtGuard({
			secret,
		});

		const token = await createTestJwt(
			{ sub: "123", exp: Math.floor(Date.now() / 1000) + 3600 },
			secret,
		);

		const request = new Request("http://localhost/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const user = await guard.authenticate(request);

		expect(user).not.toBeNull();
		expect(user?.id).toBe("123");
	});

	test("uses default mapUser when sub is present", async () => {
		const guard = createJwtGuard({
			secret,
		});

		const token = await createTestJwt(
			{
				sub: "123",
				email: "test@example.com",
				name: "Test User",
				exp: Math.floor(Date.now() / 1000) + 3600,
			},
			secret,
		);

		const request = new Request("http://localhost/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const user = await guard.authenticate(request);

		expect(user).toEqual({
			id: "123",
			email: "test@example.com",
			name: "Test User",
		});
	});

	test("uses custom mapUser function", async () => {
		const guard = createJwtGuard({
			secret,
			mapUser: (payload) => {
				return { id: payload.sub as string, email: payload.email as string };
			},
		});

		const token = await createTestJwt(
			{
				sub: "123",
				email: "test@example.com",
				name: "Test User",
				exp: Math.floor(Date.now() / 1000) + 3600,
			},
			secret,
		);

		const request = new Request("http://localhost/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const user = await guard.authenticate(request);

		expect(user).toEqual({
			id: "123",
			email: "test@example.com",
		});
	});

	test("handles case-insensitive Bearer scheme", async () => {
		const guard = createJwtGuard({
			secret,
		});

		const token = await createTestJwt(
			{ sub: "123", exp: Math.floor(Date.now() / 1000) + 3600 },
			secret,
		);

		const request = new Request("http://localhost/test", {
			headers: { Authorization: `BEARER ${token}` },
		});
		const user = await guard.authenticate(request);

		expect(user).not.toBeNull();
		expect(user?.id).toBe("123");
	});

	test("handles clock tolerance for exp claim", async () => {
		const guard = createJwtGuard({
			secret,
			clockToleranceSeconds: 60,
		});

		// Create token that expired 30 seconds ago (within tolerance)
		const token = await createTestJwt(
			{ sub: "123", exp: Math.floor(Date.now() / 1000) - 30 },
			secret,
		);

		const request = new Request("http://localhost/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const user = await guard.authenticate(request);

		expect(user).not.toBeNull();
	});

	test("handles array audience", async () => {
		const guard = createJwtGuard({
			secret,
			audience: ["audience1", "audience2"],
		});

		const token = await createTestJwt(
			{
				sub: "123",
				exp: Math.floor(Date.now() / 1000) + 3600,
				aud: ["audience1", "audience3"],
			},
			secret,
		);

		const request = new Request("http://localhost/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const user = await guard.authenticate(request);

		// Should match because token audience includes "audience1"
		expect(user).not.toBeNull();
	});

	test("returns null when mapUser throws", async () => {
		const guard = createJwtGuard({
			secret,
			mapUser: () => {
				throw new Error("Mapper error");
			},
		});

		const token = await createTestJwt(
			{ sub: "123", exp: Math.floor(Date.now() / 1000) + 3600 },
			secret,
		);

		const request = new Request("http://localhost/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const user = await guard.authenticate(request);

		// Should return null, not throw
		expect(user).toBeNull();
	});

	test("handles UTF-8 non-ASCII characters in payload", async () => {
		const guard = createJwtGuard({
			secret,
		});

		// Create token with non-ASCII characters (emoji, accented chars, etc.)
		const token = await createTestJwt(
			{
				sub: "123",
				name: "José",
				emoji: "🚀",
				chinese: "你好",
				exp: Math.floor(Date.now() / 1000) + 3600,
			},
			secret,
		);

		const request = new Request("http://localhost/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const user = await guard.authenticate(request);

		expect(user).not.toBeNull();
		expect(user?.name).toBe("José");
		expect(user?.emoji).toBe("🚀");
		expect(user?.chinese).toBe("你好");
	});

	test("default mapping uses sub as id even if payload contains id field", async () => {
		const guard = createJwtGuard({
			secret,
		});

		// Payload has both sub and id - id should be derived from sub
		const token = await createTestJwt(
			{
				sub: "123",
				id: "wrong-id",
				name: "Test User",
				exp: Math.floor(Date.now() / 1000) + 3600,
			},
			secret,
		);

		const request = new Request("http://localhost/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const user = await guard.authenticate(request);

		expect(user).not.toBeNull();
		expect(user?.id).toBe("123"); // Should use sub, not payload.id
		expect(user?.name).toBe("Test User");
	});

	test("returns null when sub is not a string or number", async () => {
		const guard = createJwtGuard({
			secret,
		});

		// Payload has sub as an object (invalid)
		const token = await createTestJwt(
			{
				sub: { invalid: true },
				exp: Math.floor(Date.now() / 1000) + 3600,
			},
			secret,
		);

		const request = new Request("http://localhost/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const user = await guard.authenticate(request);

		expect(user).toBeNull();
	});

	describe("non-object header/payload JSON", () => {
		const values = ["null", "[]", '["a"]', "123", '"str"', "true"];

		const signedToken = async (rawHeader: string, rawPayload: string) => {
			const h = base64UrlEncode(rawHeader);
			const p = base64UrlEncode(rawPayload);
			const sig = base64UrlEncodeUint8Array(
				await signHS256(`${h}.${p}`, secret),
			);
			return `${h}.${p}.${sig}`;
		};

		const run = async (token: string) => {
			const guard = createJwtGuard({ secret });
			return guard.authenticate(
				new Request("http://localhost/test", {
					headers: { Authorization: `Bearer ${token}` },
				}),
			);
		};

		for (const value of values) {
			test(`returns null when header is ${value}`, async () => {
				const token = await signedToken(value, JSON.stringify({ sub: "1" }));
				expect(await run(token)).toBeNull();
			});

			test(`returns null when signed payload is ${value}`, async () => {
				const token = await signedToken(
					JSON.stringify({ alg: "HS256", typ: "JWT" }),
					value,
				);
				expect(await run(token)).toBeNull();
			});
		}
	});

	describe("BufferSource compatibility with Uint8Array secrets", () => {
		test("works with Uint8Array secret backed by ArrayBuffer", async () => {
			const secretBytes = new TextEncoder().encode("test-secret-key");
			// Create a new ArrayBuffer-backed Uint8Array
			const buffer = new ArrayBuffer(secretBytes.length);
			const secretUint8Array = new Uint8Array(buffer);
			secretUint8Array.set(secretBytes);

			const guard = createJwtGuard({
				secret: secretUint8Array,
			});

			const token = await createTestJwt(
				{
					sub: "123",
					exp: Math.floor(Date.now() / 1000) + 3600,
				},
				secretUint8Array,
			);

			const request = new Request("http://localhost/test", {
				headers: { Authorization: `Bearer ${token}` },
			});
			const user = await guard.authenticate(request);

			expect(user).not.toBeNull();
			expect(user?.id).toBe("123");
		});

		test("works with Uint8Array secret created from string", async () => {
			const secretString = "test-secret-key";
			const secretUint8Array = new TextEncoder().encode(secretString);

			const guard = createJwtGuard({
				secret: secretUint8Array,
			});

			const token = await createTestJwt(
				{
					sub: "456",
					exp: Math.floor(Date.now() / 1000) + 3600,
				},
				secretUint8Array,
			);

			const request = new Request("http://localhost/test", {
				headers: { Authorization: `Bearer ${token}` },
			});
			const user = await guard.authenticate(request);

			expect(user).not.toBeNull();
			expect(user?.id).toBe("456");
		});

		test("rejects token signed with different Uint8Array secret", async () => {
			const secret1 = new TextEncoder().encode("secret-1");
			const secret2 = new TextEncoder().encode("secret-2");

			const guard = createJwtGuard({
				secret: secret1,
			});

			// Create token with secret2
			const token = await createTestJwt(
				{
					sub: "789",
					exp: Math.floor(Date.now() / 1000) + 3600,
				},
				secret2,
			);

			const request = new Request("http://localhost/test", {
				headers: { Authorization: `Bearer ${token}` },
			});
			const user = await guard.authenticate(request);

			expect(user).toBeNull();
		});

		test("Uint8Array secret produces same results as string secret", async () => {
			const secretString = "test-secret-key";
			const secretUint8Array = new TextEncoder().encode(secretString);

			const stringGuard = createJwtGuard({ secret: secretString });
			const uint8ArrayGuard = createJwtGuard({ secret: secretUint8Array });

			// Create token with string secret (should work with both guards)
			const token = await createTestJwt(
				{
					sub: "999",
					exp: Math.floor(Date.now() / 1000) + 3600,
				},
				secretString,
			);

			const request = new Request("http://localhost/test", {
				headers: { Authorization: `Bearer ${token}` },
			});

			const stringUser = await stringGuard.authenticate(request);
			const uint8ArrayUser = await uint8ArrayGuard.authenticate(request);

			expect(stringUser).not.toBeNull();
			expect(uint8ArrayUser).not.toBeNull();
			expect(stringUser?.id).toBe(uint8ArrayUser?.id);
		});

		test("works with Uint8Array secret and custom claims", async () => {
			const secretUint8Array = new TextEncoder().encode("custom-secret");
			const guard = createJwtGuard({
				secret: secretUint8Array,
				issuer: "test-issuer",
				audience: "test-audience",
			});

			const token = await createTestJwt(
				{
					sub: "custom-user",
					iss: "test-issuer",
					aud: "test-audience",
					exp: Math.floor(Date.now() / 1000) + 3600,
				},
				secretUint8Array,
			);

			const request = new Request("http://localhost/test", {
				headers: { Authorization: `Bearer ${token}` },
			});
			const user = await guard.authenticate(request);

			expect(user).not.toBeNull();
			expect(user?.id).toBe("custom-user");
		});
	});
});

describe("createJwtGuard requireExp and secret validation", () => {
	const secret = "test-secret-key";
	const bearer = (token: string) =>
		new Request("http://localhost/test", {
			headers: { Authorization: `Bearer ${token}` },
		});

	test("rejects tokens without exp by default", async () => {
		const guard = createJwtGuard({ secret });
		const token = await createTestJwt({ sub: "123" }, secret);
		expect(await guard.authenticate(bearer(token))).toBeNull();
	});

	test("accepts tokens without exp when requireExp is false", async () => {
		const guard = createJwtGuard({ secret, requireExp: false });
		const token = await createTestJwt({ sub: "123" }, secret);
		const user = await guard.authenticate(bearer(token));
		expect(user?.id).toBe("123");
	});

	test("accepts tokens with valid exp when requireExp is true", async () => {
		const guard = createJwtGuard({ secret, requireExp: true });
		const token = await createTestJwt(
			{ sub: "123", exp: Math.floor(Date.now() / 1000) + 3600 },
			secret,
		);
		expect(await guard.authenticate(bearer(token))).not.toBeNull();
	});

	test("throws for an empty string secret", () => {
		expect(() => createJwtGuard({ secret: "" })).toThrow(/secret/i);
	});

	test("throws for an empty Uint8Array secret", () => {
		expect(() => createJwtGuard({ secret: new Uint8Array(0) })).toThrow(
			/secret/i,
		);
	});
});

describe("createJwtGuard claim boundaries and default mapping", () => {
	const secret = "test-secret-key";
	const fixedNow = 1_800_000_000;
	const bearer = (token: string) =>
		new Request("http://localhost/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
	const freezeClock = () => setSystemTime(new Date(fixedNow * 1000));

	afterEach(() => {
		setSystemTime();
	});

	test("rejects a token whose exp equals the current time", async () => {
		freezeClock();
		const guard = createJwtGuard({ secret });
		const token = await createTestJwt({ sub: "123", exp: fixedNow }, secret);
		expect(await guard.authenticate(bearer(token))).toBeNull();
	});

	test("accepts a token that expires one second from now", async () => {
		freezeClock();
		const guard = createJwtGuard({ secret });
		const token = await createTestJwt(
			{ sub: "123", exp: fixedNow + 1 },
			secret,
		);
		expect((await guard.authenticate(bearer(token)))?.id).toBe("123");
	});

	test("rejects a token at exactly exp + clockToleranceSeconds", async () => {
		freezeClock();
		const guard = createJwtGuard({ secret, clockToleranceSeconds: 30 });
		const atLimit = await createTestJwt(
			{ sub: "123", exp: fixedNow - 30 },
			secret,
		);
		const insideLimit = await createTestJwt(
			{ sub: "123", exp: fixedNow - 29 },
			secret,
		);
		expect(await guard.authenticate(bearer(atLimit))).toBeNull();
		expect(await guard.authenticate(bearer(insideLimit))).not.toBeNull();
	});

	test("accepts nbf in the future but within clockToleranceSeconds", async () => {
		freezeClock();
		const guard = createJwtGuard({ secret, clockToleranceSeconds: 30 });
		const token = await createTestJwt(
			{ sub: "123", exp: fixedNow + 3600, nbf: fixedNow + 30 },
			secret,
		);
		expect(await guard.authenticate(bearer(token))).not.toBeNull();
	});

	test("rejects nbf beyond clockToleranceSeconds", async () => {
		freezeClock();
		const guard = createJwtGuard({ secret, clockToleranceSeconds: 30 });
		const token = await createTestJwt(
			{ sub: "123", exp: fixedNow + 3600, nbf: fixedNow + 31 },
			secret,
		);
		expect(await guard.authenticate(bearer(token))).toBeNull();
	});

	test("rejects unsigned alg: none tokens", async () => {
		const guard = createJwtGuard({ secret });
		const header = base64UrlEncode(JSON.stringify({ alg: "none", typ: "JWT" }));
		const payload = base64UrlEncode(
			JSON.stringify({ sub: "123", exp: Math.floor(Date.now() / 1000) + 3600 }),
		);
		expect(
			await guard.authenticate(bearer(`${header}.${payload}.`)),
		).toBeNull();
		expect(
			await guard.authenticate(bearer(`${header}.${payload}.c2ln`)),
		).toBeNull();
	});

	test("rejects alg: none even when HMAC-signed with the secret", async () => {
		const guard = createJwtGuard({ secret });
		const token = await createTestJwt(
			{ sub: "123", exp: Math.floor(Date.now() / 1000) + 3600 },
			secret,
			{ alg: "none", typ: "JWT" },
		);
		expect(await guard.authenticate(bearer(token))).toBeNull();
	});

	test("rejects alg: RS256 tokens", async () => {
		const guard = createJwtGuard({ secret });
		const token = await createTestJwt(
			{ sub: "123", exp: Math.floor(Date.now() / 1000) + 3600 },
			secret,
			{ alg: "RS256", typ: "JWT" },
		);
		expect(await guard.authenticate(bearer(token))).toBeNull();
	});

	test("default mapping excludes registered claims", async () => {
		const exp = Math.floor(Date.now() / 1000) + 3600;
		const guard = createJwtGuard({ secret, issuer: "my-app", audience: "api" });
		const token = await createTestJwt(
			{
				sub: "123",
				iss: "my-app",
				aud: "api",
				exp,
				nbf: exp - 7200,
				iat: exp - 7200,
				jti: "token-1",
				email: "test@example.com",
				roles: ["admin"],
			},
			secret,
		);
		expect(await guard.authenticate(bearer(token))).toEqual({
			id: "123",
			email: "test@example.com",
			roles: ["admin"],
		});
	});
});

// Helper function to create a test JWT (HS256)
async function createTestJwt(
	payload: Record<string, unknown>,
	secret: string | Uint8Array,
	header: Record<string, unknown> = { alg: "HS256", typ: "JWT" },
): Promise<string> {
	const encodedHeader = base64UrlEncode(JSON.stringify(header));
	const encodedPayload = base64UrlEncode(JSON.stringify(payload));

	const signature = await signHS256(
		`${encodedHeader}.${encodedPayload}`,
		secret,
	);
	const encodedSignature = base64UrlEncodeUint8Array(signature);

	return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

function base64UrlEncode(str: string): string {
	// Encode UTF-8 string to base64url
	const encoder = new TextEncoder();
	const bytes = encoder.encode(str);
	const binary = String.fromCharCode(...bytes);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64UrlEncodeUint8Array(bytes: Uint8Array): string {
	const binary = String.fromCharCode(...bytes);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function signHS256(
	message: string,
	secret: string | Uint8Array,
): Promise<Uint8Array> {
	const encoder = new TextEncoder();
	let keyData: Uint8Array<ArrayBuffer>;
	if (typeof secret === "string") {
		keyData = encoder.encode(secret);
	} else {
		// For Uint8Array secrets, ensure ArrayBuffer backing
		const buffer = new ArrayBuffer(secret.length);
		keyData = new Uint8Array(buffer);
		keyData.set(secret);
	}
	const messageData = encoder.encode(message);

	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		keyData,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);

	const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
	return new Uint8Array(signature);
}
