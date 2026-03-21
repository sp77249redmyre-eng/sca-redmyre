const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // ── Auth check: verify caller is admin ──
  const authHeader = event.headers['authorization'] || event.headers['Authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  const token = authHeader.replace('Bearer ', '');

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid token' }) };
  }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (!profile || profile.role !== 'admin') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden: Admin only' }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { title, message, url } = body;
  if (!title || !message) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing title or message' }) };
  }

  const { data: subscriptions, error } = await supabase
    .from('push_subscriptions')
    .select('subscription');

  if (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }

  const payload = JSON.stringify({
    title,
    body: message,
    url: url || '/announcements.html',
    tag: 'announcement'
  });

  let sent = 0;
  let failed = 0;
  const toDelete = [];

  for (const row of (subscriptions || [])) {
    try {
      await webpush.sendNotification(row.subscription, payload);
      sent++;
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        toDelete.push(JSON.stringify(row.subscription));
      }
      failed++;
    }
  }

  if (toDelete.length > 0) {
    await supabase.from('push_subscriptions').delete().in('subscription', toDelete);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, sent, failed })
  };
};
