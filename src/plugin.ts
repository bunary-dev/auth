import type {
	AuthPlugin,
	AuthPluginRouter,
	InstallableAuthManager,
} from "./types.js";

/**
 * Install an authentication plugin into an auth manager.
 *
 * Merges plugin guards (overriding existing guards with the same name),
 * calls the optional routes callback, and calls the optional configure callback.
 *
 * **Note**: This function requires an `InstallableAuthManager` (created by `createAuthManager()`).
 * Custom `AuthManagerInterface` implementations cannot use plugins unless they also
 * implement `InstallableAuthManager`.
 *
 * @param manager - The auth manager to install the plugin into (must be created by `createAuthManager()`)
 * @param plugin - The plugin to install
 * @param pluginOptions - Optional plugin-specific configuration
 *
 * @throws {Error} If the manager doesn't support plugin installation (missing `_guards` property)
 *
 * @example
 * ```ts
 * import { createAuthManager, installAuthPlugin } from "@bunary/auth";
 *
 * const manager = createAuthManager({
 *   defaultGuard: "jwt",
 *   guards: { jwt: jwtGuard }
 * });
 *
 * installAuthPlugin(manager, googleAuthPlugin, {
 *   clientId: "xxx",
 *   clientSecret: "yyy"
 * });
 * ```
 */
export function installAuthPlugin(
	manager: InstallableAuthManager,
	plugin: AuthPlugin,
	pluginOptions?: Record<string, unknown>,
): void {
	// Runtime check: ensure _guards exists (defensive programming)
	if (!manager._guards || !(manager._guards instanceof Map)) {
		throw new Error(
			"Auth manager does not support plugin installation. Use createAuthManager() to create a manager that supports plugins.",
		);
	}

	// Merge plugin guards (overrides existing guards with same name)
	if (plugin.guards) {
		for (const [name, guard] of Object.entries(plugin.guards)) {
			manager._guards.set(name, guard);
		}
	}

	// Call routes callback if provided
	// Note: Full route integration depends on HTTP package middleware hooks (auth issue #15)
	if (plugin.routes) {
		// Minimal router stub for now (routes won't be registered until HTTP integration)
		const routerStub: AuthPluginRouter = {
			get: (
				_path: string,
				_handler: (request: Request) => Response | Promise<Response>,
			) => {
				// No-op until HTTP integration is available
			},
			post: (
				_path: string,
				_handler: (request: Request) => Response | Promise<Response>,
			) => {
				// No-op until HTTP integration is available
			},
		};
		plugin.routes(routerStub);
	}

	// Call configure callback if provided
	if (plugin.configure && pluginOptions !== undefined) {
		plugin.configure(pluginOptions);
	}
}
