import { getSupabase } from '/js/auth.js';

export async function logAction(ctx, { action, table, record_id = null, details = {} }) {
  try {
    const { supabase, user, role } = ctx;

    // ❌ admin 제외
    if (role === 'admin') return;

    await supabase.from('audit_logs').insert({
      action,
      table_name: table,
      record_id,
      user_email: user.email,
      user_role: role,
      details
    });

  } catch (err) {
    console.error('audit log error:', err);
  }
}