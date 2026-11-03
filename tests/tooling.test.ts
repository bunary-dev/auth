import { describe, expect, test } from "bun:test";
import biomeConfig from "../biome.json";
import biomePackage from "../node_modules/@biomejs/biome/package.json";

// Spawning `bun run lint` can exceed bun's default 5 s test timeout on a
// cold or busy CI runner (#102).
const LINT_TIMEOUT_MS = 30_000;

describe("tooling", () => {
	test("biome.json schema matches the installed biome version", () => {
		expect(biomeConfig.$schema).toBe(
			`https://biomejs.dev/schemas/${biomePackage.version}/schema.json`,
		);
	});

	test(
		"bun run lint passes",
		() => {
			const result = Bun.spawnSync(["bun", "run", "lint"], {
				cwd: `${import.meta.dir}/..`,
			});
			expect(result.stderr.toString() + result.stdout.toString()).not.toContain(
				"biome migrate",
			);
			expect(result.exitCode).toBe(0);
		},
		LINT_TIMEOUT_MS,
	);
});
