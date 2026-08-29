/**
 * Production environment. Used in place of environment.ts for production builds
 * (see angular.json `fileReplacements`).
 *
 * Fill `supabaseUrl` + `supabaseAnonKey` from your Supabase project:
 *   Supabase dashboard → Project Settings → API.
 * The anon key is PUBLIC and safe to embed in the client. NEVER put the
 * `service_role` key here (it bypasses RLS = full DB compromise).
 */
export const environment = {
  production: true,
  supabaseUrl: '',
  supabaseAnonKey: '',
};
