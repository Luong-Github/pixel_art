/**
 * Development environment. Replaced by environment.prod.ts in production builds
 * (see angular.json `fileReplacements` for the `production` configuration).
 *
 * Fill `supabaseUrl` + `supabaseAnonKey` from your Supabase project:
 *   Supabase dashboard → Project Settings → API.
 * The anon key is PUBLIC and safe to embed in the client. NEVER put the
 * `service_role` key here (it bypasses RLS = full DB compromise).
 *
 * Leaving these empty is fine for local UI work — auth calls will simply fail
 * until the values are provided.
 */
export const environment = {
  production: false,
  supabaseUrl: '',
  supabaseAnonKey: '',
};
