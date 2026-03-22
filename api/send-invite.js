const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const auth = req.headers['authorization'] || '';
  console.log('[send-invite] auth header:', auth ? 'present' : 'MISSING');
  
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized', detail: 'No Bearer token' });
  }
  const token = auth.replace('Bearer ', '').trim();
  console.log('[send-invite] token length:', token.length);

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('[send-invite] ENV MISSING');
    return res.status(500).json({ error: 'Server config error' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  console.log('[send-invite] getUser result:', user?.id || 'NULL', authError?.message || 'no error');
  
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid token', detail: authError?.message });
  }

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single();
  console.log('[send-invite] profile role:', profile?.role || 'NULL');
  
  if (!profile || profile.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin only' });
  }

  const { email, full_name, role } = req.body;
  if (!email || !full_name || !role) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const siteUrl = process.env.SITE_URL || 'https://sca-redmyre.vercel.app';

  try {
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${siteUrl}/setup.html`,
      data: { full_name, role }
    });
    if (error) throw error;
    if (!data?.user?.id) throw new Error('Invite succeeded but user ID missing');

    await supabase.from('profiles').upsert(
      { id: data.user.id, email, full_name, role, setup_complete: false },
      { onConflict: 'email' }
    );

    return res.status(200).json({ success: true });
  } catch (err) {
    console.log('[send-invite] invite error:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to send invite' });
  }
};
