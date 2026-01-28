import { describe, expect, test } from "bun:test";
import { createAuth } from "../src/appScoped.js";
import type { AuthConfig, AuthContext, Guard } from "../src/types.js";

interface TestRequestContext {
	request: Request;
	params: Record<string, string>;
	query: URLSearchParams;
	locals: Record<string, unknown>;
}

describe("createAuth", () => {
	test("returns a middleware function", () => {
		const config: AuthConfig = {
			defaultGuard: "test",
			guards: {
				test: {
					name: "test",
					authenticate: () => null,
				},
			},
		};

		const middleware = createAuth(config);
		expect(typeof middleware).toBe("function");
		expect(middleware.length).toBe(2); // (ctx, next) => ...
	});

	test("middleware attaches auth context to ctx.locals.auth", async () => {
		const config: AuthConfig = {
			defaultGuard: "test",
			guards: {
				test: {
					name: "test",
					authenticate: () => null,
				},
			},
		};

		const middleware = createAuth(config);
		const ctx: TestRequestContext = {
			request: new Request("http://localhost/test"),
			params: {},
			query: new URLSearchParams(),
			locals: {},
		};

		await middleware(ctx, async () => {
			return new Response();
		});

		const authContext = ctx.locals.auth as AuthContext;
		expect(authContext).not.toBeNull();
		expect(typeof authContext.authenticate).toBe("function");
		expect(typeof authContext.user).toBe("function");
		expect(typeof authContext.check).toBe("function");
	});

	test("two apps with different auth configs do not share state", async () => {
		const guard1: Guard = {
			name: "guard1",
			authenticate: async () => ({ id: 1, app: "app1" }),
		};

		const guard2: Guard = {
			name: "guard2",
			authenticate: async () => ({ id: 2, app: "app2" }),
		};

		const middleware1 = createAuth({
			defaultGuard: "guard1",
			guards: { guard1 },
		});

		const middleware2 = createAuth({
			defaultGuard: "guard2",
			guards: { guard2 },
		});

		const ctx1: TestRequestContext = {
			request: new Request("http://localhost/test", {
				headers: { Authorization: "Bearer token1" },
			}),
			params: {},
			query: new URLSearchParams(),
			locals: {},
		};

		const ctx2: TestRequestContext = {
			request: new Request("http://localhost/test", {
				headers: { Authorization: "Bearer token2" },
			}),
			params: {},
			query: new URLSearchParams(),
			locals: {},
		};

		await middleware1(ctx1, async () => {
			await (ctx1.locals.auth as AuthContext).authenticate();
			return new Response();
		});

		await middleware2(ctx2, async () => {
			await (ctx2.locals.auth as AuthContext).authenticate();
			return new Response();
		});

		const user1 = (ctx1.locals.auth as AuthContext).user();
		const user2 = (ctx2.locals.auth as AuthContext).user();

		expect(user1).toEqual({ id: 1, app: "app1" });
		expect(user2).toEqual({ id: 2, app: "app2" });
		expect(user1).not.toEqual(user2);
	});

	test("middleware attaches auth context before calling next", async () => {
		const config: AuthConfig = {
			defaultGuard: "test",
			guards: {
				test: {
					name: "test",
					authenticate: async () => ({ id: 1 }),
				},
			},
		};

		const middleware = createAuth(config);
		const ctx: TestRequestContext = {
			request: new Request("http://localhost/test"),
			params: {},
			query: new URLSearchParams(),
			locals: {},
		};

		await middleware(ctx, async () => {
			return new Response();
		});

		const authContextBeforeNext = ctx.locals.auth as AuthContext;
		expect(authContextBeforeNext).not.toBeNull();
		expect(authContextBeforeNext.check()).toBe(false); // Not authenticated yet
	});

	test("auth context is isolated per request", async () => {
		const config: AuthConfig = {
			defaultGuard: "test",
			guards: {
				test: {
					name: "test",
					authenticate: async (request) => {
						const userId = request.headers.get("x-user-id");
						return userId ? { id: userId } : null;
					},
				},
			},
		};

		const middleware = createAuth(config);

		const ctx1: TestRequestContext = {
			request: new Request("http://localhost/test", {
				headers: { "x-user-id": "user1" },
			}),
			params: {},
			query: new URLSearchParams(),
			locals: {},
		};

		const ctx2: TestRequestContext = {
			request: new Request("http://localhost/test", {
				headers: { "x-user-id": "user2" },
			}),
			params: {},
			query: new URLSearchParams(),
			locals: {},
		};

		await Promise.all([
			middleware(ctx1, async () => {
				await (ctx1.locals.auth as AuthContext).authenticate();
				return new Response();
			}),
			middleware(ctx2, async () => {
				await (ctx2.locals.auth as AuthContext).authenticate();
				return new Response();
			}),
		]);

		const user1 = (ctx1.locals.auth as AuthContext).user();
		const user2 = (ctx2.locals.auth as AuthContext).user();

		expect(user1).toEqual({ id: "user1" });
		expect(user2).toEqual({ id: "user2" });
		expect(ctx1.locals.auth).not.toBe(ctx2.locals.auth);
	});
});
