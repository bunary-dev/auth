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
});
