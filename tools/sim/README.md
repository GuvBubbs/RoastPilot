# Simulated long-cook harness

The recommendation engine used to be exercised by unit tests over individual
functions plus real cooks. A real cook takes 6–12 hours and happens a few times
a year, so the loop that matters most — *the app suggests an oven change, the
cook makes it, the app sees the effect and suggests the next one* — had
essentially never been tested end to end. That loop is where the recent bug class
lived (`b823705`, "stop charging an oven change twice").

This harness simulates plausible long cooks in milliseconds, drives the app's
real recommendation loop through them, asserts the properties that can be stated
numerically, and renders screenshots at checkpoints so the rest can be judged by
eye.

It replaces regression testing on the recommendation loop. It does **not**
replace real cooks — see [Limits](#limits).

## Running it

```bash
npm run sim:calibrate     # refit the thermal model against a real export
npm run sim               # run the deck, write transcripts + snapshots, assert nothing
npm run sim:test          # the same run, with the invariants as assertions
npm run sim:shots         # 40 screenshots from the snapshots npm run sim wrote
```

`npm run sim` and `npm run sim:test` are the same code path — one flag decides
whether findings are fatal. A reporting run and an asserting run that could drift
apart would eventually disagree about what happened.

Narrow to one cook with `SIM_ONLY`:

```bash
SIM_ONLY=05-overnight npm run sim
```

Output lands in `artifacts/` (gitignored). Start with `artifacts/SUMMARY.md`.

### Testing a change

`SIM_SETTINGS` patches every scenario's settings, so a candidate change that is
expressible as a setting can be scored against the deck instead of argued about:

```bash
SIM_SETTINGS='{"ovenTempStaleMinutes":100000}' npm run sim
```

`artifacts/summary.json` is the machine-readable twin of the summary — overshoot,
schedule miss, silence, dial moves and reversals per scenario. The deck is
deterministic, so any movement in it is attributable to the change. Worked
examples, including two changes that made things worse, are in
`Docs/sim-harness-findings.md`.

**Screenshots need a browser installed once, by hand:**

```bash
npx playwright install chromium
```

`ignore-scripts` is on globally, so Playwright's postinstall never fetches it.

### Not a CI gate

`vitest.config.js` carries `exclude: [..., 'tools/**']`. Without it, vitest's
default include glob would sweep `sim.spec.js` into `npm run test:run`, which is
the deploy gate in `.github/workflows/deploy.yml`. That exclusion is
load-bearing: this harness is a judgement tool, and `sim:test` is *expected* to
report findings that are real defects in the app rather than in itself. Failing
the deploy on them would only teach someone to loosen the thresholds.

## How it works

```
meatModel.js    two-node thermal model + stall + oven cycling + probe error
calibrate.js    fits the model to a real export; prints residuals
scenarios.js    the deck (8 cooks)
driver.js       closed loop: steps time, logs readings, obeys the app
invariants.js   the machine-checkable properties
report.js       transcripts, state budgets, checkpoint snapshots
sim.spec.js     runs the deck under vitest
shots.spec.js   Playwright screenshots from the checkpoint snapshots
```

Almost nothing in `src/` had to change, because the architecture was already set
up for this:

- **Every engine entry point already takes `now`** —
  `computeSessionCalculations`, `checkRecommendationEligibility`,
  `generateRecommendation`, `assessOvenChangeEffect`. No clock seam had to be
  added to production code.
- **`useSession.initialize()`** loads storage into `session.value`, so a seeded
  session boots straight to the dashboard with no resume prompt.
- The seeding keys (`rstt_current_session`, `rstt_schema_version`) are the same
  two `tools/viewport-audit.html` already uses.

Two environment facts the driver has to respect:

- `useSession` keeps its state **and its deep autosave watcher** at module scope,
  so every scenario needs `vi.resetModules()` and a clean `localStorage`.
  Sharing them leaks one cook into the next.
- `useRefreshTimer` registers its interval in `onMounted`, so the composables
  must be used from a **mounted component**. Called bare, the 30 s tick never
  exists and every clock-dependent computed is frozen.

The driver deliberately drives the app's **actual composables** rather than
calling `computeSessionCalculations` and `generateRecommendation` directly. The
wiring between them — which `now` each gets, which oven temperature is passed as
the base, whether the recommendation re-reads the clock — is exactly where the
bugs live. A harness that reimplemented that wiring would be blind to them.

## The thermal model

Two nodes, integrated in 0.25-minute sub-steps:

```
dTsurface/dt = kOven * (Toven - Tsurface) - backReaction * kCore * (Tsurface - Tcore)
dTcore/dt    = kCore * (Tsurface - Tcore)
```

**Why not one node.** Fitting Newton's law of cooling to the two intervals in
`Docs/Reference/roast-session-2026-08-22.json`:

| segment | span | core | oven | measured rate | implied k |
|---|---|---|---|---|---|
| 1 | 44 min | 8.0 → 15.5 °C | 100 °C | 10.2 °C/h | 0.00193 /min |
| 2 | 44 min | 15.5 → 33.3 °C | 130 °C | 24.0 °C/h | 0.00378 /min |

`k` doubles. A single-node model cannot produce that — it predicts a *decaying*
approach to the oven temperature, and the real cook accelerates. The core is
still waiting for the thermal wave to arrive, so early on its rate is governed by
the surface–core gradient opening up, not by (oven − core).

Also modelled: **oven lag** (a new set point is approached with its own ~10 min
time constant — the other side of the app's `ovenChangeLagMinutes`), **thermostat
cycling** (±6 °C sawtooth on a ~12 min period), **probe placement bias** (a fixed
±1.5 °C offset per cook, not just noise — a badly placed probe is a constant
error and that is a state the app has to survive), and **per-reading noise**
(±0.3 °C). A seeded PRNG throughout; no `Math.random`, so a scenario replays
identically.

### Calibration record

`npm run sim:calibrate`, as committed:

```
kOven = 0.010991 /min
kCore = 0.010991 /min
backReaction = 0
SSE = 4.278e-1 F^2

residual at +44 min:  +0.61 F  (+0.34 C)
residual at +89 min:  -0.23 F  (-0.13 C)
worst: 0.61 F (0.34 C)
```

Two things the fit told us that were not assumed going in:

- **`backReaction` fits to zero.** Fitted freely, the term by which the core cools
  the surface collapses to ~5e-14. The real cook wants a thermally *thin* surface
  shell that simply tracks the oven, with the core lagging behind it. Carrying the
  term at a physically tidier value the data rejects made the worst residual
  three times larger (1.85 °F against 0.61 °F).
- **`kOven == kCore`.** This is where the fit lands, not an assumption. The ridge
  check in `calibrate.js` walks the ratio at a fixed geometric mean and the error
  rises steeply either side of 1 (SSE 0.43 at ratio 1, 2.13 at 2, 22.9 at 4), so
  the ratio is genuinely identified by these two residuals. The real cook behaves
  as two first-order lags of the same time constant — a critically damped cascade,
  whose step response `1 − (1 + kt)e^(−kt)` is exactly the accelerate-then-decay
  shape the readings show.

Constants are scaled per roast by `weight^(-2/3)` (heat has a length to travel,
and that length goes as the cube root of mass) times a per-cut `shapeFactor`.

## Limits

State these up front rather than discover them later.

- **The model is not the oven.** It validates the app against *plausible* thermal
  behaviour. Where reality is weirder than two nodes and a stall term, the
  harness is silent. Real cooks remain the only ground truth.
- **Calibrated on 89 minutes of one cook.** Two intervals, no stall data, nothing
  above 33 °C core. The endgame — the part that decides whether dinner is on time
  — is the least constrained part of the model. Re-running `sim:calibrate` after a
  full cook is the single highest-value improvement available to this harness.
- **The reference weight is an assumption.** The real export has `weight: null`.
  The constants are attributed to a 6 lb roast (`REFERENCE_WEIGHT_LB`); if that
  cook was a 3 lb or a 12 lb piece of meat, every scaled scenario is off by the
  corresponding factor.
- **The stall is fabricated.** The evaporative term through 66–74 °C is not
  calibrated against anything — the real export never gets near that band. Its
  magnitude is set so the stall costs a 9 lb shoulder about 3 hours, which is
  plausible, not measured.
- **The virtual cook is perfectly obedient.** Real ones forget, round to the
  nearest dial marking, and ignore advice. Scenario 06 pokes at this; it is not
  covered systematically.
- **Screenshots are judged, not asserted.** No pixel baselines — they would fail
  on every legitimate design change, and "does this advice read sensibly to
  someone mid-cook?" is not a question a pixel diff can ask. Layout regressions
  across 320–430 px remain the job of `tools/viewport-audit.html`.
- **Serve times come from measured model durations, not the round numbers in the
  original plan.** That plan predated the calibration and assumed a 6 lb prime
  rib needs ~5 h at 200 °F; the calibrated model says 2 h 35 m. Where the two
  disagree, the *intent* of the scenario ("on track", "running late") wins over
  the literal figure. Each departure is recorded in the scenario's own `caveat`.

## The deck

| # | scenario | exercises |
|---|---|---|
| 01 | real replay | the export's own config, units, target and dial moves, then simulated forward |
| 02 | baseline on track | does the app leave a correct cook alone? |
| 03 | running late | successive raises, without stacking them |
| 04 | running very early | lower → practical minimum → oven-off |
| 05 | overnight shoulder | 12 h, stall engaged, the app's flagship use case |
| 06 | reading gap | 100 min with no reading: staleness, confidence decay, frozen ETA |
| 07 | pause and restart | the `needs-reading` branch and `lastActiveOvenTemp` |
| 08 | Celsius, eager dial | `awaitingEffect` under a fast cadence, every suggestion round-tripped through °C |

## Reading a transcript

Each `artifacts/NN-name.md` opens with the outcome, the **overshoot** (how far
past target the true core went before the app said `at-target`) and a **time in
each state** table. That last table turned out to be the most useful number in
the whole harness: a state that is correct but occupies two hours of a three hour
cook is a different thing from the same state occupying five minutes, and reading
that off a 40-row table by eye does not work.

Then the row-by-row transcript. `core` is the model's truth; `probe` is what the
app was told. `oven set/eff` is the dial versus the temperature the meat actually
sees. The message column is the **substituted** string — what reaches the screen,
not the template.
