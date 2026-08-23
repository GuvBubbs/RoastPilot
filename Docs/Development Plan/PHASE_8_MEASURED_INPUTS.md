# Phase 8 — Measured inputs

**Status:** requirements only. Nothing here is built.

Capture three things the model already wants and currently guesses, without making
the app any more work to use on the day.

---

## The principle this phase is subject to

**The app helps cook a roast. It is not a laboratory notebook.**

Everything below is **optional**. Nothing added here may become a required field,
may block starting a cook, or may gate the projection. A cook who ignores all of
it must get exactly today's behaviour — not a warning, not a nag, not a degraded
verdict.

The test of that is stated as an acceptance criterion (A4) rather than left as an
intention.

---

## Why these three

Every thermal constant traces to one export with three readings and zero degrees
of freedom. Some of the gaps can only be closed by measurement, and the measuring
currently has nowhere to live in the app — which is how the calibration protocol
ended up asking for pen and paper. That was the wrong answer. A field that is
empty by default costs nothing and captures everything.

| what | how much work, per cook | what it retires |
|---|---|---|
| Thickness of the roast | one tape measure, once | the weight→length inference *and* the per-cut shape fudge |
| Starting core temperature | already asked for | the "did it go in cold" assumption |
| Oven temperature beside a reading | one glance, whenever you feel like it | three constants resting on nothing |

---

## R1 — Thickness, at session setup

### The requirement

In the **The roast** section, alongside Weight, capture the roast's **shortest
cross-section** — the distance through the thickest part, the short way.

- Optional. Empty by default.
- A single number plus a unit toggle (**cm / in**), matching how Weight already
  offers lb/kg.
- Stored canonically in **cm**, as `config.thicknessCm`.
- Sensible bounds: 2–30 cm. Clamp for use; do not reject.
- Label it in a way a cook understands without a diagram: *"Thickness through the
  thickest part"* with helper text *"The short way through — heat travels the
  shortest path."*

Also capture **length**, as `config.lengthCm`, same treatment. It is free while the
tape measure is out, and it is what the independent oracle's geometry should come
from. It does **not** feed the runtime projection (see R1.3).

### R1.1 — Why this is worth one measurement

`kPrior` currently estimates a conduction length from the weight and then applies a
per-cut fudge factor for the part a weight cannot express:

```js
K_REFERENCE * (REFERENCE_WEIGHT_LB / weight) ** (2 / 3) * shapeFactor
```

The physics underneath is `k ∝ α / L²`, where `L` is the conduction half-thickness.
So with a measured thickness the prior becomes:

```js
K_REFERENCE * (REFERENCE_RADIUS_CM / (thicknessCm / 2)) ** 2
```

**These are the same formula.** With the shape held fixed the two agree to every
digit — verified against `radiusForWeightCm(w, 'cylinder')` with
`REFERENCE_RADIUS_CM = 6.503`:

| weight | via weight^(-2/3) | via measured radius | radius |
|---|---|---|---|
| 3 lb | 0.017447 | 0.017447 | 5.16 cm |
| 6 lb | 0.010991 | 0.010991 | 6.50 cm |
| 12 lb | 0.006924 | 0.006924 | 8.19 cm |
| 24 lb | 0.004362 | 0.004362 | 10.32 cm |

That equivalence is the whole argument. This is **not a new model** — it is the
existing prior with a measured input in place of an inferred one, so it cannot
change behaviour for anyone who does not supply the measurement, and it removes two
guesses at once for anyone who does. `SHAPE_FACTORS` exists only to approximate what
a direct measurement states outright.

### R1.2 — Precedence

`kPrior` takes thickness when it has one, and falls back to weight and shape
otherwise:

1. `thicknessCm` present → radius-based prior. `SHAPE_FACTORS` **not applied** (it
   would double-count the shape, which is now measured).
2. Otherwise → today's `weight^(-2/3) × shapeFactor`, unchanged.
3. Neither → today's reference default, unchanged.

`kPrior`'s signature gains `thicknessCm`; existing callers passing only
`{ weightLb, meatType }` must behave **identically** to today. There are callers in
`calculationService.js`, `useCalculations.js` and both verification harnesses.

### R1.3 — What length is *not* for

`lengthCm` must not reach `kPrior` or the runtime projection. The app's model is a
lumped cascade with no geometry term beyond the one length; feeding it an aspect
ratio would imply a spatial model it does not have. Length exists to correct
`tools/oracle/conductionModel.js`, which currently *assumes* a roast is 1.5
diameters long — an assumption that was 4.0 until commit `60cddf6`, when it was
found to be making every accuracy figure the oracle certified wrong by about 2×.

Recording it in the app is how that assumption eventually becomes a measurement. It
is a `tools/` concern and a later commit.

---

