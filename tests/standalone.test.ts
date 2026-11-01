import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Application } from "@bunary/core";
import {
	createRouter,
	type Middleware,
	type RequestContext,
} from "@bunary/http";
import { createAuth } from "../src/appScoped.js";
import { createBasicGuard } from "../src/guards/basic.js";
import { createSessionGuard } from "../src/guards/session.js";
import {
	type AuthAppRequestContext,
	authMiddleware,
	type RequiredAuthLocals,
	requireAuth,
} from "../src/provider.js";
import type {
	AuthCookieJar,
	AuthLocals,
	AuthMiddleware,
	AuthRequestContext,
	CookieOptions,
} from "../src/types.js";
import {
	cookieHeaderFrom,
	createMemoryProvider,
	SESSION_SECRET,
} from "./helpers.js";

// Type-level checks: compiled by `bun run typecheck`, never called.
type Equals<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
const assertType = <T extends true>(_: T) => {};

function typeChecks() {
	// @bunary/http's RequestContext is an AuthRequestContext without casts
	const httpCtx = {} as RequestContext<AuthLocals>;
	const authCtx: AuthRequestContext<AuthLocals> = httpCtx;
	const appCtx: AuthAppRequestContext<AuthLocals> = httpCtx;
	void authCtx;
	void appCtx;

	// createAuth / authMiddleware / requireAuth are http Middleware
	const config = { defaultGuard: "t", guards: {} };
	const a: Middleware<AuthLocals> = createAuth<AuthLocals>(config);
	const b: Middleware = authMiddleware();
	const c: Middleware<RequiredAuthLocals> = requireAuth<RequiredAuthLocals>();
	void [a, b, c];
	const app = createRouter<AuthLocals>();
	app.use(createAuth<AuthLocals>(config));
	app.use(authMiddleware<AuthLocals>());

	// A jar shaped like @bunary/http's ctx.cookies, whose options are wider
	interface HttpCookieSerializeOptions extends CookieOptions {
		priority?: "low" | "medium" | "high";
	}
	interface HttpCookieJar {
		get(name: string): string | undefined;
		set(
			name: string,
			value: string,
			options?: HttpCookieSerializeOptions,
		): void;
		delete(name: string, options?: HttpCookieSerializeOptions): void;
		has(name: string): boolean;
		toSetCookieHeaders(): string[];
	}
	const httpJar = {} as HttpCookieJar;
	const jar: AuthCookieJar = httpJar;
	void jar;
	const ctxWithCookies = {} as RequestContext<AuthLocals> & {
		cookies: HttpCookieJar;
		app: Application;
	};
	const withCookies: AuthAppRequestContext<AuthLocals> = ctxWithCookies;
	void withCookies;

	// The middleware type is spelled in auth's own terms
	assertType<
		Equals<
			ReturnType<typeof createAuth<AuthLocals>>,
			AuthMiddleware<AuthRequestContext<AuthLocals>>
		>
	>(true);
}
void typeChecks;

function plainJar(cookieHeader = "") {
	const sent = new Map(
		cookieHeader
			.split("; ")
			.filter(Boolean)
			.map((pair) => pair.split("=") as [string, string]),
	);
	const writes: { name: string; value: string; options?: CookieOptions }[] = [];
	const jar: AuthCookieJar = {
		get: (name) => sent.get(name),
		set: (name, value, options) => writes.push({ name, value, options }),
		delete: (name, options) => writes.push({ name, value: "", options }),
	};
	return { jar, writes };
}

