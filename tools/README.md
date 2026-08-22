# tools/

## oracle/

A **second physics engine**, and the fixtures and property tests built on it.
`npm run sim` runs it.

It exists to break a circularity. The app's projection is a two-lag cascade; the
simulation harness's roast is a two-node lumped model, which with its fitted
`backReaction: 0` *is* a two-lag cascade. Same family, fitted to the same three
readings below 92 °F, every scenario extrapolating from there. Scored on that
deck alone the projection looks near-perfect and proves nothing — it would look
near-perfect if the physics were wrong in any way both models shared.

So `conductionModel.js` solves 1-D conduction in a solid body on a 120-node grid
(Crank–Nicolson), validated against the closed-form series solution for each of
its three geometries. An infinite spectrum of decay modes against the cascade's
single repeated pole: not the same family, and not reconcilable.

**Geometry turned out to matter more than the plan expected.** Scored against a
*sphere*, the evidence argues clearly for a three-lag model — and making that
change would have been worse at the only real cook there is and worse against
both of the shapes a roast actually has. A roast is a cylinder or a slab, not a
ball. So `cylinder` is the primary case and `sphere` is kept as a deliberately
adversarial one, asserted on graceful degradation rather than accuracy. The table
is in `fixtures/README.md`.

| file | what |
|---|---|
| `conductionModel.js` | the engine; `sphere` / `cylinder` / `slab` |
| `conductionModel.test.js` | the engine against its own analytic series |
| `projection.oracle.test.js` | the app's projection scored across geometries |
| `projection.properties.test.js` | properties any correct model must have |
| `fixtures/` | eight committed reading histories, two adversarial |
| `fixtures.test.js` | the fixtures |
| `makeFixtures.mjs` | regenerates them — deliberately, and rarely |


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
