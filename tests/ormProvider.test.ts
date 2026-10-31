import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { defineModel } from "@bunary/orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createSessionGuard } from "../src/guards/session.js";
import { createAuthManager } from "../src/manager.js";
import { ormUserProvider } from "../src/orm.js";
import { loadPeer } from "../src/peer.js";

const users = sqliteTable("users", {
	id: integer().primaryKey({ autoIncrement: true }),
	email: text().notNull().unique(),
	username: text(),
	password: text().notNull(),
});

const hash = (password: string) =>
	Bun.password.hash(password, { algorithm: "bcrypt", cost: 4 });

function setup() {
	const sqlite = new Database(":memory:");
	sqlite.run(
		`CREATE TABLE users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT NOT NULL UNIQUE,
			username TEXT,
			password TEXT NOT NULL
		)`,
	);
	const db = drizzle({ client: sqlite });
	return defineModel(db, users, { hidden: ["password"] });
}

let User: ReturnType<typeof setup>;

beforeEach(async () => {
	User = setup();
	await User.create({
		email: "ada@example.com",
		username: "ada",
		password: await hash("correct horse"),
	});
	await User.create({
		email: "bob@example.com",
		username: "bob",
		password: await hash("hunter2"),
	});
});

describe("ormUserProvider", () => {
	test("retrieveById finds the user by primary key", async () => {
		const provider = ormUserProvider(User);
		const user = await provider.retrieveById(2);
		expect(user?.id).toBe(2);
		expect(user?.email).toBe("bob@example.com");
	});

	test("retrieveById returns null for an unknown id", async () => {
		const provider = ormUserProvider(User);
		expect(await provider.retrieveById(99)).toBeNull();
	});

	test("retrieveByCredentials looks up by email by default", async () => {
		const provider = ormUserProvider(User);
		const user = await provider.retrieveByCredentials({
			email: "ada@example.com",
			password: "whatever",
		});
		expect(user?.id).toBe(1);
	});

	test("retrieveByCredentials returns null for an unknown user", async () => {
		const provider = ormUserProvider(User);
		expect(
			await provider.retrieveByCredentials({
				email: "nobody@example.com",
				password: "correct horse",
			}),
		).toBeNull();
	});

	test("retrieveByCredentials returns null without the identifier", async () => {
		const provider = ormUserProvider(User);
		expect(await provider.retrieveByCredentials({})).toBeNull();
		expect(await provider.retrieveByCredentials({ email: null })).toBeNull();
		expect(
			await provider.retrieveByCredentials({ email: { $ne: "" } }),
		).toBeNull();
	});

	test("retrieveByCredentials never matches on the password column", async () => {
		const stored = (await User.findOrFail(1)).password;
		const provider = ormUserProvider(User);
		// Only the password is given: no lookup by it, even with the exact hash.
		expect(await provider.retrieveByCredentials({ password: stored })).toBe(
			null,
		);
		// The identifier decides; a mismatching password does not narrow it.
		const user = await provider.retrieveByCredentials({
			email: "bob@example.com",
			password: stored,
		});
		expect(user?.id).toBe(2);
	});

	test("validateCredentials verifies the password with Bun.password", async () => {
		const provider = ormUserProvider(User);
		const user = await provider.retrieveById(1);
		if (!user) throw new Error("missing user");
		expect(
			await provider.validateCredentials(user, { password: "correct horse" }),
		).toBe(true);
	});

	test("validateCredentials rejects a wrong or missing password", async () => {
		const provider = ormUserProvider(User);
		const user = await provider.retrieveById(1);
		if (!user) throw new Error("missing user");
		expect(
			await provider.validateCredentials(user, { password: "hunter2" }),
		).toBe(false);
		expect(await provider.validateCredentials(user, {})).toBe(false);
		expect(await provider.validateCredentials(user, { password: 1 })).toBe(
			false,
		);
	});

	test("validateCredentials is false for a malformed stored hash", async () => {
		const plain = await User.create({
			email: "plain@example.com",
			password: "not-a-hash",
		});
		if (!plain) throw new Error("not created");
		const provider = ormUserProvider(User);
		const user = await provider.retrieveById(plain.id);
		if (!user) throw new Error("missing user");
		expect(
			await provider.validateCredentials(user, { password: "not-a-hash" }),
		).toBe(false);
	});

	test("identifier and password options pick other columns", async () => {
		const provider = ormUserProvider(User, {
			identifier: "username",
			password: "password",
		});
		const user = await provider.retrieveByCredentials({ username: "ada" });
		expect(user?.id).toBe(1);
		expect(
			await provider.retrieveByCredentials({ email: "ada@example.com" }),
		).toBeNull();
	});

	test("throws for options that are not columns or are the same", () => {
		expect(() =>
			// @ts-expect-error not a column of users
			ormUserProvider(User, { identifier: "login" }),
		).toThrow('identifier "login" is not a column of "users"');
		expect(() =>
			// @ts-expect-error not a column of users
			ormUserProvider(User, { password: "secret" }),
		).toThrow('password "secret" is not a column of "users"');
		expect(() =>
			ormUserProvider(User, { identifier: "password", password: "password" }),
		).toThrow("identifier and password must be different columns");
	});

	test("hidden password stays out of JSON but is still verified", async () => {
		const provider = ormUserProvider(User);
		const user = await provider.retrieveByCredentials({
			email: "ada@example.com",
		});
		if (!user) throw new Error("missing user");
		expect(JSON.parse(JSON.stringify(user))).toEqual({
			id: 1,
			email: "ada@example.com",
			username: "ada",
		});
		expect(
			await provider.validateCredentials(user, { password: "correct horse" }),
		).toBe(true);
	});

	test("works with attempt() through the session guard", async () => {
		const guard = createSessionGuard({
			provider: ormUserProvider(User),
			secret: new Uint8Array(32).fill(7),
			secure: false,
		});
		const auth = createAuthManager({
			defaultGuard: "session",
			guards: { session: guard },
		}).createContext({ request: new Request("http://localhost/") });
		expect(
			await auth.attempt({ email: "ada@example.com", password: "nope" }),
		).toBe(false);
		const result = await auth.attempt({
			email: "ada@example.com",
			password: "correct horse",
		});
		expect(result === false ? null : result.user.id).toBe(1);
	});
});

describe("loadPeer", () => {
	test("returns the module when it is installed", async () => {
		const mod = await loadPeer<typeof import("drizzle-orm")>(
			"drizzle-orm",
			"@bunary/auth/orm",
		);
		expect(typeof mod.eq).toBe("function");
	});

	test("throws a clear error when the peer is missing", async () => {
		const error = await loadPeer(
			"@bunary/not-installed",
			"@bunary/auth/orm",
		).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe(
			"@bunary/auth/orm requires @bunary/not-installed, which is not installed. Install it with: bun add @bunary/not-installed",
		);
		expect((error as Error).cause).toBeDefined();
	});
});
