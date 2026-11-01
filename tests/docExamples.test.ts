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

/**
 * The examples target `@bunary/http` 1.0 (the version whose routers set
 * `ctx.app` under `httpProvider()`), but the dev dependency is still 0.3.
 * These lists mirror http 1.0.0-rc.1's `src/index.ts` and `src/provider.ts`
 * (runtime exports and the types an example would plausibly import). 1.0
 * has no `createApp`: the app comes from `@bunary/core`.
 */
const http = new Set([
	"createCookieJar",
	"cors",
	"createRouter",
	"BodyParseError",
	"html",
	"json",
	"redirect",
	"status",
	"text",
	"abort",
	"HttpError",
	"isHttpError",
	"problem",
	"problemResponse",
	"rateLimit",
	"Resource",
	"toResponse",
	"serveStatic",
	"sse",
	"CookieJar",
	"HttpConfig",
	"Middleware",
	"RequestContext",
	"Router",
	"RouterOptions",
]);
const httpProvider = new Set(["httpProvider", "RouterToken", "serve"]);

const packages: Record<string, Set<string>> = {
	"@bunary/auth": exportedNames(join(root, "src/index.ts")),
	"@bunary/auth/provider": exportedNames(join(root, "src/provider.ts")),
	"@bunary/core": exportedNames(
		join(root, "node_modules/@bunary/core/dist/index.d.ts"),
	),
	"@bunary/http": http,
	"@bunary/http/provider": httpProvider,
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

	// Core's createApp takes no locals type; a typed app is http 0.3's
	// createApp, which http 1.0 replaced with createRouter<TLocals>().
	test("never call createApp with a locals type argument", () => {
		const wrong = all
			.filter(({ text }) => /\bcreateApp</.test(text))
			.map(({ where }) => where);
		expect(wrong).toEqual([]);
	});
});
