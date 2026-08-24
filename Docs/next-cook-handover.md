# Handover: the next real cook

**Written 2026-08-23, for a session that will happen months from now.**

`calibration-cook.md` is the protocol — what to do on the day. This is the
companion to it: what to **bring back**, and what a fresh chat needs to be told
before it can use any of it.

Read the first half before the cook. Hand the second half to the new chat.

---

# Part 1 — What to bring back

**Phase 8 is built** — see `Docs/Development Plan/PHASE_8_MEASURED_INPUTS.md`.
Everything the model needs is an app field: the dimensions and the oven's character
asked once at setup, the oven thermometer optional on every reading, and all of it
in the export. There is no clipboard and no paper step.

## Fill in the setup form completely — that is the whole job

Every field below is optional as far as the app is concerned, and every one of them
retires a guess. None of it is work during the cook; it is two minutes before the
roast goes in.

| field | why it matters |
|---|---|
| **Type** and **cut** | Type selects the shape factor. Cut is captured and exported but deliberately reaches no physics yet — it accumulates so that a future cook can test whether bone-in deserves a coefficient. |
| **Weight**, to 0.1 lb | The prior scales as `weight^(-2/3)`. The existing reference cook's weight is `null`, so the 6 lb figure everything descends from is an assumption. |
| **Thickness** through the thickest part, the short way | The strongest single input. It replaces *both* the weight→length inference and the per-cut shape fudge with a measurement, because the prior is really `k ∝ α/L²`. One tape measure. |
| **Length** | Free while the tape measure is out. Corrects the independent oracle's assumed 1.5-diameter aspect ratio — it does not touch the app's own projection. |
| **Starting reading** | Becomes `readings[0]`, so the projection starts from a measured state rather than an assumed one. |
| **Starting oven setting** | Already required. |
| **Fan-forced or conventional** | Remembered per oven, so asked once ever — and recorded per cook, so a roast at someone else's house does not export a lie. The oracle's `BIOT = 8` is hardcoded as "natural convection" and a fan oven is not that. |
| **Covered / foil / open** | A lidded pot is a different thermal problem from an open tray. |
| **Kitchen ambient**, if it is unusual | Matters mostly for the rest, which is where carryover comes from. A rest in a 12 °C kitchen is not a rest in a 24 °C one. Skip it if the kitchen is ordinary. |
| **Notes** | Anything odd. Free text, comes through in the export. |

## During the cook — two things, both optional

**Oven temperature, whenever you glance at it.** The reading modal has an optional
oven-thermometer field beside the core temperature. It is blank by default and never
required. Fill it in when you happen to look; skip it when you do not. Even five
values across a cook constrain `tauOvenHeatMin`, `tauOvenCoolMin` and
`cycleAmplitudeF`, three constants currently resting on nothing.

**One deliberate 20–30 minute oven-off**, somewhere in the middle. Log it with
**Pause cooking** and log the restart. This single interval is the only thing that
would ever constrain `tauOvenCoolMin`. Pausing by hand is unrestricted — the 140 °F
floor governs what the app *suggests*, not what you do.

## The readings, and the part that actually matters

- **Every 10 minutes** from the moment it goes in.
- **Every 5 minutes once the core passes 110 °F.**
- **Keep logging through the pull, the whole rest, and the first slice.**

That last line is the one irreplaceable thing in this document. It is the only
possible source of a **measured carryover**, and the measurement needs no fitting at
all:

> **carryover = highest core reached during the rest − core at the moment of the pull**

Two numbers off your own data. The app currently ships a straight-line guess — about
+4 °F at a 200 °F oven — that has never been measured against anything, and an
evaporation-free solve of the app's own model disagrees with published instrumented
measurements of the same cut class by a factor of three.

**Log an oven-off event at the moment you pull the meat.** It is the closest thing
the app can represent to "the roast is now on a board". See the caveat in Part 2 — it
is not a perfect proxy, and the rest block should be read by hand rather than fitted.

