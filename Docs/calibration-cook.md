# The calibration cook

**One instrumented cook is the highest-value thing that can be done to this app,
and it needs no code.** This is the protocol. Follow it once and most of what the
model currently guesses becomes measured.

## Why it matters

Every thermal constant in the app traces back to a single exported cook,
`Docs/Reference/roast-session-2026-08-22.json`. What that file actually contains:

| | |
|---|---|
| readings | **3** |
| residuals available to fit | **2** |
| free parameters fitted | **2** |
| degrees of freedom | **0** |
| duration | 88 minutes |
| highest core reached | **92 °F** |
| oven-off periods | **none** |
| oven thermometer readings | **none** |
| weight recorded | **null** — the 6 lb reference is an assumption |

Every scenario on the simulated deck targets 125–195 °F core. So the entire
endgame — the part that decides whether dinner is on time — is extrapolation from
data that stops at 92 °F. And three constants are not measured at all:

- `tauOvenHeatMin` (10 min) — how fast the oven reaches a new set point
- `tauOvenCoolMin` (45 min) — how fast it cools with the element off. **Nothing
  whatsoever constrains this number.**
- `cycleAmplitudeF` (10.8 °F) — the thermostat sawtooth
- `evapMaxF` (0.42 °F/min) — the evaporative stall. Explicitly fabricated; the
  reference cook never reaches the stall band at all.

Carryover is worse than guessed: an evaporation-free solve of the app's own model
gives **+19 °F** where instrumented measurement of the same cut class gives
**+5 to +6.5 °F**. A threefold disagreement means evaporation dominates, so
neither number is usable. The app ships a small, visible, overridable estimate
because that is the honest thing to do with no data — and one cook's worth of
endgame readings would replace it with a measurement.

## The protocol

Any roast will do. A 5–7 lb bone-in prime rib at 200–225 °F is the most useful,
because it is the case the app is most used for.

### Readings

- **Every 10 minutes** from the moment it goes in.
- **Every 5 minutes once the core passes 110 °F.**
- **Keep going through the pull, the whole rest, and the first slice.** This is
  the block that does not exist in any data the app has, and it is the only
  possible source of a carryover measurement. Do not stop logging when the meat
  comes out of the oven — that is where the interesting part starts.

### An oven thermometer

Read it **at every probe reading** and record it. Three currently-fabricated
constants depend on nothing else. A £5 dial thermometer sitting on the shelf next
to the roast is enough.

### One deliberate oven-off period

**20–30 minutes, somewhere in the middle of the cook.** Log the off event and the
restart. This single interval is what pins `tauOvenCoolMin`, which is otherwise a
guess, and `calibrate.js` now fits it whenever the export contains a pause.

Do it once the core is past 140 °F if you would rather not think about the danger
zone — the app's own pause advice will not offer it below that unless the roast is
in its final approach.

### Two dial moves, at least 45 minutes apart

Not three, and not close together. Two well-separated changes give the fit clean
information about how the oven and the meat respond; three bunched together give
it a tangle. 45 minutes is the thermal lag plus enough readings to see past it.

### And record

- **Weight to 0.1 lb.** The prior on how fast the roast heats scales as
  weight^(-2/3); the reference cook's weight is a guess.
- **Shortest cross-section in cm.** Heat travels along the shortest path, so this
  is the length the constants actually scale with — more informative than the
  weight, and nothing in the app records it yet.
- **Fridge-out time**, so the starting state is known rather than assumed. The
  projection's `Ts(0) = Tc(0)` assumption is that the roast went in uniformly
  cold; a roast that sat out for an hour did not.
- **Cut, bone-in or out, and whether it was tied.**

## Then

```bash
npm run sim:calibrate path/to/your-export.json
```

It prints the fitted constants, the per-reading residuals, and — if your export
has a pause — a fitted `tauOvenCoolMin`. Paste the constants into
`tools/sim/meatModel.js`, and update the bound in `tools/sim/calibrate.test.js`
if the worst residual has moved.

Then re-run the deck and re-baseline in the same commit:

```bash
npm run sim:baseline
```

## What is already ready for it

Three defects in `calibrate.js` would have corrupted the results, and are fixed:

- it **dropped oven-off events entirely**, so a calibration run would have fitted
  a cooling stretch as though the oven were still on — and the pause is the whole
  point of including one;
- it **weighted every residual equally**, which optimises the long slow early
  climb (where the app is silent anyway) at the expense of the endgame (which
  decides dinner);
- it **fitted only two parameters** unconditionally, so a pause in the data could
  not have improved anything.

It also now reads an `ovenActualF` field off each reading, if your export carries
one, and fits the oven's own behaviour against it.
