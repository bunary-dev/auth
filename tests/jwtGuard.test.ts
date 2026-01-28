import { describe, expect, test } from "bun:test";
import { createJwtGuard } from "../src/guards/jwt.js";

// Helper to create a test JWT (we'll need to implement JWT encoding/decoding)
// For now, we'll test the guard's behavior with mock tokens

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

		const request = new Request("http://localhost/test", {
			headers: { Authorization: "Bearer invalid.base64!!!" },
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
			sub: "123",
			exp: expect.any(Number),
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
});

// Helper function to create a test JWT (HS256)
async function createTestJwt(
	payload: Record<string, unknown>,
	secret: string,
): Promise<string> {
	const header = { alg: "HS256", typ: "JWT" };

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
	return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64UrlEncodeUint8Array(bytes: Uint8Array): string {
	const binary = String.fromCharCode(...bytes);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function signHS256(message: string, secret: string): Promise<Uint8Array> {
	const encoder = new TextEncoder();
	const keyData = encoder.encode(secret);
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
