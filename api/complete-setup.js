const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

webpush.setVapidDetails(
  process.env.VAPI_SUBJECT || 'mailto:admin@redmyre.com.au',
  process.env.VAPI_PUBLIC_KEY,
  process.env.VAPI_PRIVATE_KEY
);

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
      .select('id, setup_complete, unit, role')
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
      {
        password: password,
        email_confirm: true
      }
    );

    if (updateAuthError) throw updateAuthError;

    const cleanName = full_name.trim();

    const { error: updateProfileError } = await supabaseAdmin
      .from('profiles')
      .update({
        full_name: cleanName,
        setup_complete: true
      })
      .eq('id', profile.id);

    if (updateProfileError) throw updateProfileError;

    // 🔔 Notify admin: a user has just completed setup
    try {
      const { data: admins } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('role', 'admin')
        .eq('push_enabled', true);

      const adminIds = admins?.map(u => u.id) || [];

      if (adminIds.length > 0) {
        const { data: subs } = await supabaseAdmin
          .from('push_subscriptions')
          .select('user_id, subscription')
          .in('user_id', adminIds);

        const unitLabel = profile.unit ? ` (${profile.unit})` : '';
        const payload = JSON.stringify({
          title: '✅ New User Registered',
          body: `${cleanName}${unitLabel} has completed setup`,
          url: '/users.html'
        });

        for (const row of subs || []) {
          try {
            await webpush.sendNotification(row.subscription, payload);
          } catch (err) {
            if (err.statusCode === 410 || err.statusCode === 404) {
              try {
                await supabaseAdmin
                  .from('push_subscriptions')
                  .delete()
                  .eq('user_id', row.user_id);
              } catch {}
            }
          }
        }
      }
    } catch (pushErr) {
      console.error('[complete-setup push error]', pushErr);
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[complete-setup error]', err);
    return res.status(500).json({ error: err.message });
  }
};
