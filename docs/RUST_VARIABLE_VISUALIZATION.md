# Rust variable inspection

## Implemented display layer (native qualification pending)

The inspector reads DAP variables only. It does not call `Debug`, `Display`,
`iter`, `len`, lock a mutex, borrow a cell, upgrade a weak pointer, or interpret
private Rust memory layouts. Managed CodeLLDB and its matching Rust visualizers
remain responsible for logical children. Missing visualizers fall back to the
adapter's generic tree.

- Compact, single-line name/value rows. Types are abbreviated visually, with the
  complete adapter type available on hover. Primitive collection elements do not
  repeat the enclosing element type. There are no decorative map/set labels or
  per-row detail buttons for ordinary scalar values.
- On-demand pages of 20 map entries or 100 ordinary children, up to 1000 displayed
  children per node or scope. Repeated pages stop with an adapter limitation.
- Expanding a recognized map fetches the visible entries' actual tuple fields and
  displays each key beside its associated value without another tuple click.
  A shared queue limits actual in-flight pair reads to four, including old reads
  from canceled expansions. Nested values stay lazy. Unsupported field shapes
  retain an inspectable tree rather than parsing `{...}` or summary strings.
- Exact `0`/`1`, `.0`/`.1`, or `key`/`value` fields establish association; response
  order alone is not used. An empty logical response is not called an empty map
  unless the adapter reports zero count or an explicit zero-size summary.
- References are scoped to session, pause, frame, and inspection revision.
  Collapse invalidates pending loads. Repeated reference and depth-12 guards
  prevent unbounded automatic recursion.
- Adapter-marked raw internal nodes remain explicitly toggleable when returned.
  Paging does not replace a real indexed element with a distant raw tail.
- Detail view retains up to 16000 characters of a returned value and 2048 of a
  type, with explicit client-truncation labels. An adapter summary is not
  described as the complete underlying value. Text is never rendered as HTML.

## Coverage and acceptance matrix

| Type family | Presentation | Required native acceptance |
| --- | --- | --- |
| Vec, arrays, slices | Adapter indices, visible element type, pages | Empty, 99/100/101/1000 elements, nested values, ZST |
| HashMap, BTreeMap | Key/value pair columns when shape is verified | Complex keys, empty map, stable key association; never assume hash order |
| HashSet, BTreeSet | Logical member tree; preserve adapter order | Empty and nested members; do not fabricate sorted hash order |
| String, str, char | Text summary and selectable returned-value detail | Unicode, newline, NUL, long values, adapter truncation |
| Option, Result | Adapter variant and active payload tree | None/Some/Ok/Err, nested payloads |
| Struct, tuple, enum | Named or positional fields with visible types | Named, tuple and unit variants, generics |
| Box, Rc, Arc, references | Pointer summary and lazy target children | Sharing, repeated references, null/invalid states |
| VecDeque | Logical children from visualizer | Wrapped buffer and logical indexing |
| BinaryHeap, LinkedList | Adapter logical tree; no claimed sorting | Heap order, empty list, large collections |
| Weak, RefCell, Mutex, RwLock | Generic safe view, no target method calls | Expired weak pointer, borrowed/locked states |
| LeetCode ListNode, TreeNode | Generic fields and pointer/Option expansion | Nested nodes, shared Rc/RefCell, malformed/cyclic structures |

Graphical tree/list diagrams and universal recognition of user-defined types are
not implemented. They must not be inferred from a type name alone. Unrecognized
structures remain inspectable using the generic tree.

Existing native smoke scripts cover small HashMap and HashSet logical children.
Those scripts are not evidence that this change, large-container paging, every
listed type, or Windows/macOS has passed. Record actual Rust/CodeLLDB versions,
platform, screenshots, and assertions for each native qualification run.

## Regression requirements

Test next-page loading, duplicate clicks, adapters ignoring pagination, errors
and retry, collapse before response, continue/pause, frame/thread changes,
session restart, and evaluation-induced inspection invalidation. Keep the old
value out of the new paused context. Real native runs on Linux x86_64, macOS Intel,
and Windows x64 are required before declaring cross-platform support complete.

## Readability evidence

`tests/debug-real-dap-ui.mjs` consumes the platform probe's actual DAP transcript
and uses the production variable parser and renderer. It checks one-click map
expansion, exact key/value row associations, no opaque tuple summary, and cell
bounds before saving a screenshot. This is Chromium rendering of real adapter
data, not a claim of native WebView interaction. The Linux native smoke test
also checks same-row associations and visible cell bounds before screenshots.
Both kinds of evidence must be inspected; successful flattened scalar values
alone do not prove a readable map UI. Windows qualification is required for the
reported Windows failure. No repaired-platform result is claimed merely because
unit tests or the former Linux test passed.
