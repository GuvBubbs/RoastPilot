# tools/

## viewport-audit.html

The mobile regression gate. Loads the built app in iframes at 320 / 375 / 390 /
430px, seeds a mid-cook session into localStorage, and for the dashboard plus
each sheet asserts two things:

- `document.documentElement.scrollWidth === clientWidth` — no horizontal
  overflow. This is the check that would have caught the original layout bugs.
- every visible, enabled interactive element has an *effective* tap target of at
  least 44px. Effective means a small control wrapped in a large `<label>`
  counts as the label's size, because that is what a thumb hits.

Run it:

```bash
npm run build
npx vite preview --port 4199 --strictPort &
cp tools/viewport-audit.html dist/
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --virtual-time-budget=60000 --dump-dom \
  "http://localhost:4199/RoastPilot/viewport-audit.html?n=20" \
  | python3 -c "import re,sys,html; m=re.search(r'<div id=\"out\">(.*?)</div>', sys.stdin.read(), re.S); print(html.unescape(m.group(1)))"
```

`?n=` sets the reading count — use `0`, `1` and `20`, since the thin states are
where the chart used to fall apart.
