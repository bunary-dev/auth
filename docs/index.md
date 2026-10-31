# @bunary/auth

Guard-based authentication for the Bunary framework: a cookie session guard and a JWT guard built on [jose](https://github.com/panva/jose), a Basic guard, user providers, and `@bunary/http` middleware that attaches a request-scoped auth context to `ctx.locals.auth`.

Requires Bun ≥ 1.4.0.

## Installation

```bash
bun add @bunary/auth @bunary/http
```

`@bunary/http` is a required peer dependency. `jose` is installed automatically as a dependency. `@bunary/core` (≥ 1.0.0-rc.1) is an optional peer dependency, needed only for [`@bunary/auth/provider`](#using-with-bunarycore).

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
- `provider` — optional `UserProvider`, returned by `manager.provider()`. Guards still take their provider in their own options.

`AuthLocals` is `{ auth: AuthContext }`. Pass it (or a type extending it) to both `createApp<TLocals>()` and `createAuth<TLocals>()` to get a typed `ctx.locals.auth`:

```ts
type Locals = AuthLocals & { requestId: string };
const app = createApp<Locals>();
app.use(createAuth<Locals>(config));
```

With an untyped `createApp()`, `createAuth(config)` works too; read `ctx.locals.auth as AuthContext`.

Guards that write cookies (the [session guard](#session-guard-createsessionguardoptions)) use `ctx.cookies` when `@bunary/http` provides it (http ≥ 1.0). With `@bunary/http` 0.3, which has no `ctx.cookies`, the middleware keeps its own per-request [cookie jar](#cookies) and appends its `Set-Cookie` headers to the response that `next()` returns. That includes immutable responses such as `Response.redirect()`, which are copied, and plain-object, string or `null` results, which are converted the way `@bunary/http` converts them.

### AuthContext methods

- `authenticate(guardName?)` — run the guard against the request and store the result on this context
- `user()` — the authenticated user, or `null`
- `check()` — `true` when a user is authenticated
- `guest()` — `true` when no user is authenticated
- `attempt(credentials, guardName?)` — check credentials and log the user in; resolves to `{ user, token? }`, or `false` when they don't match (see [Logging in and out](#logging-in-and-out))
- `login(user, guardName?)` — log a user in without checking credentials; resolves to the token for the JWT guard, otherwise `undefined`
- `logout(guardName?)` — let the guard log out (the session guard clears its cookie), then clear the user for this request. Returns a promise
- `require()` — the user, or throws `Error("Unauthenticated")`
- `guard(name?)` — get a guard by name (or the default guard)

`attempt()`, `login()` and `logout()` act on the default guard unless you pass a guard name.

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
- `provider()` — the `UserProvider` from `AuthConfig.provider`; throws when the config has none
- `createContext({ request, cookies? })` — create a request-scoped `AuthContext` (safe under concurrency). `cookies` is the request's [cookie jar](#cookies); when omitted, the context creates one from the request, which reads cookies but leaves you no way to send the ones it writes. Pass your own jar when you use the session guard.

## User providers

Guards that log users in look them up through a `UserProvider` (Laravel's `UserProvider`):

```ts
interface UserProvider<TUser extends AuthUser = AuthUser> {
  retrieveById(id: string | number): Promise<TUser | null> | TUser | null;
  retrieveByCredentials(credentials: Credentials): Promise<TUser | null> | TUser | null;
  validateCredentials(user: TUser, credentials: Credentials): Promise<boolean> | boolean;
}
```

- `retrieveById` — load a user by id. The session guard calls it on every authenticated request.
- `retrieveByCredentials` — find the user the credentials refer to, ignoring the password (e.g. by email).
- `validateCredentials` — check the credentials, typically the password, against that user.

`Credentials` is `Record<string, unknown>`: whatever you pass to `attempt()`. An in-memory provider that stores only password hashes:

```ts
import type { AuthUser, UserProvider } from "@bunary/auth";

interface User extends AuthUser {
  id: number;
  email: string;
  passwordHash: string;
}

const users: User[] = [
  { id: 1, email: "ada@example.com", passwordHash: await Bun.password.hash("correct horse") },
];

const provider: UserProvider<User> = {
  retrieveById: (id) => users.find((u) => u.id === id) ?? null,
  retrieveByCredentials: (credentials) =>
    users.find((u) => u.email === credentials.email) ?? null,
  async validateCredentials(user, credentials) {
    if (typeof credentials.password !== "string") return false;
    // Constant-time comparison against the argon2id/bcrypt hash
    return await Bun.password.verify(credentials.password, user.passwordHash);
  },
};
```

The user object the provider returns becomes `auth.user()`. Strip fields such as `passwordHash` in `retrieveById` if handlers shouldn't see them.

## Session guard: `createSessionGuard(options)`

A cookie session for browser apps. The session is an encrypted JWT (jose, `dir` key management with `A256GCM`) that holds only the user id and an `exp`, stored in a cookie. Nothing is kept on the server.

```ts
import { createApp } from "@bunary/http";
import { createAuth, createSessionGuard } from "@bunary/auth";
import type { AuthLocals } from "@bunary/auth";

const app = createApp<AuthLocals>();

app.use(
  createAuth<AuthLocals>({
    defaultGuard: "session",
    guards: {
      session: createSessionGuard({
        provider, // a UserProvider, see above
        secret: process.env.SESSION_SECRET!, // exactly 32 bytes
      }),
    },
  }),
);

app.post("/login", async (ctx) => {
  const { email, password } = await ctx.json<{ email: string; password: string }>();
  const result = await ctx.locals.auth.attempt({ email, password });
  if (!result) return new Response("Invalid credentials", { status: 401 });
  return { user: { id: result.user.id } };
});

app.get("/me", async (ctx) => {
  const user = await ctx.locals.auth.authenticate();
  return user ? { id: user.id } : new Response(null, { status: 401 });
});

app.post("/logout", async (ctx) => {
  await ctx.locals.auth.logout();
  return new Response(null, { status: 303, headers: { Location: "/" } });
});
```

| Option | Default | Description |
| --- | --- | --- |
| `name` | `"session"` | Guard name |
| `provider` | — (required) | `UserProvider` used by `authenticate` (`retrieveById`) and `attempt` |
| `secret` | — (required) | Encryption key: exactly 32 bytes (`Uint8Array`, or a string that is 32 bytes in UTF-8) |
| `cookieName` | `"bunary_session"` | Cookie name; must be an RFC 6265 token |
| `lifetimeSeconds` | `7200` | Session lifetime; sets the session's `exp` and the cookie's `Max-Age` |
| `secure` | `true` | Send the cookie only over HTTPS. Set `false` for local development over plain HTTP |
| `path` | `"/"` | Cookie path; must start with `/` and contain no `;` or control characters |

Generate a key with `crypto.getRandomValues(new Uint8Array(32))` and keep it out of source control. Construction throws when `provider` is missing, `secret` is missing or not exactly 32 bytes, `cookieName` is not an RFC 6265 token (so a name like `"a; Domain=evil.com"` can't inject attributes), `path` is invalid, or `lifetimeSeconds` is not a positive integer.

The cookie is always `HttpOnly` and `SameSite=Lax`. `attempt()` and `login()` write it and `logout()` clears it (`Max-Age=0`, same path and attributes).

`authenticate` decrypts the cookie and loads the user with `provider.retrieveById(id)`. Any of these authenticate nobody (`null`), without throwing:

- no cookie, or a value that is not a JWE
- a modified cookie (the AES-GCM tag no longer matches) or one encrypted with another key
- a token using any algorithm other than `dir` + `A256GCM`, including signed or unsecured JWTs
- an expired session (`now >= exp`), or one without `exp`
- a user id that `retrieveById` doesn't find

Errors thrown by the provider itself (e.g. a database outage) are not swallowed.

Because the session lives in the cookie, `logout()` can only tell the browser to drop it: a copy of the cookie stays valid until its `exp`. Keep `lifetimeSeconds` short if that matters.

## Logging in and out

`attempt()`, `login()` and `logout()` behave per guard, like Laravel's guards:

| Guard | `attempt(credentials)` | `login(user)` | `logout()` |
| --- | --- | --- | --- |
| Session | `{ user }` and writes the session cookie | writes the session cookie; resolves to `undefined` | clears the session cookie |
| JWT | `{ user, token }`; needs `provider` | resolves to a new token | clears the request's user only; issued tokens stay valid until `exp` |
| Basic | `{ user }` for this request only, from `{ username, password }` through `verify` | throws: the guard is stateless | throws: the guard is stateless |
| Custom guard | its `attempt`, or throws `Guard "<name>" does not support attempt()` | its `login`, or throws | its `logout` if any, then clears the user |

When the credentials don't match, `attempt()` resolves to `false`, sets no user and writes no cookie. On success, `attempt()` and `login()` also set `auth.user()` for the rest of the request.

```ts
// JWT: issue a token from a login endpoint
app.post("/token", async (ctx) => {
  const result = await ctx.locals.auth.attempt(await ctx.json(), "jwt");
  if (!result) return new Response(null, { status: 401 });
  return { token: result.token };
});
```

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
| `provider` | — | `UserProvider` for `attempt()` |
| `signingKey` | — | Private key (`CryptoKey`, `KeyObject` or private JWK) for issuing tokens with an asymmetric algorithm |
| `ttlSeconds` | `3600` | Lifetime of issued tokens (`exp`) |

### Key sources and algorithms

Pass **exactly one** of `secret`, `key` or `jwksUrl`. The guard throws at construction when:

- none, or more than one, key source is given
- `secret` is empty (zero-length string or `Uint8Array`)
- `key` or `jwksUrl` is given without `algorithms`, or `algorithms` is empty
- `algorithms` contains `none`
- `secret` is combined with a non-HMAC algorithm, or `key`/`jwksUrl` with an HMAC algorithm
- `secret` is combined with `signingKey`, or `ttlSeconds` is not a positive integer

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

### Issuing tokens

`attempt(credentials)` (with a `provider`) and `login(user)` issue a token signed with the **first** entry of `algorithms`: with `secret` for HMAC, or with `signingKey` for asymmetric algorithms. The token has `sub` = `String(user.id)`, `iat`, `exp` = `iat + ttlSeconds`, and `iss`/`aud` when `issuer`/`audience` are set, so the same guard accepts it. No other user fields are put in the token. With the default mapping, a token issued for `{ id: 7 }` authenticates as `{ id: "7" }`.

Issuing a token without `secret` or `signingKey` throws, and so does `attempt()` without `provider`.

```ts
import { importPKCS8, importSPKI } from "jose";

const jwt = createJwtGuard({
  key: await importSPKI(process.env.JWT_PUBLIC_KEY!, "ES256"),
  signingKey: await importPKCS8(process.env.JWT_PRIVATE_KEY!, "ES256"),
  algorithms: ["ES256"],
  provider,
  ttlSeconds: 900,
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

The Basic guard is stateless: credentials come with every request. `attempt({ username, password })` runs `verify` and authenticates the current request only. `login()` and `logout()` throw, because there is no session or token to write or clear.

## Cookies

The session guard reads and writes cookies through a `CookieJar`:

```ts
interface CookieJar {
  get(name: string): string | undefined;
  set(name: string, value: string, options?: CookieOptions): void;
  delete(name: string, options?: CookieOptions): void;
}
```

`@bunary/http`'s `ctx.cookies` has this shape, and `createAuth()` passes it through when it exists. `createCookieJar(request)` creates a jar backed by Bun's `Bun.CookieMap` and `Bun.Cookie`. Its `headers()` method returns the queued `Set-Cookie` values. `set()` and `delete()` throw for names that are not RFC 6265 tokens. Use it with `createAuthManager()` outside `@bunary/http`:

```ts
import { createCookieJar } from "@bunary/auth";

const cookies = createCookieJar(request);
const auth = manager.createContext({ request, cookies });
const ok = await auth.attempt({ email, password });

const response = new Response(ok ? "welcome" : "nope", { status: ok ? 200 : 401 });
for (const value of cookies.headers()) response.headers.append("Set-Cookie", value);
```

## Custom guards

Any object implementing `Guard` can be registered:

```ts
interface Guard {
  name: string;
  authenticate(request: Request, input?: GuardInput): Promise<AuthUser | null> | AuthUser | null;
  // Optional, for guards that log users in
  attempt?(credentials: Credentials, input: GuardInput): Promise<AttemptResult | null>;
  login?(user: AuthUser, input: GuardInput): Promise<string | undefined>;
  logout?(input: GuardInput): Promise<void> | void;
}
```

`input` is `{ request, cookies }` from the auth context. `attempt` returns `null` for bad credentials, and the context turns that into `false`.

## Using with @bunary/core

`@bunary/auth/provider` wires auth into a `@bunary/core` application. It is a separate entry point because it imports `@bunary/core`; the main `@bunary/auth` entry never does, so apps without core typecheck and run without it.

```bash
bun add @bunary/auth @bunary/http @bunary/core
```

Put the auth config under the `auth` key of your bunary config and add `authProvider`:

```ts
import { createApp, defineConfig } from "@bunary/core";
import { createSessionGuard } from "@bunary/auth";
import { AuthToken, authProvider } from "@bunary/auth/provider";

const config = defineConfig({
  app: { name: "my-app" },
  auth: {
    defaultGuard: "session",
    provider: users, // a UserProvider
    guards: {
      session: createSessionGuard({ provider: users, secret: process.env.SESSION_KEY! }),
    },
  },
});

const app = await createApp({ config, providers: [authProvider] }).boot();

const manager = app.get(AuthToken); // AuthManagerInterface
```

- **`auth` config key.** Importing `@bunary/auth/provider` augments core's `BunaryConfig` with `auth?: AuthConfig` (`defaultGuard`, `guards`, optional `provider`), so `defineConfig({ auth: { … } })` is type-checked: unknown or mistyped keys are type errors.
- **`authProvider`** is a core provider (built with `defineProvider`). Its `register()` reads `app.config.get("auth")`, builds the manager with `createAuthManager()` and binds it under `AuthToken`. It validates the config first, so `app.boot()` rejects with a `BunaryError` when `auth` is missing, is not an object, has an empty or unknown `defaultGuard`, has a guard without `authenticate()`, or has a `provider` missing one of its three methods.
- **`AuthToken`** is a core token (`createToken<AuthManagerInterface>("auth.manager")`), so `app.get(AuthToken)` is typed. Each app gets its own manager.

### Middleware: `authMiddleware()` and `requireAuth()`

Both resolve the manager from the app at request time, authenticate the request with the default guard (or `guard`), and set `ctx.locals.auth` (the request's `AuthContext`) and `ctx.locals.user`:

| Middleware | Guest | `ctx.locals` type |
| --- | --- | --- |
| `authMiddleware(options?)` | calls the handler with `user: null` | `AuthUserLocals` (`{ auth: AuthContext; user: AuthUser \| null }`) |
| `requireAuth(options?)` | answers `401` with an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem response and skips the handler | `RequiredAuthLocals` (`{ auth: AuthContext; user: AuthUser }`) |

```ts
import { createRouter } from "@bunary/http";
import { httpProvider } from "@bunary/http/provider";
import { requireAuth, type RequiredAuthLocals } from "@bunary/auth/provider";

const router = createRouter<RequiredAuthLocals>();
router.use(requireAuth<RequiredAuthLocals>());
router.get("/me", (ctx) => ({ id: ctx.locals.user.id }));

const app = createApp({ config, providers: [authProvider, httpProvider(router)] });
```

Options (`AuthMiddlewareOptions`):

- `guard` — guard name; defaults to `auth.defaultGuard`
- `app` — the core `Application` to resolve `AuthToken` from. Defaults to `ctx.app`, which `@bunary/http` ≥ 1.0 sets for routers mounted with `httpProvider()`. With `@bunary/http` 0.3, pass it: `app.use(requireAuth({ app }))`.

The 401 body is `{ "type": "about:blank", "title": "Unauthorized", "status": 401 }` with `Content-Type: application/problem+json; charset=utf-8`, produced by `@bunary/http`'s `problem(401)` when http has it (≥ 1.0) and by an identical built-in response with http 0.3. A request throws when no app is available or the app was not booted with `authProvider` (core's `MissingBindingError`). Errors thrown by a guard are not caught. Cookies written by guards are handled as in [`createAuth()`](#middleware-createauthconfig).

## Types

Exported types: `AttemptResult`, `AuthConfig`, `AuthContext`, `AuthLocals`, `AuthManagerInterface`, `AuthUser`, `CookieJar`, `CookieOptions`, `Credentials`, `Guard`, `GuardInput`, `QueuedCookieJar`, `UserProvider`, `JwtGuardOptions`, `SessionGuardOptions`, `BasicGuardOptions`.

From `@bunary/auth/provider`: `AuthMiddlewareOptions`, `AuthUserLocals`, `RequiredAuthLocals` (both take an optional user type parameter), plus the `BunaryConfig` augmentation.

## Removed in this release

These APIs were removed outright, with no deprecation shims:

- Global helpers `auth`, `setAuthManager`, `getAuthManager`, `clearAuthManager`. Use `createAuth()` middleware, or `createAuthManager().createContext({ request })`.
- `installAuthPlugin` and the `AuthPlugin`, `AuthPluginRouter` and `InstallableAuthManager` types. Register guards directly in `AuthConfig.guards`.
- `createCookieStorage` and the `AuthStorage` type. For login state in cookies, use the [session guard](#session-guard-createsessionguardoptions).

## License

MIT
