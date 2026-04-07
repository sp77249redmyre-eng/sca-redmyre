/* ============================================================
   Redmyre BMS — Common Utilities
   /js/common.js

   모든 페이지에서 공통으로 사용하는 유틸 함수들.
   import { formatDate, getTimeAgo, ... } from '/js/common.js'
   ============================================================ */

/* ── 날짜 포맷 ── */
export function formatDate(dateStr, options = {}) {
  const defaults = { day: 'numeric', month: 'short', year: 'numeric' };
  return new Date(dateStr).toLocaleDateString('en-AU', { ...defaults, ...options });
}

export function formatDateTime(dateStr) {
  return new Date(dateStr).toLocaleString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

export function getTimeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hrs  = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (mins < 1)  return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hrs < 24)  return `${hrs}h ago`;
  return `${days}d ago`;
}

/* ── 이니셜 추출 ── */
export function getInitials(name) {
  return (name || '?')
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/* ── 금액 포맷 ── */
export function formatCurrency(amount) {
  return '$' + Number(amount || 0).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/* ── Role 레이블 ── */
export function getRoleLabel(role) {
  return (role || 'observer').charAt(0).toUpperCase() + (role || 'observer').slice(1);
}

/* ── Status 색상 매핑 (Works) ── */
export const WORKS_STATUS_MAP = {
  inprog:    { label: 'In Progress', cls: 'badge-blue',   dot: 'var(--blue-600)' },
  scheduled: { label: 'Scheduled',   cls: 'badge-gray',   dot: 'var(--muted)' },
  urgent:    { label: 'Urgent',      cls: 'badge-red',    dot: 'var(--red)' },
  review:    { label: 'Under Review',cls: 'badge-yellow', dot: 'var(--yellow)' },
  quoting:   { label: 'Quoting',     cls: 'badge-yellow', dot: 'var(--yellow)' },
  pending:   { label: 'Pending',     cls: 'badge-yellow', dot: 'var(--yellow)' },
  legal:     { label: 'Legal',       cls: 'badge-red',    dot: 'var(--red)' },
  done:      { label: 'Done',        cls: 'badge-green',  dot: 'var(--green)' },
};

/* ── Category emoji 매핑 (Complaints) ── */
export const COMPLAINT_CAT_EMOJI = {
  noise:    '🔊',
  leak:     '💧',
  cleaning: '🧹',
  parking:  '🚗',
  elevator: '🛗',
  access:   '🔒',
  hvac:     '❄️',
  common:   '🏢',
  other:    '📝',
};

export const COMPLAINT_CAT_LABEL = {
  noise:    'Noise / Vibration',
  leak:     'Leak / Plumbing',
  cleaning: 'Cleaning',
  parking:  'Parking',
  elevator: 'Elevator',
  access:   'Access / Security',
  hvac:     'HVAC / Temperature',
  common:   'Common Area',
  other:    'Other',
};

/* ── Push Notification Toggle ── */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
}

let notifEnabled = false;

function updateNotifUI() {
  const btn = document.getElementById('notifToggleBtn');
  if (!btn) return;
  document.getElementById('notifIcon').textContent  = notifEnabled ? '🔔' : '🔕';
  document.getElementById('notifLabel').textContent = notifEnabled ? 'ON'  : 'OFF';
  btn.style.background  = notifEnabled ? 'var(--accent-soft, rgba(99,102,241,0.1))' : 'transparent';
  btn.style.borderColor = notifEnabled ? 'var(--accent, #6366f1)' : 'var(--border)';
  btn.style.color       = notifEnabled ? 'var(--accent, #6366f1)' : 'var(--muted)';
}

window.toggleNotification = async function () {
  if (!notifEnabled) {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { notifEnabled = false; updateNotifUI(); return; }
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array('BNyzSuyh9RRzRLNiPq1mngiuEH35QX3smFJoYQGWdOSdu_4koNy4s65I8WUpI1gxanRgJLNU0gDJfhW1PUdxQrI')
      });
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('push_subscriptions').insert({ user_id: user.id, subscription: sub });
      notifEnabled = true;
    } catch(e) { notifEnabled = false; }
  } else {
    notifEnabled = false;
  }
  updateNotifUI();
};
