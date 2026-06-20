# CDS CLI — Computer-Use Tool Reference

`cds` is a one-command-per-invocation tool. Each action re-resolves the current managed Chrome window. Do not rely on hidden state from a prior invocation.

## Text

```bash
pnpm cds invoke chrome.findText --query "LangChain"
pnpm cds invoke chrome.clickText --query "LangChain" --match_index 0
```

`chrome.clickText --anchor_offset_x/--anchor_offset_y` applies a capture-pixel offset from the OCR match center before CDS projects the point to logical screen coordinates.

## Rows

```bash
pnpm cds invoke chrome.findRows --query "Result"
pnpm cds invoke chrome.clickRow --query "Result" --row_index 1
```

`chrome.findRows --query` and `chrome.clickRow --query` are CDS extensions over AUV row commands. AUV row find returns all detected rows.

## Text Input

```bash
pnpm cds invoke chrome.focusText --query "Search"
pnpm cds invoke chrome.typeText --text "AI agent London" --submit_key return
```

`chrome.typeText` types into the active control. It does not search for a target. Use `chrome.focusText` or `chrome.axFocusText` first when focus is needed.

## Buttons

```bash
pnpm cds invoke chrome.pressButton --query "Submit"
pnpm cds invoke chrome.axPressButton --query "Submit"
```

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
- Do not use `chrome.typeText --query ...`; focus and type are separate commands.
- Do not use dotted flags such as `--target.kind`.
- Do not assume `findText` stores anything for `clickText`.
