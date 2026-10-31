import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Builds the package into a temp dir and typechecks/runs consumers against
// the shipped dist, with and without the optional @bunary/core peer and
// without @bunary/http.

const root = resolve(import.meta.dir, "..");
const modules = join(root, "node_modules");
const tsc = join(modules, ".bin", "tsc");
let work: string;

function run(cmd: string[], cwd: string) {
	const proc = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
	return {
		code: proc.exitCode,
		output: `${proc.stdout.toString()}${proc.stderr.toString()}`,
	};
}

function link(target: string, path: string) {
	mkdirSync(resolve(path, ".."), { recursive: true });
	symlinkSync(target, path);
}

/** A consumer project whose node_modules holds the built package and peers. */
function consumer(
	name: string,
	withCore: boolean,
	files: Record<string, string>,
	withHttp = true,
) {
	const dir = join(work, name);
	const nm = join(dir, "node_modules");
	cpSync(join(work, "pkg"), join(nm, "@bunary", "auth"), { recursive: true });
	if (withHttp) {
		link(join(modules, "@bunary", "http"), join(nm, "@bunary", "http"));
	}
	link(join(modules, "jose"), join(nm, "jose"));
	link(join(modules, "@types"), join(nm, "@types"));
	link(join(modules, "bun-types"), join(nm, "bun-types"));
	link(join(modules, "undici-types"), join(nm, "undici-types"));
	if (withCore) {
		link(join(modules, "@bunary", "core"), join(nm, "@bunary", "core"));
		link(join(modules, "@standard-schema"), join(nm, "@standard-schema"));
	}
	writeFileSync(
		join(dir, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				target: "ESNext",
				module: "Preserve",
				moduleResolution: "bundler",
				types: ["bun"],
				strict: true,
				noEmit: true,
				skipLibCheck: false,
			},
			include: ["*.ts"],
		}),
	);
	for (const [file, source] of Object.entries(files)) {
		writeFileSync(join(dir, file), source);
	}
	return dir;
}

beforeAll(() => {
	work = mkdtempSync(join(tmpdir(), "bunary-auth-consumer-"));
	const pkg = join(work, "pkg");
	const out = join(pkg, "dist");
	const build = run(
		[
			"bun",
			"build",
			"./src/index.ts",
			"./src/provider.ts",
			"--outdir",
			out,
			"--target",
			"bun",
			"--splitting",
			"--packages",
			"external",
		],
		root,
	);
	if (build.code !== 0) throw new Error(build.output);
	const dts = run(
		[process.execPath, tsc, "-p", "tsconfig.build.json", "--outDir", out],
		root,
	);
	if (dts.code !== 0) throw new Error(dts.output);
	cpSync(join(root, "package.json"), join(pkg, "package.json"));
}, 60_000);

afterAll(() => {
	rmSync(work, { recursive: true, force: true });
});

/** Whether code (comments stripped) names the package as a module specifier. */
function importsPackage(code: string, pkg: string): boolean {
	const stripped = code
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");
	return stripped.includes(`"${pkg}"`) || stripped.includes(`'${pkg}'`);
}

function distFiles(): string[] {
	const out = join(work, "pkg", "dist");
	return readdirSync(out, { recursive: true, encoding: "utf8" })
		.filter((file) => /\.(js|d\.ts)$/.test(file))
		.map((file) => join(out, file));
}

describe("built package", () => {
	test("no shipped file imports @bunary/http", () => {
		const files = distFiles();
		expect(files.length).toBeGreaterThan(0);
		for (const file of files) {
			expect(importsPackage(readFileSync(file, "utf8"), "@bunary/http")).toBe(
				false,
			);
		}
	});

	test("only the provider entry imports @bunary/core", () => {
		const files = distFiles();
		const provider = files.filter((f) => /[\\/]provider\.(js|d\.ts)$/.test(f));
		expect(provider).toHaveLength(2);
		for (const file of provider) {
			expect(importsPackage(readFileSync(file, "utf8"), "@bunary/core")).toBe(
				true,
			);
		}
		for (const file of files) {
			if (provider.includes(file)) continue;
			expect(importsPackage(readFileSync(file, "utf8"), "@bunary/core")).toBe(
				false,
			);
		}
	});

	test("main entry typechecks and runs without @bunary/http or @bunary/core", () => {
		const dir = consumer(
			"standalone",
			false,
			{
				"index.ts": `
import {
	createAuth,
	createBasicGuard,
	type AuthCookieJar,
	type AuthLocals,
	type AuthRequestContext,
} from "@bunary/auth";

const cookies: AuthCookieJar = {
	get: () => undefined,
	set: () => {},
	delete: () => {},
};
const middleware = createAuth<AuthLocals>({
	defaultGuard: "basic",
	guards: { basic: createBasicGuard({ verify: () => ({ id: 7 }) }) },
});
const ctx: AuthRequestContext<AuthLocals> = {
	request: new Request("http://x/", { headers: { Authorization: "Basic " + btoa("a:b") } }),
	cookies,
	locals: {} as AuthLocals,
};
const res = await middleware(ctx, async () => {
	const user = await ctx.locals.auth.authenticate();
	return new Response(String(user?.id));
});
console.log(await (res as Response).text());
`,
			},
			false,
		);
		const types = run([process.execPath, tsc, "-p", "."], dir);
		expect(types.output).toBe("");
		expect(types.code).toBe(0);

		const exec = run(["bun", "index.ts"], dir);
		expect(exec.output.trim()).toBe("7");
	}, 30_000);

	test("main entry typechecks without @bunary/core installed", () => {
		const dir = consumer("no-core", false, {
			"index.ts": `
import { createApp } from "@bunary/http";
import { createAuth, createBasicGuard, type AuthLocals } from "@bunary/auth";

const app = createApp<AuthLocals>();
app.use(createAuth<AuthLocals>({
	defaultGuard: "basic",
	guards: { basic: createBasicGuard({ verify: () => null }) },
}));
app.get("/", async (ctx) => ({ user: await ctx.locals.auth.authenticate() }));
`,
		});
		const result = run([process.execPath, tsc, "-p", "."], dir);
		expect(result.output).toBe("");
		expect(result.code).toBe(0);
	}, 30_000);

	test("provider entry augments BunaryConfig and runs with core", () => {
		const dir = consumer("with-core", true, {
			"index.ts": `
import { createApp, defineConfig } from "@bunary/core";
import { createBasicGuard } from "@bunary/auth";
import { AuthToken, authProvider, requireAuth } from "@bunary/auth/provider";

const config = defineConfig({
	app: { name: "consumer" },
	auth: {
		defaultGuard: "basic",
		guards: { basic: createBasicGuard({ verify: () => ({ id: 1 }) }) },
	},
});

const bad = defineConfig({
	app: { name: "consumer" },
	auth: {
		defaultGuard: "basic",
		guards: {},
		// @ts-expect-error unknown keys are type errors
		gaurd: "basic",
	},
});
void bad;

const app = await createApp({ config, providers: [authProvider] }).boot();
const name: string = app.get(AuthToken).guard().name;
const res = await requireAuth({ app })(
	{ request: new Request("http://x/"), params: {}, query: new URLSearchParams(), locals: {} } as never,
	async () => new Response("ok"),
);
console.log(name, (res as Response).status);
`,
		});
		const types = run([process.execPath, tsc, "-p", "."], dir);
		expect(types.output).toBe("");
		expect(types.code).toBe(0);

		const exec = run(["bun", "index.ts"], dir);
		expect(exec.output.trim()).toBe("basic 401");
	}, 30_000);
});
