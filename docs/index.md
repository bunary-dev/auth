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
```

## Requirements

- Bun ≥ 1.0.0

