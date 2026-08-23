# Phase 8 — Measured inputs

**Status:** requirements only. Nothing here is built.

Ask for everything about the roast and the oven that the thermal model or the
simulator parameterises, once, at the start of a cook — and put all of it in the
export. Without making the app any more work to use on the day.

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

## Why

Every thermal constant traces to one export with three readings and zero degrees
of freedom. Some of the gaps can only be closed by measurement, and the measuring
currently has nowhere to live in the app — which is how the calibration protocol
ended up asking for pen and paper. That was the wrong answer. A field that is
empty by default costs nothing and captures everything.

| what | work, per cook | what it retires | req |
|---|---|---|---|
| Thickness of the roast | one tape measure, once | the weight→length inference *and* the per-cut shape fudge | R1 |
| Length | same tape measure | the oracle's assumed aspect ratio | R1.3 |
| Starting core temperature | already asked for | the "did it go in cold" assumption | R2 |
| Oven temperature by a reading | one glance, when you feel like it | three constants resting on nothing | R3 |
| Bone in or out | already asked for | nothing yet — it reaches no physics at all | R6 |
| Fan-forced or conventional | one tap, once ever | `BIOT = 8`, hardcoded "natural convection" | R7.1 |
| Covered or open | one tap | the same surface-transfer channel as the fan | R7.2 |
| Whether a stall is expected | nothing — derived from the type | the app rediscovering the stall every cook | R8 |

---

## What the two models parameterise, and what the app asks

Worked through `tools/sim/meatModel.js`, `tools/oracle/conductionModel.js` and
`src/services/thermalModel.js`. This is the whole input surface.

| parameter | where | asked at setup? | reaches the app's physics? |
|---|---|---|---|
| meat type | `SHAPE_FACTORS`, `CUTS` | **yes** | yes — shape factor |
| weight | `kPrior` | **yes** | yes |
| starting core temp | `readings[0]` | **yes** | yes |
| starting oven setting | opening set point | **yes** | yes |
| **cut (bone-in / boneless)** | — | **yes** | **no — label and CSV only** |
| **thickness** | the whole point of `weight^(-2/3) × shapeFactor` | **no** | R1 |
| **length** | oracle aspect ratio, assumed 1.5 D | **no** | R1.3 — recorded, not modelled |
| **stalls (per cut)** | `CUTS[cut].stalls` | **no** — derivable from type | R8 |
| **fan vs conventional oven** | `BIOT = 8`, "natural convection" | **no** | R7 |
| **covered / foil / open** | same channel as the fan | **no** | R7 |
| oven temperature observed | `ovenActualF` | **no** | R3 — calibration only |
| kitchen ambient | `ambientF = 70` | **no** | R7.3 — minor |
| `tauOvenHeatMin` / `tauOvenCoolMin` | oven lag | no — **measure, don't ask** | R3 |
| `cycleAmplitudeF`, `cyclePeriodMin` | thermostat sawtooth | no — not knowable by a cook | R3 |
| `probeBiasRangeF`, `probeNoiseF` | probe error | **never ask** — it is an error, not a setting | — |
| `ALPHA_CM2_PER_MIN = 0.084` | beef diffusivity | no — it is mostly water content, near-constant across red meat | — |

Four gaps a cook could simply state, and one field already stated that goes
nowhere. Everything else is either measured (R3) or not a cook's business.

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

## R6 — The cut already asked for should reach the physics, or say why not

`config.meatCut` is captured at setup, offers Bone-in / Boneless for four of the
five presets, and reaches **nothing but a label in SettingsPanel and a row in the
CSV export**. It does not touch `kPrior`, `SHAPE_FACTORS` or the projection.

Bone-in versus boneless is a real physical difference — bone conducts differently
from muscle, and a bone-in roast is usually a different shape at the same weight.

### The requirement is *not* to invent a coefficient

There is no data to justify a bone-in factor, and inventing one is exactly the
failure this whole line of work has been correcting. So:

1. Pass `meatCut` into `kPrior`'s parameter object, so the call sites already carry
   it and a future calibration can test a factor without touching every caller.
2. Apply **1.0** for every cut, and say so in the docstring: *"captured, exported,
   and deliberately not yet used — no cook has been measured that could justify a
   number."*
3. Ensure it is in the export (it is, `config` is serialised wholesale) and in the
   CSV (it is, `exportService.js:129`).

That way the data accumulates, the wiring exists, and nothing is fabricated. If a
cook with a thickness measurement is entered, R1 supersedes this anyway — a measured
thickness already contains whatever the bone did to the shape.

## R7 — Oven character

The single largest un-asked physical input. `BIOT = 8` is documented as
"a domestic oven with **natural convection**". A fan-forced oven has substantially
higher surface heat transfer, and a roast under foil has substantially lower. Both
change how fast the surface tracks the oven, which is the first stage of the
cascade.

### R7.1 — Fan-forced or conventional: a persisted setting, not a per-cook question

This is a property of the cook's **oven**, not of the roast. Asking it every time is
the sort of friction this phase exists to avoid.

- Lives in **Settings** as `settings.ovenIsFanForced` (boolean, default `false`),
  asked once and remembered.
- Surfaced in setup only as a one-line confirmation of the remembered value, with a
  way to change it — not as a question.

### R7.2 — Covered or open: per-cook, one tap

`config.covering`: `'open' | 'foil' | 'lid'`, default `'open'`. This genuinely
varies cook to cook and a lidded pot is a different thermal problem from an open
tray.

