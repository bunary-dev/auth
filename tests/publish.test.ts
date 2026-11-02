import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pkg from "../package.json";

const root = join(import.meta.dir, "..");
const scripts: Record<string, string | undefined> = pkg.scripts;

describe("clean rebuild on publish", () => {
	test("clean removes dist", () => {
		expect(scripts.clean).toBe("rm -rf dist");
	});

	test("build starts with bun run clean", () => {
		expect(scripts.build?.startsWith("bun run clean && ")).toBe(true);
	});

	test("prepublishOnly runs clean, then build, then tests and typecheck", () => {
		const steps = scripts.prepublishOnly?.split(" && ") ?? [];
		expect(steps).toEqual([
			"bun run clean",
			"bun run build",
			"bun test",
			"bun run typecheck",
		]);
	});

	test("prepack is gone (prepublishOnly replaces it)", () => {
		expect(scripts.prepack).toBeUndefined();
	});

	test("build removes stale files from dist", () => {
		mkdirSync(join(root, "dist"), { recursive: true });
		const stale = join(root, "dist", "stale-file.js");
		writeFileSync(stale, "export const stale = true;\n");
		const result = Bun.spawnSync(["bun", "run", "build"], { cwd: root });
		expect(result.exitCode).toBe(0);
		expect(existsSync(stale)).toBe(false);
		expect(existsSync(join(root, "dist", "index.js"))).toBe(true);
	}, 60_000);
});
