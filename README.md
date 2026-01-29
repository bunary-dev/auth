# @bunary/auth

Authentication and authorization for the Bunary framework. Guard-based: createAuth (app-scoped with @bunary/http), createAuthManager, built-in JWT and Basic guards, AuthStorage for cookies, AuthPlugin for third-party providers. Full reference: [docs/index.md](./docs/index.md).

## Installation

```bash
bun add @bunary/auth
```

## Quick start

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
