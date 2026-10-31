# @bunary/auth

Authentication for the Bunary framework. Guard-based: `createAuth` is `@bunary/http` middleware that attaches a request-scoped auth context to `ctx.locals.auth`, `createAuthManager` covers standalone use, and the built-in guards are a JWT guard built on [jose](https://github.com/panva/jose) (HS256 by default; RS256/ES256/EdDSA via a public key or JWKS URL) and a Basic guard. See the full reference: [docs/index.md](./docs/index.md).

Requires Bun ≥ 1.4.0. `@bunary/http` is a required peer dependency.

## Installation

```bash
bun add @bunary/auth @bunary/http
```

## Quick Start

```ts
import { createAuth, createJwtGuard } from "@bunary/auth";
import type { AuthLocals } from "@bunary/auth";
import { createApp } from "@bunary/http";

const app = createApp<AuthLocals>();
app.use(createAuth<AuthLocals>({
  defaultGuard: "jwt",
  guards: { jwt: createJwtGuard({ secret: process.env.JWT_SECRET! }) }
}));
app.get("/profile", async (ctx) => {
  const user = await ctx.locals.auth.authenticate();
  if (!user) return new Response("Unauthorized", { status: 401 });
  return { user };
});
app.listen({ port: 3000 });
```

For JWT algorithms, keys and JWKS, the Basic guard (with `Bun.password`) and types, see [docs/index.md](./docs/index.md).

## License

MIT
