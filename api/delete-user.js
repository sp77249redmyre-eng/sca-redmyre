const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { user_id } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'Missing user_id' });
  }

  // 🔒 자기 자신 삭제 방지 — Authorization 토큰으로 현재 유저 확인
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.substring(7);
      const supabaseUser = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        { global: { headers: { Authorization: `Bearer ${token}` } } }
      );
      const { data: { user: currentUser } } = await supabaseUser.auth.getUser();
      if (currentUser && currentUser.id === user_id) {
        return res.status(400).json({ error: 'Cannot delete your own account' });
      }
    } catch (authErr) {
      console.warn('[delete-user] Auth check failed:', authErr);
      return res.status(401).json({ error: 'Invalid authentication' });
    }
  }

  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    // 🔍 Auth 삭제 전에 이메일 먼저 가져오기 (occupants 정리에 사용)
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('email')
      .eq('id', user_id)
      .maybeSingle();
    const userEmail = profile?.email?.toLowerCase() || null;

    // 🔥 Auth 삭제
    const { error: deleteError } =
      await supabaseAdmin.auth.admin.deleteUser(user_id);

    if (deleteError) throw deleteError;

    // 🔥 profiles 삭제
    const { error: dbError } = await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('id', user_id);

    if (dbError) throw dbError;

    // 🔥 occupants에서 그 이메일만 제거 (다른 정보는 유지)
    if (userEmail) {
      const { data: occs } = await supabaseAdmin
        .from('occupants')
        .select('id, primary_email, business_email');

      for (const o of (occs || [])) {
        let needsUpdate = false;
        let newPrimary = o.primary_email;
        let newBusiness = o.business_email;

        // primary_email에서 그 이메일만 제거 (콤마/세미콜론 분리)
        if (o.primary_email) {
          const list = o.primary_email.split(/[,;]/).map(e => e.trim()).filter(Boolean);
          const filtered = list.filter(e => e.toLowerCase() !== userEmail);
          if (filtered.length !== list.length) {
            newPrimary = filtered.length > 0 ? filtered.join(', ') : null;
            needsUpdate = true;
          }
        }

        // business_email에서 그 이메일만 제거
        if (o.business_email) {
          const list = o.business_email.split(/[,;]/).map(e => e.trim()).filter(Boolean);
          const filtered = list.filter(e => e.toLowerCase() !== userEmail);
          if (filtered.length !== list.length) {
            newBusiness = filtered.length > 0 ? filtered.join(', ') : null;
            needsUpdate = true;
          }
        }

        if (needsUpdate) {
          const { error: updErr } = await supabaseAdmin
            .from('occupants')
            .update({ primary_email: newPrimary, business_email: newBusiness })
            .eq('id', o.id);
          if (updErr) {
            console.warn(`[delete-user] occupants cleanup failed for ${o.id}:`, updErr);
          }
        }
      }
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[delete error]', err);
    return res.status(500).json({ error: err.message });
  }
};
