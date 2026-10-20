/* Public connection settings. These two values are designed to be public:
   the database only lets visitors call submit_application(), and every other
   table is protected by row level security. Never put the secret key here. */
window.MEET_CONFIG = {
  supabaseUrl: "https://tklhucdxrgkbkjkaturg.supabase.co",
  supabaseAnonKey: "sb_publishable_UA48mOS3QNtZvxKqmSiIhw_l99hKBs3"
};
