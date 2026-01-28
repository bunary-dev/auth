# @bunary/auth

Authentication primitives and guards for Bunary.

## Installation

```bash
bun add @bunary/auth
```

## Quickstart (minimal)

This package provides authentication building blocks. A request-safe, app-scoped integration API is being tracked separately (see the auth roadmap).

```ts
import { createAuthManager } from "@bunary/auth";

const manager = createAuthManager({
  defaultGuard: "example",
  guards: {
    example: {
      name: "example",
      async authenticate(request) {
        const token = request.headers.get("Authorization");
        return token ? { id: "1" } : null;
      },
    },
  },
});

// Per-request usage
const auth = manager.createContext({
  request: new Request("http://localhost/profile", {
    headers: { Authorization: "Bearer anything" },
  }),
});

await auth.authenticate();
const user = auth.user();
```

## Storage (cookie-first)

For OAuth/session-style flows, `@bunary/auth` provides a small `AuthStorage` abstraction and a cookie-backed reference implementation:

```ts
import { createCookieStorage } from "@bunary/auth";

// For local HTTP development (http://localhost), set secure: false
const storage = createCookieStorage({
  cookiePrefix: "bunary_",
  secure: false, // Required for http://localhost
});

const response = new Response("ok");
storage.set(response, "oauth_state", "abc123", { ttlSeconds: 60 });
storage.clear(response, "oauth_state");
```

**Important**: `secure` defaults to `true` (HTTPS-only). For local HTTP development, you **must** set `secure: false` or cookies won't be accepted by browsers.

## Built-in Guards

### JWT Bearer

For JWT token authentication (HS256):

```ts
import { createJwtGuard, createAuthManager } from "@bunary/auth";

const jwtGuard = createJwtGuard({
  secret: process.env.JWT_SECRET!,
  issuer: "my-app",
  audience: "api",
});

const manager = createAuthManager({
  defaultGuard: "jwt",
  guards: { jwt: jwtGuard }
```

### Basic Auth

For simple username/password authentication:

```ts
import { createBasicGuard, createAuthManager } from "@bunary/auth";

const basicGuard = createBasicGuard({
  async verify(username, password) {
    if (username === "admin" && password === "secret") {
      return { id: 1, username: "admin" };
    }
    return null;
  }
});

const manager = createAuthManager({
  defaultGuard: "basic",
  guards: { basic: basicGuard }
});
```

## Plugins (third-party providers)

Plugins enable third-party auth providers (Google/GitHub/Okta/etc.) to integrate cleanly:

```ts
import { createAuthManager, installAuthPlugin } from "@bunary/auth";
import type { AuthPlugin } from "@bunary/auth";

const plugin: AuthPlugin = {
  name: "example-provider",
  guards: {
    provider: {
      name: "provider",
      async authenticate(request) {
        // Validate provider token
        return { id: "1" };
      }
    }
  }
};

const manager = createAuthManager({ defaultGuard: "provider", guards: {} });
installAuthPlugin(manager, plugin);
```

## Requirements

- Bun ≥ 1.0.0

