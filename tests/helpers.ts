import type { AuthUser, UserProvider } from "../src/types.js";

export interface TestUser extends AuthUser {
	id: number;
	email: string;
	passwordHash: string;
}

/**
 * In-memory user provider backed by `Bun.password` hashes, as in the docs.
 */
export async function createMemoryProvider(): Promise<
	UserProvider<TestUser> & { lookups: number }
> {
	const users: TestUser[] = [
		{
			id: 1,
			email: "ada@example.com",
			passwordHash: await Bun.password.hash("correct horse", {
				algorithm: "bcrypt",
				cost: 4,
			}),
		},
		{
			id: 2,
			email: "bob@example.com",
			passwordHash: await Bun.password.hash("hunter2", {
				algorithm: "bcrypt",
				cost: 4,
			}),
		},
	];

	const provider = {
		lookups: 0,
		retrieveById(id: AuthUser["id"]) {
			provider.lookups++;
			return users.find((u) => u.id === id) ?? null;
		},
		retrieveByCredentials(credentials: Record<string, unknown>) {
			return users.find((u) => u.email === credentials.email) ?? null;
		},
		async validateCredentials(
			user: TestUser,
			credentials: Record<string, unknown>,
		) {
			if (typeof credentials.password !== "string") return false;
			return await Bun.password.verify(credentials.password, user.passwordHash);
		},
	};
	return provider;
}

/** 32-byte session key */
export const SESSION_SECRET = "0123456789abcdef0123456789abcdef";

/**
 * Turn queued `Set-Cookie` values into a request `Cookie` header, the way a
 * browser would send them back.
 */
export function cookieHeaderFrom(setCookies: string[]): string {
	return setCookies.map((c) => c.split(";")[0]).join("; ");
}
