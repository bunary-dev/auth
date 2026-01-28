# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
