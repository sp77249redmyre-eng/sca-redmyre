const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { email, full_name, role, unit } = req.body;

  if (!email || !full_name || !role) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const siteUrl = process.env.SITE_URL || 'https://sca-redmyre.vercel.app';

  try {
    const { data, error } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${siteUrl}/setup`,
        data: { full_name, role, unit: unit || null }
      });

    if (error) throw error;

    await supabaseAdmin.from('profiles').upsert({
      id: data.user.id,
      email: email.toLowerCase().trim(),
      full_name,
      role,
      unit: unit || null,
      setup_complete: false
    });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[invite error]', err);
    return res.status(500).json({ error: err.message });
  }
};
