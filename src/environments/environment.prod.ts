/**
 * Production environment. Used in place of environment.ts for production builds
 * (see angular.json `fileReplacements`).
 *
 * Prefer same-origin (`/api`) behind a reverse proxy: it sidesteps CORS entirely
 * and keeps the session cookie first-party. A cross-site API would force
 * `SameSite=None`, which browsers keep tightening.
 */
export const environment = {
  production: true,
  apiUrl: '/api',
};
