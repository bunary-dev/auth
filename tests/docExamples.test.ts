import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

/** Names a module exports (values and types), read from its source or .d.ts. */
function exportedNames(file: string): Set<string> {
	const code = readFileSync(file, "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");
	const names = new Set<string>();
	for (const [, list = ""] of code.matchAll(
		/export\s+(?:type\s+)?\{([^}]*)\}/g,
	)) {
		for (const spec of list.split(",")) {
			const name = spec
				.trim()
				.replace(/^type\s+/, "")
				.split(/\s+as\s+/)
				.pop();
			if (name) names.add(name);
		}
	}
	for (const [, name = ""] of code.matchAll(
		/export\s+(?:declare\s+)?(?:const|function|interface|type|class)\s+(\w+)/g,
	)) {
		names.add(name);
	}
	return names;
}

const packages: Record<string, Set<string>> = {
	"@bunary/auth": exportedNames(join(root, "src/index.ts")),
	"@bunary/auth/provider": exportedNames(join(root, "src/provider.ts")),
	"@bunary/core": exportedNames(
		join(root, "node_modules/@bunary/core/dist/index.d.ts"),
	),
	"@bunary/http": exportedNames(
		join(root, "node_modules/@bunary/http/dist/index.d.ts"),
	),
	"@bunary/http/provider": exportedNames(
		join(root, "node_modules/@bunary/http/dist/provider.d.ts"),
	),
	jose: exportedNames(join(root, "node_modules/jose/dist/types/index.d.ts")),
};

function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? sources(join(dir, entry.name))
			: [join(dir, entry.name)],
	);
}

type ExampleImport = { where: string; name: string; from: string };

/** `import { a, type B } from "pkg"` statements in an example's text. */
function importsIn(text: string, where: string): ExampleImport[] {
	const found: ExampleImport[] = [];
	for (const [, list = "", from = ""] of text.matchAll(
		/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g,
	)) {
		for (const spec of list.split(",")) {
			const name = spec
				.replace(/\*/g, "")
				.trim()
				.replace(/^type\s+/, "")
				.split(/\s+as\s+/)[0];
			if (name) found.push({ where, name, from });
		}
	}
	return found;
}

type Example = { where: string; text: string };

/** JSDoc comments in src/ and ```ts blocks in README.md and docs/index.md. */
function examples(): Example[] {
	const found: Example[] = [];
	for (const file of sources(join(root, "src"))) {
		for (const [text] of readFileSync(file, "utf8").matchAll(
			/\/\*\*[\s\S]*?\*\//g,
		)) {
			found.push({ where: file, text });
		}
	}
	for (const file of ["README.md", "docs/index.md"]) {
		for (const [text] of readFileSync(join(root, file), "utf8").matchAll(
			/```ts[\s\S]*?```/g,
		)) {
			found.push({ where: file, text });
		}
	}
	return found;
}

describe("doc and JSDoc examples", () => {
	const all = examples();
	const imports = all.flatMap(({ where, text }) => importsIn(text, where));

	test("finds the examples' imports", () => {
		expect(imports.length).toBeGreaterThan(20);
	});

	test("import each symbol from a package that exports it", () => {
		const wrong = imports
			.filter(({ name, from }) => !packages[from]?.has(name))
			.map(({ where, name, from }) => `${where}: ${name} from ${from}`);
		expect(wrong).toEqual([]);
	});

	test("import createApp from @bunary/core", () => {
		const createApp = imports.filter(({ name }) => name === "createApp");
		expect(createApp.length).toBeGreaterThan(0);
		for (const { from } of createApp) expect(from).toBe("@bunary/core");
	});

	// Core's createApp takes no locals type; a typed router is http's
	// createRouter<TLocals>().
	test("never call createApp with a locals type argument", () => {
		const wrong = all
			.filter(({ text }) => /\bcreateApp</.test(text))
			.map(({ where }) => where);
		expect(wrong).toEqual([]);
	});
});
