/**
 * Development environment. Replaced by environment.prod.ts in production builds
 * (see angular.json `fileReplacements` for the `production` configuration).
 *
 * The client knows exactly ONE address: the backend API. No Supabase URL, no anon
 * key, no Stripe key, no OAuth client id — every third-party credential lives in
 * the server's environment only (BD-4). If a key ever shows up in this file, the
 * architecture has regressed.
 */
export const environment = {
  production: false,
  apiUrl: 'http://localhost:8080',
};
