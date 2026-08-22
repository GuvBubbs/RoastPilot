/**
 * Build identity.
 *
 * The three `__APP_*__` values are string literals substituted by Vite's
 * `define` at build time (see vite.config.js). Vitest runs without that
 * config, so every read is guarded — importing this file must never be the
 * thing that breaks a test.
 */

export const APP_VERSION =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

export const APP_COMMIT =
  typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'local';

export const APP_BUILT_AT =
  typeof __APP_BUILT_AT__ === 'string' ? __APP_BUILT_AT__ : null;

/**
 * The line shown under the version in Settings → About: when this bundle was
 * built and which commit it came from, e.g. "22 Aug 2026 · b823705".
 * @returns {string}
 */
export function buildLabel() {
  if (!APP_BUILT_AT) return APP_COMMIT;

  const built = new Date(APP_BUILT_AT);
  if (Number.isNaN(built.getTime())) return APP_COMMIT;

  const date = built.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
  return `${date} · ${APP_COMMIT}`;
}
