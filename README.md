# @bunary/auth

Authentication and authorization module for the Bunary framework. Provides a flexible guard-based authentication system.

## Documentation

Canonical documentation for this package lives in [`docs/index.md`](./docs/index.md).

## Installation

```bash
bun add @bunary/auth
```

## Quick Start

```typescript
import { createAuthManager, setAuthManager, auth } from "@bunary/auth";
import type { Guard, AuthUser } from "@bunary/auth";

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

// Create and register the auth manager
const authManager = createAuthManager({
  defaultGuard: "jwt",
  guards: [jwtGuard]
});

setAuthManager(authManager);

// Use in your application
const user = await auth();
```

## API

### `createAuthManager(config)`

Creates a new authentication manager instance.

```typescript
const manager = createAuthManager({
  defaultGuard: "jwt",
  guards: [jwtGuard, sessionGuard]
});
```

**Config Options:**
- `defaultGuard` - Name of the default guard to use
- `guards` - Array of guard implementations

### `setAuthManager(manager)`

Sets the global authentication manager instance.

```typescript
setAuthManager(manager);
```

### `auth()`

Returns the currently authenticated user, or `null` if not authenticated.

```typescript
const user = auth();
if (user) {
  console.log(`Hello, ${user.name}`);
}
```

### AuthManager Methods

#### `guard(name?)`

Get a specific guard by name, or the default guard.

```typescript
const jwt = manager.guard("jwt");
const defaultGuard = manager.guard();
```

#### `authenticate(request, guardName?)`

Authenticate a request using the specified guard (or default).

```typescript
const user = await manager.authenticate(request);
const user = await manager.authenticate(request, "session");
```

#### `user()`

Get the currently authenticated user.

```typescript
const user = manager.user();
```

#### `check()`

Check if a user is authenticated.

```typescript
if (manager.check()) {
  // User is authenticated
}
```

#### `logout()`

Clear the authenticated user.

```typescript
manager.logout();
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
  guards: Guard[];
}
```

## License

MIT
