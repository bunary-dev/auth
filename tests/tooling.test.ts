import { describe, expect, test } from "bun:test";
import biomeConfig from "../biome.json";
import biomePackage from "../node_modules/@biomejs/biome/package.json";

describe("tooling", () => {
	test("biome.json schema matches the installed biome version", () => {
		expect(biomeConfig.$schema).toBe(
			`https://biomejs.dev/schemas/${biomePackage.version}/schema.json`,
		);
	});

	test("bun run lint passes", () => {
		const result = Bun.spawnSync(["bun", "run", "lint"], {
			cwd: `${import.meta.dir}/..`,
		});
		expect(result.stderr.toString() + result.stdout.toString()).not.toContain(
			"biome migrate",
		);
		expect(result.exitCode).toBe(0);
	});
});
