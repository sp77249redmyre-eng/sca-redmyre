const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { user_id } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'Missing user_id' });
  }

  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    // 🔥 자기 자신 삭제 방지 (유지)
    // 필요하면 나중에 user email 기준으로 다시 추가 가능

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
