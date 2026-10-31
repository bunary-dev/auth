import { describe, expect, test } from "bun:test";
import {
	type BunaryConfig,
	createApp,
	createToken,
	defineConfig,
	type Token,
} from "@bunary/core";
import { createBasicGuard } from "../src/guards/basic.js";
import { AuthToken } from "../src/provider.js";
import type { AuthConfig, AuthManagerInterface } from "../src/types.js";

// Type-level checks: these fail `bun run typecheck`, not `bun test`.

const guard = createBasicGuard({ verify: () => null });

describe("BunaryConfig augmentation", () => {
	test("defineConfig accepts an auth key", () => {
		const config = defineConfig({
			app: { name: "typed" },
			auth: { defaultGuard: "basic", guards: { basic: guard } },
		});
		const auth: AuthConfig | undefined = config.auth;
		expect(auth?.defaultGuard).toBe("basic");
	});

	test("auth is optional", () => {
		const config: BunaryConfig = { app: { name: "no-auth" } };
		expect(config.auth).toBeUndefined();
	});

	test("unknown or mistyped auth keys are type errors", () => {
		const typo: BunaryConfig = {
			app: { name: "typo" },
			auth: {
				defaultGuard: "basic",
				guards: { basic: guard },
				// @ts-expect-error unknown key in auth
				gaurds: {},
			},
		};
		const wrongType: BunaryConfig = {
			app: { name: "wrong-type" },
			auth: {
				// @ts-expect-error defaultGuard must be a string
				defaultGuard: 1,
				guards: { basic: guard },
			},
		};
		expect([typo, wrongType]).toHaveLength(2);
	});

	test("app.get(AuthToken) is typed as the manager", async () => {
		const app = await createApp({
			config: { app: { name: "typed" } },
		}).boot();
		const token: Token<AuthManagerInterface> = AuthToken;
		// @ts-expect-error AuthToken is not a Token<string>
		const wrong: Token<string> = AuthToken;
		expect(String(wrong)).toBe(String(token));
		expect(app.has(createToken("unrelated"))).toBe(false);
	});
});
