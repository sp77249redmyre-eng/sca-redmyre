const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

// FIX 1 — VAPID_SUBJECT fallback
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:admin@redmyre.com.au',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = auth.replace('Bearer ', '');

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Invalid token' });

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single();
  if (!profile || profile.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin only' });
  }

  const { title, message, url } = req.body;
  if (!title || !message) {
    return res.status(400).json({ error: 'Missing title or message' });
  }

  // FIX 2 — select id + subscription
  const { data: subscriptions, error } = await supabase
    .from('push_subscriptions')
    .select('id, subscription');

  if (error) return res.status(500).json({ error: error.message });

  const payload = JSON.stringify({
    title,
    body: message,
    url: url || '/announcements.html',
    tag: 'announcement'
  });

  let sent = 0, failed = 0;
  const toDelete = [];

  for (const row of (subscriptions || [])) {
    try {
      await webpush.sendNotification(row.subscription, payload);
      sent++;
    } catch (err) {
      // FIX 3 — delete by primary key id, not JSON string
      if (err.statusCode === 410 || err.statusCode === 404) {
        toDelete.push(row.id);
      }
      failed++;
    }
  }

  if (toDelete.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', toDelete);
  }

  return res.status(200).json({ success: true, sent, failed });
};
