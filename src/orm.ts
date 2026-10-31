/**
 * `@bunary/orm` integration: a {@link UserProvider} backed by an orm model.
 *
 * Shipped as the `@bunary/auth/orm` subpath so the main entry never imports
 * `@bunary/orm` or `drizzle-orm`, which are optional peers. Importing this
 * subpath without them installed throws an error saying what to install.
 */

import type { SQL, Table } from "drizzle-orm";
import { loadPeer } from "./peer.js";
import type { AuthUser, Credentials, UserProvider } from "./types.js";

const SUBPATH = "@bunary/auth/orm";

// Fail at import time, with a clear message, when the peers are missing.
await loadPeer(`@bunary/orm`, SUBPATH);
const { eq, getTableColumns } = await loadPeer<typeof import("drizzle-orm")>(
	"drizzle-orm",
	SUBPATH,
);

/**
 * The parts of an `@bunary/orm` model (from `defineModel()`) the provider
 * uses. Any model satisfies it.
 */
export interface OrmUserModel<TUser extends object = object> {
	/** The Drizzle table the model wraps. */
	readonly table: Table;
	/** The table's name. */
	readonly tableName: string;
	/** Find a row by primary key, or `null`. */
	find(id: never): Promise<TUser | null>;
	/** Filter by a Drizzle condition. */
	where(condition: SQL | undefined): { first(): Promise<TUser | null> };
}

/** Column keys (JS keys) of a model's table. */
export type OrmColumnKey<TModel extends OrmUserModel> =
	keyof TModel["table"]["_"]["columns"] & string;

/** The instance type a model's `find()` resolves to, as an auth user. */
export type OrmUser<TModel extends OrmUserModel> = NonNullable<
	Awaited<ReturnType<TModel["find"]>>
> &
	AuthUser;

/**
 * Options for {@link ormUserProvider}. Each key names both the credentials
 * field and the model column it is compared with.
 */
export interface OrmUserProviderOptions<TColumn extends string = string> {
	/** Column users are looked up by in `retrieveByCredentials()` (defaults to `"email"`). */
	identifier?: TColumn;
	/** Column holding the `Bun.password` hash (defaults to `"password"`). */
	password?: TColumn;
}

/**
 * Create a {@link UserProvider} backed by an `@bunary/orm` model.
 *
 * - `retrieveById(id)` is `Model.find(id)`.
 * - `retrieveByCredentials(credentials)` is
 *   `Model.where(eq(identifier, credentials[identifier])).first()`. Only the
 *   identifier is matched, never the password; a missing or non-scalar
 *   identifier returns `null` without a query.
 * - `validateCredentials(user, credentials)` checks
 *   `credentials[password]` against the user's password column with
 *   `Bun.password.verify`. A missing password or a stored value that is not
 *   a valid hash is `false`.
 *
 * Mark the password column `hidden` on the model so it stays out of JSON.
 *
 * @param model - A model from `defineModel()`
 * @param options - Identifier and password column names
 * @throws {Error} If `identifier` or `password` is not a column of the
 *   model's table, or both name the same column
 *
 * @example
 * ```ts
 * import { defineModel } from "@bunary/orm";
 * import { ormUserProvider } from "@bunary/auth/orm";
 *
 * const User = defineModel(db, users, { hidden: ["password"] });
 * const provider = ormUserProvider(User); // { identifier: "email", password: "password" }
 * ```
 */
export function ormUserProvider<TModel extends OrmUserModel>(
	model: TModel,
	options: OrmUserProviderOptions<OrmColumnKey<TModel>> = {},
): UserProvider<OrmUser<TModel>> {
	const identifier: string = options.identifier ?? "email";
	const password: string = options.password ?? "password";
	const columns = getTableColumns(model.table);
	for (const [option, key] of [
		["identifier", identifier],
		["password", password],
	] as const) {
		if (!Object.hasOwn(columns, key)) {
			throw new Error(
				`ormUserProvider: ${option} "${key}" is not a column of "${model.tableName}"`,
			);
		}
	}
	if (identifier === password) {
		throw new Error(
			"ormUserProvider: identifier and password must be different columns",
		);
	}
	const identifierColumn = columns[identifier];

	return {
		async retrieveById(id) {
			return (await model.find(id as never)) as OrmUser<TModel> | null;
		},

		async retrieveByCredentials(credentials: Credentials) {
			const value = credentials[identifier];
			if (
				typeof value !== "string" &&
				typeof value !== "number" &&
				typeof value !== "bigint"
			) {
				return null;
			}
			return (await model
				.where(eq(identifierColumn as never, value))
				.first()) as OrmUser<TModel> | null;
		},

		async validateCredentials(user, credentials: Credentials) {
			const plain = credentials[password];
			const hash = (user as Record<string, unknown>)[password];
			if (typeof plain !== "string" || typeof hash !== "string" || !hash) {
				return false;
			}
			try {
				return await Bun.password.verify(plain, hash);
			} catch {
				return false;
			}
		},
	};
}
