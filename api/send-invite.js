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

    return res.status(200).json({ success: true, skipEmail: !!skipEmail });

  } catch (err) {
    console.error('[invite error]', err);
    return res.status(500).json({ error: err.message });
  }
};
