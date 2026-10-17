# Continuous documentation search matches

Base: PR86, 78c2691530dac97a6bb6fde15913256dadf7b40a.

## Reported issue
One active search result may cross several syntax-colored Text nodes. Existing search correctly preserved each node, but every fragment received an outline and rounded corners. A single phrase appeared as separate little boxes.

## Change
CSS only: an opaque soft-amber background is identical on every fragment, with no outline, border, corner radius, shadow, padding or margins. Font and foreground color inherit from the original syntax/emphasis parent. No glyph-width or line-height changes, no geometry overlays, and no search/lifecycle state changes.

Forced-colors mode uses the user's Highlight/HighlightText system colors with forced-color-adjust:none scoped to the text-only marks. It does not opt out the reader or syntax spans.

## Acceptance
- A match spanning keywords, plain text and numbers reads as one continuous fill, with original syntax colors visible.
- Original code text, dimensions, selection/search semantics and exact Text-node restoration are unchanged.
- Same-line fragments meet without per-token boxes at normal size and CSS zoom; narrow prose wraps naturally.
- Long code remains horizontally scrollable rather than clipped.
- Forced colors uses a visible system-color match without fragmented outlines.
- Existing Ctrl/Cmd+F, Enter/Shift+Enter, Escape, IME-event, delayed-content and close/reopen tests stay enabled.
- Browser screenshots and the genuine Linux Rust Vec::push search screenshot must be inspected after CI.

CSS zoom tests do not establish native OS scaling or other-platform validation. This checkpoint changes no LSP behavior, saving, account isolation or production capability gates. No package, merge or Release.

## Verification
Pending GitHub Actions on the checkpoint head; final exact commit and evidence are recorded in its Draft PR.
