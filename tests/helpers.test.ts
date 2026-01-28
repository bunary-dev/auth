import { afterEach, describe, expect, test } from "bun:test";
import {
	auth,
	clearAuthManager,
	getAuthManager,
	setAuthManager,
} from "../src/helpers.js";
import { createAuthManager } from "../src/manager.js";
import type { Guard } from "../src/types.js";

const mockGuard: Guard = {
	name: "test",
	async authenticate(request) {
		const auth = request.headers.get("Authorization");
		if (auth === "Bearer valid") {
			return { id: 1, name: "Test User" };
		}
		return null;
	},
};

describe("auth() helper", () => {
	afterEach(() => {
		clearAuthManager();
	});

	describe("setAuthManager()", () => {
		test("sets the global auth manager", () => {
			const authManager = createAuthManager({
				defaultGuard: "test",
				guards: { test: mockGuard },
			});

			setAuthManager(authManager);
			expect(getAuthManager()).toBe(authManager);
		});
	});

	describe("auth()", () => {
		test("throws when no auth manager is set", () => {
			expect(() =>
				auth({ request: new Request("http://localhost/test") }),
			).toThrow();
		});

		test("creates a context (unauthenticated by default)", () => {
			const authManager = createAuthManager({
				defaultGuard: "test",
				guards: { test: mockGuard },
			});
			setAuthManager(authManager);

			const ctx = auth({ request: new Request("http://localhost/test") });
			expect(ctx.user()).toBeNull();
			expect(ctx.check()).toBe(false);
		});

		test("returns user after authentication", async () => {
			const authManager = createAuthManager({
				defaultGuard: "test",
				guards: { test: mockGuard },
			});
			setAuthManager(authManager);

			const request = new Request("http://localhost/test", {
				headers: { Authorization: "Bearer valid" },
			});
			const ctx = auth({ request });
			await ctx.authenticate();

			expect(ctx.user()).toEqual({ id: 1, name: "Test User" });
		});

		test("returns null after logout", async () => {
			const authManager = createAuthManager({
				defaultGuard: "test",
				guards: { test: mockGuard },
			});
			setAuthManager(authManager);

			const request = new Request("http://localhost/test", {
				headers: { Authorization: "Bearer valid" },
			});
			const ctx = auth({ request });
			await ctx.authenticate();
			ctx.logout();

			expect(ctx.user()).toBeNull();
		});
	});

	describe("clearAuthManager()", () => {
		test("removes the global auth manager", () => {
			const authManager = createAuthManager({
				defaultGuard: "test",
				guards: { test: mockGuard },
			});
			setAuthManager(authManager);
			expect(getAuthManager()).not.toBeNull();

			clearAuthManager();
			expect(getAuthManager()).toBeNull();
		});
	});
});
