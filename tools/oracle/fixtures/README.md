# Static fixtures

Committed reading histories the projection was **not** built from, so that a
future change to the model cannot quietly move the ground truth it is judged
against. Regenerate with `node tools/oracle/makeFixtures.mjs`, and only
deliberately — a fixture regenerated whenever a test fails has stopped being
evidence.

Each file carries its own `trueHitMin`: the minute the generating process
actually crossed the pull temperature. That number is the answer; everything the
app says is scored against it.

| fixture | family | what it is for |
|---|---|---|
| `01-cylinder-6lb-200F` | 1-D conduction, cylinder | the ordinary case |
| `02-cylinder-3lb-250F` | 1-D conduction, cylinder | small and fast; `k` is 4× case 01, so the weight prior must not anchor the answer |
| `03-cylinder-24lb-175F` | 1-D conduction, cylinder | close to ten hours, and only 25 °F of headroom over the target |
| `04-cylinder-dial-moved` | 1-D conduction, cylinder | two dial changes mid-cook |
| `05-cylinder-paused` | 1-D conduction, cylinder | a 40 min oven-off period; the readings across it are *cooling* |
| `06-slab-6lb-200F` | 1-D conduction, slab | same weight as 01, different geometry, different spectrum |
| `07-adversarial-linear-ramp` | **none** — a straight line | 30 °F/hr forever |
| `08-adversarial-single-lag` | **none** — one exponential | Newton's law, straight at the oven |

## Why a cylinder is the primary geometry

A roast is not a sphere. A prime rib, a pork loin, a leg of lamb and a
tenderloin are all cylinders to a first approximation; a flat cut is closer to
a slab.

The cylinder's **proportions** matter as much as its shape, because the
conduction length is the radius. `radiusForWeightCm` assumes a length of 1.5
diameters, which is what a bone-in rib roast measures — about 5 in across and 8 in
long at 6 lb. It assumed four diameters until this was checked, which is a
tenderloin's shape, and at 6 lb produced a 3.7 in × 14.8 in roast that heated more
than twice as fast as the real cook in this repository. Every error figure the
oracle certified was measured on it. That matters more than it sounds, because the best cascade length is a
property of the geometry — rms error of the normalised step response over the
5 %-to-95 % span of the climb:

| meat lags | sphere | cylinder | slab |
|---|---|---|---|
| 1 | 13.3 % | 11.2 % | 8.0 % |
| 2 | **5.5 %** | **1.9 %** | **2.5 %** |
| 3 | **1.8 %** | 4.4 % | 6.1 % |

Scored against a sphere alone, the evidence argues clearly for a three-lag
model. Making that change would have been worse at the only real cook there is
(0.61 °F worst residual with two lags, 3.28 °F with three) and worse against
both of the geometries a roast resembles. An oracle of the wrong shape is not a
neutral check — it is a confident wrong answer.

The sphere is kept in `projection.oracle.test.js` as a deliberately adversarial
case, asserted on graceful degradation rather than accuracy.

## The adversarial pair

Neither `07` nor `08` comes from a thermal model, and neither is a cook that
could happen. They are here to answer a different question: what does the app do
with data its model cannot describe?

`07` is a perfectly straight ramp. No real core does this — a core decelerates as
it closes on the surface — so no `k` explains the readings and the residual
cannot be made small.

`08` is the one shape a two-lag cascade **structurally** cannot produce: a single
first-order lag, fastest at its very first moment, with no dead time at all. The
cascade's own response starts flat, so it can never match a curve that starts at
full speed.

Both are asserted on **degradation, not accuracy**: the app may be wrong about
the finish time, and it must not claim a good fit while being wrong. That is the
property that decides whether a cook is misled.
