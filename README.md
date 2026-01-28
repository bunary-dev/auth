# @bunary/auth

Authentication and authorization module for the Bunary framework. Provides a flexible guard-based authentication system.

## Documentation

Canonical documentation for this package lives in [`docs/index.md`](./docs/index.md).

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

## API

### `createAuthManager(config)`

Creates a new authentication manager instance.

```ts
const manager = createAuthManager({
  defaultGuard: "jwt",
  guards: { jwt: jwtGuard },
});
```

**Config Options:**
- `defaultGuard` - Name of the default guard to use
- `guards` - Record of guard implementations (keyed by guard name)

### `setAuthManager(manager)`

Sets the global authentication manager instance.

```typescript
setAuthManager(manager);
```

### `auth({ request })`

Creates a **request-scoped** auth context (requires `setAuthManager()` first).

```ts
const authCtx = auth({ request });
await authCtx.authenticate();
const user = authCtx.user();
```

### AuthManager methods

#### `guard(name?)`

Get a specific guard by name, or the default guard.

```typescript
const jwt = manager.guard("jwt");
const defaultGuard = manager.guard();
```

#### `createContext({ request })`

Create a request-scoped auth context (safe under concurrency):

```ts
const authCtx = manager.createContext({ request });
await authCtx.authenticate(); // stores user on this context only
```

### AuthContext methods

- `authenticate(guardName?)`
- `user()`
- `check()`
- `require()`
- `logout()`

## AuthStorage (cookie-first)

For OAuth/session-style flows, `@bunary/auth` provides a tiny `AuthStorage` abstraction and a cookie-backed reference implementation:

```ts
import { createCookieStorage } from "@bunary/auth";

// For local HTTP development (http://localhost), set secure: false
const storage = createCookieStorage({
  cookiePrefix: "bunary_",
  secure: false, // Required for http://localhost
});

// For production HTTPS, use defaults (secure: true)
const prodStorage = createCookieStorage({ cookiePrefix: "bunary_" });

const response = new Response("ok");
storage.set(response, "oauth_state", "abc123", { ttlSeconds: 60 });
storage.clear(response, "oauth_state");
```

**Note**: `secure` defaults to `true` (HTTPS-only). For local HTTP development, you **must** set `secure: false` or cookies won't be accepted by browsers.

## AuthPlugin (third-party providers)

Plugins allow third-party providers (Google/GitHub/Okta/etc.) to integrate without modifying `@bunary/auth` internals:

```ts
import { createAuthManager, installAuthPlugin } from "@bunary/auth";
import type { AuthPlugin } from "@bunary/auth";

const googleAuthPlugin: AuthPlugin = {
  name: "google",
  guards: {
    google: {
      name: "google",
      async authenticate(request) {
        const token = request.headers.get("Authorization")?.replace("Bearer ", "");
        if (!token) return null;
        // Validate Google OAuth token
        return { id: "google-123", email: "user@example.com" };
      }
    }
  },
  routes: (router) => {
    // Register OAuth redirect/callback routes
    // Full integration depends on HTTP package middleware hooks (see auth issue #15)
    router.get("/auth/google", handleGoogleRedirect);
    router.get("/auth/google/callback", handleGoogleCallback);
  },
  configure: (options) => {
    // Validate plugin-specific options
    if (!options.clientId) throw new Error("clientId required");
  }
};

const manager = createAuthManager({
  defaultGuard: "jwt",
  guards: { jwt: jwtGuard }
});

installAuthPlugin(manager, googleAuthPlugin, {
  clientId: "xxx",
  clientSecret: "yyy"
});

// Plugin guards are now available
const auth = manager.createContext({ request });
await auth.authenticate("google");
```

## Built-in Guards

**JWT Bearer Guard:**
```typescript
import { createJwtGuard } from "@bunary/auth";

const jwtGuard = createJwtGuard({
  secret: process.env.JWT_SECRET!,
  issuer: "my-app",
  audience: "api",
  mapUser: (payload) => ({
    id: payload.sub as string,
    email: payload.email as string,
  })
});

const manager = createAuthManager({
  defaultGuard: "jwt",
  guards: { jwt: jwtGuard }
});
```

## Guard Interface

Guards are responsible for authenticating requests. Implement the `Guard` interface:

```typescript
interface Guard {
  name: string;
  authenticate(request: Request): Promise<AuthUser | null> | AuthUser | null;
}
```

### Example Guards

**JWT Guard:**
```typescript
const jwtGuard: Guard = {
  name: "jwt",
  async authenticate(request) {
    const auth = request.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return null;
    
    const token = auth.slice(7);
    try {
      const payload = await verifyJWT(token);
      return { id: payload.sub, ...payload };
    } catch {
      return null;
    }
  }
};
```

**Session Guard:**
```typescript
const sessionGuard: Guard = {
  name: "session",
  async authenticate(request) {
    const sessionId = getCookie(request, "session_id");
    if (!sessionId) return null;
    
    const session = await getSession(sessionId);
    return session?.user ?? null;
  }
};
```

## Types

```typescript
interface AuthUser {
  id: string | number;
  [key: string]: unknown;
}

interface Guard {
  name: string;
  authenticate(request: Request): Promise<AuthUser | null> | AuthUser | null;
}

interface AuthConfig {
  defaultGuard: string;
  guards: Record<string, Guard>;
}

interface JwtGuardOptions {
  name?: string;
  secret: string | Uint8Array;
  issuer?: string;
  audience?: string | string[];
  clockToleranceSeconds?: number;
  mapUser?: (payload: Record<string, unknown>) => AuthUser | null;
}
```

## License

MIT
