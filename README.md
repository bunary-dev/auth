# @bunary/auth

Authentication and authorization for the Bunary framework. Provides a guard-based authentication system with createAuth for app-scoped integration with @bunary/http, createAuthManager for standalone use, built-in JWT and Basic guards, AuthStorage for cookie management, and AuthPlugin support for third-party providers. See full reference: [docs/index.md](./docs/index.md).

## Installation

```bash
bun add @bunary/auth
```

## Quick Start

```ts
import { createAuth, createJwtGuard } from "@bunary/auth";
import { createApp } from "@bunary/http";

const app = createApp();
app.use(createAuth({
  defaultGuard: "jwt",
  guards: { jwt: createJwtGuard({ secret: process.env.JWT_SECRET! }) }
}));
app.get("/profile", (ctx) => { /* ctx.locals.auth */ });
app.listen({ port: 3000 });
```

For API details, AuthStorage, AuthPlugin, and types, see [docs/index.md](./docs/index.md).

## License

MIT
