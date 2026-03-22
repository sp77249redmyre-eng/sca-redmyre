const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = auth.replace('Bearer ', '').trim();

  // 🔹 유저 검증 (ANON KEY)
  const supabaseUser = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data, error: authError } = await supabaseUser.auth.getUser(token);

  if (authError || !data?.user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // 🔹 관리자 권한 체크 (SERVICE ROLE)
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const userId = data.user.id;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userId)   // 🔥 핵심 수정 (id 기반)
    .maybeSingle();

  console.log('[user id]', userId, '[profile]', profile);

  if (!profile || profile.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin only' });
  }

  // 🔹 입력값 검증
  const { email, full_name, role } = req.body;

  if (!email || !full_name || !role) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const siteUrl = process.env.SITE_URL || 'https://sca-redmyre.vercel.app';

  try {
    // 🔹 초대 발송
    const { data: inviteData, error: inviteError } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${siteUrl}/setup.html`,
        data: { full_name, role }
      });

    if (inviteError) throw inviteError;

    // 🔹 profiles 저장
    await supabaseAdmin.from('profiles').upsert(
      {
        id: inviteData.user.id,
        email: email.toLowerCase().trim(),
        full_name,
        role,
        setup_complete: false
      },
      { onConflict: 'email' }
    );

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[invite error]', err);
    return res.status(500).json({ error: err.message });
  }
};
