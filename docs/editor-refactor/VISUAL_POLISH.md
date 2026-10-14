# Minimal visual polish

Base: 9ecdbd09a1f65e29bc62b163883f1a8c56f09e19. Independent visual checkpoint; Tauri 2 / React / CodeMirror 6 / Rust unchanged.

## Reference and scope
Lithe reference remains 6210013d06e1410c7bcbb1949e1ff16ea8deae15. The existing LITHE_REFERENCE.md maps layout, settings, editor settings and command-palette sources. This checkpoint applies the documented design principles (quiet workspace, progressive disclosure, compact controls), not Monaco/Swift code. No upstream code or third-party assets copied; the new add glyph is an original SVG path using InkLeet's existing icon component.

## Changes
- Neutral paper/editor/sidebar surfaces, consistent boundaries and opaque keyboard-focus rings. Warm accent reserved for active controls. Intel One Mono stays in code, stack and variable values.
- Quieter inactive icons, aligned sidebar numbers and selected-row inset; desktop sidebar gives 32 px back to reading/editing above 1100 px.
- Code gutter shares editor surface. Narrow editor toolbar uses container sizing without clipping menus or focus rings.
- Debug status and breakpoint count share one compact row. Stack names ellipsize with complete hover title and separate line column. One outer inspection scroll surface; scalar values no longer look disabled.
- Watch add/remove use accessible SVG IconButton. Warnings, errors, stale-snapshot protection, invocation guards and evaluator semantics unchanged.
- Login help moves into the manual; verification and cancellation remain explicit, with errors visible. Login UI race tests retain every assertion with the renamed visible action.

## Reproducible acceptance
1. At widths 1440, 1100 and 800, open a problem, select language and named answer; toolbar controls remain inside the pane. Open the answer menu and verify it is not clipped.
2. Tab through search, selects, answer menu and buttons. Focus is visible. In OS high contrast, selects use native appearance; reduced motion disables decorative transitions.
3. Run and pause a local test. Inspect stack, scalar/expanded values, evaluate once and add/delete a watch. Scroll to later frames/watches, then step and stop. Existing values and action guards must remain correct.
4. Open Settings, search, change download proxy, provoke persistence failure, close with Escape. Focus returns to the invoking control and draft is retained.
5. Open login; only concise actions appear. Cancel a pending verification, complete a newer one, then resolve the stale request. Old identity must not replace the active account.

## Evidence boundary
At initial commit, visual changes are authored but browser/native verification and new screenshots are pending GitHub Actions. Existing PR9 CI success does not qualify this visual checkpoint. Authenticated Chinese-site submissions and Windows/macOS/Android native GUI remain unverified. No release or main-branch merge.
