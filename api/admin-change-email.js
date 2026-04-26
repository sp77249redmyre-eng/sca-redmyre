const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { user_id, new_email } = req.body;

  if (!user_id || !new_email) {
    return res.status(400).json({ error: 'Missing user_id or new_email' });
  }

  const cleanNewEmail = new_email.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanNewEmail)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  // 🔒 Admin 권한 검증 — Authorization 토큰
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  try {
    const token = authHeader.substring(7);
    const supabaseUser = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
    const { data: { user: currentUser } } = await supabaseUser.auth.getUser();
    if (!currentUser) {
      return res.status(401).json({ error: 'Invalid authentication' });
    }

    // 🔒 자기 자신 이메일 변경 방지
    if (currentUser.id === user_id) {
      return res.status(400).json({ error: 'Cannot change your own email. Please contact another administrator or use Supabase directly.' });
    }

    // Admin role 확인
    const { data: currentProfile } = await supabaseUser
      .from('profiles')
      .select('role')
      .eq('id', currentUser.id)
      .maybeSingle();

    if (!currentProfile || currentProfile.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
  } catch (authErr) {
    console.warn('[admin-change-email] Auth check failed:', authErr);
    return res.status(401).json({ error: 'Invalid authentication' });
  }

  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    // 1. 변경 대상 사용자의 기존 이메일 조회
    const { data: targetProfile, error: targetErr } = await supabaseAdmin
      .from('profiles')
      .select('email')
      .eq('id', user_id)
      .maybeSingle();

    if (targetErr) throw targetErr;
    if (!targetProfile) {
      return res.status(404).json({ error: 'User not found' });
    }

    const oldEmail = targetProfile.email?.toLowerCase() || null;

    // 2. 같은 이메일이면 변경 없음
    if (oldEmail === cleanNewEmail) {
      return res.status(400).json({ error: 'New email is the same as current email' });
    }

    // 3. 새 이메일이 이미 다른 사용자에게 사용 중인지 확인
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, email')
      .eq('email', cleanNewEmail)
      .maybeSingle();

    if (existingProfile && existingProfile.id !== user_id) {
      return res.status(409).json({ error: 'This email is already used by another user' });
    }

    // 4. Supabase Auth 이메일 변경 (확인 절차 스킵)
    const { error: authUpdateErr } = await supabaseAdmin.auth.admin.updateUserById(
      user_id,
      { email: cleanNewEmail, email_confirm: true }
    );

    if (authUpdateErr) {
      console.error('[admin-change-email] Auth update failed:', authUpdateErr);
      return res.status(500).json({ error: 'Failed to update auth email: ' + authUpdateErr.message });
    }

    // 5. profiles.email 업데이트
    const { error: profileUpdateErr } = await supabaseAdmin
      .from('profiles')
      .update({ email: cleanNewEmail })
      .eq('id', user_id);

    if (profileUpdateErr) {
      console.error('[admin-change-email] Profile update failed:', profileUpdateErr);
      // Auth는 이미 변경됨 — 롤백 시도
      try {
        await supabaseAdmin.auth.admin.updateUserById(user_id, { email: oldEmail, email_confirm: true });
      } catch (rollbackErr) {
        console.error('[admin-change-email] Rollback failed:', rollbackErr);
      }
      return res.status(500).json({ error: 'Failed to update profile: ' + profileUpdateErr.message });
    }

    // 6. occupants 모든 행에서 옛 이메일 → 새 이메일 교체
    let occupantsUpdated = 0;
    if (oldEmail) {
      const { data: occs } = await supabaseAdmin
        .from('occupants')
        .select('id, primary_email, business_email');

      for (const o of (occs || [])) {
        let needsUpdate = false;
        let newPrimary = o.primary_email;
        let newBusiness = o.business_email;

        // primary_email 콤마 분리 후 옛 이메일 → 새 이메일 교체
        if (o.primary_email) {
          const list = o.primary_email.split(/[,;]/).map(e => e.trim()).filter(Boolean);
          const replaced = list.map(e => e.toLowerCase() === oldEmail ? cleanNewEmail : e);
          // 중복 제거 (만약 새 이메일이 이미 같은 행에 있으면)
          const dedupLower = new Set();
          const final = replaced.filter(e => {
            const lower = e.toLowerCase();
            if (dedupLower.has(lower)) return false;
            dedupLower.add(lower);
            return true;
          });
          if (final.join(', ') !== list.join(', ')) {
            newPrimary = final.length > 0 ? final.join(', ') : null;
            needsUpdate = true;
          }
        }

        // business_email 동일 처리
        if (o.business_email) {
          const list = o.business_email.split(/[,;]/).map(e => e.trim()).filter(Boolean);
          const replaced = list.map(e => e.toLowerCase() === oldEmail ? cleanNewEmail : e);
          const dedupLower = new Set();
          const final = replaced.filter(e => {
            const lower = e.toLowerCase();
            if (dedupLower.has(lower)) return false;
            dedupLower.add(lower);
            return true;
          });
          if (final.join(', ') !== list.join(', ')) {
            newBusiness = final.length > 0 ? final.join(', ') : null;
            needsUpdate = true;
          }
        }

        if (needsUpdate) {
          const { error: updErr } = await supabaseAdmin
            .from('occupants')
            .update({ primary_email: newPrimary, business_email: newBusiness })
            .eq('id', o.id);
          if (updErr) {
            console.warn(`[admin-change-email] occupants update failed for ${o.id}:`, updErr);
          } else {
            occupantsUpdated++;
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      old_email: oldEmail,
      new_email: cleanNewEmail,
      occupants_updated: occupantsUpdated
    });

  } catch (err) {
    console.error('[admin-change-email] error:', err);
    return res.status(500).json({ error: err.message });
  }
};
