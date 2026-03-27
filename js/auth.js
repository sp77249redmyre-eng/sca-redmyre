const SUPABASE_URL      = 'https://wunsexdnqathluplkkvo.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_6UyUhrHT3X1I02bVqwNuHQ_YQWh_NAo';

let _supabase = null;

export async function getSupabase() {
  if (_supabase) return _supabase;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _supabase;
}
