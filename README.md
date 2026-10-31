# @bunary/auth

Authentication for the Bunary framework. Guard-based: `createAuth` is middleware (it fits `@bunary/http`'s `app.use()`) that attaches a request-scoped auth context to `ctx.locals.auth`, `createAuthManager` covers standalone use, and the built-in guards are an encrypted cookie session guard and a JWT guard, both built on [jose](https://github.com/panva/jose) (JWT: HS256 by default; RS256/ES256/EdDSA via a public key or JWKS URL), and a Basic guard. Users are looked up through a `UserProvider`, and each guard supports Laravel-style `attempt()`, `login()` and `logout()`. See the full reference: [docs/index.md](./docs/index.md).

Requires Bun ≥ 1.4.0. No other bunary package is required: auth types its middleware against its own small structural interfaces (`AuthRequestContext`, `AuthCookieJar`, `AuthMiddleware`), which `@bunary/http`'s objects already satisfy. `@bunary/core` (≥ 1.0.0-rc.1) is an optional peer: `@bunary/auth/provider` adds an `auth` config key, `authProvider`, `AuthToken` and `authMiddleware()`/`requireAuth()` (401 problem response) for core apps.

## Installation

```bash
bun add @bunary/auth
bun add @bunary/http   # for the Quick Start below
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

For user providers, the session guard, per-guard `attempt()`/`login()`/`logout()` semantics, JWT algorithms, keys and JWKS, the Basic guard (with `Bun.password`), [using with `@bunary/http`](./docs/index.md#using-with-bunaryhttp), [using with `@bunary/core`](./docs/index.md#using-with-bunarycore) and types, see [docs/index.md](./docs/index.md).

## License

MIT
