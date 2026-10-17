# Expanded documentation search

## Behavior
Ctrl/Cmd+F or the header search icon opens a compact, initially hidden reader-local search row. Enter/Shift+Enter and arrow buttons navigate with wraparound. Escape closes search first; a second Escape closes the reader. Query input retains focus as matches scroll into view.

Search is literal and Unicode case-insensitive using JavaScript's simple Unicode case folding (no locale-specific normalization). Original UTF-16 offsets are retained. Inline markup can span a match; paragraphs, sections, table cells and BR boundaries cannot concatenate into false matches.

## Bounds and ownership
Search indexes only the mounted sanitized document, not the preview, raw Markdown, controls or truncation notice. Index is built once per content installation, with 524,288 text units and 32,768 visited DOM-node limits. Queries over 1,024 units fail explicitly. Complete results use compact integer triples; there is no first-1,000-match truncation. Maximum match storage is about 6 MiB, derived from the text limit, excluding index/string overhead.

Only the active result has temporary mark elements. The original Text nodes are detached intact and restored precisely, preserving surrounding elements, sanitization and node identity. Navigation does not rerender Markdown, normalize the DOM or rebuild the text index. Only reader/inner overflow containers scroll.

One 100ms trailing input timer is cancelled on composition, hide and destruction. IME navigation/dismissal is guarded until composition ends. Owner abort and close remove timers, listeners, marks and index references. A query entered while rendering waits for explicit mounted-content refresh. No MutationObserver or polling is added.

## Validation
Pure tests cover Unicode offsets, literal metacharacters, boundaries, whitespace, limits, and every result at the 256K tail. Browser acceptance covers complete-document tail search, 2,000 matches, inline markup/node identity, IME event guards, reader-local keyboard routing, two-stage Escape, narrow layout, close during pending debounce and worker races. Native test adds real Ctrl+F/input/Escape on actual JDT completion details.

CI identities and outcomes are reported separately in the Draft PR. Browser synthetic composition events do not establish native Chinese IME behavior. No production dependency, code-formatting behavior, authentication or file-save changes.
