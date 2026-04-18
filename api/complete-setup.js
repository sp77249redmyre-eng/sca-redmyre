const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { email, full_name, password } = req.body;

  if (!email || !full_name || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  if (full_name.trim().length < 2) {
    return res.status(400).json({ error: 'Name must be at least 2 characters' });
  }

  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const cleanEmail = email.toLowerCase().trim();

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, setup_complete')
      .eq('email', cleanEmail)
      .maybeSingle();

    if (profileError) throw profileError;

    if (!profile) {
      return res.status(404).json({ error: 'Email not registered' });
    }

    if (profile.setup_complete === true) {
      return res.status(403).json({ error: 'Account already set up. Please login.' });
    }

    const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(
      profile.id,
      { password: password }
    );

    if (updateAuthError) throw updateAuthError;

    const { error: updateProfileError } = await supabaseAdmin
      .from('profiles')
      .update({
        full_name: full_name.trim(),
        setup_complete: true
      })
      .eq('id', profile.id);

    if (updateProfileError) throw updateProfileError;

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[complete-setup error]', err);
    return res.status(500).json({ error: err.message });
  }
};
