import { describe, expect, test } from "bun:test";
import { type Application, BunaryError, createApp } from "@bunary/core";
import { createApp as createHttpApp, type RequestContext } from "@bunary/http";
import { createBasicGuard } from "../src/guards/basic.js";
import { createSessionGuard } from "../src/guards/session.js";
import {
	AuthToken,
	type AuthUserLocals,
	authMiddleware,
	authProvider,
	type RequiredAuthLocals,
	requireAuth,
} from "../src/provider.js";
import type { AuthConfig, AuthContext, AuthUser } from "../src/types.js";
import { createMemoryProvider } from "./helpers.js";

const basicGuard = createBasicGuard({
	verify: (username, password) =>
		username === "admin" && password === "s3cret" ? { id: 1, username } : null,
});

const basicHeader = (user: string, password: string) => ({
	Authorization: `Basic ${btoa(`${user}:${password}`)}`,
});

function bootApp(auth: unknown): Promise<Application> {
	return createApp({
		config: { app: { name: "auth-test" }, auth } as never,
		providers: [authProvider],
	}).boot();
}

function makeCtx(
	request: Request,
	app?: Application,
): RequestContext & { app?: Application } {
	return {
		request,
		params: {},
		query: new URL(request.url).searchParams,
		locals: {},
		json: <T>() => request.json() as Promise<T>,
		text: () => request.text(),
		formData: () => request.formData(),
		...(app && { app }),
	};
}

const basicConfig: AuthConfig = {
	defaultGuard: "basic",
	guards: { basic: basicGuard },
};

describe("AuthToken", () => {
	test("is a core token named auth.manager", () => {
		expect(String(AuthToken)).toBe("Token(auth.manager)");
	});
});

describe("authProvider", () => {
	test("is a named core provider with a register hook", () => {
		expect(authProvider.name).toBe("@bunary/auth");
		expect(typeof authProvider.register).toBe("function");
	});

	test("registers a working manager under AuthToken", async () => {
		const app = await bootApp(basicConfig);
		expect(app.has(AuthToken)).toBe(true);

		const manager = app.get(AuthToken);
		expect(manager.guard()).toBe(basicGuard);

		const auth = manager.createContext({
			request: new Request("http://localhost/", {
				headers: basicHeader("admin", "s3cret"),
			}),
		});
		expect(await auth.authenticate()).toEqual({ id: 1, username: "admin" });
		expect(auth.check()).toBe(true);
	});

	test("exposes the configured user provider on the manager", async () => {
		const users = await createMemoryProvider();
		const app = await bootApp({ ...basicConfig, provider: users });
		expect(app.get(AuthToken).provider()).toBe(users);
	});

	test("manager.provider() throws when no user provider is configured", async () => {
		const app = await bootApp(basicConfig);
		expect(() => app.get(AuthToken).provider()).toThrow(
			"No user provider configured",
		);
	});

	test("two apps get separate managers", async () => {
		const other = createBasicGuard({ name: "other", verify: () => null });
		const a = await bootApp(basicConfig);
		const b = await bootApp({
			defaultGuard: "other",
			guards: { other },
		});
		expect(a.get(AuthToken)).not.toBe(b.get(AuthToken));
		expect(b.get(AuthToken).guard()).toBe(other);
	});

	test.each([
		[undefined, 'BunaryConfig: "auth" is required by authProvider'],
		["nope", 'BunaryConfig: "auth" must be an object'],
		[
			{ guards: {} },
			'BunaryConfig: "auth.defaultGuard" must be a non-empty string',
		],
		[
			{ defaultGuard: "basic" },
			'BunaryConfig: "auth.guards" must be an object',
		],
		[
			{ defaultGuard: "basic", guards: { basic: { name: "basic" } } },
			'BunaryConfig: "auth.guards.basic" must be a guard (an object with authenticate())',
		],
		[
			{ defaultGuard: "jwt", guards: { basic: basicGuard } },
			'BunaryConfig: "auth.defaultGuard" is "jwt", which is not in "auth.guards"',
		],
		[
			{ ...basicConfig, provider: { retrieveById: () => null } },
			'BunaryConfig: "auth.provider" must be a user provider (retrieveById, retrieveByCredentials and validateCredentials)',
		],
	])("rejects an invalid auth config at boot (%p)", async (auth, message) => {
		const error = await bootApp(auth).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(BunaryError);
		expect((error as Error).message).toBe(message);
	});
});