### R7.3 — Kitchen ambient: optional, and mainly for the rest

`config.ambientF`, optional, defaulting to today's `AMBIENT_F` of 70 °F. It matters
in two places: how fast the oven cools when switched off, and — more importantly —
how the roast behaves during the rest, which is where the carryover measurement
comes from. A rest in a 12 °C kitchen is not a rest in a 24 °C one.

Low priority. One number, and the default is fine for most cooks.

### R7.4 — None of these three feed the runtime model yet

Same rule as R3.3 and R6: **capture, export, do not consume.** There is no
calibrated coefficient for a fan oven or for foil, and the honest move is to record
the conditions so that one real cook can produce one, rather than to guess a
multiplier now and have it look like knowledge.

What they change immediately is the *interpretation of a calibration run*: a fitted
`k` from a fan-forced covered cook and one from an open conventional cook are not
the same measurement, and today's export cannot tell them apart. That alone
justifies the fields.

## R8 — Stall expectation, derived rather than asked

`tools/sim/meatModel.js` knows which cuts stall — `CUTS['pork-shoulder'].stalls` is
`true`, the other four are `false`. The app has **no stall concept at all**. Its
rate-agreement gate discovers a stall reactively, every cook, from scratch.

No new setup question is needed: the app already has `meatType`.

### The requirement

Expose a derived `expectsStall` from the meat type, and use it **only for the
copy**, not for the maths:

- When the rate gate refuses and `expectsStall` is true, say so with confidence:
  *"This is the stall — normal for a shoulder around 150–165 °F. Timing advice comes
  back when it picks up again."*
- When it refuses and `expectsStall` is false, the current wording is right, because
  an unexpected slowdown on a prime rib might well be a probe that has moved.

The maths must not change. A stall term in the model is a much larger piece of work
and needs the endgame data the next real cook will produce. This is copy that tells
the cook what is happening, from information the app already holds.

## R9 — Everything asked must be in the JSON

The user-facing requirement behind all of the above: **if the app asks it, the
export carries it.**

- `exportToJSON` serialises `session.config` and `session.readings` wholesale, so
  every new config field lands automatically. Assert it rather than assume it.
- `exportToCSV` builds rows explicitly. Add: thickness, length, covering, ambient,
  and `settings.ovenIsFanForced`. Lengths are **absolute**, not deltas — use a
  length converter, and note that the carryover row in that same function was
  exported through the wrong converter for precisely this class of reason.
- The reading rows need an `ovenActualF` column, blank where absent.

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

- **A1.** Weight, thickness, length, cut, meat type, starting temperature, oven
  character (fan / covering / ambient) and the per-reading oven temperature are all
  capturable through the UI, and all optional.
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
- **A7.** Every field this phase adds appears in both exports. A cook who fills in
  everything produces a JSON from which the conditions of the cook can be
  reconstructed without asking them a single follow-up question. That is the test:
  **could a session months later work out what this roast was and what oven it was
  in, from the file alone?**
- **A8.** Setup remains one screen-worth of scrolling with no new required field,
  and the time from "open the app" to "start cook" for someone who skips everything
  optional does not increase.

---

## Explicitly out of scope

- **Any required field.** No exceptions.
- **Prompting for an oven reading**, on a schedule or otherwise. The reading prompt
  exists to stop the roast overshooting; adding a second thing to nag about spends
  the credibility it needs for the first.
- **Feeding `ovenActualF` into the runtime projection.** R3.3.
- **A spatial model.** `lengthCm` is recorded, not modelled. R1.3.
- **Fridge-out time.** R2.
- **A coefficient for bone-in, fan-forced or foil.** R6 and R7 capture and export
  them and deliberately apply nothing. There is no cook measured that could justify
  a number, and inventing one is the failure this whole line of work has been
  correcting.
- **Poultry.** `MEAT_PRESETS` has five entries and none of them is a bird, so a
  chicken or turkey falls through to a neutral shape factor — while
  `tools/oracle/fixtures/03-cylinder-24lb-175F` is described as "a 24 lb bird" and
  the harness deck is entirely red meat. Adding poultry is not a preset entry: a
  bird is a shell around a cavity rather than a solid mass, and the app's whole
  pause-safety argument is built on `MIN_CORE_FOR_OVEN_OFF_F = 140`, which is
  red-meat reasoning. See the open questions.
- **A stall term in the model.** R8 is copy only. A real stall term needs the
  endgame data the next real cook produces.
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
5. **Poultry — a whole separate decision, not a preset.** A bird is a shell around
   a cavity, so a solid-body cascade is a poor description of it, and the food-safety
   floor the pause logic rests on is red-meat reasoning at 140 °F. If poultry is
   wanted, it needs its own thinking about both, and probably its own safety floor.
   Until then, leaving it out of the presets is more honest than a shape factor that
   implies the model understands it.
6. **Should `ovenIsFanForced` be per-oven or per-cook?** Specified as per-oven in
   R7.1 on the grounds that people own one oven. A cook who roasts at someone
   else's house would disagree. A remembered default with a per-cook override is
   the likely answer; confirm before building.

---

## Related

- `Docs/next-cook-handover.md` — what to bring back from the next real cook
- `Docs/calibration-cook.md` — the protocol for the day
- `tools/oracle/fixtures/README.md` — why the cylinder is the primary geometry
- `src/services/thermalModel.js` — `kPrior`, `SHAPE_FACTORS`, `K_REFERENCE`
- `tools/sim/calibrate.js` — the existing `ovenActualF` consumer
