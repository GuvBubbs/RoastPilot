/**
 * Carryover: how much further the core climbs after the meat leaves the oven.
 *
 * The split this file exists to support is the one the app was missing. There
 * are two temperatures, not one:
 *
 *   servingTempF  what the cook wants on the plate. This is doneness - 125 °F is
 *                 medium-rare, and it is the number a cook actually means.
 *   pullTempF     where the cook stops. This is what the projection aims at, and
 *                 it is lower, because the roast keeps cooking on the board.
 *
 * The old `targetTemp` was both at once. The app stopped the cook exactly at it
 * and the meat then carried on to 4-8 °F above, so either the cook subtracted the
 * carryover in their head - which two of the presets told them to do, in a note
 * - or dinner came out over.
 *
 * ---
 *
 * WHAT THIS NUMBER IS WORTH. Not much, and it says so.
 *
 * The audit could not establish a trustworthy figure. Solving the app's own
 * thermal model for the post-oven coast, with no evaporative term, gives +19 °F.
 * Instrumented measurements of the same cut class give +5 to +6.5 °F. A
 * threefold disagreement means the evaporation the model omits dominates the
 * result, so neither number is usable and the honest thing is a small,
 * visible, overridable estimate rather than a confident derivation.
 *
 * So: a clamped straight line across the oven band, in whole degrees. Low ovens
 * put less heat into the surface shell, so there is less stored heat to flow
 * inward once the door opens; hot ovens store more.
 *
 * Whole degrees deliberately. A carryover of "5.7 °F" claims a precision that
 * does not exist behind it.
 *
 * ---
 *
 * WHY IT IS STORED PER SESSION AND NEVER RECOMPUTED LIVE.
 *
 * Two reasons, and the second is the important one.
 *
 * A cook that already happened should not have its finish line rewritten by a
 * later, better estimator - the pull temperature the cook actually aimed at is a
 * fact about that cook.
 *
 * And recomputing it from the *current* oven temperature would close a loop from
 * the recommendation engine back into its own target: the app lowers the oven
 * because the roast is early, the carryover estimate drops, the pull temperature
 * rises, the roast is now further from done, so the app raises the oven. That is
 * an oscillator, not a feature.
 */

/**
 * The two ends of the line, in Fahrenheit.
 *
 * 175 °F is the practical minimum oven the app will suggest; 300 °F is the
 * maximum. Outside that range the value is clamped rather than extrapolated -
 * there is no evidence out there to extrapolate along.
 */
export const CARRYOVER_ANCHORS = {
  lowOvenF: 175,
  lowRiseF: 3,
  highOvenF: 300,
  highRiseF: 8
};

/**
 * Estimate carryover rise for a given oven temperature.
 *
 * @param {number|null} ovenTempF - The oven set point the roast is cooking at
 * @returns {number} Whole degrees Fahrenheit of expected rise after pulling
 */
export function estimateCarryoverF(ovenTempF) {
  const { lowOvenF, lowRiseF, highOvenF, highRiseF } = CARRYOVER_ANCHORS;

  // No oven temperature to reason from: the low end, which is the least the app
  // can claim rather than an average of two guesses.
  if (typeof ovenTempF !== 'number' || !Number.isFinite(ovenTempF)) {
    return lowRiseF;
  }

  const clamped = Math.min(highOvenF, Math.max(lowOvenF, ovenTempF));
  const fraction = (clamped - lowOvenF) / (highOvenF - lowOvenF);

  // The app's own default 200 °F oven lands on exactly +4 °F.
  return Math.round(lowRiseF + fraction * (highRiseF - lowRiseF));
}

/**
 * The pull temperature implied by a plate temperature.
 *
 * @param {number} servingTempF
 * @param {number} carryoverF
 * @returns {number}
 */
export function pullTempFor(servingTempF, carryoverF) {
  if (!Number.isFinite(servingTempF)) return servingTempF;
  const rise = Number.isFinite(carryoverF) ? carryoverF : 0;
  return servingTempF - rise;
}

/**
 * The plate temperature implied by a pull temperature. The inverse of the above,
 * used when migrating a session that only ever recorded where the cook stopped.
 *
 * @param {number} pullTempF
 * @param {number} carryoverF
 * @returns {number}
 */
export function servingTempFor(pullTempF, carryoverF) {
  if (!Number.isFinite(pullTempF)) return pullTempF;
  const rise = Number.isFinite(carryoverF) ? carryoverF : 0;
  return pullTempF + rise;
}
