/**
 * Import an optional peer dependency, turning "not installed" into an error
 * that names the subpath that needs it and how to install it.
 *
 * @param specifier - The peer's package name, e.g. `"@bunary/orm"`
 * @param importer - The subpath that needs it, e.g. `"@bunary/auth/orm"`
 * @throws {Error} If the peer cannot be resolved (other load errors are rethrown as is)
 */
export async function loadPeer<T>(
	specifier: string,
	importer: string,
): Promise<T> {
	try {
		return (await import(specifier)) as T;
	} catch (error) {
		if (!isNotFound(error, specifier)) throw error;
		throw new Error(
			`${importer} requires ${specifier}, which is not installed. Install it with: bun add ${specifier}`,
			{ cause: error },
		);
	}
}

function isNotFound(error: unknown, specifier: string): boolean {
	if (!(error instanceof Error)) return false;
	const code = (error as Error & { code?: unknown }).code;
	if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
		return error.message.includes(specifier);
	}
	return (
		error.message.includes(`Cannot find package '${specifier}'`) ||
		error.message.includes(`Cannot find module '${specifier}'`)
	);
}
