# CareerDeepSeek Observer Extension

This is the default low-footprint browser observation experiment surface.

## Boundary

- Uses Manifest V3.
- Uses `activeTab` and `scripting`.
- Does not request `debugger`.
- Does not request `tabs`.
- Does not request `<all_urls>` host permissions.
- Does not declare persistent `content_scripts`.
- Does not inject overlays, cursors, DOM markers, or global element maps into the target page.
- Runs one read-only observation function after the user clicks the extension popup.

The output is a DOM-visible observation with ARIA/HTML-derived semantic approximation. It is not Chrome's native accessibility tree. Native AX corroboration belongs to the CDP debug observer.

## Local Use

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Load this directory as an unpacked extension.
4. Open a page.
5. Click the extension icon, then click `Observe`.

The popup shows screenshot preview and compact JSON. Do not save real screenshots, raw page text, or real browsing evidence inside this public repository.
