# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Breaking

- `createJwtGuard` now verifies with [jose](https://github.com/panva/jose) `jwtVerify`, replacing the hand-written JWT parsing and HS256 verification. `secret` is optional now: pass exactly one of `secret`, `key` or `jwksUrl`. Invalid key configuration throws at construction (no or several key sources, empty `algorithms`, `none`, or an HMAC/asymmetric mismatch between the key source and `algorithms`) (#76)
- `@bunary/http` is now a required peer dependency. `createAuth` is typed against its `Middleware`/`RequestContext`, and auth's own duplicated context and middleware types are gone (#76)
- Removed the global singleton helpers `auth`, `setAuthManager`, `getAuthManager` and `clearAuthManager`. Use `createAuth()` or `createAuthManager().createContext({ request })` (#76)
- Removed `installAuthPlugin` together with the `AuthPlugin`, `AuthPluginRouter` and `InstallableAuthManager` types. `createAuthManager` now returns `AuthManagerInterface` and no longer has an internal `_guards` property (#76)
- Removed `createCookieStorage` (auth's own cookie parsing and serialisation) and the `AuthStorage` type (#76)

### Added

- `createJwtGuard` options `algorithms` (default `["HS256"]` with `secret`), `key` (public `CryptoKey`/`KeyObject`/JWK) and `jwksUrl` (verified through jose's `createRemoteJWKSet` and its cache), so RS256, PS256, ES256 and EdDSA tokens can be verified; HS384/HS512 work with `secret` (#76)
- `AuthLocals` type and a `createAuth<TLocals>()` type parameter, giving a typed `ctx.locals.auth` with `createApp<AuthLocals>()` (#76)
- `jose` is a direct dependency; `@bunary/core` is declared as an optional peer dependency (#76)
- `requireExp` option on `createJwtGuard` (default `true`): tokens without an `exp` claim are rejected (#63)

### Fixed

- `createJwtGuard` throws on an empty secret and no longer leaves the key-import promise unobserved (#63)
- `createJwtGuard` rejects a token at exactly `exp` (`now >= exp + clockToleranceSeconds`), as RFC 7519 requires (#43)

### Changed

- The internal `_guards` map on the object returned by `createAuthManager` is now non-enumerable, so `Object.keys(manager)` and spreads only show `guard` and `createContext`; `installAuthPlugin` is unaffected (#46)
- Basic guard docs and JSDoc example verify passwords with `Bun.password.verify` against a stored hash instead of a plaintext comparison (#46)
- **Breaking:** JWTs without `exp` are now rejected by default; pass `requireExp: false` to keep the old behaviour (#63)
- **Breaking:** the default `createJwtGuard` user mapping no longer copies registered claims (`iss`, `sub`, `aud`, `exp`, `nbf`, `iat`, `jti`) onto the user; it returns `{ id: sub }` plus custom claims. Use `mapUser` to keep them (#43)

## [0.2.0] - 2026-09-21

### Changed

- **Requires Bun ≥ 1.4.0** (`engines.bun`); `.bun-version` pins 1.4.2 for CI and contributors (#49)
- Toolchain: `@types/bun` `^1.4.2`, `typescript` `^7.0.2` and `@biomejs/biome` `2.5.1` pinned as devDependencies; `bun.lock` committed (#49)
- `tsconfig.json` aligned with Bun 1.4 `bun init` defaults (`module: Preserve`, `moduleDetection: force`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `noImplicitOverride`) (#49)
- CI: Bun version read from `.bun-version`, plus a non-required `bun latest` canary job; new `build` job verifies the publish tarball with `bun pm pack --dry-run`; `actions/checkout@v7` (#49)
- Coverage thresholds (80% lines / 30% functions, set below the package's lowest-covered file, `src/plugin.ts`) enforced via `bunfig.toml` (#49)

### Fixed

- `exports["."]` now lists `types` before `import` so TypeScript resolves the declarations; added `default` condition and `./package.json` subpath (#49, absorbs #46 item 1)
- Added `publishConfig.access: public` and `sideEffects: false` (#49)
- Added missing `LICENSE` file (MIT) to the repo and the published tarball (#49)

## [0.1.0] - 2026-01-31

### Added

- First minor release — API stable for development use until 1.0.0

## [0.0.7] - 2026-01-29

### Added

- `createAuth()` factory function for app-scoped authentication middleware (feature #15)
- Middleware attaches `AuthContext` to `ctx.locals.auth` for each request
- Supports multiple apps with different auth configurations in the same process
- No global singleton required - fully app-scoped integration

### Deprecated

- Global helper functions (`setAuthManager()`, `auth()`, `getAuthManager()`, `clearAuthManager()`) are now deprecated
- Use `createAuth()` middleware and access auth via `ctx.locals.auth` instead
- Global helpers will be removed in v1.0.0

## [0.0.6] - 2026-01-28

### Added

- `createJwtGuard()` factory for JWT Bearer authentication (HS256)
- Verifies signatures using WebCrypto API (no external dependencies)
- Validates standard claims (exp, nbf, iss, aud)
- Supports clock tolerance for exp/nbf validation
- Customizable user mapping via `mapUser` function

- `createBasicGuard()` factory for Basic Authentication (HTTP Basic Auth)
- Handles malformed headers safely (returns null, never throws)
- Supports both async and synchronous verify functions

### Completed

- First-party auth guards tracker (feature #10): Both Basic Auth and JWT Bearer guards are now available as documented factory functions with complete README examples

### Removed

- Unused dependency on `@bunary/core` (chore #13): The package had no imports from `@bunary/core`, so the dependency was removed to reduce install footprint

## [0.0.5] - 2026-01-28

### Added

- `AuthPlugin` interface and `installAuthPlugin()` for third-party provider integration
- Plugin guards can override existing guards
- Optional `routes` callback for OAuth redirect/callback registration (full integration depends on HTTP package middleware hooks)

## [0.0.4] - 2026-01-28

### Added

- `AuthStorage` interface and cookie-first reference implementation (`createCookieStorage`)

## [0.0.3] - 2026-01-28

### Added

- Request-scoped `AuthContext` via `manager.createContext({ request })` (no shared user state across concurrent requests)

### Changed

- `auth()` helper now requires a request input: `auth({ request })` and returns an `AuthContext`
- `AuthManagerInterface` is now stateless and no longer stores a global/current user

## [0.0.1] - 2025-01-20

### Added

- `createAuthManager()` factory function for creating authentication managers
- Guard-based authentication system with multiple guard support
- `auth()` helper for accessing the current authenticated user
- `setAuthManager()` and `getAuthManager()` for global auth manager management
- `clearAuthManager()` for testing and cleanup
- Full TypeScript support with exported types:
  - `AuthUser` - Authenticated user interface
  - `Guard` - Guard implementation interface
  - `AuthConfig` - Configuration interface
  - `AuthManagerInterface` - Auth manager interface
- Comprehensive test suite (21 tests)
