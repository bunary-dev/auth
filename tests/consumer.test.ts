import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Builds the package into a temp dir and typechecks/runs consumers against
// the shipped dist, with and without the optional @bunary/core and
// @bunary/orm peers.

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
	withOrm = false,
) {
	const dir = join(work, name);
	const nm = join(dir, "node_modules");
	cpSync(join(work, "pkg"), join(nm, "@bunary", "auth"), { recursive: true });
	link(join(modules, "@bunary", "http"), join(nm, "@bunary", "http"));
	link(join(modules, "jose"), join(nm, "jose"));
	link(join(modules, "@types"), join(nm, "@types"));
	link(join(modules, "bun-types"), join(nm, "bun-types"));
	link(join(modules, "undici-types"), join(nm, "undici-types"));
	if (withCore) {
		link(join(modules, "@bunary", "core"), join(nm, "@bunary", "core"));
		link(join(modules, "@standard-schema"), join(nm, "@standard-schema"));
	}
	if (withOrm) {
		link(join(modules, "@bunary", "orm"), join(nm, "@bunary", "orm"));
		link(join(modules, "drizzle-orm"), join(nm, "drizzle-orm"));
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
				// drizzle-orm 0.45 own .d.ts files fail lib checking
				skipLibCheck: withOrm,
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
			"./src/orm.ts",
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

describe("built package", () => {
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
	test("orm entry fails with a clear error without @bunary/orm, main entry still loads", () => {
		const dir = consumer("no-orm", false, {
			"main.ts": `
import { createBasicGuard } from "@bunary/auth";
console.log(createBasicGuard({ verify: () => null }).name);
`,
			"orm.ts": `
try {
	await import("@bunary/auth/orm");
	console.log("loaded");
} catch (error) {
	console.log((error as Error).message);
}
`,
		});
		expect(run(["bun", "main.ts"], dir).output.trim()).toBe("basic");
		expect(run(["bun", "orm.ts"], dir).output.trim()).toBe(
			"@bunary/auth/orm requires @bunary/orm, which is not installed. Install it with: bun add @bunary/orm",
		);
	}, 30_000);

	test("orm entry typechecks and runs with @bunary/orm", () => {
		const dir = consumer(
			"with-orm",
			false,
			{
				"index.ts": `
import { Database } from "bun:sqlite";
import { defineModel } from "@bunary/orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { ormUserProvider } from "@bunary/auth/orm";

const users = sqliteTable("users", {
	id: integer().primaryKey({ autoIncrement: true }),
	email: text().notNull(),
	password: text().notNull(),
});
const sqlite = new Database(":memory:");
sqlite.run("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, password TEXT NOT NULL)");
const User = defineModel(drizzle({ client: sqlite }), users, { hidden: ["password"] });
await User.create({ email: "ada@example.com", password: await Bun.password.hash("secret") });

const provider = ormUserProvider(User, { identifier: "email" });
// @ts-expect-error not a column
void (() => ormUserProvider(User, { identifier: "login" }));
const user = await provider.retrieveByCredentials({ email: "ada@example.com" });
const email: string | undefined = user?.email;
const ok = user ? await provider.validateCredentials(user, { password: "secret" }) : false;
console.log(email, ok);
`,
			},
			true,
		);
		const types = run([process.execPath, tsc, "-p", "."], dir);
		expect(types.output).toBe("");
		expect(types.code).toBe(0);

		const exec = run(["bun", "index.ts"], dir);
		expect(exec.output.trim()).toBe("ada@example.com true");
	}, 30_000);
});
