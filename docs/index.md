# @bunary/auth

Guard-based authentication for the Bunary framework: a JWT guard built on [jose](https://github.com/panva/jose), a Basic guard, and `@bunary/http` middleware that attaches a request-scoped auth context to `ctx.locals.auth`.

Requires Bun ≥ 1.4.0.

## Installation

```bash
bun add @bunary/auth @bunary/http
```

`@bunary/http` is a required peer dependency. `jose` is installed automatically as a dependency. `@bunary/core` is an optional peer dependency and is not needed for anything described here.

## Quick Start

```ts
import { createApp } from "@bunary/http";
import { createAuth, createJwtGuard } from "@bunary/auth";
import type { AuthLocals } from "@bunary/auth";

const app = createApp<AuthLocals>();

app.use(
  createAuth<AuthLocals>({
    defaultGuard: "jwt",
    guards: {
      jwt: createJwtGuard({
        secret: process.env.JWT_SECRET!,
        issuer: "my-app",
        audience: "api",
      }),
    },
  }),
);

app.get("/profile", async (ctx) => {
  const user = await ctx.locals.auth.authenticate(); // default guard
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return { user };
});

app.listen({ port: 3000 });
```

There is no global auth singleton: each app creates its own middleware, so several apps with different auth configs can run in the same process.

## Middleware: `createAuth(config)`

`createAuth<TLocals>(config)` returns an `@bunary/http` `Middleware<TLocals>` that creates a fresh `AuthContext` for every request and stores it on `ctx.locals.auth` before calling `next()`. It does not authenticate by itself; call `ctx.locals.auth.authenticate()` where you need a user.

`config` is an `AuthConfig`:

- `defaultGuard` — name of the guard used when none is passed
- `guards` — record of named `Guard`s

`AuthLocals` is `{ auth: AuthContext }`. Pass it (or a type extending it) to both `createApp<TLocals>()` and `createAuth<TLocals>()` to get a typed `ctx.locals.auth`:

```ts
type Locals = AuthLocals & { requestId: string };
const app = createApp<Locals>();
app.use(createAuth<Locals>(config));
```

With an untyped `createApp()`, `createAuth(config)` works too; read `ctx.locals.auth as AuthContext`.

### AuthContext methods

- `authenticate(guardName?)` — run the guard against the request and store the result on this context
- `user()` — the authenticated user, or `null`
- `check()` — `true` when a user is authenticated
- `require()` — the user, or throws `Error("Unauthenticated")`
- `logout()` — clear the user for this request
- `guard(name?)` — get a guard by name (or the default guard)

## Standalone: `createAuthManager(config)`

Outside `@bunary/http`, use the manager directly:

```ts
import { createAuthManager, createJwtGuard } from "@bunary/auth";

const manager = createAuthManager({
  defaultGuard: "jwt",
  guards: { jwt: createJwtGuard({ secret: process.env.JWT_SECRET! }) },
});

const auth = manager.createContext({ request });
await auth.authenticate();
if (auth.check()) {
  console.log(auth.user());
}
```

- `guard(name?)` — get a guard by name or the default guard; throws for an unknown name
- `createContext({ request })` — create a request-scoped `AuthContext` (safe under concurrency)

## JWT guard: `createJwtGuard(options)`

Reads `Authorization: Bearer <jwt>` (scheme is case-insensitive) and verifies the token with jose's `jwtVerify`.

| Option | Default | Description |
| --- | --- | --- |
| `name` | `"jwt"` | Guard name |
| `secret` | — | HMAC secret (string or `Uint8Array`) for `HS256`/`HS384`/`HS512` |
| `key` | — | Public key (`CryptoKey`, `KeyObject` or public JWK) for asymmetric algorithms |
| `jwksUrl` | — | URL (string or `URL`) of a JSON Web Key Set |
| `algorithms` | `["HS256"]` with `secret`; required otherwise | Accepted `alg` values |
| `issuer` | — | Required `iss` value |
| `audience` | — | Required `aud` value(s); any match is accepted |
| `clockToleranceSeconds` | `0` | Leeway for `exp` and `nbf` |
| `requireExp` | `true` | Reject tokens that have no `exp` claim |
| `mapUser` | see below | Map the verified payload to an `AuthUser` |

### Key sources and algorithms

Pass **exactly one** of `secret`, `key` or `jwksUrl`. The guard throws at construction when:

- none, or more than one, key source is given
- `secret` is empty (zero-length string or `Uint8Array`)
- `key` or `jwksUrl` is given without `algorithms`, or `algorithms` is empty
- `algorithms` contains `none`
- `secret` is combined with a non-HMAC algorithm, or `key`/`jwksUrl` with an HMAC algorithm

Only the configured algorithms are accepted. Tokens with `alg: none`, or signed with any other algorithm, are rejected. The algorithm/key-type split also stops algorithm-confusion attacks, such as an `HS256` token signed with your RSA public key.

```ts
// HS256 (default) with a shared secret
createJwtGuard({ secret: process.env.JWT_SECRET! });

// RS256 / ES256 / EdDSA with a public key
import { importSPKI } from "jose";
const publicKey = await importSPKI(process.env.JWT_PUBLIC_KEY!, "RS256");
createJwtGuard({ key: publicKey, algorithms: ["RS256"] });

// An identity provider's JWKS
createJwtGuard({
  jwksUrl: "https://login.example.com/.well-known/jwks.json",
  algorithms: ["RS256"],
  issuer: "https://login.example.com/",
  audience: "api",
});
```

With `jwksUrl`, keys are fetched and cached by jose's `createRemoteJWKSet`, which picks the key by the token's `kid` and refetches when it sees an unknown one. `@bunary/auth` adds no cache of its own. If the JWKS endpoint can't be reached, the guard returns `null`.

### Claims

- **`exp`**: tokens without `exp` are rejected unless `requireExp: false`. A token is rejected once `now >= exp + clockToleranceSeconds`, so a token at exactly `exp` is already expired (RFC 7519).
- **`nbf`**: rejected while `now < nbf - clockToleranceSeconds`.
- **`iss` / `aud`**: checked when `issuer` / `audience` are set.

### Failure behaviour

`authenticate` never throws for bad input. A missing or non-Bearer header, a malformed token (bad base64url, a header or payload that is `null`, an array or otherwise not a JSON object), a bad signature, a disallowed algorithm, failed claim checks or a `mapUser` that throws all return `null`.

### User mapping

Without `mapUser`, the user is `{ id: sub, ...customClaims }`. `sub` must be a string or number, or the guard returns `null`. The registered claims `iss`, `sub`, `aud`, `exp`, `nbf`, `iat` and `jti` are not copied onto the user, and `id` always comes from `sub`, even when the payload has an `id` claim. Pass `mapUser(payload)` to build the user yourself:

```ts
createJwtGuard({
  secret: process.env.JWT_SECRET!,
  mapUser: (payload) => ({ id: payload.sub as string, email: payload.email as string }),
});
```

## Basic guard: `createBasicGuard(options)`

Reads `Authorization: Basic <base64>`, decodes the credentials as UTF-8 (invalid base64 or UTF-8 returns `null`), splits on the first `:` (so passwords may contain colons), and calls `verify(username, password, request)`.

Never compare plaintext passwords in `verify`. Store hashes (e.g. from `Bun.password.hash`) and check them with `Bun.password.verify`:

```ts
import { createBasicGuard } from "@bunary/auth";

const basicGuard = createBasicGuard({
  name: "admin", // defaults to "basic"
  async verify(username, password) {
    const user = await findUserByName(username); // your lookup
    if (!user) return null;
    if (!(await Bun.password.verify(password, user.passwordHash))) return null;
    return { id: user.id, username };
  },
});
```

## Custom guards

Any object implementing `Guard` can be registered:

```ts
interface Guard {
  name: string;
  authenticate(request: Request): Promise<AuthUser | null> | AuthUser | null;
}
```

## Types

Exported types: `AuthConfig`, `AuthContext`, `AuthLocals`, `AuthManagerInterface`, `AuthUser`, `Guard`, `GuardInput`, `JwtGuardOptions`, `BasicGuardOptions`.

## Removed in this release

These APIs were removed outright, with no deprecation shims:

- Global helpers `auth`, `setAuthManager`, `getAuthManager`, `clearAuthManager`. Use `createAuth()` middleware, or `createAuthManager().createContext({ request })`.
- `installAuthPlugin` and the `AuthPlugin`, `AuthPluginRouter` and `InstallableAuthManager` types. Register guards directly in `AuthConfig.guards`.
- `createCookieStorage` and the `AuthStorage` type.

## License

MIT
