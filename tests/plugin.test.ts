import { describe, expect, test } from "bun:test";
import { createAuthManager } from "../src/manager.js";
import { installAuthPlugin } from "../src/plugin.js";
import type { AuthPlugin, Guard } from "../src/types.js";

describe("AuthPlugin", () => {
	const mockGuard: Guard = {
		name: "test",
		async authenticate(request) {
			const token = request.headers.get("X-Token");
			return token === "valid" ? { id: 1, name: "Test User" } : null;
		},
	};

	test("installAuthPlugin() merges plugin guards into manager", () => {
		const manager = createAuthManager({
			defaultGuard: "jwt",
			guards: {
				jwt: {
					name: "jwt",
					async authenticate() {
						return null;
					},
				},
			},
		});

		const plugin: AuthPlugin = {
			name: "test-plugin",
			guards: {
				test: mockGuard,
			},
		};

		installAuthPlugin(manager, plugin);

		// Plugin guard should be available
		const guard = manager.guard("test");
		expect(guard.name).toBe("test");
	});

	test("installAuthPlugin() allows plugin guards to override existing guards", async () => {
		const originalGuard: Guard = {
			name: "jwt",
			async authenticate() {
				return { id: 999, name: "Original" };
			},
		};

		const manager = createAuthManager({
			defaultGuard: "jwt",
			guards: {
				jwt: originalGuard,
			},
		});

		const plugin: AuthPlugin = {
			name: "override-plugin",
			guards: {
				jwt: {
					name: "jwt",
					async authenticate() {
						return { id: 1, name: "Overridden" };
					},
				},
			},
		};

		installAuthPlugin(manager, plugin);

		// Plugin guard should override original
		const guard = manager.guard("jwt");
		const request = new Request("http://localhost/");
		const user = await guard.authenticate(request);
		expect(user).toEqual({ id: 1, name: "Overridden" });
	});

	test("installAuthPlugin() calls routes callback when provided", () => {
		const manager = createAuthManager({
			defaultGuard: "jwt",
			guards: {
				jwt: {
					name: "jwt",
					async authenticate() {
						return null;
					},
				},
			},
		});

		let routesCalled = false;
		const plugin: AuthPlugin = {
			name: "routes-plugin",
			routes: (router) => {
				routesCalled = true;
				expect(typeof router).toBe("object");
			},
		};

		installAuthPlugin(manager, plugin);
		expect(routesCalled).toBe(true);
	});

	test("installAuthPlugin() calls configure callback when provided (with options)", () => {
		const manager = createAuthManager({
			defaultGuard: "jwt",
			guards: {
				jwt: {
					name: "jwt",
					async authenticate() {
						return null;
					},
				},
			},
		});

		let configureCalled = false;
		let receivedOptions: Record<string, unknown> | undefined;
		const plugin: AuthPlugin = {
			name: "configure-plugin",
			configure: (options) => {
				configureCalled = true;
				receivedOptions = options;
				expect(typeof options).toBe("object");
			},
		};

		installAuthPlugin(manager, plugin, { clientId: "test" });
		expect(configureCalled).toBe(true);
		expect(receivedOptions).toEqual({ clientId: "test" });
	});

	test("installAuthPlugin() calls configure callback with empty object when options omitted", () => {
		const manager = createAuthManager({
			defaultGuard: "jwt",
			guards: {
				jwt: {
					name: "jwt",
					async authenticate() {
						return null;
					},
				},
			},
		});

		let configureCalled = false;
		let receivedOptions: Record<string, unknown> | undefined;
		const plugin: AuthPlugin = {
			name: "configure-plugin",
			configure: (options) => {
				configureCalled = true;
				receivedOptions = options;
				expect(typeof options).toBe("object");
			},
		};

		installAuthPlugin(manager, plugin);
		expect(configureCalled).toBe(true);
		expect(receivedOptions).toEqual({});
	});

	test("installAuthPlugin() works with plugin that has only guards", () => {
		const manager = createAuthManager({
			defaultGuard: "jwt",
			guards: {
				jwt: {
					name: "jwt",
					async authenticate() {
						return null;
					},
				},
			},
		});

		const apiGuard: Guard = {
			name: "api",
			async authenticate(request) {
				const token = request.headers.get("X-Token");
				return token === "valid" ? { id: 1, name: "API User" } : null;
			},
		};

		const plugin: AuthPlugin = {
			name: "guards-only",
			guards: {
				api: apiGuard,
			},
		};

		installAuthPlugin(manager, plugin);

		expect(manager.guard("api").name).toBe("api");
	});

	test("installAuthPlugin() throws when manager doesn't support plugins", () => {
		// Custom manager that implements AuthManagerInterface but not InstallableAuthManager
		const customManager = {
			guard: () => ({
				name: "custom",
				async authenticate() {
					return null;
				},
			}),
			createContext: () => ({
				guard: () => ({
					name: "custom",
					async authenticate() {
						return null;
					},
				}),
				authenticate: async () => null,
				user: () => null,
				check: () => false,
				require: () => {
					throw new Error("Unauthenticated");
				},
				logout: () => {},
			}),
			// Missing _guards property
		};

		const plugin: AuthPlugin = {
			name: "test-plugin",
			guards: {
				test: mockGuard,
			},
		};

		expect(() => {
			// @ts-expect-error - Testing runtime error for custom manager without _guards
			installAuthPlugin(customManager, plugin);
		}).toThrow(
			"Auth manager does not support plugin installation. Use createAuthManager() to create a manager that supports plugins.",
		);
	});
});
