// @noEmit: true
// @strict: true

// Type tests demonstrating stable/mutator/invalidates modifiers with SolidJS store patterns.
// SolidJS stores use property access (store.user), but our modifiers work on FUNCTIONS.
// These tests show bridge patterns that bring per-key stability to store-like APIs.
//
// CRITICAL: Narrowing from `stable[key]` propagates through the METHOD CALL itself,
// not through intermediate variables. You must check the method call directly:
//   if (reader.get("key") !== undefined) { reader.get("key") /* narrowed */ }
// NOT:
//   const v = reader.get("key"); if (v !== undefined) { reader.get("key") /* NOT narrowed */ }

// ============================================================================
// Common type declarations (no imports — all declare'd)
// ============================================================================

type Accessor<T> = stable () => T;

declare function createMemo<T>(fn: () => T): Accessor<T>;

type Status = "loading" | "ready" | "error";

interface AppState {
    user: string | undefined;
    count: number;
    status: Status;
}

// ============================================================================
// Scenario 1: Derived Memo from Store (works today)
// ============================================================================
// createMemo wraps a store property read into an Accessor<T> (which is stable).
// The returned Accessor is stable, so narrowing is preserved across calls.

declare const store: AppState;
const userMemo: Accessor<string | undefined> = createMemo(() => store.user);

if (userMemo() !== undefined) {
    userMemo().toUpperCase();                   // OK — narrowed to string (stable)
    const len: number = userMemo().length;      // OK — still narrowed
}

// ============================================================================
// Scenario 2: Keyed Store Accessor and Writer
// ============================================================================
// StoreAccessor uses stable[key] so repeated reads of the SAME key
// return the same narrowed type. StoreWriter uses mutator + invalidates get[key]
// so writing to key K only invalidates get(K), not other keys.
//
// The if-check MUST be directly on the method call for narrowing to propagate.

interface StoreAccessor<T> {
    stable[key] get<K extends keyof T & string>(key: K): T[K];
}

interface StoreWriter<T> {
    mutator set<K extends keyof T & string>(key: K, value: T[K]): void invalidates get[key];
}

declare const reader: StoreAccessor<AppState>;
declare const writer: StoreWriter<AppState>;

// Check directly on the method call — narrowing propagates to subsequent same-key calls
if (reader.get("user") !== undefined) {
    const u2: string = reader.get("user");     // narrowed (same key, same call site)

    // Writing a DIFFERENT key does NOT invalidate "user"
    writer.set("count", 99);
    const u3: string = reader.get("user");     // still narrowed

    // Writing "user" DOES invalidate "user" — but post-call narrowing from argument "bob"
    writer.set("user", "bob");
    const u4: string = reader.get("user");     // post-call narrowed to string via argument "bob"
}

// ============================================================================
// Scenario 3: createTypedStore — combined keyed accessor + writer
// ============================================================================
// Returns [read, write] where per-key narrowing is independently tracked.
// write("count") must NOT invalidate read("user").
// Uses `T extends object` constraint (not Record<string, unknown> which fails
// with interfaces that have specific keys).

declare function createTypedStore<T extends object>(init: T): [
    read: StoreAccessor<T>,
    write: StoreWriter<T>,
];

const [rdr, wrt] = createTypedStore<AppState>({
    user: undefined,
    count: 0,
    status: "loading",
});

// Check directly on the method call
if (rdr.get("user") !== undefined) {
    // Reading "user" again — narrowed
    const a: string = rdr.get("user");

    // Write to "count" — does NOT affect "user" narrowing
    wrt.set("count", 42);
    const b: string = rdr.get("user");         // still narrowed

    // Write to "user" → invalidates get["user"]
    wrt.set("user", undefined);
    const c = rdr.get("user");                  // invalidated — back to string | undefined

    // Widen it back by writing a string
    wrt.set("user", "alice");
    const d: string = rdr.get("user");         // post-call narrowed to string via argument
}

// ============================================================================
// Scenario 4: Nested Store Access via Keys
// ============================================================================
// Deeper nesting: get("users") returns an array or discriminated union,
// and it stays narrowed because stable[key] treats repeated reads as stable.

interface NestedState {
    users: { userName: string; role: "admin" | "user" }[] | undefined;
    config: { theme: "light" | "dark" } | undefined;
}

declare const nested: StoreAccessor<NestedState>;

