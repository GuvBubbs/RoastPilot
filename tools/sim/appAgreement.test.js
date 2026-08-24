/**
 * Facts the app and this harness both state, checked against each other.
 *
 * The app must not import from tools/ - the harness is the independent engine the
 * app is scored against, and an app that read its constants from its own scoring
 * rig would be marking its own homework. The price of that separation is
 * duplicated constants, and duplicated constants drift. This file is where the
 * duplication is paid for.
 *
 * It lives in tools/ rather than src/ for the same reason: it is the harness's
 * job to notice, and vitest.config.js excludes tools/** from the unit run.
 */
import { describe, it, expect } from 'vitest';
import { CUTS, STALL_BAND_F as SIM_STALL_BAND_F } from './meatModel.js';
import {
  STALL_BAND_F as APP_STALL_BAND_F,
  STALLING_MEAT_TYPES,
  SHAPE_FACTORS,
  expectsStall
} from '../../src/services/thermalModel.js';
import { MEAT_PRESETS } from '../../src/constants/defaults.js';

/**
 * The harness keys cuts by SLUG ('pork-shoulder'); the app keys the same facts by
 * the lowercased display string the session config records ('pork shoulder'),
 * because that is what SessionSetupModal writes and SHAPE_FACTORS already reads.
 * Stated once, here, rather than inferred by a regex in two places.
 */
const SLUG_TO_DISPLAY = {
  'prime-rib': 'prime rib',
  'tenderloin': 'beef tenderloin',
  'pork-loin': 'pork loin',
  'pork-shoulder': 'pork shoulder',
  'leg-of-lamb': 'leg of lamb'
};

describe('the stall, as both engines describe it', () => {
  it('agrees on the band', () => {
    expect(APP_STALL_BAND_F).toEqual(SIM_STALL_BAND_F);
  });

  it('agrees on which cuts stall', () => {
    /**
     * The app names the stall in the one sentence a blocked cook reads; the
     * harness models it as a real slowdown that the app then has to survive. If
     * these two disagree, the deck stalls a roast the app describes as behaving
     * oddly, or the app explains a stall that never happens.
     */
    for (const [slug, cut] of Object.entries(CUTS)) {
      const display = SLUG_TO_DISPLAY[slug];
      expect(display, `no display name mapped for ${slug}`).toBeTruthy();
      expect(expectsStall(display), display).toBe(cut.stalls === true);
    }
  });

  it('lists no stalling type the harness has never heard of', () => {
    // The other direction: a typo in STALLING_MEAT_TYPES would silently switch
    // the copy off, and every assertion above would still pass.
    const simStallers = Object.entries(CUTS)
      .filter(([, cut]) => cut.stalls)
      .map(([slug]) => SLUG_TO_DISPLAY[slug])
      .sort();
    expect(Object.keys(STALLING_MEAT_TYPES).sort()).toEqual(simStallers);
  });
});

describe('the cuts, as both engines key them', () => {
  it('shares one set of shape factors', () => {
    // Not part of Phase 8, but the same duplication and the same failure mode -
    // and the map above is only trustworthy if it round-trips for every cut.
    for (const [slug, cut] of Object.entries(CUTS)) {
      expect(SHAPE_FACTORS[SLUG_TO_DISPLAY[slug]], slug).toBe(cut.shapeFactor);
    }
  });

  it('offers the cook only types the model has constants for', () => {
    // A preset with no shape factor gets 1.0 by default, which is a silent guess
    // rather than a stated one.
    for (const preset of MEAT_PRESETS) {
      expect(SHAPE_FACTORS, preset.type)
        .toHaveProperty(preset.type.toLowerCase());
    }
  });
});
