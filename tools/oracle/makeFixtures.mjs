/**
 * Generate the committed static fixtures.
 *
 *   node tools/oracle/makeFixtures.mjs
 *
 * Run once, and only re-run deliberately. The whole point of these files is that
 * they are DATA the model was not built from and cannot quietly follow: a
 * fixture regenerated whenever a test fails is a fixture that has stopped being
 * evidence.
 *
 * Six come from the conduction oracle across three geometries. Two are
 * adversarial and come from no thermal model at all - see fixtures/README.md.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createConductionModel } from './conductionModel.js';

const DIR = resolve(process.cwd(), 'tools/oracle/fixtures');
mkdirSync(DIR, { recursive: true });

const BASE = Date.parse('2026-08-22T18:00:00.000Z');
const at = (m) => new Date(BASE + m * 60_000).toISOString();
const cadence = (every, until) => {
  const out = [];
  for (let t = 0; t <= until; t += every) out.push(t);
  return out;
};

function conductionFixture({ name, what, geometry, weightLb, ovenF, startCoreF, pullTempF, readAt, ovenChanges = [] }) {
  const model = createConductionModel({ weightLb, geometry, startCoreF, ovenSetF: ovenF });
  const marks = [
    ...readAt.map((m) => ({ atMin: m, kind: 'read' })),
    ...ovenChanges.map((c) => ({ ...c, kind: 'oven' }))
  ].sort((a, b) => a.atMin - b.atMin || (a.kind === 'read' ? -1 : 1));

  const readings = [];
  const ovenEvents = [{ setTemp: ovenF, timestamp: at(0), isOff: false }];
  let cursor = 0;
  let trueHitMin = null;
  const stepTo = (minutes) => {
    while (cursor < minutes - 1e-9) {
      const dt = Math.min(1, minutes - cursor);
      model.step(dt);
      cursor += dt;
      if (trueHitMin === null && model.coreF >= pullTempF) trueHitMin = cursor;
    }
  };

  for (const mark of marks) {
    stepTo(mark.atMin);
    if (mark.kind === 'read') {
      readings.push({ temp: Math.round(model.coreF * 10) / 10, timestamp: at(mark.atMin) });
    } else {
      model.setOven(mark.setF);
      ovenEvents.push({ setTemp: mark.setF ?? 0, timestamp: at(mark.atMin), isOff: mark.setF === null });
    }
  }
  if (trueHitMin === null) stepTo(cursor + 2000);

  return {
    name, what, family: `1-D conduction, ${geometry}`, adversarial: false,
    weightLb, pullTempF, trueHitMin: Math.round(trueHitMin), readings, ovenEvents
  };
}

const FIXTURES = [
  conductionFixture({
    name: '01-cylinder-6lb-200F',
    what: 'The ordinary case: a 6 lb prime rib at 200 F. A cylinder about 5 in across and 8 in long, which is what a rib roast measures.',
    geometry: 'cylinder', weightLb: 6, ovenF: 200, startCoreF: 48, pullTempF: 125,
    readAt: cadence(10, 200)
  }),
  conductionFixture({
    name: '02-cylinder-3lb-250F',
    what: 'A small, fast roast. The fitted k is four times the 6 lb case, so it tests that the weight prior does not anchor the answer.',
    geometry: 'cylinder', weightLb: 3, ovenF: 250, startCoreF: 45, pullTempF: 130,
    readAt: cadence(8, 160)
  }),
  conductionFixture({
    name: '03-cylinder-24lb-175F',
    what: 'A 24 lb bird at a low oven: close to ten hours, and only 25 F of headroom over the target.',
    geometry: 'cylinder', weightLb: 24, ovenF: 175, startCoreF: 42, pullTempF: 150,
    readAt: cadence(30, 700)
  }),
  conductionFixture({
    name: '04-cylinder-dial-moved',
    what: 'Two dial changes mid-cook. The projection integrates the actual timeline, so this is the case that would break a model which averaged the oven.',
    geometry: 'cylinder', weightLb: 6, ovenF: 175, startCoreF: 48, pullTempF: 125,
    readAt: cadence(12, 300),
    ovenChanges: [{ atMin: 37, setF: 225 }, { atMin: 97, setF: 200 }]
  }),
  conductionFixture({
    name: '05-cylinder-paused',
    what: 'A 40 minute oven-off period in the middle. The readings across it are cooling, not slow heating.',
    geometry: 'cylinder', weightLb: 6, ovenF: 210, startCoreF: 48, pullTempF: 125,
    readAt: cadence(12, 300),
    ovenChanges: [{ atMin: 49, setF: null }, { atMin: 89, setF: 210 }]
  }),
  conductionFixture({
    name: '06-slab-6lb-200F',
    what: 'The same weight as 01 but a slab - a flat cut rather than a round one, so the heat comes in from two faces instead of all round. A different spectrum again, and a different time scale.',
    geometry: 'slab', weightLb: 6, ovenF: 200, startCoreF: 48, pullTempF: 125,
    readAt: cadence(8, 160)
  }),

  /**
   * ---- The adversarial pair ------------------------------------------------
   * Neither comes from a thermal model. They exist to be asserted on GRACEFUL
   * DEGRADATION rather than on accuracy: the question is what the app does when
   * handed data its model cannot describe.
   */
  (() => {
    // A perfectly linear ramp. No curvature at all, so no k explains it: the fit
    // will land on the smallest k it can and still miss.
    const readAt = cadence(15, 300);
    const rate = 0.5; // F per minute
    return {
      name: '07-adversarial-linear-ramp',
      what: 'A perfectly straight ramp, 30 F/hr, forever. No thermal model produces this - a real core decelerates as it closes on the surface. The app must not report a good fit for it.',
      family: 'none: a straight line',
      adversarial: true,
      weightLb: 6,
      pullTempF: 125,
      trueHitMin: Math.round((125 - 48) / rate),
      readings: readAt.map((m) => ({ temp: Math.round((48 + rate * m) * 10) / 10, timestamp: at(m) })),
      ovenEvents: [{ setTemp: 200, timestamp: at(0), isOff: false }]
    };
  })(),
  (() => {
    // A SINGLE first-order lag: Newton's law of cooling, straight at the oven.
    // No dead time whatever - the core's fastest moment is its first. That is the
    // one shape a cascade structurally cannot produce.
    const readAt = cadence(15, 300);
    const k = 0.012;
    const ovenF = 200;
    const startF = 48;
    const core = (m) => ovenF - (ovenF - startF) * Math.exp(-k * m);
    const pullTempF = 125;
    return {
      name: '08-adversarial-single-lag',
      what: 'A single first-order lag, straight at the oven: no dead time at all, fastest at t=0. The one shape a two-lag cascade structurally cannot produce, because its own response starts flat.',
      family: 'none: one exponential',
      adversarial: true,
      weightLb: 6,
      pullTempF,
      trueHitMin: Math.round(-Math.log(1 - (pullTempF - startF) / (ovenF - startF)) / k),
      readings: readAt.map((m) => ({ temp: Math.round(core(m) * 10) / 10, timestamp: at(m) })),
      ovenEvents: [{ setTemp: ovenF, timestamp: at(0), isOff: false }]
    };
  })()
];

for (const fixture of FIXTURES) {
  const path = resolve(DIR, `${fixture.name}.json`);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  console.log(`${fixture.name}  ${fixture.readings.length} readings, true hit +${fixture.trueHitMin} min`);
}
console.log(`\n${FIXTURES.length} fixtures written to ${DIR}`);
