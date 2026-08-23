# Pinned previous build

`calculationService.previous.js` is `src/services/calculationService.js` as it
stood on `main` before the prediction-maths rewrite, copied verbatim.

It exists for one test: `src/services/storageCompat.test.js`'s backward-compatibility
block, which runs the OLD code against storage the CURRENT code writes. Every other
compatibility test in this repo only goes forwards, and a rollback goes the other
way — `registerType: 'autoUpdate'` in `vite.config.js` means a rollback reaches every
client on its own, so a session this build writes has to stay readable by the build
before it. It did not: the v2 migration deleted `config.targetTemp`, the old build
read it back as `undefined`, and `new Date(NaN)` threw inside a render.

Its two imports are repointed at the CURRENT `src/utils` and `src/constants` — it is
a pinned copy of one module, not a whole previous build. That is deliberate: the
question this test asks is whether the old code can read the config shape the new
code writes, and dragging the old `addMinutes` (with its DST bug) into the fixture
would test something else. Both versions throw on `new Date(NaN)` identically.

Do not edit it to make a test pass. It is a record of what is deployed, and the
whole point is that it cannot be adjusted to agree with us. When v2 has been out
long enough that rolling back to this is no longer possible, delete this directory
and the test block that imports it in the same commit as the v3 migration that
drops the `targetTemp` shadow.
