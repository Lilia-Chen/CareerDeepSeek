# CDS CLI — Computer-Use Tool Reference

`cds` is a one-command-per-invocation tool. Each action re-resolves the current managed Chrome window. Do not rely on hidden state from a prior invocation.

## Public Chrome Invoke Surface

P2.1 public commands:

- `chrome.observe`
- `chrome.findText`
- `chrome.waitForText`
- `chrome.clickTarget`
- `chrome.typeInput`
- `chrome.key`
- `chrome.scrollRegion`
- `chrome.back`
- `chrome.forward`
- `chrome.reload`
- `chrome.addressBarSubmit`

`chrome.checkSafetyGate` is not a public invoke command. Safety checks run inside each action invocation and remain available only as driver-level internals.

## Observe

```bash
pnpm cds invoke chrome.observe
pnpm cds invoke chrome.observe --scope viewport
pnpm cds invoke chrome.observe --scope browser_chrome
```

`chrome.observe` returns Chrome window evidence with region metadata. The default `--scope all` includes page viewport evidence, browser chrome evidence, and unknown-region evidence.

`--scope viewport` returns only webpage `page_viewport` evidence. `--scope browser_chrome` returns coarse Chrome-owned UI evidence outside the webpage viewport. P2.1 does not expose finer address-bar, toolbar, tab-strip, menu-bar, or bookmarks-bar region tags.

## Text

```bash
pnpm cds invoke chrome.findText --query "LangChain"
```

`chrome.findText` is observe-only and searches visible webpage text inside `page_viewport`. Use `chrome.clickTarget --kind text` for foreground text-anchor clicking.

`chrome.findText` returns visible text matches plus related `SurfaceNode` and cross-source audit context from OCR, AXTree, and Chrome DOM evidence when available. It does not store a target for later commands. Use normalized viewport bounds from the returned match/node as `hint_*` when the next action needs spatial grounding.

## Wait For Text

```bash
pnpm cds invoke chrome.waitForText --query "LangChain" --timeout_ms 5000
```

`chrome.waitForText` resolves verified viewport geometry once at invocation start, then polls OCR inside that viewport. The polling loop stays OCR-only; AXTree/DOM enrichment and region metadata are attached only on the final enriched result.

## Text Input

```bash
pnpm cds invoke chrome.typeInput --query "Search" --text "AI agent London"
pnpm cds invoke chrome.typeInput --query "Search" --text "AI agent London" --submit_key return
pnpm cds invoke chrome.typeInput --query "Search" --text "AI agent London" --hint_left 0.10 --hint_top 0.05 --hint_right 0.90 --hint_bottom 0.15
```

`chrome.typeInput` finds an input field inside `page_viewport` from fresh AXTree/DOM evidence, foreground-clicks it, replaces the field's current value with `--text`, and optionally presses `submit_key`.

Do not use `chrome.typeInput` for the Chrome address bar. Use `chrome.addressBarSubmit`.

## Click Targets

```bash
pnpm cds invoke chrome.clickTarget --query "LangChain" --kind text
pnpm cds invoke chrome.clickTarget --query "Submit" --kind button
pnpm cds invoke chrome.clickTarget --query "Code with Claude" --kind link --hint_left 0.20 --hint_top 0.30 --hint_right 0.65 --hint_bottom 0.42
```

`chrome.clickTarget` uses OCR, AXTree, and Chrome DOM evidence to resolve one foreground pointer target inside `page_viewport`. `--kind` narrows the target type to `text`, `button`, `link`, `menuitem`, or `any`. `--kind input` is not supported. `--kind any` also excludes input-capable controls. Use `chrome.typeInput` for webpage input fields. Direct AX delivery commands are not part of the ordinary CLI surface.

For `--kind any`, CDS groups OCR/AX/DOM evidence for the same visual target, then prefers confirmed interaction evidence: interactive AX role first, actionable DOM element/role second, OCR-only visible text third. If multiple candidates remain in the same highest tier, the command must return `ambiguous_target` instead of guessing.

## Keyboard

```bash
pnpm cds invoke chrome.key --key return
pnpm cds invoke chrome.key --key l --modifiers command
```

## Scroll

```bash
pnpm cds invoke chrome.scrollRegion --direction down --amount 6
```

`chrome.scrollRegion` scrolls inside `page_viewport`. Normalized region ratios are viewport-relative, not full Chrome-window-relative. The command delivers scroll input at a computed viewport point and does not perform a default pre-click.

## Browser Chrome

```bash
pnpm cds invoke chrome.back
pnpm cds invoke chrome.forward
pnpm cds invoke chrome.reload
pnpm cds invoke chrome.addressBarSubmit --text "AI agent jobs London"
```

`chrome.back`, `chrome.forward`, and `chrome.reload` operate on the active tab of the leased managed Chrome window. Primary delivery is Chrome Apple Events / JXA against the bound leased window. Keyboard fallback uses `Cmd+[` / `Cmd+]` / `Cmd+R` after foreground verification.

`chrome.addressBarSubmit` focuses the omnibox with foreground `Cmd+L`, types `--text`, and presses Return. It does not call `chrome.typeInput`, does not use `clickTarget`, and does not default to Apple Events `set URL`.

All browser-chrome domain commands perform same-invocation profile + window + tab checks: managed profile lease, leased OS window, foreground verification, and active-tab metadata before/after delivery when available.

## Anti-Patterns

- Do not use legacy candidate-state commands; target descriptions must be passed directly to each atomic command.
- Do not use `chrome.clickText`; use `chrome.clickTarget --kind text`.
- Do not use row commands; `findRows` and `clickRow` are removed from the invoke surface.
- Do not split webpage input entry into focus and type commands; use `chrome.typeInput`.
- Do not use `chrome.typeInput` for the Chrome address bar; use `chrome.addressBarSubmit`.
- Do not use `chrome.clickTarget --kind input`; input is handled by `chrome.typeInput`.
- Do not use `chrome.clickTarget --kind any` to focus input fields; `any` excludes input-capable controls.
- Do not use dotted flags such as `--target.kind`.
- Do not assume `findText` stores anything for later actions.
- Do not expect `waitForText` to run full AX/DOM enrichment on every poll; polling stays OCR-only and enrichment applies to the final result.
- Do not call `chrome.checkSafetyGate` as a public invoke command.
