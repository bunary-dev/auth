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
			expect(typeof authManager.createContext).toBe("function");
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

	describe("AuthContext", () => {
		test("authenticates valid request with default guard", async () => {
			const authManager = createAuthManager(createConfig());
			const request = new Request("http://localhost/test", {
				headers: { Authorization: "Bearer valid-token" },
			});

			const ctx = authManager.createContext({ request });
			const user = await ctx.authenticate();
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

			const ctx = authManager.createContext({ request });
			const user = await ctx.authenticate();
			expect(user).toBeNull();
		});

		test("authenticates with specified guard", async () => {
			const authManager = createAuthManager(createConfig());
			const request = new Request("http://localhost/test", {
				headers: { "X-API-Key": "test-key" },
			});

			const ctx = authManager.createContext({ request });
			const user = await ctx.authenticate("api-key");
			expect(user).toEqual({ id: 2, name: "API User" });
		});

		test("stores authenticated user on the context for later retrieval", async () => {
			const authManager = createAuthManager(createConfig());
			const request = new Request("http://localhost/test", {
				headers: { Authorization: "Bearer valid-token" },
			});

			const ctx = authManager.createContext({ request });
			await ctx.authenticate();
			expect(ctx.user()).toEqual({
				id: 1,
				name: "John Doe",
				email: "john@example.com",
			});
		});

		test("returns null before authentication", () => {
			const authManager = createAuthManager(createConfig());
			const ctx = authManager.createContext({
				request: new Request("http://localhost/test"),
			});
			expect(ctx.user()).toBeNull();
		});

		test("returns authenticated user after authentication", async () => {
			const authManager = createAuthManager(createConfig());
			const request = new Request("http://localhost/test", {
				headers: { Authorization: "Bearer valid-token" },
			});

			const ctx = authManager.createContext({ request });
			await ctx.authenticate();
			expect(ctx.user()).toEqual({
				id: 1,
				name: "John Doe",
				email: "john@example.com",
			});
		});

		test("check() returns false before authentication", () => {
			const authManager = createAuthManager(createConfig());
			const ctx = authManager.createContext({
				request: new Request("http://localhost/test"),
			});
			expect(ctx.check()).toBe(false);
		});

		test("check() returns true after successful authentication", async () => {
			const authManager = createAuthManager(createConfig());
			const request = new Request("http://localhost/test", {
				headers: { Authorization: "Bearer valid-token" },
			});

			const ctx = authManager.createContext({ request });
			await ctx.authenticate();
			expect(ctx.check()).toBe(true);
		});

		test("check() returns false after failed authentication", async () => {
			const authManager = createAuthManager(createConfig());
			const request = new Request("http://localhost/test", {
				headers: { Authorization: "Bearer invalid-token" },
			});

			const ctx = authManager.createContext({ request });
			await ctx.authenticate();
			expect(ctx.check()).toBe(false);
		});

		test("logout() clears the authenticated user", async () => {
			const authManager = createAuthManager(createConfig());
			const request = new Request("http://localhost/test", {
				headers: { Authorization: "Bearer valid-token" },
			});

			const ctx = authManager.createContext({ request });
			await ctx.authenticate();
			expect(ctx.check()).toBe(true);

			ctx.logout();
			expect(ctx.check()).toBe(false);
			expect(ctx.user()).toBeNull();
		});

		test("require() throws when unauthenticated", () => {
			const authManager = createAuthManager(createConfig());
			const ctx = authManager.createContext({
				request: new Request("http://localhost/test"),
			});
			expect(() => ctx.require()).toThrow("Unauthenticated");
		});

		test("require() returns the user when authenticated", async () => {
			const authManager = createAuthManager(createConfig());
			const ctx = authManager.createContext({
				request: new Request("http://localhost/test", {
					headers: { Authorization: "Bearer valid-token" },
				}),
			});
			await ctx.authenticate();
			expect(ctx.require()).toEqual({
				id: 1,
				name: "John Doe",
				email: "john@example.com",
			});
		});

		test("contexts are isolated (no user leakage across concurrent requests)", async () => {
			const authManager = createAuthManager(createConfig());

			const ctxA = authManager.createContext({
				request: new Request("http://localhost/test", {
					headers: { Authorization: "Bearer valid-token" },
				}),
			});
			const ctxB = authManager.createContext({
				request: new Request("http://localhost/test", {
					headers: { "X-API-Key": "test-key" },
				}),
			});

			await Promise.all([
				ctxA.authenticate("jwt"),
				ctxB.authenticate("api-key"),
			]);

			expect(ctxA.user()).toEqual({
				id: 1,
				name: "John Doe",
				email: "john@example.com",
			});
			expect(ctxB.user()).toEqual({ id: 2, name: "API User" });
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

		const ctx = authManager.createContext({ request });
		const user = await ctx.authenticate();
		expect(user).toEqual({ id: 3, name: "Sync User" });
	});
});