## Two things about the outcome, in Notes or in your own words

- **Was it how you wanted it?** Over, under, or right. The whole app exists to land
  this, and there is no record anywhere of whether it ever has.
- **Anything unusual.** Door opened, foil added part way, tray moved, oven
  struggling, a reading you think was wrong and why. A note costs nothing and an
  unexplained outlier costs an afternoon.

## If it does not all happen

Still worth bringing back. Ranked by what is irreplaceable:

1. **Readings through the pull and rest** — carryover. Nothing else can produce it.
2. **Thickness, and weight** — retires the two standing geometry assumptions.
3. **One deliberate oven-off** — `tauOvenCoolMin` is constrained by nothing today.
4. **A few oven-thermometer values** — three fabricated constants.
5. **Fan / covering** — cheap, and without them a fitted `k` cannot be compared
   against anyone else's cook.
6. **Two dial moves 45+ min apart** — nice to have; the deck already covers this shape.

A cook with items 1 and 2 and nothing else is a large improvement on what exists.

## One thing that changed and makes life easier

You no longer need to log a reading the instant the roast goes in. The projection
used to start its timeline at the *first reading* and silently discard everything
before it, which inverted its own verdict — the same roast read "38 min late" with a
reading at t=0 and "30 min early" with the first reading half an hour later. That is
fixed: the timeline now anchors on the oven event, which `startSession` writes
automatically.

**So: start the session when the roast goes in, and take the first probe reading
whenever you get to it.** Just do not start the *session* late — that is the case
that is still an approximation.

# Part 2 — Context for the new chat

Everything below is for the session that receives the data. It is written to be
pasted or pointed at.

## Suggested opening message

> I've done the instrumented calibration cook described in
> `Docs/calibration-cook.md`. Read `Docs/next-cook-handover.md` first — Part 2 is
> written for you. The export is at `Docs/Reference/<filename>.json`. It should
> carry the roast's dimensions, the oven's character and whatever oven-thermometer
> values I entered; if any of that is missing, my notes are [pasted below / in
> `Docs/Reference/<filename>-notes.md`].
>
> Work out what this data changes. I'd rather know that a constant was already
> right than have it adjusted to fit one cook.

## Where the code is

- Branch **`fix-prediction-maths`**, 24 commits ahead of `main`. **Not merged and
  not deployed** — `main` is still the old linear-projection build.
- 472 unit tests, 162 harness tests, 16 simulated cooks, 0 invariant errors.
- `npm run test:run` — unit. `npm run sim` — the oracle, the fixtures and the
  simulated deck. `npm run build` — production build.

## What the projection is

Two first-order thermal lags in series (surface, then core), driven by a third
lag for the oven itself, with **one** fitted parameter `k`. Closed-form per
segment, integrated through the real dial timeline. `src/services/thermalModel.js`.

The fit is `Σ residuals² + λ(ln k − ln k_prior)²`, where the prior comes from
weight and cut. Confidence is the RMS residual over the **last five** readings,
against a 1.6 °F noise floor. Whether the app speaks at all is decided by a
dead-time gate plus a check that the model's instantaneous rate still agrees with
the slope the readings show.

## What is measured, and what is not

Everything traces to one export: `Docs/Reference/roast-session-2026-08-22.json`.
Three readings, two residuals, two fitted parameters, **zero degrees of freedom**,
88 minutes, topping out at 92 °F core, no oven-off period, no oven-thermometer
data, and a `null` weight.

