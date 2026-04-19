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

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[delete error]', err);
    return res.status(500).json({ error: err.message });
  }
};
