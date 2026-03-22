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

  // 🔐 USER 검증
  const supabaseUser = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data, error: authError } = await supabaseUser.auth.getUser(token);

  if (authError || !data?.user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // 🔥 ADMIN 권한 확인
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .single();

  if (profileError || !profile || profile.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin only' });
  }

  const { user_id } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'Missing user_id' });
  }

  try {
    // 🔥 Auth 삭제
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user_id);

    if (deleteError) throw deleteError;

    // 🔥 DB 삭제
    await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('id', user_id);

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[delete error]', err);
    return res.status(500).json({ error: err.message });
  }
};