| constant | where | status |
|---|---|---|
| `kOven`, `kCore` = 0.010991 | `tools/sim/meatModel.js` | fitted, to 2 residuals |
| `backReaction` = 0 | same | fitted, lands at 0 |
| `K_REFERENCE` = 0.010991 | `src/services/thermalModel.js` | reproduces the real cook's 145 min to 125 °F |
| `TAU_OVEN_HEAT_MIN` = 10 | same | **assumed** |
| `TAU_OVEN_COOL_MIN` = 45 | same | **assumed — nothing constrains it** |
| `cycleAmplitudeF` = 10.8 | `meatModel.js` | **assumed** |
| `evapMaxF` = 0.42 | same | **explicitly fabricated**; the reference cook never reaches the stall band |
| carryover +3 → +8 °F | `src/services/carryoverService.js` | **a visible placeholder**, never measured |
| oracle aspect ratio 1.5 | `tools/oracle/conductionModel.js` | assumed from what a rib roast measures — `config.lengthCm` is now **captured**, and is what replaces it |
| `BIOT` = 8 | same | **assumed**, and documented as "natural convection" — a fan oven is not that. `config.ovenIsFanForced` is now **captured**, and applied to nothing. Note it is an *oracle* constant: `src/` has no Biot number and no diffusivity term, because the app's model is a lumped cascade |
| `AMBIENT_F` = 70 | `src/services/thermalModel.js` | **assumed, and still consumed** — the oven cool-down and `steadyStateF` read it. `config.ambientF` is **captured** and deliberately not wired in: doing so would move the pause and oven-off projections of cooks already running |
| bone-in coefficient | — | **none**; `meatCut` is captured and exported and reaches no physics by design. It is now a `kPrior` parameter so one can be tested without touching a caller |
| covering coefficient | — | **none**; `config.covering` is **captured** and applied to nothing |
| stall term | — | **none in the app at all**; the rate-agreement gate discovers a stall reactively each cook. Phase 8 added COPY only: a refusal that names the stall, in the cook's own unit, when the cut is in `STALLING_MEAT_TYPES` **and** the latest reading is inside `STALL_BAND_F` — see `stallExplainsSlowdown`. Both conditions, because the rate gate has no temperature term and a shoulder at 101 °F trips it too. No arithmetic changed |

**Captured, in that table, means: in the export, and reaching no coefficient.**
That is the point rather than an omission — there is no measured cook that could
justify a number for any of them, and inventing one is the failure this whole line
of work has been correcting. What the fields buy is that the *next* fit can be
interpreted: a fitted `k` from a fan-forced covered 13 cm roast and one from an open
conventional 20 cm roast are not the same measurement.

The one measured input that DOES act is `config.thicknessCm`. It replaces the
weight-and-shape estimate of the conduction length in `kPrior`, exactly (the two
agree at the reference geometry as algebra, not as a tolerance) — so a tape measure
supersedes a proxy rather than being averaged with it.

## The numbers as they stand — the before picture

Acceptance over 13 representative simulated cooks, from
`tools/sim/artifacts/SUMMARY.md`:

| metric | mean | worst |
|---|---|---|
| \|convergence\| | 29.2 min | 110 min |
| overshoot | 2.1 °F | 7.0 °F (13/13 measured) |
| blind minutes | 2.7 | 10 (11/13 measured) |
| blocked minutes | | 705 total |
| reversals | | 3 total |
| invariant errors | | **0** |

Convergence and blocked minutes both miss the plan's targets. They are reported
rather than tuned; do not "fix" them by moving a threshold.

## How to use the data

```bash
npm run sim:calibrate Docs/Reference/<the-new-export>.json
```

Prints the fitted constants, per-reading residuals, and — if the export contains
an oven-off period — a fitted `tauOvenCoolMin`. Then:

1. Paste the constants into `tools/sim/meatModel.js`.
2. Update the residual bound in `tools/sim/calibrate.test.js` if the worst
   residual moved.
3. `npm run sim:baseline` and commit the baseline **in the same commit** as the
   constants. A stale baseline is a hard failure by design.

Oven-thermometer values should already be on the readings as `ovenActualF`, which
`calibrate.js` reads and weights at 0.25 relative to a core residual:

```json
{ "temp": 91.9, "timestamp": "2026-08-22T03:27:00.000Z", "ovenActualF": 244 }
```