describe("authMiddleware", () => {
	test("resolves the manager from ctx.app and attaches the user", async () => {
		const app = await bootApp(basicConfig);
		const ctx = makeCtx(
			new Request("http://localhost/", {
				headers: basicHeader("admin", "s3cret"),
			}),
			app,
		);

		let called = false;
		await authMiddleware()(ctx, async () => {
			called = true;
			return new Response("ok");
		});

		expect(called).toBe(true);
		expect(ctx.locals.user).toEqual({ id: 1, username: "admin" });
		expect((ctx.locals.auth as AuthContext).user()).toEqual({
			id: 1,
			username: "admin",
		});
	});

	test("passes guests through with user null", async () => {
		const app = await bootApp(basicConfig);
		const ctx = makeCtx(new Request("http://localhost/"), app);

		const response = await authMiddleware()(
			ctx,
			async () => new Response("ok"),
		);

		expect(await (response as Response).text()).toBe("ok");
		expect(ctx.locals.user).toBeNull();
		expect((ctx.locals.auth as AuthContext).guest()).toBe(true);
	});

	test("uses the named guard", async () => {
		const always: AuthUser = { id: 7 };
		const app = await bootApp({
			...basicConfig,
			guards: {
				basic: basicGuard,
				token: { name: "token", authenticate: () => always },
			},
		});
		const ctx = makeCtx(new Request("http://localhost/"), app);

		await authMiddleware({ guard: "token" })(ctx, async () => new Response());

		expect(ctx.locals.user).toBe(always);
	});

	test("takes the app as an option when ctx.app is absent", async () => {
		const app = await bootApp(basicConfig);
		const ctx = makeCtx(
			new Request("http://localhost/", {
				headers: basicHeader("admin", "s3cret"),
			}),
		);

		await authMiddleware({ app })(ctx, async () => new Response());

		expect(ctx.locals.user).toEqual({ id: 1, username: "admin" });
	});

	test("throws a clear error without an app", async () => {
		const ctx = makeCtx(new Request("http://localhost/"));
		await expect(
			Promise.resolve(authMiddleware()(ctx, async () => new Response())),
		).rejects.toThrow("authMiddleware: no @bunary/core Application");
	});

	test("appends Set-Cookie headers written by the guard", async () => {
		const users = await createMemoryProvider();
		const app = await bootApp({
			defaultGuard: "session",
			provider: users,
			guards: {
				session: createSessionGuard({
					provider: users,
					secret: "0123456789abcdef0123456789abcdef",
					secure: false,
				}),
			},
		});
		const ctx = makeCtx(new Request("http://localhost/login"), app);

		const response = (await authMiddleware()(ctx, async () => {
			await (ctx.locals.auth as AuthContext).attempt({
				email: "ada@example.com",
				password: "correct horse",
			});
			return new Response("ok");
		})) as Response;

		expect(response.headers.get("set-cookie")).toContain("bunary_session=");
	});
});

describe("requireAuth", () => {
	test("responds 401 with a problem document and skips the handler", async () => {
		const app = await bootApp(basicConfig);
		const ctx = makeCtx(new Request("http://localhost/me"), app);

		let called = false;
		const response = (await requireAuth()(ctx, async () => {
			called = true;
			return new Response("ok");
		})) as Response;

		expect(called).toBe(false);
		expect(response.status).toBe(401);
		expect(response.headers.get("content-type")).toBe(
			"application/problem+json; charset=utf-8",
		);
		expect(await response.json()).toEqual({
			type: "about:blank",
			title: "Unauthorized",
			status: 401,
		});
	});

	test("passes authenticated requests through with the user", async () => {
		const app = await bootApp(basicConfig);
		const ctx = makeCtx(
			new Request("http://localhost/me", {
				headers: basicHeader("admin", "s3cret"),
			}),
			app,
		);

		const response = (await requireAuth()(
			ctx,
			async () => new Response("ok"),
		)) as Response;

		expect(response.status).toBe(200);
		expect(ctx.locals.user).toEqual({ id: 1, username: "admin" });
	});

	test("works as @bunary/http middleware end to end", async () => {
		const app = await bootApp(basicConfig);
		const http = createHttpApp<RequiredAuthLocals>();
		http.use(requireAuth<RequiredAuthLocals>({ app }));
		http.get("/me", (ctx) => ({ id: ctx.locals.user.id }));

		const ok = await http.fetch(
			new Request("http://localhost/me", {
				headers: basicHeader("admin", "s3cret"),
			}),
		);
		expect(ok.status).toBe(200);
		expect(await ok.json()).toEqual({ id: 1 });

		const denied = await http.fetch(
			new Request("http://localhost/me", {
				headers: basicHeader("admin", "wrong"),
			}),
		);
		expect(denied.status).toBe(401);
	});

	test("optional variant types user as nullable", async () => {
		const app = await bootApp(basicConfig);
		const http = createHttpApp<AuthUserLocals>();
		http.use(authMiddleware<AuthUserLocals>({ app }));
		http.get("/me", (ctx) => ({ guest: ctx.locals.user === null }));

		const response = await http.fetch(new Request("http://localhost/me"));
		expect(await response.json()).toEqual({ guest: true });
	});
});
