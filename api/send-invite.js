const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { email, full_name, role, unit, skipEmail } = req.body;

  if (!email || !role) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const siteUrl = process.env.SITE_URL || 'https://sca-redmyre.vercel.app';
  const normalizedEmail = email.toLowerCase().trim();

  try {
    let userId;

    if (skipEmail) {
      // Silent add: create user with random password, no email sent
      const randomPassword = 'Tmp_' + Math.random().toString(36).slice(2) + Date.now().toString(36);

      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        password: randomPassword,
        email_confirm: true,
        user_metadata: { full_name, role, unit: unit || null }
      });

      if (error) throw error;
      userId = data.user.id;

    } else {
      // Normal invite flow: send email
      const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${siteUrl}/setup`,
        data: { full_name, role, unit: unit || null }
      });

      if (error) throw error;
      userId = data.user.id;
    }

    await supabaseAdmin.from('profiles').upsert({
      id: userId,
      email: normalizedEmail,
      full_name,
      role,
      unit: unit || null,
      setup_complete: false
    });

    // 🔄 occupants 자동 동기화
    // - owner/committee → primary_email에 콤마 누적
    // - tenant → business_email에 콤마 누적
    // - admin/observer → 동기화 안 함
    // - unit 없으면 동기화 안 함
    // - 이미 등록된 이메일이면 추가 안 함 (중복 방지)
    // - 그 unit 행이 occupants에 없으면 에러 반환
    let occupantsSyncResult = null;
    if (unit && ['owner', 'committee', 'tenant'].includes(role)) {
      try {
        const { data: occRow, error: occFindErr } = await supabaseAdmin
          .from('occupants')
          .select('id, primary_email, business_email, unit')
          .eq('unit', unit)
          .maybeSingle();

        if (occFindErr) throw occFindErr;

        if (!occRow) {
          // unit 행이 없음 → 에러 (사장님이 occupants 먼저 등록해야 함)
          return res.status(409).json({
            success: false,
            warning: `User profile created, but occupants entry for Unit ${unit} not found. Please create the unit in the Occupants page first, then re-add this user, OR add the email manually to the Occupants page.`,
            profile_created: true,
            occupants_synced: false
          });
        }

        // role에 따라 어느 컬럼에 추가할지 결정
        const targetField = (role === 'tenant') ? 'business_email' : 'primary_email';
        const currentValue = occRow[targetField] || '';
        const existingEmails = currentValue.split(/[,;]/).map(e => e.trim()).filter(Boolean);
        const existingLower = existingEmails.map(e => e.toLowerCase());

        if (existingLower.includes(normalizedEmail)) {
          // 이미 등록됨 → 중복 추가 안 함
          occupantsSyncResult = { synced: false, reason: 'already_exists', unit, field: targetField };
        } else {
          // 콤마로 누적
          const newList = [...existingEmails, normalizedEmail];
          const newValue = newList.join(', ');

          const { error: updErr } = await supabaseAdmin
            .from('occupants')
            .update({ [targetField]: newValue })
            .eq('id', occRow.id);

          if (updErr) throw updErr;
          occupantsSyncResult = { synced: true, unit, field: targetField };
        }
      } catch (syncErr) {
        console.warn('[send-invite] occupants sync failed:', syncErr);
        occupantsSyncResult = { synced: false, reason: 'error', error: syncErr.message };
      }
    }

    return res.status(200).json({
      success: true,
      skipEmail: !!skipEmail,
      occupants_sync: occupantsSyncResult
    });

  } catch (err) {
    console.error('[invite error]', err);
    return res.status(500).json({ error: err.message });
  }
};
