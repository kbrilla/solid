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

Two lines were modified and one test file was added:

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

### 3. `packages/solid/test/signals.stable-mutator.type-tests.ts` (new file)

Eight narrowing test scenarios that type-check correctly with tsgo. See [Test Scenarios](#test-scenarios) below.

---

## What Was NOT Changed (and Why)

**`Signal<T>` and `Setter<T>` were not annotated** with `mutator` or `invalidates`.

SolidJS's `Setter<T>` is a complex overloaded callable interface:

```ts
export type Setter<in out T> = {
  <U extends T>(...args: undefined extends T ? [] : [value: ...]): ...;
  <U extends T>(value: (prev: T) => U): U;
  <U extends T>(value: Exclude<U, Function>): U;
  <U extends T>(value: Exclude<U, Function> | ((prev: T) => U)): U;
};
```

Inlining `mutator` syntax on these overloads caused type incompatibility errors. The `stable` annotation on `Accessor<T>` alone provides the core benefit: narrowed types are preserved across signal reads. The `mutator`/`invalidates` annotations would additionally allow the compiler to *reset* narrowing when a setter is called, but that's an incremental improvement — not a prerequisite for the narrowing preservation demonstrated here.

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
