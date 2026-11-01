import { describe, expect, test } from "bun:test";
import { createRouter } from "@bunary/http";
import { createAuth } from "../src/appScoped.js";
import { createBasicGuard } from "../src/guards/basic.js";
import type {
	AuthConfig,
	AuthContext,
	AuthLocals,
	AuthRequestContext,
	Guard,
} from "../src/types.js";

function makeCtx(request: Request): AuthRequestContext {
	return {
		request,
		locals: {},
	};
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
		const ctx = makeCtx(new Request("http://localhost/test"));

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

		const ctx1 = makeCtx(
			new Request("http://localhost/test", {
				headers: { Authorization: "Bearer token1" },
			}),
		);

		const ctx2 = makeCtx(
			new Request("http://localhost/test", {
				headers: { Authorization: "Bearer token2" },
			}),
		);

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
		const ctx = makeCtx(new Request("http://localhost/test"));

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

		const ctx1 = makeCtx(
			new Request("http://localhost/test", {
				headers: { "x-user-id": "user1" },
			}),
		);

		const ctx2 = makeCtx(
			new Request("http://localhost/test", {
				headers: { "x-user-id": "user2" },
			}),
		);

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

	test("works as @bunary/http middleware end to end", async () => {
		const passwordHash = await Bun.password.hash("s3cret");
		const app = createRouter<AuthLocals>();
		app.use(
			createAuth<AuthLocals>({
				defaultGuard: "basic",
				guards: {
					basic: createBasicGuard({
						async verify(username, password) {
							if (username !== "admin") return null;
							if (!(await Bun.password.verify(password, passwordHash)))
								return null;
							return { id: 1, username };
						},
					}),
				},
			}),
		);
		app.get("/me", async (ctx) => {
			const user = await ctx.locals.auth.authenticate();
			if (!user) return new Response("Unauthorized", { status: 401 });
			return { user };
		});

		const ok = await app.fetch(
			new Request("http://localhost/me", {
				headers: { Authorization: `Basic ${btoa("admin:s3cret")}` },
			}),
		);
		expect(ok.status).toBe(200);
		expect(await ok.json()).toEqual({ user: { id: 1, username: "admin" } });

		const denied = await app.fetch(
			new Request("http://localhost/me", {
				headers: { Authorization: `Basic ${btoa("admin:wrong")}` },
			}),
		);
		expect(denied.status).toBe(401);
	});

	test("default-typed middleware is accepted by an untyped router", () => {
		const app = createRouter();
		app.use(
			createAuth({
				defaultGuard: "t",
				guards: { t: { name: "t", authenticate: () => null } },
			}),
		);
		expect(typeof app.fetch).toBe("function");
	});
});
