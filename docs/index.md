# @bunary/auth

Authentication and authorization module for the Bunary framework. Provides a flexible guard-based authentication system.

## Installation

```bash
bun add @bunary/auth
```

## Quick Start

```ts
import { createAuthManager, setAuthManager, auth } from "@bunary/auth";
import type { Guard } from "@bunary/auth";

// Define a JWT guard
const jwtGuard: Guard = {
  name: "jwt",
  async authenticate(request) {
    const token = request.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) return null;

    // Validate token and return user
    const user = await validateToken(token);
    return user;
  }
};

// Create the auth manager (stateless) with your guards
const manager = createAuthManager({
  defaultGuard: "jwt",
  guards: { jwt: jwtGuard }
});

// Optional: set a global manager to use the `auth({ request })` helper
setAuthManager(manager);

// Use in your application
const request = new Request("http://localhost/profile", {
  headers: { Authorization: "Bearer my-token" },
});

const authCtx = auth({ request });
await authCtx.authenticate(); // uses default guard
const user = authCtx.user();
```

## App-Scoped Integration (Recommended)

For applications using `@bunary/http`, use `createAuth()` to create app-scoped authentication middleware. This avoids global state and allows multiple apps with different auth configs in the same process.

```ts
import { createApp } from "@bunary/http";
import { createAuth, createJwtGuard } from "@bunary/auth";
import type { AuthContext } from "@bunary/auth";

const app = createApp();

// Create app-scoped auth middleware
const authMiddleware = createAuth({
  defaultGuard: "jwt",
  guards: {
    jwt: createJwtGuard({
      secret: process.env.JWT_SECRET!,
      issuer: "my-app",
      audience: "api"
    })
  }
});

// Use middleware to attach auth context to all requests
app.use(authMiddleware);

// Access auth in route handlers via ctx.locals.auth
app.get("/profile", (ctx) => {
  const auth = ctx.locals.auth as AuthContext;

  // Authenticate using default guard
  await auth.authenticate();

  if (!auth.check()) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  return { user: auth.user() };
});

app.listen(3000);
```

Benefits: no global singleton, multiple apps can have different auth configs, auth context is attached per request, type-safe access via `ctx.locals.auth`.

## API

### createAuth(config)

Creates app-scoped authentication middleware for use with `@bunary/http`. The middleware attaches an `AuthContext` to `ctx.locals.auth` for each request.

### createAuthManager(config)

Creates a new authentication manager instance. Config: `defaultGuard` (name of default guard), `guards` (record of guard implementations).

### setAuthManager(manager)

Sets the global authentication manager instance.

### auth({ request })

Creates a request-scoped auth context (requires `setAuthManager()` first).

### AuthManager methods

- `guard(name?)` — get a specific guard by name or the default guard
- `createContext({ request })` — create a request-scoped auth context (safe under concurrency)

### AuthContext methods

- `authenticate(guardName?)`
- `user()`
- `check()`
- `require()`
- `logout()`

## AuthStorage (cookie-first)

For OAuth/session-style flows, `createCookieStorage` provides a cookie-backed reference implementation. Use `secure: false` for local HTTP development so browsers accept the cookies.

## AuthPlugin (third-party providers)

Plugins let third-party providers (Google/GitHub/Okta/etc.) integrate without modifying `@bunary/auth` internals. Implement `AuthPlugin` with `name`, `guards`, optional `routes` and `configure`, then call `installAuthPlugin(manager, plugin, options)`.

## Built-in Guards

**JWT Bearer:** `createJwtGuard({ secret, issuer?, audience?, mapUser? })`. HS256 verification.

**Basic Auth:** `createBasicGuard({ name?, verify(username, password, request) })`. Use with `createAuthManager` or `createAuth`.

## Guard Interface

```typescript
interface Guard {
  name: string;
  authenticate(request: Request): Promise<AuthUser | null> | AuthUser | null;
}
```

## Types

See package exports for `AuthUser`, `Guard`, `AuthConfig`, `JwtGuardOptions`, `BasicGuardOptions`, `AuthContext`, `AuthPlugin`.

## License

MIT
