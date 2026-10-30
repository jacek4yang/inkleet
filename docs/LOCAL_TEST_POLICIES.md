# Local test contracts

Local results are **not** LeetCode verdicts. The application never selects a comparator from a problem title, ID, output shape, or unknown judge policy. Each named case owns its selected policy, expected value, and comparison target. The immutable run record retains those settings; changing them marks the displayed result stale until another explicit run.

## Comparison policies

- **Exact JSON (default):** object key order is irrelevant; array order matters. Decimal number tokens are normalized without binary-floating-point rounding, so adjacent integers above 2^53 remain different. Duplicate object keys are rejected.
- **Numeric tolerance:** preserves JSON structure, object keys, array order, strings, booleans and null. Each numeric leaf satisfies `abs(actual - expected) <= max(absoluteTolerance, relativeTolerance * max(abs(actual), abs(expected)))`. Both nonnegative tolerances are explicit; the initial values are `1e-6`. Decimal arithmetic preserves the supplied tokens, including large integers. This is not approximate string matching or unordered matching. A numeric leaf must convert to a finite floating-point number for range validation, have at most 256 normalized significant digits, and a normalized exponent in [-1024, 308]. The range check does not supply the compared numeric value. Out-of-range/invalid values are **uncomparable**, never a pass.
- **Outer array unordered:** compares exact JSON elements as a **multiset**. Duplicate counts matter; nested arrays retain order. Both roots must be arrays. No recursive unordered inference and no tolerance are applied.

All policies retain the original expected/actual text for display. Comparison text is bounded to 1,048,576 UTF-16 code units, depth 64, and 10,000 JSON nodes; expected text is limited to 65,536 UTF-16 code units. These text bounds are not UTF-8 byte counts. Exceeding a comparison limit does not turn a result into a pass or silently change its policy. An empty expected field means no comparison. A named case containing multiple function invocations is shown but not compared against one expected value. Interrupted, canceled, truncated, malformed, duplicated, foreign, and incomplete result batches never receive an all-passed verdict.

## Design classes: Python and Rust

The supported metadata schema explicitly supplies `classname`, `constructor.params`, and `methods` with `name`, `params` and `return.type`; `systemdesign: true` is recognized. Inputs are pairs of JSON values:

```text
["Counter","add","get"]
[[],[2],[]]
```

The first operation must be that class's constructor; subsequent operations must appear in the metadata. Unknown operations, double-underscore magic names, repeated constructors, overloads, mismatched arity and unknown parameter/return types are rejected. A sequence creates one object and executes its operations in order. Another sequence creates another object. One sequence produces one array: constructor and void methods yield `null`; each other entry is that operation's return value **at that moment**, not a reference later operations can alter. An exception/panic makes the sequence an error; a later independent sequence can still run.

Limits: at most 32 arguments per operation, 64 declared methods, 200 operations per sequence, 1,000 operations per submitted batch, 100 sequences, the existing 1 MiB input limit, process timeouts, output limits, and result serialization budgets. All named cases share the existing process/time budget. This is trusted-code execution, **not a security sandbox**.

Rust uses the official template's constructor (`new`) and snake-case method signatures to recover move/shared/mutable argument modes. When an official template is available, methods must have `&self` or `&mut self`; owned receivers, generics/overloads and unrecognized signatures fail closed. If no official template is available, conventional `new`/snake-case moved arguments are compiled; incompatible signatures fail compilation rather than invoking a different method. Existing source snapshots are not rewritten. Python uses the explicitly authored/imported named class and metadata methods; an injected convenience-prelude class cannot satisfy a missing solution. Go, C, C++ and Java design drivers remain unsupported and explicitly reject these inputs.

Design expectations compare the returned operation array. Post-call argument targets are not available for a design sequence. Design metadata now exposes separate “操作” and “参数” input fields; either may still be edited as raw JSON.

## Special types and zero-argument calls

Python and Rust additionally support `NestedInteger` and its arrays, encoded as integer leaves and nested JSON arrays. Integer leaves must fit signed 32-bit values. Rust uses the standard `Int(i32)` / `List(Vec<NestedInteger>)` enum shape. Python supplies `isInteger`, `getInteger`, `setInteger`, `add` and `getList`. Authored compatible definitions are retained rather than replaced. NestedInteger values are bounded; malformed leaves and cyclic Python results are errors. Go/C/C++/Java NestedInteger adapters remain unsupported. This is **not** support for arbitrary `Node`, graph, random-pointer, interactive, iterator or special judge interfaces.

An ordinary zero-parameter function uses one empty JSON array `[]` per invocation. Empty input does not implicitly run code.

## Evidence boundaries

`cargo run --locked --manifest-path crates/managed-env/Cargo.toml --example local_features_probe` actually compiles/runs generated Rust drivers and executes Python drivers with authored fixtures. It checks state, errors, full large integers, snapshot preservation, design sequences, NestedIterator, NestedInteger and zero-parameter calls. The dedicated workflow executes it on Linux x64, Windows x64 and macOS Intel runners; its artifact records the exact checked-out commit and tool versions. A passing runner probe is not managed-toolchain installation, native GUI, real-account, install/upgrade or LeetCode-judge qualification. Browser regressions use mocked run IPC solely to check the actual UI, persisted policies, ownership and stale-result behavior.

Additional bounds: the virtual design scaffold accepts at most 128 combined parameter/return type entries; generated Rust driver source is limited to 8 MiB. Python NestedInteger conversion is bounded to depth 64. Missing-template Rust fallback still uses the fixed constructor `new` and validated snake-case metadata method names; actual compilation determines receiver compatibility.
