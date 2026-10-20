/* Public connection settings. These two values are designed to be public:
   the database only lets visitors call submit_application(), and every other
   table is protected by row level security. Never put the service key here. */
window.MEET_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT-REF.supabase.co",
  supabaseAnonKey: "YOUR-SUPABASE-ANON-KEY"
};
