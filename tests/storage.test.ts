import { describe, expect, test } from "bun:test";
import { createCookieStorage } from "../src/storage.js";

describe("AuthStorage (cookie-first)", () => {
	test("get() returns null when cookie is missing", async () => {
		const storage = createCookieStorage({ cookiePrefix: "bunary_" });
		const request = new Request("http://localhost/", { headers: {} });

		expect(storage.get(request, "oauth_state")).toBeNull();
	});

	test("set() writes a Set-Cookie header and get() can read it back from a subsequent request", async () => {
		const storage = createCookieStorage({ cookiePrefix: "bunary_" });
		const response = new Response("ok");

		await storage.set(response, "oauth_state", "abc123");
		const setCookie = response.headers.get("set-cookie");
		expect(setCookie).toContain("bunary_oauth_state=");

		// Extract just the name=value part (before first semicolon) to simulate real Cookie header
		const cookieValue = setCookie?.split(";")[0] ?? "";
		const nextRequest = new Request("http://localhost/", {
			headers: { cookie: cookieValue },
		});
		expect(storage.get(nextRequest, "oauth_state")).toBe("abc123");
	});

	test("clear() expires the cookie", async () => {
		const storage = createCookieStorage({ cookiePrefix: "bunary_" });
		const response = new Response("ok");

		await storage.clear(response, "oauth_state");
		const setCookie = response.headers.get("set-cookie");
		expect(setCookie).toContain("bunary_oauth_state=");
		expect(setCookie?.toLowerCase()).toContain("max-age=0");
	});

	test("set() supports ttlSeconds option", async () => {
		const storage = createCookieStorage({ cookiePrefix: "bunary_" });
		const response = new Response("ok");

		await storage.set(response, "oauth_state", "abc123", { ttlSeconds: 60 });
		const setCookie = response.headers.get("set-cookie");
		expect(setCookie?.toLowerCase()).toContain("max-age=60");
	});

	test("get() handles malformed percent-encoding gracefully (falls back to raw value)", () => {
		const storage = createCookieStorage({ cookiePrefix: "bunary_" });
		// Cookie with invalid percent-encoding (stray %)
		const request = new Request("http://localhost/", {
			headers: { cookie: "bunary_oauth_state=abc%xyz" },
		});

		// Should not throw; should return raw value
		expect(() => storage.get(request, "oauth_state")).not.toThrow();
		expect(storage.get(request, "oauth_state")).toBe("abc%xyz");
	});

	test("set() omits Max-Age when ttlSeconds is NaN", () => {
		const storage = createCookieStorage({ cookiePrefix: "bunary_" });
		const response = new Response("ok");

		storage.set(response, "oauth_state", "abc123", {
			ttlSeconds: Number.NaN,
		});
		const setCookie = response.headers.get("set-cookie");
		expect(setCookie).toContain("bunary_oauth_state=");
		expect(setCookie?.toLowerCase()).not.toContain("max-age");
	});

	test("set() omits Max-Age when ttlSeconds is Infinity", () => {
		const storage = createCookieStorage({ cookiePrefix: "bunary_" });
		const response = new Response("ok");

		storage.set(response, "oauth_state", "abc123", {
			ttlSeconds: Number.POSITIVE_INFINITY,
		});
		const setCookie = response.headers.get("set-cookie");
		expect(setCookie).toContain("bunary_oauth_state=");
		expect(setCookie?.toLowerCase()).not.toContain("max-age");
	});

	test("sameSite: 'none' automatically sets secure: true (browser requirement)", () => {
		const storage = createCookieStorage({
			cookiePrefix: "bunary_",
			sameSite: "none",
			secure: false, // Explicitly set to false
		});
		const response = new Response("ok");

		storage.set(response, "oauth_state", "abc123");
		const setCookie = response.headers.get("set-cookie");
		expect(setCookie?.toLowerCase()).toContain("samesite=none");
		expect(setCookie?.toLowerCase()).toContain("secure");
	});

	test("rejects cookie names with invalid characters", () => {
		const storage = createCookieStorage();
		const response = new Response("ok");
		for (const key of ["a;b", "a=b", "a\r\nSet-Cookie: x=y", "a b", "a,b"]) {
			expect(() => storage.set(response, key, "v")).toThrow();
			expect(() => storage.clear(response, key)).toThrow();
			expect(() =>
				storage.get(new Request("http://localhost/"), key),
			).toThrow();
		}
		expect(response.headers.get("set-cookie")).toBeNull();
	});

	test("rejects invalid cookiePrefix", () => {
		expect(() =>
			createCookieStorage({ cookiePrefix: "x; Domain=evil.com;" }),
		).toThrow();
		expect(() => createCookieStorage({ cookiePrefix: "a\nb" })).toThrow();
	});

	test("rejects invalid path", () => {
		for (const path of ["/; Domain=evil.com", "/\r\nX: y", "/\x00", "/\x7f"]) {
			expect(() => createCookieStorage({ path })).toThrow();
		}
		expect(() => createCookieStorage({ path: "/app/sub" })).not.toThrow();
	});

	test("get() unquotes quoted cookie values", () => {
		const storage = createCookieStorage();
		const request = new Request("http://localhost/", {
			headers: { cookie: 'bunary_a="hello"; bunary_b="x%20y"; bunary_c=""' },
		});
		expect(storage.get(request, "a")).toBe("hello");
		expect(storage.get(request, "b")).toBe("x y");
		expect(storage.get(request, "c")).toBe("");
	});
});
