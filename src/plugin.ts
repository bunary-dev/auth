import type {
	AuthManagerInterface,
	AuthPlugin,
	AuthPluginRouter,
	Guard,
} from "./types.js";

/**
 * Internal manager type that includes guards map for plugin installation.
 */
type AuthManagerWithGuards = AuthManagerInterface & {
	_guards: Map<string, Guard>;
};

/**
 * Install an authentication plugin into an auth manager.
 *
 * Merges plugin guards (overriding existing guards with the same name),
 * calls the optional routes callback, and calls the optional configure callback.
 *
 * @param manager - The auth manager to install the plugin into
 * @param plugin - The plugin to install
 * @param pluginOptions - Optional plugin-specific configuration
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
	manager: AuthManagerInterface,
	plugin: AuthPlugin,
	pluginOptions?: Record<string, unknown>,
): void {
	const managerWithGuards = manager as AuthManagerWithGuards;

	// Merge plugin guards (overrides existing guards with same name)
	if (plugin.guards) {
		for (const [name, guard] of Object.entries(plugin.guards)) {
			managerWithGuards._guards.set(name, guard);
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
