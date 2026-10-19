import type {
	AuthPlugin,
	AuthPluginRouter,
	InstallableAuthManager,
} from "./types.js";

/**
 * Install an authentication plugin into an auth manager.
 *
 * Merges plugin guards (overriding existing guards with the same name),
 * calls the optional routes callback with the given router, and calls the optional configure callback.
 *
 * **Note**: This function requires an `InstallableAuthManager` (created by `createAuthManager()`).
 * Custom `AuthManagerInterface` implementations cannot use plugins unless they also
 * implement `InstallableAuthManager`.
 *
 * @param manager - The auth manager to install the plugin into (must be created by `createAuthManager()`)
 * @param plugin - The plugin to install
 * @param pluginOptions - Optional plugin-specific configuration (defaults to `{}` if omitted)
 * @param router - Router that `plugin.routes` registers onto; required when the plugin defines `routes`
 *
 * @throws {Error} If the plugin defines `routes` and no router is provided
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
	router?: AuthPluginRouter,
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

	// Routes can only be mounted on a real router; never silently drop them
	if (plugin.routes) {
		if (!router) {
			throw new Error(
				`Auth plugin "${plugin.name}" registers routes, but no router was provided to installAuthPlugin(). Pass a router as the fourth argument.`,
			);
		}
		plugin.routes(router);
	}

	// Call configure callback if provided (always called with options, defaulting to {})
	if (plugin.configure) {
		plugin.configure(pluginOptions ?? {});
	}
}
