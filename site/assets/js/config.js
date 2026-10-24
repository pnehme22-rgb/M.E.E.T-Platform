/* Public connection settings. These two values are designed to be public:
   the database only lets visitors call submit_application(), and every other
   table is protected by row level security. Never put the secret key here. */
window.MEET_CONFIG = {
  supabaseUrl: "https://tklhucdxrgkbkjkaturg.supabase.co",
  supabaseAnonKey: "sb_publishable_UA48mOS3QNtZvxKqmSiIhw_l99hKBs3",
  // Cloudflare Turnstile site key (public, for meetstudio.art). The matching
  // secret key is kept only in Supabase › Authentication › Attack Protection.
  // To switch bot protection off: turn it off in Supabase first, then empty this.
  turnstileSiteKey: "0x4AAAAAAFkgso1MHsnVyK8g"
};
