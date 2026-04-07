const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

webpush.setVapidDetails(
  process.env.VAPI_SUBJECT || 'mailto:admin@redmyre.com.au',
  process.env.VAPI_PUBLIC_KEY,
  process.env.VAPI_PRIVATE_KEY
);

module.exports = async (req, res) => {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { title, message, target_role, user_id } = req.body;

  let query = supabase
    .from('push_subscriptions')
    .select('user_id, subscription');

  if (user_id) {
    query = query.eq('user_id', user_id);
  } else if (target_role) {
    const { data: users } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', target_role)
      .eq('push_enabled', true);

    const ids = users?.map(u => u.id) || [];

    if (ids.length === 0) {
      return res.status(200).json({ success: true, sent: 0 });
    }

    query = query.in('user_id', ids);
  } else {
    const { data: users } = await supabase
      .from('profiles')
      .select('id')
      .eq('push_enabled', true);

    const ids = users?.map(u => u.id) || [];

    if (ids.length === 0) {
      return res.status(200).json({ success: true, sent: 0 });
    }

    query = query.in('user_id', ids);
  }

  const { data: subscriptions } = await query;

  let sent = 0;

  for (const row of subscriptions || []) {
    try {
      await webpush.sendNotification(
        row.subscription,
        JSON.stringify({
          title,
          body: message
        })
      );
      sent++;
    } catch {}
  }

  return res.status(200).json({ success: true, sent });
};