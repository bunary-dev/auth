import { describe, expect, test } from "bun:test";
import * as pkg from "../src/index.js";

describe("package exports", () => {
	test("exposes the guard API", () => {
		expect(Object.keys(pkg).sort()).toEqual([
			"createAuth",
			"createAuthManager",
			"createBasicGuard",
			"createJwtGuard",
		]);
	});

	test.each([
		"auth",
		"setAuthManager",
		"getAuthManager",
		"clearAuthManager",
		"installAuthPlugin",
		"createCookieStorage",
	])("no longer exports %s", (name) => {
		expect(pkg).not.toHaveProperty(name);
	});
});