describe("standalone (no @bunary/http)", () => {
	test("createAuth runs against a hand-written context and cookie jar", async () => {
		const provider = await createMemoryProvider();
		const middleware = createAuth<AuthLocals>({
			defaultGuard: "session",
			guards: {
				session: createSessionGuard({ provider, secret: SESSION_SECRET }),
			},
		});

		const login = plainJar();
		const ctx: AuthRequestContext<AuthLocals> = {
			request: new Request("http://localhost/login"),
			cookies: login.jar,
			locals: {} as AuthLocals,
		};
		const res = await middleware(ctx, async () => {
			await ctx.locals.auth.attempt({
				email: "ada@example.com",
				password: "correct horse",
			});
			return new Response("ok");
		});
		// Writes go to the provided jar, not to the response
		expect((res as Response).headers.get("set-cookie")).toBeNull();
		expect(login.writes).toHaveLength(1);
		const [write] = login.writes;
		expect(write?.options?.httpOnly).toBe(true);

		const next = plainJar(`${write?.name}=${write?.value}`);
		const ctx2: AuthRequestContext<AuthLocals> = {
			request: new Request("http://localhost/me"),
			cookies: next.jar,
			locals: {} as AuthLocals,
		};
		await middleware(ctx2, async () => {
			expect(await ctx2.locals.auth.authenticate()).toMatchObject({ id: 1 });
			return new Response("ok");
		});
	});

	test("without ctx.cookies the queued Set-Cookie lands on the response", async () => {
		const provider = await createMemoryProvider();
		const middleware = createAuth<AuthLocals>({
			defaultGuard: "session",
			guards: {
				session: createSessionGuard({ provider, secret: SESSION_SECRET }),
			},
		});
		const ctx = {
			request: new Request("http://localhost/login"),
			locals: {} as AuthLocals,
		};
		const res = (await middleware(ctx, async () => {
			await ctx.locals.auth.attempt({
				email: "ada@example.com",
				password: "correct horse",
			});
			return { ok: true };
		})) as Response;
		expect(await res.json()).toEqual({ ok: true });
		expect(cookieHeaderFrom(res.headers.getSetCookie())).toContain("=");
	});
});

describe("with @bunary/http", () => {
	test("app.use(authMiddleware()) and createAuth() work end to end", async () => {
		const app = createRouter<AuthLocals>();
		app.use(
			createAuth<AuthLocals>({
				defaultGuard: "basic",
				guards: {
					basic: createBasicGuard({
						verify: (u, p) => (u === "a" && p === "b" ? { id: 1 } : null),
					}),
				},
			}),
		);
		app.get("/me", async (ctx) => ({
			user: await ctx.locals.auth.authenticate(),
		}));

		const res = await app.fetch(
			new Request("http://localhost/me", {
				headers: { Authorization: `Basic ${btoa("a:b")}` },
			}),
		);
		expect(await res.json()).toEqual({ user: { id: 1 } });
	});
});

describe("source and build", () => {
	const root = resolve(import.meta.dir, "..");

	function sources(dir: string): string[] {
		return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
			entry.isDirectory()
				? sources(join(dir, entry.name))
				: [join(dir, entry.name)],
		);
	}

	function importsPackage(code: string, pkg: string): boolean {
		const stripped = code
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/^\s*\/\/.*$/gm, "");
		return stripped.includes(`"${pkg}"`) || stripped.includes(`'${pkg}'`);
	}

	test("src/ never imports @bunary/http", () => {
		for (const file of sources(join(root, "src"))) {
			expect(importsPackage(readFileSync(file, "utf8"), "@bunary/http")).toBe(
				false,
			);
		}
	});

	test("only src/provider.ts imports @bunary/core", () => {
		for (const file of sources(join(root, "src"))) {
			if (file.endsWith("provider.ts")) continue;
			expect(importsPackage(readFileSync(file, "utf8"), "@bunary/core")).toBe(
				false,
			);
		}
	});

	test("@bunary/http is not a peer dependency", () => {
		const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
		expect(pkg.peerDependencies).not.toHaveProperty("@bunary/http");
		expect(pkg.peerDependenciesMeta ?? {}).not.toHaveProperty("@bunary/http");
		expect(pkg.peerDependenciesMeta["@bunary/core"]).toEqual({
			optional: true,
		});
	});
});
