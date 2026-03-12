# SolidJS × TypeScript-Go: `stable` Modifier Demo

This is a fork of [SolidJS](https://github.com/solidjs/solid) demonstrating the **`stable`/`mutator`/`invalidates` function modifier proposal** for TypeScript, implemented in [TypeScript-Go (tsgo)](https://github.com/kbrilla/typescript-go).

The `stable` modifier tells the type-checker that a function returns the same value on repeated calls (without intervening mutations). This allows **control flow analysis (CFA) to preserve narrowing across multiple calls** to the same function — a long-requested capability for reactive frameworks.

**Repository:** [github.com/kbrilla/solid](https://github.com/kbrilla/solid) (branch: `stable-mutator-demo`)

---

## What This Demonstrates

SolidJS represents reactive state as getter/setter pairs:

```ts
const [count, setCount] = createSignal<number | null>(0);
```

`count` is an `Accessor<T>` — a zero-argument function `() => T`. Standard TypeScript loses narrowing across repeated calls:

```ts
if (count() !== null) {
    count().toFixed(2); // ❌ tsc error: count() might be null
}
```

With `stable`:

```ts
export type Accessor<T> = stable () => T;
```

TypeScript-Go preserves the narrowing:

```ts
if (count() !== null) {
    count().toFixed(2); // ✅ tsgo: narrowed to number, stays narrowed
}
```

---

## What Was Changed

Three lines were modified and one test file was added:

### 1. `packages/solid/src/reactive/signal.ts` (line 187)

```diff
- export type Accessor<T> = () => T;
+ export type Accessor<T> = stable () => T;
```

### 2. `packages/solid/src/server/reactive.ts` (line 9)

```diff
- export type Accessor<T> = () => T;
+ export type Accessor<T> = stable () => T;
```

### 3. `Signal<T>` tuple type (both files)

```diff
- export type Signal<T> = [get: Accessor<T>, set: Setter<T>];
+ export type Signal<T> = [get: Accessor<T>, set: mutator Setter<T> invalidates get];
```

This uses `mutator TypeRef invalidates <target>` to wrap `Setter<T>` with mutator 
semantics. `invalidates get` targets the `get` tuple label — when the setter is called, 
the compiler resets narrowing on the getter. The full `Setter<T>` callable interface 
(with all 4 overloads) is preserved.

### 4. `packages/solid/test/signals.stable-mutator.type-tests.ts` (new file)

Eight narrowing test scenarios that type-check correctly with tsgo. See [Test Scenarios](#test-scenarios) below.

---

## `mutator` on Type References

The `Signal<T>` tuple now uses `mutator Setter<T> invalidates get` — applying `mutator` 
directly to the `Setter<T>` type reference rather than requiring inline function type syntax. 
This is essential for SolidJS because `Setter<T>` is a complex overloaded callable interface 
with 4 overload signatures — rewriting it inline would be impractical.

### Before (inline function type — impractical for complex interfaces):
```ts
type Signal<T> = [
    get: stable () => T,
    set: mutator (value: T) => void invalidates get  // only one signature — loses overloads
];
```

### After (type reference — preserves full interface):
```ts
type Signal<T> = [
    get: Accessor<T>,                           // Accessor<T> = stable () => T
    set: mutator Setter<T> invalidates get      // full Setter<T> interface preserved
];
```

The `mutator TypeRef invalidates <targets>` syntax wraps any callable type reference with 
mutator/invalidates semantics while preserving the complete type identity, including all overloads.

SolidJS's `Setter<T>` has 4 overloads:

```ts
export type Setter<in out T> = {
  <U extends T>(...args: undefined extends T ? [] : [value: ...]): ...;
  <U extends T>(value: (prev: T) => U): U;
  <U extends T>(value: Exclude<U, Function>): U;
  <U extends T>(value: Exclude<U, Function> | ((prev: T) => U)): U;
};
```

All 4 overloads are preserved through the type reference — calling any of them invalidates 
the `get` accessor's narrowing state.

---

## How to Run

### Pre-built binaries

Platform-specific tsgo binaries are included in `tsgo-bin/`:

| File | Platform |
|------|----------|
| `tsgo-bin/tsgo-darwin-arm64` | macOS Apple Silicon (32M) |
| `tsgo-bin/tsgo-darwin-amd64` | macOS Intel (33M) |
| `tsgo-bin/tsgo-linux-amd64` | Linux x86_64 (32M) |

### Type-check the full SolidJS codebase

```sh
# Make the binary executable (pick your platform)
chmod +x tsgo-bin/tsgo-darwin-arm64

# Run the type-checker
./tsgo-bin/tsgo-darwin-arm64 --project tsconfig.build.json --noEmit
```

### Type-check the test file specifically

The test file imports from SolidJS source and demonstrates all 8 narrowing scenarios:

```sh
./tsgo-bin/tsgo-darwin-arm64 --project tsconfig.test.json --noEmit
```

---

## Test Scenarios

The test file `packages/solid/test/signals.stable-mutator.type-tests.ts` contains 8 scenarios, all of which type-check correctly with tsgo:

| # | Scenario | What It Tests |
|---|----------|---------------|
| 1 | **Basic signal narrowing** | `count() !== undefined` → subsequent `count()` stays narrowed to `number` |
| 2 | **Accessor type alias** | `Accessor<string \| undefined>` as a parameter type carries `stable` through the alias |
| 3 | **Exhaustive switch** | `switch (status())` with `never` default — exhaustiveness check works on signal |
| 4 | **Discriminated union** | `shape().kind === "circle"` → `shape().radius` available in true branch |
| 5 | **Multiple independent signals** | Two signals `a()` and `b()` narrow independently without interfering |
| 6 | **Signal in loop** | `items() !== undefined` → `for (const item of items())` treats value as iterable |
| 7 | **typeof guard** | `typeof data() === "string"` → `data().toUpperCase()` in the branch |
| 8 | **Null check** | `name() !== null` → `.toUpperCase()` and `.length` available |

---

## Error Baseline Comparison

Type-checking `tsconfig.build.json --noEmit` across three configurations:

| Configuration | Errors | Notes |
|---------------|--------|-------|
| **Standard tsc** | 8 | 7 JSX module resolution + 1 real type error |
| **tsgo (unmodified SolidJS)** | 10 | Baseline tsgo errors |
| **tsgo (with `stable` Accessor)** | 11 | +1 new error (see below) |

### The additional error with `stable`

```
packages/solid/src/reactive/signal.ts:970:34 - error TS100014:
  Cannot call 'stable' function 'deps' inside uncertainty boundary 'untrack'
```

This is **correct behavior**. The `on()` function calls `deps()` (a stable `Accessor`) and later passes it into `untrack()`, which is an uncertainty boundary — the compiler correctly flags that narrowing from the outer `deps()` call cannot be trusted inside the `untrack` callback. This demonstrates that the stability analysis is working as intended: it catches real semantic issues in framework code.

---

## Store Patterns — Keyed Per-Property Narrowing

### What SolidJS Stores Are

SolidJS stores use proxy-based property access, not function calls:

```ts
const [store, setStore] = createStore({ user: "alice", count: 0 });

store.user;                      // property access — no () call
setStore("user", "bob");         // path-based setter
```

The API signature:

```ts
declare function createStore<T>(init: T): [get: Store<T>, set: SetStoreFunction<T>];
```

`Store<T>` is just `T` — an identity alias. At runtime it's a reactive proxy, but at the type level there's no wrapper. Reads are property accesses (`store.user`), and writes use a path-based setter (`setStore("user", "bob")`).

### The Challenge: Property Access vs Function Calls

The `stable`/`mutator`/`invalidates` modifiers attach to **functions**. SolidJS stores use **property access** — `store.user` is not a function call. This creates an impedance mismatch: the compiler can reason about the stability of `count()` (a function call), but not `store.user` (a property read).

### Bridge Patterns That Work Today

Two patterns bridge the gap between property-based stores and function-based stability:

#### 1. Derived Memos

Wrap a store property read in `createMemo` to produce a `stable` accessor:

```ts
const userMemo: Accessor<string | undefined> = createMemo(() => store.user);

if (userMemo() !== undefined) {
    userMemo().toUpperCase();    // ✅ narrowed — Accessor is stable
}
```

This works because `createMemo` returns `Accessor<T>`, which is `stable () => T`.

#### 2. Keyed Accessor/Writer Interfaces

A typed wrapper that exposes per-key stability via `stable[key]` and per-key invalidation via `invalidates get[key]`:

```ts
interface StoreAccessor<T> {
    stable[key] get<K extends keyof T & string>(key: K): T[K];
}

interface StoreWriter<T> {
    mutator set<K extends keyof T & string>(key: K, value: T[K]): void invalidates get[key];
}
```

`stable[key]` means repeated calls to `get` with the **same key argument** are treated as stable — the compiler tracks stability per key, not per function. `invalidates get[key]` means calling `set("user", ...)` only invalidates `get("user")`, not `get("count")`.

### What the Keyed Pattern Enables

#### Narrowing preserved across same-key reads

```ts
declare const reader: StoreAccessor<AppState>;

if (reader.get("user") !== undefined) {
    const u: string = reader.get("user");     // ✅ narrowed — same key, stable
}
```

#### Writing a DIFFERENT key does NOT invalidate narrowing

```ts
if (reader.get("user") !== undefined) {
    writer.set("count", 99);                  // writes "count"
    const u: string = reader.get("user");     // ✅ still narrowed — different key
}
```

#### Writing the SAME key invalidates and provides post-call narrowing

```ts
if (reader.get("user") !== undefined) {
    writer.set("user", "bob");                // writes "user" → invalidates get("user")
    const u: string = reader.get("user");     // ✅ post-call narrowed to string via argument
}
```

#### Exhaustive switch on keyed store fields

```ts
switch (statusStore.get("status")) {
    case "loading":
        const l: "loading" = statusStore.get("status");  // narrowed
        break;
    case "ready":
        const r: "ready" = statusStore.get("status");    // narrowed
        break;
    case "error":
        const e: "error" = statusStore.get("status");    // narrowed
        break;
    default:
        const _exhaustive: never = statusStore.get("status"); // exhaustive
}
```

#### Discriminated union narrowing via keyed access

```ts
if (reader.get("entry").kind === "text") {
    reader.get("entry").content;              // ✅ narrowed — .content accessible
}
```

### Test File

All store patterns are tested in `packages/solid/test/stores.stable-mutator.type-tests.ts` — 8 scenarios:

| # | Scenario | What It Tests |
|---|----------|---------------|
| 1 | **Derived memo from store** | `createMemo(() => store.user)` produces stable accessor |
| 2 | **Keyed accessor narrowing** | `get("user")` stays narrowed across repeated reads |
| 3 | **createTypedStore** | Combined `[read, write]` with per-key tracking |
| 4 | **Nested store access** | Keyed reads of arrays/objects stay narrowed |
| 5 | **produce as mutator** | Whole-state mutator function pattern |
| 6 | **Exhaustive switch** | `switch (store.get("status"))` exhaustiveness check |
| 7 | **Independent stores** | Writing to one store's key doesn't affect another store |
| 8 | **Discriminated union** | `.kind` narrowing on keyed access with invalidation |

### Future: Stable Properties (Potential Extension)

A future extension could add `stable` to **property types** directly:

```ts
interface Store<T> {
    stable readonly [K in keyof T]: T[K];
}
```

This would allow `store.user` property access to preserve narrowing without function wrappers — the proxy-based read would be treated as identity-stable by the compiler. This requires extending `stable` from function signatures to property types, which is a larger language change but would close the impedance mismatch entirely for proxy-based reactive state.

---

## Building tsgo From Source

To build the TypeScript-Go compiler yourself from the companion PR:

```sh
# Clone the TypeScript-Go fork
git clone https://github.com/kbrilla/typescript-go
cd typescript-go
git checkout copilot/fix-22288449-1141931061-9bf9efe0-f2f4-46ea-8d66-164de7c73c85

# Build for your platform
CGO_ENABLED=0 go build -tags='noembed,noassert' -o tsgo ./cmd/tsgo

# Cross-compile for other platforms
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -tags='noembed,noassert' -o tsgo-linux-amd64 ./cmd/tsgo
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -tags='noembed,noassert' -o tsgo-darwin-arm64 ./cmd/tsgo
```

**Companion PR:** The `stable`/`mutator`/`invalidates` implementation in TypeScript-Go is available on the branch above at [github.com/kbrilla/typescript-go](https://github.com/kbrilla/typescript-go).

---

## Background

The `stable`/`mutator`/`invalidates` modifiers are a proposal for TypeScript that addresses a fundamental limitation: the compiler cannot reason about the return-value stability of function calls. This means narrowing is always lost across function call boundaries, even when the function is a pure getter.

This is especially painful for reactive frameworks like SolidJS, Vue, Svelte (runes), and Angular (signals), where state is accessed through getter functions. The `stable` modifier solves this by letting library authors declare that a function's return value doesn't change between calls unless explicitly mutated.

For full proposal details, see the TypeScript-Go companion branch.
