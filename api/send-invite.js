const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = auth.replace('Bearer ', '');

  // Admin client with service role
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // User client to verify token
  const supabaseUser = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: { user }, error: authError } = await supabaseUser.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid token', detail: authError?.message });
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles').select('role').eq('id', user.id).single();
  if (!profile || profile.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin only' });
  }

  const { email, full_name, role } = req.body;
  if (!email || !full_name || !role) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const siteUrl = process.env.SITE_URL || 'https://sca-redmyre.vercel.app';

  try {
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${siteUrl}/setup.html`,
      data: { full_name, role }
    });
    if (error) throw error;
    if (!data?.user?.id) throw new Error('Invite succeeded but user ID missing');

    await supabaseAdmin.from('profiles').upsert(
      { id: data.user.id, email, full_name, role, setup_complete: false },
      { onConflict: 'email' }
    );

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to send invite' });
  }
};