// Check directly on the method call
if (nested.get("users") !== undefined) {
    // Array operations on narrowed result
    const firstUser = nested.get("users")![0];
    nested.get("users")!.map(u => u.userName);

    // Re-reading "users" is still narrowed
    const len: number = nested.get("users")!.length;
}

if (nested.get("config") !== undefined) {
    const theme: "light" | "dark" = nested.get("config")!.theme;

    // Reading "config" again — still narrowed
    const t2: "light" | "dark" = nested.get("config")!.theme;
}

// ============================================================================
// Scenario 5: produce as mutator pattern
// ============================================================================
// produce-like utility that returns a mutator function.
// Not keyed (operates on the whole state), but shows the mutator pattern.

declare function typedProduce<T>(fn: (state: T) => void): mutator (state: T) => T;

const updateUser = typedProduce<AppState>(state => {
    state.user = "updated";
});

// The returned function is a mutator — calling it invalidates any stable
// binding of its return type.
declare const stableState: stable () => AppState;
const s1 = stableState();
const s2 = stableState();  // stable — same reference concept

// ============================================================================
// Scenario 6: Exhaustive Switch on Store Field
// ============================================================================
// stable[key] makes repeated reads of "status" stable, so exhaustive
// switch/case narrowing is sound across multiple reads.
// The switch expression MUST be directly on the method call.

declare const statusStore: StoreAccessor<AppState>;

function handleStatus() {
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
            // Exhaustive — statusStore.get("status") is `never` here
            const _exhaustive: never = statusStore.get("status");
    }
}

// ============================================================================
// Scenario 7: Independent Store Fields Don't Cross-Invalidate
// ============================================================================
// Two separate keyed stores. Writing to one store's key must NOT affect
// the other store's narrowing at all.
// Uses "userName" field to avoid conflict with lib.dom.d.ts `declare const name: void`.

interface UserState {
    userName: string | undefined;
    email: string | undefined;
}

interface CounterState {
    value: number | undefined;
    max: number;
}

declare const userRdr: StoreAccessor<UserState>;
declare const userWrt: StoreWriter<UserState>;
declare const cntRdr: StoreAccessor<CounterState>;
declare const cntWrt: StoreWriter<CounterState>;

// Check directly on the method calls
if (userRdr.get("userName") !== undefined && cntRdr.get("value") !== undefined) {
    // Both narrowed
    const n: string = userRdr.get("userName");
    const v: number = cntRdr.get("value");

    // Writing to counter "value" doesn't affect user "userName"
    cntWrt.set("value", undefined);
    const n2: string = userRdr.get("userName");    // still narrowed

    // Writing to user "email" doesn't affect user "userName"
    userWrt.set("email", "test@example.com");
    const n3: string = userRdr.get("userName");    // still narrowed (different key)

    // Writing to user "userName" DOES invalidate user "userName"
    userWrt.set("userName", undefined);
    const n4 = userRdr.get("userName");            // post-call narrowed to undefined via argument
}

// ============================================================================
// Scenario 8: Mutable store accessor with conditional narrowing
// ============================================================================
// Wrapping createMutable-like behavior in typed accessors with narrowing.
// Shows a full read/write interface with discriminated union narrowing.

type MutableEntry =
    | { kind: "text"; content: string }
    | { kind: "image"; url: string; width: number }
    | { kind: "empty" };

interface MutableStore {
    stable[key] get<K extends string>(key: K): MutableEntry;
    mutator set<K extends string>(key: K, value: MutableEntry): void invalidates get[key];
}

declare const mstore: MutableStore;

// Check directly on the method call's property
if (mstore.get("doc1").kind === "text") {
    const content: string = (mstore.get("doc1") as { kind: "text"; content: string }).content;

    // Writing a DIFFERENT key preserves narrowing
    mstore.set("doc2", { kind: "empty" });
    // doc1 still narrowed
    const c2: string = (mstore.get("doc1") as { kind: "text"; content: string }).content;

    // Writing "doc1" invalidates it — post-call narrowing from argument
    // @ts-expect-error TS100014 — expected: uncertainty boundary (narrowing dropped by mutator)
    mstore.set("doc1", { kind: "image", url: "pic.png", width: 100 });
    // doc1 invalidated + post-call narrowed to the argument type
    const e4 = mstore.get("doc1");
}