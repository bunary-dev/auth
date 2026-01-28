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

		const nextRequest = new Request("http://localhost/", {
			headers: { cookie: setCookie ?? "" },
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
});
