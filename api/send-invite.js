const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const auth = req.headers['authorization'] || '';
  console.log('[auth header]', auth ? 'present, length:' + auth.length : 'MISSING');

  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized', detail: 'No Bearer token' });
  }
  const token = auth.replace('Bearer ', '').trim();
  console.log('[token] length:', token.length, 'starts:', token.substring(0, 20));

  // TASK 4 FIX — use ANON KEY for user token validation
  const supabaseUser = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data, error: authError } = await supabaseUser.auth.getUser(token);
  console.log('[getUser result]', data?.user?.id || 'NULL', authError?.message || 'no error');

  if (authError || !data?.user) {
    return res.status(401).json({ error: 'Invalid token', detail: authError?.message });
  }

  // Use SERVICE ROLE for admin operations only
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: profile } = await supabaseAdmin
    .from('profiles').select('role').eq('email', data.user.email).single();
  console.log('[profile role]', profile?.role || 'NULL');

  if (!profile || profile.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin only' });
  }

  const { email, full_name, role } = req.body;
  if (!email || !full_name || !role) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const siteUrl = process.env.SITE_URL || 'https://sca-redmyre.vercel.app';

  try {
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${siteUrl}/setup.html`,
      data: { full_name, role }
    });
    if (inviteError) throw inviteError;
    if (!inviteData?.user?.id) throw new Error('Invite succeeded but user ID missing');

    await supabaseAdmin.from('profiles').upsert(
      { id: inviteData.user.id, email, full_name, role, setup_complete: false },
      { onConflict: 'email' }
    );

    return res.status(200).json({ success: true });
  } catch (err) {
    console.log('[invite error]', err.message);
    return res.status(500).json({ error: err.message || 'Failed to send invite' });
  }
};
