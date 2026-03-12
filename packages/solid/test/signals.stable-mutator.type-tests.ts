/**
 * Type tests demonstrating stable signal narrowing with tsgo.
 *
 * SolidJS's Accessor<T> is now defined as `stable () => T`, which means
 * the TypeScript-Go compiler can preserve narrowing across repeated calls
 * to signal accessors.
 *
 * These tests require tsgo (TypeScript-Go) with stable/mutator support.
 * They will not type-check with standard tsc (which doesn't know `stable`).
 *
 * Run with: /path/to/tsgo --project tsconfig.test.json --noEmit
 */
import { createSignal, Accessor } from "../src/index.js";

// =============================================================================
// 1. Basic Signal Narrowing
// Accessor is stable, so repeated calls preserve narrowing
// =============================================================================
{
    const [count] = createSignal<number | undefined>(0);

    if (count() !== undefined) {
        const a: number = count();        // ✅ Narrowed to number — stable preserves this
        const b: number = count() + 1;    // ✅ Still number — same call, same narrowing
        count().toFixed(2);               // ✅ .toFixed is available on number
    }
}

// =============================================================================
// 2. Accessor<T> type alias carries stable annotation
// =============================================================================
{
    // When you use Accessor<T> as a type, it carries the stable annotation
    function useValue(getValue: Accessor<string | undefined>) {
        if (getValue() !== undefined) {
            const s: string = getValue();  // ✅ Narrowed to string
            getValue().toUpperCase();      // ✅ .toUpperCase is available
        }
    }
}

// =============================================================================
// 3. Exhaustive switch on signal accessor
// =============================================================================
{
    type Status = "loading" | "success" | "error";
    const [status] = createSignal<Status>("loading");

    switch (status()) {
        case "loading":
            break;
        case "success":
            break;
        case "error":
            break;
        default:
            const _exhaustive: never = status();  // ✅ Exhaustiveness check works
    }
}

// =============================================================================
// 4. Discriminated union narrowing through signal
// =============================================================================
{
    type Shape =
        | { kind: "circle"; radius: number }
        | { kind: "square"; side: number };

    const [shape] = createSignal<Shape>({ kind: "circle", radius: 5 });

    if (shape().kind === "circle") {
        shape().radius;   // ✅ Narrowed to { kind: "circle"; radius: number }
    } else {
        shape().side;     // ✅ Narrowed to { kind: "square"; side: number }
    }
}

// =============================================================================
// 5. Multiple independent signals narrow independently
// =============================================================================
{
    const [a] = createSignal<number | undefined>(1);
    const [b] = createSignal<string | undefined>("x");

    if (a() !== undefined && b() !== undefined) {
        const n: number = a();   // ✅ Each signal narrows independently
        const s: string = b();   // ✅
    }
}

// =============================================================================
// 6. Signal in loop condition
// =============================================================================
{
    const [items] = createSignal<number[] | undefined>([1, 2, 3]);

    if (items() !== undefined) {
        for (const item of items()) {    // ✅ Narrowed to number[] — iterable
            item.toFixed(2);
        }
    }
}

// =============================================================================
// 7. Signal narrowing with typeof guard
// =============================================================================
{
    const [data] = createSignal<string | number | undefined>("hello");

    if (typeof data() === "string") {
        data().toUpperCase();             // ✅ Narrowed to string
    } else if (typeof data() === "number") {
        data().toFixed(2);                // ✅ Narrowed to number
    }
}

// =============================================================================
// 8. Nullish coalescing with stable accessor
// =============================================================================
{
    const [name] = createSignal<string | null>("Alice");

    if (name() !== null) {
        name().toUpperCase();             // ✅ Narrowed to string
        const len: number = name().length; // ✅ .length available
    }
}
