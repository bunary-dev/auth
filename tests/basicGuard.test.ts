import { describe, expect, test } from "bun:test";
import { createBasicGuard } from "../src/guards/basic.js";

describe("createBasicGuard", () => {
	test("returns a guard with default name 'basic'", () => {
		const guard = createBasicGuard({
			verify: async () => null,
		});

		expect(guard.name).toBe("basic");
	});

	test("returns a guard with custom name", () => {
		const guard = createBasicGuard({
			name: "admin-basic",
			verify: async () => null,
		});

		expect(guard.name).toBe("admin-basic");
	});

	test("returns null when Authorization header is missing", async () => {
		const guard = createBasicGuard({
			verify: async () => ({ id: 1 }),
		});

		const request = new Request("http://localhost/test");
		const user = await guard.authenticate(request);

		expect(user).toBeNull();
	});

	test("returns null when Authorization header has wrong scheme", async () => {
		const guard = createBasicGuard({
			verify: async () => ({ id: 1 }),
		});

		const request = new Request("http://localhost/test", {
			headers: { Authorization: "Bearer token123" },
		});
		const user = await guard.authenticate(request);

		expect(user).toBeNull();
	});

	test("returns null when Authorization header has invalid base64", async () => {
		const guard = createBasicGuard({
			verify: async () => ({ id: 1 }),
		});

		const request = new Request("http://localhost/test", {
			headers: { Authorization: "Basic invalid-base64!!!" },
		});
		const user = await guard.authenticate(request);

		expect(user).toBeNull();
	});

	test("returns null when base64 doesn't contain colon separator", async () => {
		const guard = createBasicGuard({
			verify: async () => ({ id: 1 }),
		});

		// "nocolon" base64 encoded
		const invalid = btoa("nocolon");
		const request = new Request("http://localhost/test", {
			headers: { Authorization: `Basic ${invalid}` },
		});
		const user = await guard.authenticate(request);

		expect(user).toBeNull();
	});

	test("calls verify with username and password on successful parse", async () => {
		let receivedUsername: string | null = null;
		let receivedPassword: string | null = null;
		let receivedRequest: Request | null = null;

		const guard = createBasicGuard({
			verify: async (username, password, request) => {
				receivedUsername = username;
				receivedPassword = password;
				receivedRequest = request;
				return { id: 1, username };
			},
		});

		const testRequest = new Request("http://localhost/test", {
			headers: { Authorization: `Basic ${btoa("alice:secret123")}` },
		});
		const user = await guard.authenticate(testRequest);

		// Verify function should have been called
		expect(receivedUsername).not.toBeNull();
		expect(receivedPassword).not.toBeNull();
		expect(receivedRequest).not.toBeNull();

		// TypeScript narrowing after null checks
		const username = receivedUsername as unknown as string;
		const password = receivedPassword as unknown as string;
		const request = receivedRequest as unknown as Request;

		expect(username).toBe("alice");
		expect(password).toBe("secret123");
		expect(request).toBe(testRequest);
		expect(user).toEqual({ id: 1, username: "alice" });
	});

	test("returns null when verify returns null", async () => {
		const guard = createBasicGuard({
			verify: async () => null,
		});

		const request = new Request("http://localhost/test", {
			headers: { Authorization: `Basic ${btoa("alice:wrong")}` },
		});
		const user = await guard.authenticate(request);

		expect(user).toBeNull();
	});

	test("handles username with colon in password", async () => {
		const guard = createBasicGuard({
			verify: async (username, password) => {
				// First colon separates username:password
				expect(username).toBe("alice");
				expect(password).toBe("pass:word");
				return { id: 1, username };
			},
		});

		const request = new Request("http://localhost/test", {
			headers: { Authorization: `Basic ${btoa("alice:pass:word")}` },
		});
		const user = await guard.authenticate(request);

		expect(user).toEqual({ id: 1, username: "alice" });
	});

	test("handles empty username", async () => {
		const guard = createBasicGuard({
			verify: async (username, password) => {
				expect(username).toBe("");
				expect(password).toBe("secret");
				return { id: 1 };
			},
		});

		const request = new Request("http://localhost/test", {
			headers: { Authorization: `Basic ${btoa(":secret")}` },
		});
		const user = await guard.authenticate(request);

		expect(user).toEqual({ id: 1 });
	});

	test("handles empty password", async () => {
		const guard = createBasicGuard({
			verify: async (username, password) => {
				expect(username).toBe("alice");
				expect(password).toBe("");
				return { id: 1 };
			},
		});

		const request = new Request("http://localhost/test", {
			headers: { Authorization: `Basic ${btoa("alice:")}` },
		});
		const user = await guard.authenticate(request);

		expect(user).toEqual({ id: 1 });
	});

	test("works with synchronous verify function", async () => {
		const guard = createBasicGuard({
			verify: (username, password) => {
				if (username === "admin" && password === "admin") {
					return { id: 1, username };
				}
				return null;
			},
		});

		const request = new Request("http://localhost/test", {
			headers: { Authorization: `Basic ${btoa("admin:admin")}` },
		});
		const user = await guard.authenticate(request);

		expect(user).toEqual({ id: 1, username: "admin" });
	});

	test("handles case-insensitive Authorization scheme", async () => {
		const guard = createBasicGuard({
			verify: async (username) => ({ id: 1, username }),
		});

		const request = new Request("http://localhost/test", {
			headers: { Authorization: `BASIC ${btoa("alice:secret")}` },
		});
		const user = await guard.authenticate(request);

		expect(user).toEqual({ id: 1, username: "alice" });
	});
});
