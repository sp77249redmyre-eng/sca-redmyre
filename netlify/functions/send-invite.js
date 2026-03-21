const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { email, full_name, role } = body;
  if (!email || !full_name || !role) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    // Send the real invite email (uses "Invite user" template)
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: process.env.SITE_URL + '/setup.html',
      data: { full_name, role }
    });

    if (error) throw error;

    // Upsert profile with name + role ready for when they complete setup
    await supabaseAdmin.from('profiles').upsert(
      { id: data.user.id, email, full_name, role, setup_complete: false },
      { onConflict: 'email' }
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Failed to send invite' })
    };
  }
};
