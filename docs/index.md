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

## Requirements

- Bun ≥ 1.0.0

