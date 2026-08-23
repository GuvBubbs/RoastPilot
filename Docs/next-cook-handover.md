# Handover: the next real cook

**Written 2026-08-23, for a session that will happen months from now.**

`calibration-cook.md` is the protocol — what to do on the day. This is the
companion to it: what to **bring back**, and what a fresh chat needs to be told
before it can use any of it.

Read the first half before the cook. Hand the second half to the new chat.

---

# Part 1 — What to bring back

The app's export is necessary and not sufficient. Several of the things worth
measuring have nowhere to live in the app as data the tooling can read — the free-text
`Notes` field will hold them, but nothing parses it — so they have to be written down
as you go or they are gone.

## 1. The export (`Export JSON` in Settings)

This carries: every reading with its timestamp, every oven event including
off/restart, the whole config, and the settings in force. It is the backbone —
everything else below hangs off its timestamps.

**Two config fields to check before you start, because they are the ones the
reference cook is missing:**

| field | why | where |
|---|---|---|
| **Weight** | The prior on how fast the roast heats scales as `weight^(-2/3)`. The existing reference cook's weight is `null`, so the 6 lb figure everything descends from is an assumption. | Session setup — "The roast" |
| **Type and cut** | Selects the shape factor (a tenderloin and a shoulder of equal weight do not heat alike). | Session setup |

Enter the weight to **0.1 lb**. It is one number and it retires a guess.

> **Check `Docs/Development Plan/PHASE_8_MEASURED_INPUTS.md` before you cook.** It
> specifies app fields for items 2, 3 and 4 below — an optional oven-temperature
> input on the reading modal, and thickness/length at setup. If it has been built by
> then, enter them in the app and skip the paper. If not, the paper fallback below
> still works and is what the calibration code expects.

## 2. The oven-thermometer sheet — **the app cannot store this yet**

`tools/sim/calibrate.js` reads an `ovenActualF` field off each reading and will
fit the oven's own behaviour against it. **Nothing in the app ever writes that
field** — `AddReadingModal` has two inputs, internal temperature and time, and
there is no oven-temperature input anywhere. So this has to be a piece of paper.

Put a dial thermometer on the shelf beside the roast and record, at every probe
reading:

```
time        oven thermometer
14:31       208
14:41       214
14:51       196
...
```

Clock time is enough — it gets matched to the readings by timestamp afterwards.
This is what pins `tauOvenHeatMin`, `tauOvenCoolMin` and `cycleAmplitudeF`, three
constants currently resting on nothing.

## 3. The roast's dimensions — **the app cannot store these either**

- **Shortest cross-section, in cm.** Heat travels the shortest path, so this is
  the length the physics actually scales with — more informative than the weight.
- **Length, in cm.** The independent oracle
  (`tools/oracle/conductionModel.js`) currently *assumes* a roast is 1.5
  diameters long. It assumed four diameters until 2026-08-23 (commit `60cddf6`),
  which made every accuracy figure the oracle certified wrong by roughly a factor
  of two. One real measurement replaces the assumption.

A tape measure across the thickest part before it goes in. Ten seconds.

## 4. The starting reading — already an app field, so use it

Enter the core temperature in **Starting reading** at setup. It becomes
`readings[0]`, so the projection starts from a measured state instead of an assumed
one.

This replaces the "fridge-out time" an earlier draft of the protocol asked for. A
measured core is strictly better than a time from which a core would have to be
guessed. The one thing it does not capture is the *gradient* — a roast that sat out
for two hours has a warm surface over a cool core, and a single core reading cannot
tell that apart from one straight out of the fridge. That is second-order, the
residuals will show it, and it is not worth a field.

The `Notes` field is a fine place for the dimensions and anything else in this list
until Phase 8 gives them somewhere structured to live — it comes through in the
export, it is just not machine-readable.

## 5. The rest block — the one measurement nothing else can give

**Keep logging readings after the meat comes out**, every 5 minutes, through the
whole rest and up to the first slice.

This is the only possible source of a **measured carryover**. The app currently
ships a straight-line guess: +3 °F at a 175 °F oven rising to +8 °F at 300 °F, so
about +4 °F at a typical 200 °F oven. That number has never been measured, and an
evaporation-free solve of the app's own model disagrees with instrumented
measurements of the same cut class by a factor of three. The measurement itself
needs no fitting at all:

> **carryover = highest core reached during the rest − core at the moment of the pull**

Two numbers off your own sheet.

**Log an oven-off event at the moment you pull the meat.** It is the closest thing
the app can represent to "the roast is now on a board", and without it the
timeline thinks the roast is still in a hot oven. See the caveat in Part 2 — it is
not a perfect proxy and the rest block should be read by hand rather than fitted.

## 6. Two things about the outcome

- **Was it how you wanted it?** Over, under, or right. The whole app exists to
  land this, and there is currently no record anywhere of whether it ever has.
- **Anything unusual.** Door opened, foil on, tray moved, oven struggling, a
  reading you think was wrong and why. A note costs nothing and an unexplained
  outlier costs an afternoon.

## If it does not all happen

It is still worth bringing back. Ranked by what is irreplaceable:

1. **Readings through the pull and rest** — carryover. Nothing else can produce it.
2. **Weight and shortest cross-section** — retires two standing assumptions.
3. **One deliberate 20–30 min oven-off** — `tauOvenCoolMin` is constrained by
   nothing whatsoever today.
4. **Oven-thermometer sheet** — three fabricated constants.
5. **Two dial moves 45+ min apart** — nice to have; the deck already covers this
   shape.

A cook with items 1 and 2 and nothing else is a large improvement on what exists.

## One thing that changed and makes life easier

You no longer need to log a reading the instant the roast goes in. The projection
used to start its timeline at the *first reading* and silently discard everything
before it, which inverted its own verdict — the same roast read "38 min late" with
a reading at t=0 and "30 min early" with the first reading half an hour later.
That is fixed: the timeline now anchors on the oven event, which `startSession`
writes automatically.

**So: start the session when the roast goes in, and take the first probe reading
whenever you get to it.** Just don't start the session late — that is the case
that is still an approximation.

---

# Part 2 — Context for the new chat

Everything below is for the session that receives the data. It is written to be
pasted or pointed at.

## Suggested opening message

> I've done the instrumented calibration cook described in
> `Docs/calibration-cook.md`. Read `Docs/next-cook-handover.md` first — Part 2 is
> written for you. The export is at `Docs/Reference/<filename>.json` and my
> hand-recorded oven-thermometer readings and measurements are [pasted below /
> in `Docs/Reference/<filename>-notes.md`].
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
| oracle aspect ratio 1.5 | `tools/oracle/conductionModel.js` | assumed from what a rib roast measures |

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

To get the oven-thermometer readings into the fit, add an `ovenActualF` to the
matching readings in the JSON by hand — `calibrate.js` already reads it, weighted
at 0.25 relative to a core residual:

```json
{ "temp": 91.9, "timestamp": "2026-08-22T03:27:00.000Z", "ovenActualF": 244 }
```

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
