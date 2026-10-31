import { describe, expect, test } from "bun:test";
import { createApp } from "@bunary/http";
import { createAuth } from "../src/appScoped.js";
import { createCookieJar } from "../src/cookies.js";
import { createSessionGuard } from "../src/guards/session.js";
import type { AuthLocals, CookieJar } from "../src/types.js";
import {
	cookieHeaderFrom,
	createMemoryProvider,
	SESSION_SECRET,
} from "./helpers.js";

describe("createCookieJar()", () => {
	test("reads cookies from the request", () => {
		const jar = createCookieJar(
			new Request("http://localhost/", {
				headers: { cookie: "a=1; b=x%20y" },
			}),
		);
		expect(jar.get("a")).toBe("1");
		expect(jar.get("b")).toBe("x y");
		expect(jar.get("missing")).toBeUndefined();
		expect(jar.headers()).toEqual([]);
	});

	test("queues Set-Cookie values for set() and delete()", () => {
		const jar = createCookieJar(new Request("http://localhost/"));
		jar.set("s", "v", {
			httpOnly: true,
			sameSite: "lax",
			path: "/",
			maxAge: 5,
		});
		jar.delete("s", { path: "/" });
		const [set, del] = jar.headers();
		expect(set).toContain("s=v");
		expect(set).toContain("HttpOnly");
		expect(del).toContain("Max-Age=0");
	});

	test("rejects cookie names that are not RFC 6265 tokens", () => {
		const jar = createCookieJar(new Request("http://localhost/"));
		for (const name of ["a;b", "a=b", "a\r\nSet-Cookie: x=y", "a b", "a,b"]) {
			expect(() => jar.set(name, "v")).toThrow();
			expect(() => jar.delete(name)).toThrow();
		}
		expect(jar.headers()).toEqual([]);
	});
});

describe("createAuth() with the session guard", () => {
	async function makeApp(jarFactory?: (req: Request) => CookieJar) {
		const provider = await createMemoryProvider();
		const app = createApp<AuthLocals>();
		if (jarFactory) {
			// Simulates @bunary/http >= 1.0, which provides ctx.cookies
			app.use(async (ctx, next) => {
				(ctx as unknown as { cookies: CookieJar }).cookies = jarFactory(
					ctx.request,
				);
				return await next();
			});
		}
		app.use(
			createAuth<AuthLocals>({
				defaultGuard: "session",
				guards: {
					session: createSessionGuard({ provider, secret: SESSION_SECRET }),
				},
			}),
		);
		app.post("/login", async (ctx) => {
			const body = await ctx.json<Record<string, unknown>>();
			const result = await ctx.locals.auth.attempt(body);
			if (!result) return new Response("nope", { status: 401 });
			return { id: result.user.id };
		});
		app.get("/me", async (ctx) => {
			const user = await ctx.locals.auth.authenticate();
			return user ? { id: user.id } : new Response(null, { status: 401 });
		});
		app.post("/logout", async (ctx) => {
			await ctx.locals.auth.logout();
			return Response.redirect("http://localhost/", 302);
		});
		return app;
	}

	test("without ctx.cookies, queued cookies are appended to the response", async () => {
		const app = await makeApp();
		const login = await app.fetch(
			new Request("http://localhost/login", {
				method: "POST",
				body: JSON.stringify({
					email: "ada@example.com",
					password: "correct horse",
				}),
				headers: { "Content-Type": "application/json" },
			}),
		);
		expect(login.status).toBe(200);
		expect(await login.json()).toEqual({ id: 1 });
		const setCookies = login.headers.getSetCookie();
		expect(setCookies).toHaveLength(1);
		expect(setCookies[0]).toContain("HttpOnly");

		const me = await app.fetch(
			new Request("http://localhost/me", {
				headers: { cookie: cookieHeaderFrom(setCookies) },
			}),
		);
		expect(await me.json()).toEqual({ id: 1 });

		// Immutable redirect responses still get the clearing cookie
		const logout = await app.fetch(
			new Request("http://localhost/logout", {
				method: "POST",
				headers: { cookie: cookieHeaderFrom(setCookies) },
			}),
		);
		expect(logout.status).toBe(302);
		expect(logout.headers.get("location")).toBe("http://localhost/");
		expect(logout.headers.getSetCookie()[0]).toContain("Max-Age=0");
	});

	test("a failed attempt sets no cookie", async () => {
		const app = await makeApp();
		const res = await app.fetch(
			new Request("http://localhost/login", {
				method: "POST",
				body: JSON.stringify({ email: "ada@example.com", password: "bad" }),
				headers: { "Content-Type": "application/json" },
			}),
		);
		expect(res.status).toBe(401);
		expect(res.headers.getSetCookie()).toEqual([]);
	});

	test("uses ctx.cookies when the app provides it, without appending itself", async () => {
		const jars: ReturnType<typeof createCookieJar>[] = [];
		const app = await makeApp((req) => {
			const jar = createCookieJar(req);
			jars.push(jar);
			return jar;
		});
		const res = await app.fetch(
			new Request("http://localhost/login", {
				method: "POST",
				body: JSON.stringify({
					email: "ada@example.com",
					password: "correct horse",
				}),
				headers: { "Content-Type": "application/json" },
			}),
		);
		expect(res.status).toBe(200);
		// The app's own jar got the cookie; appending is the app's job
		expect(res.headers.getSetCookie()).toEqual([]);
		expect(jars[0]?.headers()).toHaveLength(1);
	});

	test("non-Response results are converted when cookies are queued", async () => {
		const provider = await createMemoryProvider();
		const app = createApp<AuthLocals>();
		app.use(
			createAuth<AuthLocals>({
				defaultGuard: "session",
				guards: {
					session: createSessionGuard({ provider, secret: SESSION_SECRET }),
				},
			}),
		);
		app.get("/text", async (ctx) => {
			await ctx.locals.auth.login({ id: 1 });
			return "hi";
		});
		app.get("/empty", async (ctx) => {
			await ctx.locals.auth.login({ id: 1 });
			return null;
		});
		const text = await app.fetch(new Request("http://localhost/text"));
		expect(await text.text()).toBe("hi");
		expect(text.headers.get("content-type")).toContain("text/plain");
		expect(text.headers.getSetCookie()).toHaveLength(1);
		const empty = await app.fetch(new Request("http://localhost/empty"));
		expect(empty.status).toBe(204);
		expect(empty.headers.getSetCookie()).toHaveLength(1);
	});
});
