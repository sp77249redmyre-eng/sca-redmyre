const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:admin@redmyre.com.au',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

module.exports = async (req, res) => {

  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = auth.replace('Bearer ', '');

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: { user } } = await supabase.auth.getUser(token);

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || profile.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin only' });
  }

  const { title, message } = req.body;

  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('id, subscription');

  let sent = 0;

  for (const row of subscriptions || []) {
    try {
      await webpush.sendNotification(
        row.subscription,
        JSON.stringify({ title, body: message })
      );
      sent++;
    } catch {}
  }

  return res.status(200).json({ success: true, sent });
};
