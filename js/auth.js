/* ============================================================
   Redmyre BMS — Supabase Auth Module
   /js/auth.js

   ⚠️ Supabase client는 이 파일에서만 생성합니다.
   ⚠️ 다른 파일에서 직접 createClient 절대 금지.
   ⚠️ import { getSupabase } from '/js/auth.js' 로만 사용.
   ============================================================ */

const SUPABASE_URL     = 'https://wunsexdnqathluplkkvo.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_6UyUhrHT3X1I02bVqwNuHQ_YQWh_NAo';

let _supabase = null;

export async function getSupabase() {
  if (_supabase) return _supabase;

  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage
    }
  });
  return _supabase;
}
