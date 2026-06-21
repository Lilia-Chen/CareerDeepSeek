# CDS CLI — Computer-Use Tool Reference

`cds` is a one-command-per-invocation tool. Each action re-resolves the current managed Chrome window. Do not rely on hidden state from a prior invocation.

## Text

```bash
pnpm cds invoke chrome.findText --query "LangChain"
```

`chrome.findText` is observe-only. Use `chrome.clickTarget --kind text` for foreground text-anchor clicking.

`chrome.findText` returns visible text matches plus related `SurfaceNode` and cross-source audit context from OCR, AXTree, and Chrome DOM evidence when available. It does not store a target for later commands. Use normalized bounds from the returned match/node as `hint_*` when the next action needs spatial grounding.

## Text Input

```bash
pnpm cds invoke chrome.typeInput --query "Search" --text "AI agent London"
pnpm cds invoke chrome.typeInput --query "Search" --text "AI agent London" --submit_key return
pnpm cds invoke chrome.typeInput --query "Search" --text "AI agent London" --hint_left 0.10 --hint_top 0.05 --hint_right 0.90 --hint_bottom 0.15
```

`chrome.typeInput` finds an input field from fresh AXTree/DOM evidence, foreground-clicks it, replaces the field's current value with `--text`, and optionally presses `submit_key`.

## Click Targets

```bash
pnpm cds invoke chrome.clickTarget --query "LangChain" --kind text
pnpm cds invoke chrome.clickTarget --query "Submit" --kind button
pnpm cds invoke chrome.clickTarget --query "Code with Claude" --kind link --hint_left 0.20 --hint_top 0.30 --hint_right 0.65 --hint_bottom 0.42
```

`chrome.clickTarget` uses OCR, AXTree, and Chrome DOM evidence to resolve one foreground pointer target. `--kind` narrows the target type to `text`, `button`, `link`, `menuitem`, or `any`. `--kind input` is not supported. `--kind any` also excludes input-capable controls. Use `chrome.typeInput` for input fields. Direct AX delivery commands are not part of the ordinary CLI surface.

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

## Anti-Patterns

- Do not use legacy candidate-state commands; target descriptions must be passed directly to each atomic command.
- Do not use `chrome.clickText`; use `chrome.clickTarget --kind text`.
- Do not use row commands; `findRows` and `clickRow` are removed from the invoke surface.
- Do not split input entry into focus and type commands; use `chrome.typeInput`.
- Do not use `chrome.clickTarget --kind input`; input is handled by `chrome.typeInput`.
- Do not use `chrome.clickTarget --kind any` to focus input fields; `any` excludes input-capable controls.
- Do not use dotted flags such as `--target.kind`.
- Do not assume `findText` stores anything for later actions.
- Do not expect `waitForText` to run full AX/DOM enrichment on every poll; polling stays OCR-only and enrichment applies to the final result.
