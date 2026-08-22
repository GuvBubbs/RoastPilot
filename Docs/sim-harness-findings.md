# What the simulated cooks revealed

First run of `tools/sim` — eight simulated long cooks driven through the app's
real `useCalculations` → `useRecommendations` loop. Ranked by whether the finding
would change a real cook's outcome.

> **Status.** The three defects (7, 9, 10) are **fixed**, with regression tests.
> Finding 8 is **out of scope**: only cooks of 2–5 hours are planned, and those
> never enter the stall band. The algorithm changes (1–6) are **not implemented**
> — they are design decisions, and `Docs/Reference/formula-notes.md` carries the
> maths and the measured case for each.
>
> **Scope: 2–5 hour cooks.** The overnight shoulder stays in the deck as a stress
> case but should not drive decisions; see
> [What the scope change revised](#what-the-scope-change-revised) in the formula
> notes, which reverses one warning below.

Numbers cite `tools/sim/artifacts/` from a run at `kOven = kCore = 0.010991`
(worst calibration residual 0.61 °F against the real export).

## The one-line version

The recommendation loop is **structurally sound and badly gated**. Every
correctness property held — no flapping, no double-charging, no NaN, no
unsubstituted placeholders, every cook terminated `at-target`. But the app spent
14–76% of each cook refusing to speak, its first recommendation was wrong in
direction in seven cooks out of eight, and roasts overshot target by up to 31 °F
without a word.

---

## 1. The first recommendation is systematically wrong, and confident

| scenario | first advice | app's variance then | actual outcome |
|---|---|---|---|
| 01 real replay | **raise** at +45 | 85 min late | 45 min **early** |
| 02 baseline | **raise** at +40 | 123 min late | 20 min **early** |
| 03 running late | **raise** at +55 | 142 min late | 15 min late |
| 04 very early | lower at +40 | 32 min early | 110 min **early** |
| 05 shoulder | **raise** at +45 | 131 min late | 295 min **early** |
| 06 reading gap | **raise** at +45 | 74 min late | 25 min **early** |
| 07 pause | **raise** at +40 | 66 min late | 60 min **early** |
| 08 Celsius | **raise** at +45 | 63 min late | on target |

Seven of eight cooks open with "running late, consider raising the oven." Seven
of eight then finish **early**. Confidence at that moment is `medium` —
"Adequate data for reasonable predictions."

The cause is in the physics, not the code. The first moment the app is allowed to
speak is 3 readings spanning 30 min, which at a realistic cadence is ~45 minutes
in — squarely inside the *accelerating* phase of the cook, when the core is still
waiting for the thermal wave. `calculateHeatingRate` fits a straight line through
that, and a straight line through an accelerating curve extrapolates to a
finishing time one to two hours too late.

**This is not hypothetical.** The human cook in
`Docs/Reference/roast-session-2026-08-22.json` raised the oven from 212 °F to
266 °F immediately after their second reading, then walked it back to 248 °F
after their third. The app would have told them to do exactly that. The replay
finishes 45 min early and 17 °C over target.

The engine already has what it needs to know better: `averageRate` versus
`currentRate` diverge sharply during acceleration, and the sign of that
divergence says which phase the cook is in. Nothing consumes it.

## 2. `stale_oven_data` silences the app through the endgame

Fires in five of eight cooks, and it is not a corner:

| scenario | minutes blocked as stale | share of cook |
|---|---|---|
| 05 overnight shoulder | 355 | **76%** |
| 03 running late | 70 | 37% |
| 04 running very early | 50 | 32% |
| 06 reading gap | 35 | 19% |
| 02 baseline | 20 | 11% |

The 12-hour pork shoulder — the app's flagship use case — got exactly **one
minute** of actual advice across 465 minutes. The rest was
`insufficient_readings`, `settling`, or "Oven temperature hasn't been updated
recently."

`tools/sim/artifacts/shots/04-running-very-early--near-target.png` shows what
this looks like on the phone. On one screen, simultaneously:

- status band: **"Running 1h 41m early"**
- oven chip: **"Oven 225°F · 1h 15m ago"** with a warning triangle
- recommendation panel: **"Oven temperature hasn't been updated recently. Please
  confirm current oven setting."** — the only offered action being *Update oven
  temp*
- ETA card: a green check

The app knows the roast is nearly two hours early. It shows the oven setting,
correctly, right there. It then refuses to advise anything, and asks the user to
re-type a number it is already displaying. Twenty-five minutes later the roast is
17.7 °F past target.

In low-and-slow cooking, **not touching the dial is the goal**.
`ovenTempStaleMinutes: 60` treats a steady oven as missing data, so the gate
fires precisely when the app is working. It sits in
`checkRecommendationEligibility` ahead of everything except `at-target` and
`needs-reading`, so it overrides all of the schedule logic.

## 3. Nothing asks for a reading when it matters, and overshoot is unbounded

| scenario | overshoot past target | minutes done before the app knew |
|---|---|---|
| 01 real replay | **+31.0 °F** (17.2 °C) | 45 |
| 06 reading gap | +18.7 °F | 35 |
| 02 baseline | +17.9 °F | 35 |
| 04 very early | +17.7 °F | 25 |
| 05 shoulder | +11.7 °F | 40 |
| 03 running late | +3.2 °F | 5 |
| 07 pause | +1.8 °F | 0 |

At 40 °F/h near the end of a cook, a 45-minute reading gap is 30 °F of core
temperature. The app holds a `predictedTargetTime` the whole way and never uses
it to say *"take a reading at 8:19"* — which is the one thing that would close
this. In the replay a roast targeted at 54.4 °C is served at 71.6 °C: medium-rare
ordered, well done delivered.

Compounding it, `at-target` reads identically whether the reading is 0.1 °F or
31 °F past target — "Target reached. Turn the oven off and rest the meat." There
is no overshoot state.

## 4. `settling` swallows the cook and hides the schedule

Time in `settling`: 40–99 minutes per cook, 14–60% of each.

`ovenChangeSettleReadings: 2` readings past `ovenChangeLagMinutes: 15` means, at a
45-minute cadence, roughly **80 minutes locked per dial change**. Scenario 04 sat
in `settling` from +41 to +105 while its variance grew from −32 min to −101 min,
saying throughout: *"Oven at 225°F is where it needs to be. Log a reading now to
confirm it is working."*

That message is true and it is the wrong emphasis. The dial is right; the
*schedule* has moved 70 minutes while it was being confirmed, and the panel does
not mention it.

The gate itself is correct — see the clean bill in
[What held up](#what-held-up) — the problem is that the state says nothing about
schedule drift while it holds.

## 5. Celsius suggestions breach `recommendationMaxStepF`

Reproducible, and only in Celsius sessions (01 and 08):

```
base 95 °C (203 °F), running late by >30 min
  changeAmount = min(25, 10 * 2.5)      = 25 °F
  203 + 25 = 228 °F = 108.9 °C
  snapToDial -> 110 °C = 230 °F
  changeAmount = 230 - 203              = 27 °F   (15 °C)
```

`recommendationMaxStepF: 25` is applied *before* the dial snap and never
re-checked after it. `calculateRecommendation` recomputes `changeAmount` from the
snapped value so the two agree with each other — but the agreed value is over the
ceiling. On a 5 °C dial grid the overshoot is up to half an increment, so the app
asks for a 15 °C jump where the setting says 13.9 °C.

Visible in
`tools/sim/artifacts/shots/08-celsius-eager-dial--first-recommendation.png`:
*"Consider raising oven to 110°C"* from 95 °C. Small in magnitude, but it is a
configured bound being exceeded, and only on the Celsius path.

## 6. Retarget amounts read as enormous single steps

While a change is unmeasured, `reconcileWithOvenChange` restates the projection's
target as an absolute temperature — deliberately, and that is what stops changes
stacking. But the derived `changeAmountFormatted` is the distance from wherever
the cook actually put the dial:

- scenario 07: *"Oven is at 235°F. Aim for 185°F"* — a `-50°F` chip
- scenario 01: *"Oven is at 120°C. Aim for 90°C"* — a 30 °C drop, one reading
  after the cook raised it

Correct by design; the reasoning even says so ("that target already allows for
the change you just made"). But a cook who just raised the oven and is now told
to drop it 30 °C will not read past the number. The absolute target is the
trustworthy part; the delta chip is the part that undermines it.

## 7. The rate card clips at 390 px

`RATE 33.77°F/...`, `11.08°F/...`, `25.33°C...` across the frames. `convertRate`
rounds to two decimals, which overflows the card for most Fahrenheit rates — and
two decimals is spurious precision on a regression slope fitted to three noisy
readings. One decimal both fits and tells the truth.

## 8. Two identical "Add reading" buttons stack

In `settling` and `needs-reading` the recommendation panel's primary control is
*Add reading*, rendering directly above the BottomBar's *+ Add reading*. See
`tools/sim/artifacts/shots/05-overnight-shoulder--settling.png`.

---

## What held up

Worth stating, because these were the properties most at risk and the harness
was built to break them:

- **No double-charging.** Asserted at every transcript row by re-running the
  app's own `assessOvenChangeEffect` at that instant and requiring the UI's
  `awaitingEffect` to agree — so this checks the *wiring*, not a restatement of
  the rules. Clean across all eight cooks, including a dial moved away and back
  (which correctly nets out) and the eager-dial Celsius cook. **`b823705` is
  fixed and stays fixed.**
- **No flapping.** At most one direction reversal per cook, never inside a lag
  window without a reading between.
- **No unsubstituted placeholders** reached the screen in `message`,
  `alternativeMessage`, `reasoning` or `blockerReason` — checked on the
  substituted output, which is what renders.
- **No NaN or Infinity** in any displayed field; `predictedTargetTime` never
  earlier than the reading it came from; the projected finish time constant
  between readings, with only the distance to it moving.
- **Every cook terminated `at-target`**, never stuck on a blocker.
- **`lastActiveOvenTemp` is right.** The pause-and-restart cook restarted at the
  correct 185 °F rather than the 0 °F an off event stores.

## Harness bugs found and discarded along the way

Recorded so the findings above can be read as app findings rather than harness
noise:

- The scripted pause in scenario 07 was defeated by a reading landing in the same
  instant, which ended the pause after 60 seconds instead of 40 minutes.
- The restart temperature was captured when the pause began instead of read from
  `lastActiveOvenTemp` at restart.
- In the replay, the human's dial move and the app's applied advice landed in the
  same instant, giving one moment two oven settings.
- `config.startingTemp` was passed in display units. It is canonical °F —
  `SessionSetupModal.vue:536` converts correctly with `toStorageUnit`, so this was
  entirely the harness. It showed as a −13.9 °C opening reading.

That last one **retracted a finding**. Before it was fixed, the replay spent 25%
of the cook blocked on `unstable_rate` ("Temperature readings are fluctuating"),
which looked like the app mislabelling curvature as noise. It was the bogus
opening reading wrecking the R². With the bug fixed, `unstable_rate` never fires
anywhere in the deck.

## Recommendations

Every number below is measured on the same eight cooks, not estimated.
`SIM_SETTINGS` applies a settings patch to the whole deck, and
`artifacts/summary.json` scores the result:

```bash
SIM_SETTINGS='{"ovenTempStaleMinutes":100000}' npm run sim
```

### First: no amount of tuning fixes this

| configuration | unfinished | mean overshoot | mean schedule miss | worst miss | silence | dial moves | reversals |
|---|---|---|---|---|---|---|---|
| **baseline (shipped)** | 1/8 | 12.7 °F | **81 min** | 295 min | 885 min | 13 | 4 |
| stale gate off | 2/8 | 11.2 °F | 46 min | 110 min | 600 min | 19 | 6 |
| defer 1st advice (4 rdg / 60 min) | 0/8 | 14.0 °F | 46 min | 115 min | 1800 min | 2 | 0 |
| wider dead band (25 min) | 1/8 | 12.9 °F | 81 min | 295 min | 865 min | 14 | 5 |
| smaller steps (5/10 °F) | 2/8 | 14.2 °F | 74 min | 200 min | 1035 min | 13 | 4 |
| defer + stale off | 2/8 | 11.7 °F | 43 min | 115 min | 980 min | 13 | 2 |
| **defer + stale off + settle 1 rdg** | 1/8 | 13.4 °F | **38 min** | 115 min | 735 min | 17 | 1 |

The best settings-only configuration halves the mean schedule miss (81 → 38 min)
and nearly eliminates churn (4 → 1 reversals). It does not touch overshoot
(12.7 → 13.4 °F) and still misses dinner by 38 minutes on average. **This is an
algorithm change, not a tuning exercise.**

Two negative results worth keeping: a **wider dead band does nothing** (81 → 81
min), and **smaller steps make everything worse** (74 min miss, 14.2 °F
overshoot, still 4 reversals) — a smaller step just means more of them.

### Correction to the earlier ordering

An earlier draft of this document recommended fixing the stale-oven gate first,
on the grounds that it was the biggest silence for the smallest change. **That
was wrong, and the harness says so.** Removing the gate in isolation:

```
+46  raise 250    +116 lower 200   +226 lower 175   +351 oven off 45 min
+396 restart 175  +526 raise 200   +771 raise 225   +896 raise 250
```

Eight dial moves, four reversals, and the overnight shoulder **never reaches
target in 16 hours**. The stale gate is load-bearing by accident: it is
suppressing a control loop that would otherwise oscillate. Fix the projection
first, or fix both together — never the gate alone.

Removing it also unmasked a finding the gate had been hiding, below.

### Algorithm changes

**1. Replace the linear projection with a two-stage lag fit.** The highest-value
change by a wide margin. Scored at every reading of every cook against the
model's true remaining time:

| projection | MAE (ex-stall) | worst | MAE at first advice |
|---|---|---|---|
| **linear** (shipped) | 17.5 min | 115 min | **52.1 min** |
| single-node exponential | 40.2 min | 219 min | 105.9 min |
| **two-stage lag, one fitted constant** | **3.0 min** | 7 min | **28.4 min** |

`calculateHeatingRate` fits a straight line; the cook is a curve, and early on it
is a curve bending the *wrong way* for a line to cope with. Fitting one constant
`k` to `T_core' = k(T_surface − T_core)`, `T_surface' = k(T_oven − T_surface)`
against the readings and the oven history — the app already holds both — cuts the
error roughly sixfold.

Note the middle row. The obvious cheap fix, "use an exponential approach to the
oven temperature instead of a line", is **worse than what ships today**, because a
decaying-approach curve has exactly the wrong curvature during the phase where
the error is largest. The win is specifically the two-stage shape — which is also
the shape the real export's own data selected (see
`tools/sim/README.md#calibration-record`).

Caveat: the two-stage arm is scored against a world generated by a two-stage
model, so 3.0 min is a ceiling rather than a forecast. The comparison against the
exponential arm is the part that does not depend on that.

**2. If the rewrite is too big, refuse to advise on the accelerating phase.** The
signal is already computed and thrown away: `currentRate` and `averageRate`
diverge sharply while the cook is accelerating, and the sign of that divergence
says which phase you are in. Gating on rate *stability* rather than R² is the
cheap version of change 1. Measured proxy (deferring the first recommendation to
4 readings / 60 min): dial moves **13 → 2**, reversals **4 → 0**, mean schedule
miss **81 → 46 min**, and all eight cooks finish. Nothing else tested comes close
for the effort.

**3. Then fix the stale-oven gate.** A steady dial is not missing data — in
low-and-slow cooking, not touching the dial is the goal. The information is
already conveyed without silencing anything: `StatusCards.vue:136` renders an
"Oven setting may be out of date" chip, so the blocker in
`checkRecommendationEligibility` is redundant with a warning that already exists.
Demote it to that warning. Sequenced *after* 1 or 2, per the correction above.

**4. Ask for the next reading.** No configuration tested moved overshoot out of
the 11–14 °F band, because overshoot is not a tuning problem — nothing in the app
ever asks for a reading. It holds `predictedTargetTime` the whole way and could
say "take a reading at 8:19"; a 45-minute gap near the end of a cook is 30 °F of
core temperature. This is the change that stops a medium-rare order arriving well
done.

**5. Add a past-target state.** `at-target` fires on `>= targetTemp` and reads
identically at +0.1 °F and +31 °F over. Separate "at target" from "past target,
by this much".

**6. Report schedule drift during `settling`.** Scenario 04 sat in `settling` for
65 minutes while its variance grew from −32 to −101 min, saying only "Oven at
225°F is where it needs to be." The dial advice is right; the omission is that
the schedule moved 70 minutes while it was being confirmed.

### Bug fixes

**7. `recommendationMaxStepF` is not re-clamped after the dial snap.** *Fixed.*
Celsius sessions only, reproducible in both:

```
base 95 °C (203 °F), running >30 min late
  changeAmount  = min(25, 10 * 2.5)  = 25 °F        <- clamped here
  203 + 25      = 228 °F = 108.9 °C
  snapToDial    -> 110 °C = 230 °F                  <- snapped up, past the clamp
  changeAmount  = 230 - 203          = 27 °F        <- recomputed, never re-clamped
```

`calculateRecommendation` recomputes `changeAmount` from the snapped value so the
two agree with each other, but the agreed value is over the configured ceiling.
On a 5 °C grid the breach is up to half an increment.

Fixed in `calculateRecommendation` by re-snapping toward the base when the
snapped step exceeds the maximum, in both the raise and the lower branch, ahead
of the existing "snapping swallowed the whole step" guard. The suggestion at
95 °C went from 110 °C (15 °C, over cap) to 105 °C (10 °C). Six new cases in
`recommendationService.test.js`, plus one asserting the Fahrenheit path still
lands exactly on the cap. The `bounds` invariant is now clean across the deck.

**8. The stall is diagnosed as a probe fault.** *Out of scope — not changed.* A
2–5 hour cook to 125–140 °F never reaches the 150–165 °F stall band, and at those
lengths a near-zero rate really is most likely a misplaced probe or an oven that
went off, so the message is good advice as it stands. Revisit only if a shoulder
or brisket is ever on the menu. Unmasked by removing the stale gate: with the core sitting at 153 °F in the stall band and the oven at 175 °F,
the app blocks for **190 minutes (20% of the cook)** on
`RATE_TOO_LOW` — *"Heating rate is very slow or negative. Check thermometer
placement."* The probe is fine. The meat is stalling, which is the best-known
phenomenon in low-and-slow cooking. A near-zero rate with the core in
150–165 °F and the oven well above it is a stall, not a misplaced probe, and it
should say so rather than blaming the user and going silent. (The stall's exact
magnitude here is fabricated — see the limits — but any stall produces the
near-zero rate that trips this, so the response is the finding, not the number.)

**9. The rate card clips at 390 px.** *Fixed.* `RATE 33.77°F/...`,
`11.08°F/...`, `25.33°C...`. `convertRate` rounds to two decimals, which
overflows a `truncate`d `.stat-value` for most Fahrenheit rates — and two
decimals is spurious precision on a regression slope fitted to three noisy
readings.

`formatRate` now shows three significant figures at most: one decimal below 10,
none above, so the string never exceeds nine characters. `convertRate` keeps its
precision for callers doing arithmetic. New `temperatureUtils.test.js`.

**10. Two identical "Add reading" buttons stack.** *Fixed.* In `settling`,
`needs-reading` and the `insufficient_readings` blocker, the recommendation
panel's control duplicated the BottomBar's `+ Add reading`, rendering directly
above it.

Those three cases now fall through to `pauseControl`, which also repairs
something the duplication was costing: the panel is the only route to the
pause/restart sheets, and during `settling` that route did not exist. It is now
"Pause cooking" there, and "Log oven restart" while paused. The headline already
says a reading is what is needed, and the bottom bar is where the thumb already
is.

### Suggested order

1. **4** (ask for the next reading) — smallest change with a direct effect on the
   thing that ruins dinner, independent of everything else, and the only lever
   that touches overshoot at all.
2. **3** (demote the stale gate) — at 2–5 hours this is measured **free**:
   schedule miss and reversals both unchanged, and 175 minutes of silence handed
   back across seven cooks. The warning against doing this standalone applied
   only to the overnight cook.
3. **1** (two-stage projection) — the real fix, and the only thing that moves
   schedule accuracy off ~45 min.
4. **2** (refuse to advise while accelerating) — a stopgap if 1 is too big;
   redundant once 1 lands.
5. **5, 6** — display truth-telling, once the projection is worth telling.

~~7, 9, 10~~ — done.

Re-run `npm run sim` after each. The deck is deterministic, so any movement in
`artifacts/summary.json` is attributable to the change.

## Before trusting any of this further

Re-run `npm run sim:calibrate` against a full cook. The model is fitted to 89
minutes and 2 intervals, with nothing above 33 °C core and no stall data — and
the endgame is both the least constrained part of the model and the part every
finding above turns on. See `tools/sim/README.md#limits`.
