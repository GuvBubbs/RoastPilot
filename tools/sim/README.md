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

**Fifteen cooks.** Four are excluded from the acceptance aggregate and say so in
`SUMMARY.md`, because they are not representative of normal operation: the
12-hour shoulder, whose thresholds are not these, and three *controls* whose bad
numbers are the measurement rather than a failure.

The controls are the most useful thing on the deck, because each isolates one
intervention by removing it:

| cook | what it removes | overshoot |
|---|---|---|
| `02-baseline-on-track` | nothing — the reference | 2.8 °F |
| `10-forgetful-cook` | the cook ignores the reading prompt | **21.1 °F** |
| `15-reading-due-prompt` | sparse habit, but the prompt obeyed and the ceiling set to 3 h so only the *derived* cadence can be doing the work | 5.3 °F |

`15` takes 9 of its 11 readings because the app asked. Compared with `10` — the
same sparse habit with the prompt ignored — that is 21.1 °F of overshoot turned
into 5.3, attributable to the derivation alone rather than to the settings
ceiling.

It replaces regression testing on the recommendation loop. It does **not**
replace real cooks — see [Limits](#limits).

## Running it

```bash
npm run sim:calibrate     # refit the thermal model against a real export
npm run sim               # run the deck, write transcripts + snapshots, ASSERT
npm run sim:baseline      # the same run, then re-record baseline.json from it
npm run sim:shots         # 40 screenshots from the snapshots npm run sim wrote
```

There is one entry point and it asserts. `npm run sim` used to be wired to a
`SIM_REPORT_ONLY` mode that wrote every transcript and asserted nothing, with the
asserting run hidden behind `sim:test`; the obvious command, the one in this
README, was the one that could not fail. That is fixed.

A failing run still writes everything: the transcripts are written per scenario
*before* anything is asserted, and `summary.json` is written in `afterAll` either
way. So a red deck still leaves the full diagnostic, and `sim:baseline` can still
re-record from it.

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

### The baseline, and why it ratchets

The deck does not pass clean, and pretending otherwise is how it stopped being
able to fail. Five cooks miss their serve time by more than the 20-minute
tolerance and several overshoot the target by 15–30 °F. Those numbers are
recorded in `baseline.json` and the harness asserts against *them*:

| verdict | when |
|---|---|
| **ok** | inside the tolerance — the baseline is not consulted at all |
| **advisory** | over tolerance, but no worse than the recorded baseline |
| **error** | worse than the baseline |
| **error** | *better* than the baseline by the ratchet margin |

The last row is the point. A baseline that only ever loosens is a baseline nobody
tightens: the improvement lands, the number stays stale, and a year later the
harness is asserting a bound that stopped being true. Making a stale baseline a
hard failure forces the fix and the tightened number into the same commit.

So when a change legitimately improves the deck, the run goes red and tells you
to re-record. Do that, and commit `baseline.json` *with the change*:

```bash
npm run sim:baseline
```

Never re-record to make an unexplained red go away — that is the one habit that
defeats the whole arrangement.

`blockedMinutes` has no tolerance and is watched in **both** directions. Silence
is not a metric with a good value: deferring advice was measured inert once
already, taking the deck from 485 to 1100 minutes of no advice at all in exchange
for one minute of accuracy.

### The oracle

`npm run sim` also runs `tools/oracle`, which is the answer to the obvious
objection about everything above: the app's model and this harness's roast are
the *same family*, so agreement between them is not evidence. The oracle is a
1-D conduction solve — an infinite spectrum of decay modes against the cascade's
one repeated pole — validated against closed-form series solutions and used to
score the projection on data neither model can fit exactly. See
`tools/README.md`.

Measured there: mean absolute error in predicted finish time of 7–16 minutes
against 27–208 minutes for the straight line the curve replaced, across a cook a
cook actually lives through. The line is a few minutes *better* late on, when a
solid body's core is nearly straight; what it cannot do is decline to answer, and
early on it is hours out in the wrong direction.

### It IS a CI gate

`.github/workflows/test.yml` runs `npm run test:run` and `npm run sim` on every
pull request, in separate jobs, and uploads `artifacts/` when the deck is red.

`vitest.config.js` still carries `exclude: [..., 'tools/**']`, so the deck is not
swept into the unit suite by vitest's default include glob — but that is about
keeping two differently-scored suites apart, not about keeping this one out of
CI. The whole deck of eight cooks runs in about 1.3 s; the unit suite takes 6.6 s.

Before this, the only gate was `npm run test:run` on push to `main` — which is
*after* merge, so the first signal a commit was broken was a failed deploy.

## How it works

```
meatModel.js       two-node thermal model + stall + oven cycling + probe error
calibrate.js       fits the model to a real export; prints residuals
calibrate.test.js  asserts the committed constants still reproduce that export
scenarios.js       the deck (8 cooks)
driver.js          closed loop: steps time, logs readings, obeys the app
score.js           the numbers a cook is judged by, derived from the outcome
baseline.js        tolerance / baseline / ratchet policy over those numbers
baseline.json      the recorded misses (committed)
baseline.cli.js    `npm run sim:baseline` - re-records baseline.json
invariants.js       the machine-checkable properties
report.js          transcripts, state budgets, checkpoint snapshots
sim.spec.js        runs the deck under vitest
shots.spec.js      Playwright screenshots from the checkpoint snapshots
```

`score.js` exists so the transcripts and the assertions cannot disagree about
what "overshoot" was: both read the same function. `calibrate.test.js` exists
because `CALIBRATED` in `meatModel.js` is two hand-pasted numbers that nothing
checked — and every scenario's ground truth is whatever they say.

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
