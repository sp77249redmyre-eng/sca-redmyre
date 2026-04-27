const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

webpush.setVapidDetails(
  process.env.VAPI_SUBJECT || 'mailto:admin@redmyre.com.au',
  process.env.VAPI_PUBLIC_KEY,
  process.env.VAPI_PRIVATE_KEY
);

// 에러 로깅 헬퍼 — audit_logs에 자동 기록
async function logError(supabase, errorMsg, details = {}) {
  try {
    await supabase.from('audit_logs').insert({
      action: 'api_error',
      user_email: 'system',
      details: {
        function: 'send-push',
        error: errorMsg,
        ...details,
      },
    });
  } catch (e) {
    console.error('[logError] failed:', e);
  }
}

module.exports = async (req, res) => {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const { title, message, target_role, target_roles, user_id, url } = req.body;

    let query = supabase
      .from('push_subscriptions')
      .select('user_id, subscription');

    if (user_id) {
      query = query.eq('user_id', user_id);
    } else if (target_roles && Array.isArray(target_roles)) {
      const { data: users } = await supabase
        .from('profiles')
        .select('id')
        .in('role', target_roles)
        .eq('push_enabled', true);

      const ids = users?.map(u => u.id) || [];
      if (ids.length === 0) return res.status(200).json({ success: true, sent: 0 });
      query = query.in('user_id', ids);
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
    let failedCount = 0;
    const failures = [];

    for (const row of subscriptions || []) {
      try {
        await webpush.sendNotification(
          row.subscription,
          JSON.stringify({
            title,
            body: message,
            url: url || '/'
          })
        );
        sent++;
      } catch (err) {
        console.log('PUSH ERROR:', err.statusCode, err.message, err.body);
        failedCount++;
        // 410/404는 정상 (사용자가 앱 삭제 등) — 자동 정리
        if (err.statusCode === 410 || err.statusCode === 404) {
          try { await supabase.from('push_subscriptions').delete().eq('user_id', row.user_id); } catch {}
        } else {
          // 진짜 에러 → 모음
          failures.push({
            user_id: row.user_id,
            statusCode: err.statusCode,
            message: err.message,
          });
        }
      }
    }

    // 진짜 에러가 있었으면 audit_logs에 기록
    if (failures.length > 0) {
      await logError(supabase, `${failures.length} push notifications failed`, {
        title,
        target_role,
        target_roles,
        user_id,
        sent_count: sent,
        failed_count: failures.length,
        failures: failures.slice(0, 5), // 처음 5개만
      });
    }

    return res.status(200).json({ success: true, sent, failed: failedCount });
  } catch (e) {
    // 전체 처리 실패
    await logError(supabase, e.message || String(e), {
      stack: e.stack,
    });
    return res.status(500).json({ error: e.message || 'Push send failed' });
  }
};
