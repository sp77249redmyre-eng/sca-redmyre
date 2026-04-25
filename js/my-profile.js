// ============================================================
// Redmyre BMS — My Profile Modal
// /js/my-profile.js
// Phase 1: 골격 + 클릭으로 열고 닫기 + 본인 이름 표시
// ============================================================

(function() {
  'use strict';

  // 모달 열기
  window.openMyProfile = async function() {
    const modal = document.getElementById('myProfileModal');
    const body = document.getElementById('myProfileBody');
    if (!modal || !body) {
      console.error('[my-profile] modal not found');
      return;
    }

    // 모달 표시
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Phase 1: 본인 이름만 표시 (window에 저장된 컨텍스트 사용)
    const name = window.__bmsCtx?.name || document.getElementById('topName')?.textContent || 'User';
    const email = window.__bmsCtx?.user?.email || '';
    const role = window.__bmsCtx?.role || '';

    body.innerHTML = `
      <div class="myprof-placeholder">
        <h3>Hello, ${escapeHtml(name)}!</h3>
        <p style="margin-top:8px">Email: ${escapeHtml(email)}</p>
        <p>Role: ${escapeHtml(role)}</p>
        <p style="margin-top:24px;font-size:12px;color:#cbd5e1">
          (Phase 1 — skeleton only.<br>More features coming next.)
        </p>
      </div>
    `;
  };

  // 모달 닫기
  window.closeMyProfile = function() {
    const modal = document.getElementById('myProfileModal');
    if (modal) {
      modal.classList.remove('open');
      document.body.style.overflow = '';
    }
  };

  // ESC 키로 닫기
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      const modal = document.getElementById('myProfileModal');
      if (modal && modal.classList.contains('open')) {
        window.closeMyProfile();
      }
    }
  });

  // HTML escape
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  console.log('[my-profile] module loaded');
})();