## R2 — Starting temperature (mostly already done)

`config.startingTemp` already exists, is already a top-level **Starting reading**
section in setup, and already becomes `readings[0]` via `startSession`. No new
field is needed.

### What changes

- **Drop "fridge-out time" from the calibration protocol.** A measured starting
  core is strictly better than a time from which a starting core would have to be
  inferred. `Docs/calibration-cook.md` asks for the time; it should ask for the
  reading instead, which the app already stores as data rather than as free text in
  `notes`.
- **Encourage without requiring.** Helper text on the field explaining what it buys:
  the projection starts from a known state rather than an assumed one. It stays
  optional and `isFormValid` does not change.

### The one thing it does not capture — record it, do not ask for it

A single core temperature states the core, not the *gradient*. The model assumes
`Ts(0) = Tc(0)` — surface and core equal, i.e. the roast went in uniformly cold. A
roast that sat on the bench for two hours has a warm surface over a cooler core, and
a core reading of 55 °F cannot tell that apart from a roast straight out of the
fridge at 55 °F.

This is second-order, the residuals will show it, and the existing warm-start
detection already flags the extreme case. **Do not add a field for it.** Note the
limitation in the model's docstring so a future reader does not mistake the starting
temperature for a complete initial condition.

---

## R3 — Oven temperature beside a reading

### The requirement

Add an **optional** oven-temperature input to `AddReadingModal`, stored as
`ovenActualF` on the reading.

- **Empty by default. Never prefilled.** In particular, never prefilled with the
  current set point — that would manufacture data indistinguishable from a
  measurement, which is worse than having none. This is the single most important
  constraint in R3.
- Never blocks saving a reading.
- Second field, below the core temperature, visually subordinate to it. Suggested
  label *"Oven thermometer — optional"* with helper text *"If you have one on the
  shelf. Leave blank otherwise."*
- Displayed in the session's units; stored in Fahrenheit, like every other
  temperature.

### R3.1 — The field name is already fixed

`tools/sim/calibrate.js` already reads `ovenActualF` off each reading and includes
it in the objective, weighted 0.25 relative to a core residual. **Match that name
exactly.** The consumer exists; only the producer is missing. This is the whole
reason the calibration protocol was reduced to asking for a sheet of paper.

### R3.2 — Sparse data is still worth having

A field that is usually skipped produces a handful of values per cook, and that is
fine. `calibrate.js` handles per-reading presence already — it adds a term only
where the field is finite. Five readings across a cook constrain the oven's
behaviour better than none, and this is the only route to `tauOvenHeatMin`,
`tauOvenCoolMin` and `cycleAmplitudeF` short of instrumenting the oven.

### R3.3 — What it must not do

It must not feed the runtime projection. The model drives its oven node from the
**dial setting**, because that is what a cook controls and what the recommendation
engine writes. An observed oven temperature is calibration evidence, not a control
input, and mixing the two would close a loop from a measurement back into the
advice that produced it. Store it, export it, and let the offline fitter use it.

---

## R4 — Data model, migration, export

- New optional config fields: `thicknessCm`, `lengthCm`, `thicknessUnit`
  (`'cm' | 'in'`, display preference only).
- New optional reading field: `ovenActualF`.
- **No migration required and none should be written.** All four are optional and
  absent-means-unknown. A v2 session without them must load and run unchanged; the
  existing `migrateSessionToV2` must not be touched.
- The legacy `targetTemp` compatibility shadow in `legacyCompatConfig` is unaffected
  — do not disturb it. See `tools/rollback/README.md` for why it exists.
- `exportToJSON` serialises `session.config` and `session.readings` wholesale, so
  the new fields appear in the export with no change. **Verify this rather than
  assuming it** — it is one assertion.
- `exportToCSV` builds its rows explicitly and will need the new fields adding.
  Thickness and length are **absolute lengths**, not deltas: convert them with a
  length converter, and note that the carryover row in that same function was
  exported through the wrong converter for exactly this class of reason.

---

## R5 — Validation

Wire through `validateSessionConfig`, which now runs from both `SessionSetupModal`
and `SettingsPanel`:

- `thicknessCm` absent → valid. Present → finite and within 2–30 cm.
- `lengthCm` absent → valid. Present → finite, within 3–100 cm, and **not less than
  `thicknessCm`** (a roast cannot be shorter than it is thick). This cross-field
  rule is the kind that has been lost before: `validateSettings` carried one, was
  deleted as dead, and its cross-field rule was left stated nowhere until it was
  found missing.
- `ovenActualF` absent → valid. Present → finite and within 100–550 °F, matching the
  bound already applied to `initialOvenTemp`.

Validation failures must name the field and must not lose the cook's other edits.

---

## Tests required

Not optional, and not "tests exist" — these specific properties:

