const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Missing email' });
  }

  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const cleanEmail = email.toLowerCase().trim();

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('email, setup_complete')
      .eq('email', cleanEmail)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(200).json({ status: 'not_found' });
    }

    if (data.setup_complete === false) {
      return res.status(200).json({ status: 'needs_setup' });
    }

    return res.status(200).json({ status: 'ready' });

  } catch (err) {
    console.error('[check-email error]', err);
    return res.status(500).json({ error: err.message });
  }
};
