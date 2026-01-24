import { describe, expect, test } from "bun:test";
import { createAuthManager } from "../src/manager.js";
import type { AuthConfig, Guard } from "../src/types.js";

// Test guard that validates "Bearer valid-token"
const mockJwtGuard: Guard = {
	name: "jwt",
	async authenticate(request) {
		const auth = request.headers.get("Authorization");
		if (auth === "Bearer valid-token") {
			return { id: 1, name: "John Doe", email: "john@example.com" };
		}
		return null;
	},
};

// Test guard that validates "ApiKey test-key"
const mockApiKeyGuard: Guard = {
	name: "api-key",
	async authenticate(request) {
		const key = request.headers.get("X-API-Key");
		if (key === "test-key") {
			return { id: 2, name: "API User" };
		}
		return null;
	},
};

const createConfig = (overrides: Partial<AuthConfig> = {}): AuthConfig => ({
	defaultGuard: "jwt",
	guards: {
		jwt: mockJwtGuard,
		"api-key": mockApiKeyGuard,
	},
	...overrides,
});

describe("AuthManager", () => {
	describe("createAuthManager()", () => {
		test("creates an auth manager with config", () => {
			const authManager = createAuthManager(createConfig());
			expect(authManager).toBeDefined();
			expect(typeof authManager.guard).toBe("function");
			expect(typeof authManager.authenticate).toBe("function");
			expect(typeof authManager.user).toBe("function");
			expect(typeof authManager.check).toBe("function");
			expect(typeof authManager.logout).toBe("function");
		});
	});

	describe("guard()", () => {
		test("returns the default guard when no name specified", () => {
			const authManager = createAuthManager(createConfig());
			const guard = authManager.guard();
			expect(guard.name).toBe("jwt");
		});

		test("returns a named guard", () => {
			const authManager = createAuthManager(createConfig());
			const guard = authManager.guard("api-key");
			expect(guard.name).toBe("api-key");
		});

		test("throws when guard does not exist", () => {
			const authManager = createAuthManager(createConfig());
			expect(() => authManager.guard("nonexistent")).toThrow();
		});
	});

	describe("authenticate()", () => {
		test("authenticates valid request with default guard", async () => {
			const authManager = createAuthManager(createConfig());
			const request = new Request("http://localhost/test", {
				headers: { Authorization: "Bearer valid-token" },
			});

			const user = await authManager.authenticate(request);
			expect(user).toEqual({
				id: 1,
				name: "John Doe",
				email: "john@example.com",
			});
		});

		test("returns null for invalid credentials", async () => {
			const authManager = createAuthManager(createConfig());
			const request = new Request("http://localhost/test", {
				headers: { Authorization: "Bearer invalid-token" },
			});

			const user = await authManager.authenticate(request);
			expect(user).toBeNull();
		});

		test("authenticates with specified guard", async () => {
			const authManager = createAuthManager(createConfig());
			const request = new Request("http://localhost/test", {
				headers: { "X-API-Key": "test-key" },
			});

			const user = await authManager.authenticate(request, "api-key");
			expect(user).toEqual({ id: 2, name: "API User" });
		});

		test("stores authenticated user for later retrieval", async () => {
			const authManager = createAuthManager(createConfig());
			const request = new Request("http://localhost/test", {
				headers: { Authorization: "Bearer valid-token" },
			});

			await authManager.authenticate(request);
			expect(authManager.user()).toEqual({
				id: 1,
				name: "John Doe",
				email: "john@example.com",
			});
		});
	});

	describe("user()", () => {
		test("returns null before authentication", () => {
			const authManager = createAuthManager(createConfig());
			expect(authManager.user()).toBeNull();
		});

		test("returns authenticated user after authentication", async () => {
			const authManager = createAuthManager(createConfig());
			const request = new Request("http://localhost/test", {
				headers: { Authorization: "Bearer valid-token" },
			});

			await authManager.authenticate(request);
			expect(authManager.user()).toEqual({
				id: 1,
				name: "John Doe",
				email: "john@example.com",
			});
		});
	});

	describe("check()", () => {
		test("returns false before authentication", () => {
			const authManager = createAuthManager(createConfig());
			expect(authManager.check()).toBe(false);
		});

		test("returns true after successful authentication", async () => {
			const authManager = createAuthManager(createConfig());
			const request = new Request("http://localhost/test", {
				headers: { Authorization: "Bearer valid-token" },
			});

			await authManager.authenticate(request);
			expect(authManager.check()).toBe(true);
		});

		test("returns false after failed authentication", async () => {
			const authManager = createAuthManager(createConfig());
			const request = new Request("http://localhost/test", {
				headers: { Authorization: "Bearer invalid-token" },
			});

			await authManager.authenticate(request);
			expect(authManager.check()).toBe(false);
		});
	});

	describe("logout()", () => {
		test("clears the authenticated user", async () => {
			const authManager = createAuthManager(createConfig());
			const request = new Request("http://localhost/test", {
				headers: { Authorization: "Bearer valid-token" },
			});

			await authManager.authenticate(request);
			expect(authManager.check()).toBe(true);

			authManager.logout();
			expect(authManager.check()).toBe(false);
			expect(authManager.user()).toBeNull();
		});
	});
});

describe("Guard Interface", () => {
	test("guard can be synchronous", async () => {
		const syncGuard: Guard = {
			name: "sync",
			authenticate(request) {
				const token = request.headers.get("Authorization");
				if (token === "Bearer sync-token") {
					return { id: 3, name: "Sync User" };
				}
				return null;
			},
		};

		const authManager = createAuthManager({
			defaultGuard: "sync",
			guards: { sync: syncGuard },
		});

		const request = new Request("http://localhost/test", {
			headers: { Authorization: "Bearer sync-token" },
		});

		const user = await authManager.authenticate(request);
		expect(user).toEqual({ id: 3, name: "Sync User" });
	});
});