1. **`kPrior` equivalence.** With no thickness, `kPrior` returns bit-identical
   values to today across the 1–40 lb range and every entry in `SHAPE_FACTORS`.
   This is the regression that matters: the change must be invisible to anyone not
   using it.
2. **`kPrior` with thickness reproduces the weight rule** at the reference
   geometry, to the precision in the R1.1 table. If a future change breaks the
   equivalence, that is a finding, not a tolerance to widen.
3. **Shape factor not double-counted.** A tenderloin and a shoulder with the *same
   measured thickness* get the same prior.
4. **Absent fields change nothing end to end.** A session with no thickness and no
   `ovenActualF` produces an identical projection, confidence code and
   recommendation to the same session today. Assert on a real cook's readings, not
   a synthetic pair.
5. **The oven field is never prefilled.** Open `AddReadingModal` with a session
   whose dial is at 225 and assert the oven input is empty. This is a one-line test
   guarding the constraint most likely to be "improved" away by someone being
   helpful.
6. **Round-trip.** All four fields survive save → load → export → reimport, in both
   unit systems.
7. **`calibrate.js` consumes a real export** containing `ovenActualF` written by the
   app, not hand-edited JSON. This is the end-to-end proof the producer and consumer
   agree.
8. **Validation, both directions.** Each bound rejects, and an ordinary save still
   goes through. The second half matters more: a guard wired up with a wrong
   property name rejects everything, and the build does not notice — this happened
   in `SettingsPanel` and was caught only because a test asserted the happy path.

---

## Acceptance criteria

- **A1.** Weight, thickness, length, starting temperature and the per-reading oven
  temperature are all capturable through the UI, and all optional.
- **A2.** A cook entering a thickness gets a prior derived from it, with no shape
  factor applied.
- **A3.** `npm run sim:calibrate` on an export produced by the app — with no manual
  editing — fits the oven constants against the `ovenActualF` values it contains.
- **A4.** **The burden test.** Starting and running a cook while ignoring every
  field in this phase produces byte-identical advice, ETAs and confidence codes to
  the current build. Demonstrated by the simulated deck: 16 cooks, unchanged
  baselines, no re-baselining permitted as part of this phase. If a baseline moves,
  the change is not neutral and the reason must be understood before it lands.
- **A5.** `npm run test:run`, `npm run sim` and `npm run build` all clean.
- **A6.** `Docs/calibration-cook.md` and `Docs/next-cook-handover.md` updated: the
  oven thermometer is an app field rather than a sheet of paper, fridge-out time is
  replaced by the starting reading, and the dimensions are entered rather than
  written down.

---

## Explicitly out of scope

- **Any required field.** No exceptions.
- **Prompting for an oven reading**, on a schedule or otherwise. The reading prompt
  exists to stop the roast overshooting; adding a second thing to nag about spends
  the credibility it needs for the first.
- **Feeding `ovenActualF` into the runtime projection.** R3.3.
- **A spatial model.** `lengthCm` is recorded, not modelled. R1.3.
- **Fridge-out time.** R2.
- **Bone-in / boneless / tied as model inputs.** `meatCut` is already captured and
  currently only selects a preset. Whether it should reach the physics is a
  question for a cook with data, not a guess to encode now.
- **Changing the oracle's geometry from a single cook's measurements.** Record the
  numbers; correcting the oracle is a separate, deliberate commit, and its
  parameters must keep coming from physical reality rather than from anything fitted
  to the app.

---

## Open questions for whoever builds this

1. **Thickness of a bone-in roast** — through the meat, or including the bone? Bone
   conducts differently and the model has no term for it. Recommend measuring the
   meat and letting the residual carry the rest; state the choice in the helper text
   so two cooks measure the same thing.
2. **Where thickness lives in the form.** It belongs next to Weight, but that
   section already holds Type, Cut, Weight and a unit toggle. Worth a look at
   320 px before committing to a layout — `StatusCards` has twice ruled against
   crowding at that width.
3. **Whether to show the derived prior back to the cook.** Tempting, and probably
   not: it is an internal constant, and the app deliberately shows interpretation
   (`confidence`) rather than raw fit output. Leave it out unless there is a reason.
4. **Whether one thickness is enough for a tapered roast.** A leg of lamb is not a
   cylinder. Probably yes, with the residual absorbing it — but this is the kind of
   question one real cook answers and no amount of reasoning does.

---

## Related

- `Docs/next-cook-handover.md` — what to bring back from the next real cook
- `Docs/calibration-cook.md` — the protocol for the day
- `tools/oracle/fixtures/README.md` — why the cylinder is the primary geometry
- `src/services/thermalModel.js` — `kPrior`, `SHAPE_FACTORS`, `K_REFERENCE`
- `tools/sim/calibrate.js` — the existing `ovenActualF` consumer
