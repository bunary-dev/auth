import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pkg from "../package.json";

const root = join(import.meta.dir, "..");

describe("0.4.0 release baseline", () => {
	test("package version is 0.4.0", () => {
		expect(pkg.version).toBe("0.4.0");
	});

	test("@bunary/core is an optional ^0.4.0 peer", () => {
		expect(pkg.peerDependencies["@bunary/core"]).toBe("^0.4.0");
		expect(pkg.peerDependenciesMeta["@bunary/core"]).toEqual({
			optional: true,
		});
	});

	test("bunary dev dependencies come from npm at ^0.4.0", () => {
		expect(pkg.devDependencies["@bunary/core"]).toBe("^0.4.0");
		expect(pkg.devDependencies["@bunary/http"]).toBe("^0.4.0");
		expect(existsSync(join(root, "vendor"))).toBe(false);
	});

	test("tests run against the 0.4.0 bunary packages", () => {
		for (const name of ["core", "http"]) {
			const installed = JSON.parse(
				readFileSync(
					join(root, "node_modules/@bunary", name, "package.json"),
					"utf8",
				),
			);
			expect(installed.version).toMatch(/^0\.4\./);
		}
	});

	test("CHANGELOG has a 0.4.0 release under an empty [Unreleased]", () => {
		const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
		expect(changelog).toMatch(
			/## \[Unreleased\]\s+## \[0\.4\.0\] - \d{4}-\d{2}-\d{2}/,
		);
	});

	test("docs install @bunary/auth@^0.4.0 and name no pre-release as current", () => {
		for (const file of ["README.md", "docs/index.md"]) {
			const text = readFileSync(join(root, file), "utf8");
			expect(text).toContain("bun add @bunary/auth@^0.4.0");
			expect(text).not.toMatch(/bun add @bunary\/auth(?!@\^0\.4\.0)/);
			expect(text).not.toContain("1.0.0-rc");
			expect(text).not.toMatch(/@bunary\/http`? (≥ )?(0\.3|1\.0)/);
		}
	});

	// prepack builds dist/, so a pack (or npm publish) from a clean checkout
	// still ships the entry points.
	test("pack builds and lists only dist, README, CHANGELOG and LICENSE", () => {
		const result = Bun.spawnSync(["bun", "pm", "pack", "--dry-run"], {
			cwd: root,
		});
		const output = result.stdout.toString() + result.stderr.toString();
		const files = [...output.matchAll(/^packed\s+\S+\s+(\S+)$/gm)].map(
			([, file = ""]) => file,
		);
		expect(files.length).toBeGreaterThan(0);
		for (const file of files) {
			expect(file).toMatch(
				/^(dist\/.+|README\.md|CHANGELOG\.md|LICENSE|package\.json)$/,
			);
		}
		for (const file of [
			"LICENSE",
			"dist/index.js",
			"dist/index.d.ts",
			"dist/provider.js",
			"dist/provider.d.ts",
		]) {
			expect(files).toContain(file);
		}
	}, 60_000);
});