If a reading has none, the field is `null` rather than missing — that is deliberate,
so that "no thermometer on the shelf" and "written by a build that could not record
it" are distinguishable. `calibrate.js` skips a null and counts a number.

**Check the new config fields before trusting a fitted `k`.** A fitted constant from
a fan-forced covered cook and one from an open conventional cook are not the same
measurement, and neither is comparable to the reference export, which records
neither. `config.thicknessCm`, `config.ovenIsFanForced` (or `settings.`) and
`config.covering` are what make the number interpretable.

## Traps, in the order they will come up

**The rest block is not a thermal environment the model represents.** An oven-off
event drives the oven node toward 70 °F with a 45-minute time constant. A roast on
a board is in still air at 70 °F *immediately*. So the post-pull readings are the
right data in the wrong container: **read the carryover off them by hand** (peak
core minus core at pull) rather than feeding them to the fitter and believing the
result.

**Do not fit the oracle to this cook.** `tools/oracle/` is the independent engine
that every accuracy claim is checked against — 1-D Crank–Nicolson conduction,
validated against analytic series solutions in three geometries. Its parameters
come from physical reality (a roast's measured dimensions, beef's thermal
diffusivity), never from the app's calibration. Fitting it to the app's data turns
it into a second copy of the app and the whole verification apparatus becomes
circular. Its geometry *should* be updated from the tape-measure numbers in Part 1
— that is a physical measurement, not a fit.

**Do not regenerate the oracle fixtures to make a test pass.**
`tools/oracle/fixtures/*.json` are committed ground truth. They were regenerated
once, deliberately, when the geometry was found to be wrong. `fixtures/README.md`
says it: a fixture regenerated whenever a test fails has stopped being evidence.

**One cook is not a calibration set.** The honest outcome may be "this confirms
the constants and measures carryover for the first time". That is a good outcome.
Resist adjusting a constant that is already inside the noise.

**Check the sim's ground truth did not silently become the app's model.**
`tools/sim/meatModel.js` deliberately carries a thermostat sawtooth, an
evaporative stall, a probe placement bias and per-reading noise that
`thermalModel.js` does not model. Pasting fitted constants in must not quietly
remove that separation.

## Things a real cook can settle that no simulator can

- **Carryover.** The headline. See above.
- **Whether the stall is real at these weights**, and whether the rate-agreement
  gate fires on it at the right moment. On the simulated 9 lb shoulder the app now
  refuses from +320 to +730 — 410 minutes — and resumes at +731 against a serve
  deadline of +720. That is the *same* amount of silence as before the gate went
  in, moved: it used to run from +465 to the end of the cook, with the app
  confidently saying "running early" for the 145 minutes before it while the probe
  crawled at 0.7 °F/hr. Now the silence sits where the model genuinely does not
  describe the roast, and it ends before the cook does — but it still swallows the
  deadline by eleven minutes. Whether that trade is right is a judgement a real
  cook informs and a simulator cannot.
- **`tauOvenCoolMin`**, from the deliberate oven-off.
- **Whether the reading prompt's cadence is liveable.** It aims to keep no more
  than 8 °F of core unobserved, with a 10-minute floor. In the endgame that is a
  reading every ten minutes. Nobody has ever tried to actually follow it.
- **Whether the advice was any good.** There is no record anywhere of the app
  having been obeyed through a real cook and the dinner landing on time.

## Related documents

- `Docs/calibration-cook.md` — the protocol for the day
- `Docs/Reference/formula-notes.md` — derivations
- `Docs/sim-harness-findings.md` — what the simulator found
- `tools/oracle/fixtures/README.md` — why the cylinder is the primary geometry
- `tools/rollback/README.md` — why a pinned copy of the old build is committed
- `Docs/Development Plan/PHASE_8_MEASURED_INPUTS.md` — the app fields that would
  replace most of Part 1's paperwork
