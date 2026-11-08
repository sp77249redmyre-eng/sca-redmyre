
import { initLayout } from '/js/layout.js';
import { parseComment } from '/js/common.js';

window.deletePc = async function(id, el) {
  if (!confirm('Delete this comment?')) return;
  const { error } = await supabase.from('project_comments').delete().eq('id', id);
  if (error) { showToast('Failed to delete', true); return; }
  const msg = el.closest('.pc-msg');
  if (msg) msg.remove();
};

window.editPc = function(id, el) {
  const msgDiv = el.closest('.pc-msg');
  const bodyDiv = msgDiv.querySelector('.pc-msg-body');
  if (!bodyDiv) return;
  const original = bodyDiv.innerHTML;
  // Build modal
  const overlay = document.createElement('div');
  overlay.id = 'pc-edit-modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
  const modal = document.createElement('div');
  modal.style.cssText = 'background:#fff;border-radius:14px;padding:28px;width:100%;max-width:780px;box-shadow:0 20px 60px rgba(0,0,0,0.25);display:flex;flex-direction:column;gap:14px';
  const title = document.createElement('div');
  title.textContent = 'Edit Comment';
  title.style.cssText = 'font-size:16px;font-weight:700;color:#1e293b';
  const editorWrap = document.createElement('div');
  editorWrap.id = 'pc-edit-quill';
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'background:#f1f5f9;color:#374151;border:none;border-radius:8px;padding:8px 20px;font-size:13px;font-weight:600;cursor:pointer';
  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.style.cssText = 'background:#2563eb;color:#fff;border:none;border-radius:8px;padding:8px 20px;font-size:13px;font-weight:600;cursor:pointer';
  const close = () => overlay.remove();
  cancelBtn.onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  saveBtn.onclick = async () => {
    const qEdit = modal._quill;
    const txt = qEdit ? qEdit.root.innerHTML : '';
    const plain = qEdit ? qEdit.getText().trim() : '';
    if (!plain) return;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    const { error } = await supabase.from('project_comments').update({ comment: txt }).eq('id', id);
    if (error) { showToast('Failed to update', true); saveBtn.disabled = false; saveBtn.textContent = 'Save'; return; }
    bodyDiv.innerHTML = txt;
    close();
    showToast('Comment updated');
  };
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(saveBtn);
  modal.appendChild(title);
  modal.appendChild(editorWrap);
  modal.appendChild(btnRow);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  setTimeout(()=>{
    if(window.Quill){
      modal._quill = new Quill('#pc-edit-quill',{theme:'snow',modules:{toolbar:[['bold','italic',{color:[]}]]},placeholder:'Edit your comment...'});
      modal._quill.root.innerHTML = original;
    }
  }, 100);
};
import { getSupabase } from '/js/auth.js';

let allQuotes   = [];
let allVotes    = [];
let supabase    = null;
let user        = null;
let role        = 'observer';
let allProfiles = {};
let committeeMembers = [];

const COMMITTEE_ORDER = [
  { name: 'Jimmy',    role: 'Chairman'          },
  { name: 'Michael',  role: 'Treasurer'         },
  { name: 'Michelle', role: 'Secretary'         },
  { name: 'Sudesh',   role: 'Committee Member'  },
  { name: 'Niranjan', role: 'Committee Member'  },
  { name: 'Sarah',    role: 'Committee Member'  },
  { name: 'Laura',    role: 'Committee Member'  },
  { name: 'Eva',      role: 'Committee Member'  }
];
let expandedVendors = {};
let pendingFiles    = [];

// Per-(projectId+email) lock – prevents race conditions under fast clicks
const actionLocks = new Map();
const resultEmailSent = new Set(); // PATCH 5: track projects where result email was sent

const RULES = { approvalsRequired: 5, declinesToAutoDecline: 5, holdsToAutoHold: 4 };
const TOTAL_VOTERS = 8;

// ── SINGLE SOURCE OF TRUTH: Voting result calculator ──────────────
// 8명 committee 기준:
// 5+ Approve → approved
// 5+ Decline → declined
// 4+ Hold    → hold
// 8명 전원 투표 후 과반 없음 → hold (재투표)
// 복수견적: 어느 vendor도 5A 못 받으면 → hold (재투표)
function calculateResult({ approvals, declines, holds, hasTie = false, totalVoted = 0 }) {
  if (approvals >= RULES.approvalsRequired)       return 'approved';
  if (declines  >= RULES.declinesToAutoDecline)   return 'declined';
  if (holds     >= RULES.holdsToAutoHold)         return 'hold';
  if (hasTie    && approvals > 0)                 return 'hold';
  if (totalVoted >= TOTAL_VOTERS)                 return 'hold';
  return 'pending';
}

// ── Internal validation (runs once on load, logs to console) ──────
(function validateCalculateResult() {
  const cases = [
    { input: { approvals:5, declines:0, holds:0, totalVoted:5 }, expected:'approved', label:'5A → approved'                        },
    { input: { approvals:6, declines:0, holds:0, totalVoted:6 }, expected:'approved', label:'6A → approved'                        },
    { input: { approvals:0, declines:5, holds:0, totalVoted:5 }, expected:'declined', label:'5D → declined'                        },
    { input: { approvals:0, declines:0, holds:4, totalVoted:4 }, expected:'hold',     label:'4H → hold'                            },
    { input: { approvals:5, declines:3, holds:0, totalVoted:8 }, expected:'approved', label:'5A 3D → approved'                     },
    { input: { approvals:3, declines:5, holds:0, totalVoted:8 }, expected:'declined', label:'3A 5D → declined'                     },
    { input: { approvals:4, declines:4, holds:0, totalVoted:8 }, expected:'hold',     label:'4A 4D 전원투표 → hold'                },
    { input: { approvals:3, declines:3, holds:2, totalVoted:8 }, expected:'hold',     label:'3A 3D 2H 전원투표 → hold'             },
    { input: { approvals:4, declines:3, holds:1, totalVoted:8 }, expected:'hold',     label:'4A 3D 1H 전원투표 → hold'             },
    { input: { approvals:4, declines:0, holds:0, totalVoted:4 }, expected:'pending',  label:'4A 4명만 투표 → pending'              },
    { input: { approvals:0, declines:4, holds:0, totalVoted:4 }, expected:'pending',  label:'4D 4명만 투표 → pending'              },
    { input: { approvals:0, declines:0, holds:3, totalVoted:3 }, expected:'pending',  label:'3H 3명만 투표 → pending'              },
    { input: { approvals:2, declines:2, holds:4, totalVoted:8 }, expected:'hold',     label:'2A 2D 4H → hold'                      },
    { input: { approvals:3, declines:0, holds:0, totalVoted:8, hasTie:true }, expected:'hold', label:'Tie 전원투표 → hold'          },
    { input: { approvals:2, declines:0, holds:0, totalVoted:4, hasTie:true }, expected:'hold', label:'Tie hasTie → hold'            },
    { input: { approvals:0, declines:0, holds:0, totalVoted:0 }, expected:'pending',  label:'0 → pending'                          },
  ];
  let passed = 0; let failed = 0;
  cases.forEach(({ input, expected, label }) => {
    const got = calculateResult(input);
    if (got === expected) { passed++; }
    else { failed++; console.error(`[calculateResult] FAIL: ${label} → got "${got}", expected "${expected}"`); }
  });
  if (failed === 0) console.log(`[calculateResult] All ${passed} validation tests passed`);
  else console.error(`[calculateResult] ✖ ${failed} test(s) FAILED – check voting logic`);
})();

async function init() {
  const layoutResult = await initLayout();
  if (!layoutResult) return;
  supabase = layoutResult.supabase;
  user     = layoutResult.user;
  role     = layoutResult.role || 'observer';

  window.logActivity = async function(action, record_id = null) {
    try {
      if (role === 'admin') return;
      await supabase.from('audit_logs').insert({
        user_email: user.email,
        user_role: role,
        action,
        record_id,
        created_at: new Date().toISOString()
      });
    } catch (e) {}
  };
  const { data: profiles } = await supabase.from('profiles').select('email, full_name, role');
  committeeMembers = [];
  (profiles || []).forEach(p => {
    allProfiles[p.email] = p.full_name || p.email.split('@')[0];
  });
  // COMMITTEE_ORDER 기준으로 고정 순서 + role 매핑
  COMMITTEE_ORDER.forEach(member => {
    const profile = (profiles || []).find(p => (p.full_name || '').trim().toLowerCase().startsWith(member.name.toLowerCase()));
    committeeMembers.push({
      email: profile ? profile.email : '',
      name: member.name,
      committeeRole: member.role
    });
  });
  if (role === 'admin') {
    const btn = document.getElementById('createProjectBtn');
    if (btn) {
      btn.style.display = '';
      btn.style.visibility = 'visible';
      btn.classList.add('is-visible');
    }
  }
  await loadData();
  renderQuotes();

  supabase.channel('quotes-realtime')
    .on('postgres_changes', {event: '*', schema: 'public', table: 'quotes'}, async () => { await loadData(); renderQuotes(); })
    .on('postgres_changes', {event: '*', schema: 'public', table: 'votes'}, async () => { await loadData(); renderQuotes(); })
    .on('postgres_changes', {event: '*', schema: 'public', table: 'project_comments'}, async () => { await loadData(); renderQuotes(); })
    .subscribe();
}

async function loadData() {
  try {
    const [qRes, vRes] = await Promise.all([
      supabase.from('quotes').select('*').eq('archived', false).or('is_emergency.eq.false,is_emergency.is.null').order('created_at', { ascending: false }),
      supabase.from('votes').select('*')
    ]);
    allQuotes = qRes.data || [];
    allVotes  = vRes.data || [];
  } catch(e) {
    console.error('loadData failed:', e);
    showToast('Failed to load data', true);
  }
}



function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// One row per (project_id, user_email)
function getUserVoteRow(projectId) {
  if (!projectId || !user?.email) return null;
  return allVotes.find(v => v.project_id === projectId && v.user_email === user.email) || null;
}

function getProjectVotes(projectId) {
  if (!projectId) return [];
  return allVotes.filter(v => v.project_id === projectId);
}

function countQuoteProjects(quotes) {
  return new Set((quotes || []).map(q => q.project_id || q.id).filter(Boolean)).size;
}

window.toggleQuoteSection = function(bodyId, button) {
  const body = document.getElementById(bodyId);
  if (!body || !button) return;
  const willOpen = body.hidden;
  body.hidden = !willOpen;
  button.setAttribute('aria-expanded', String(willOpen));
  const chevron = button.querySelector('.quote-section-chevron');
  if (chevron) chevron.textContent = willOpen ? '⌃' : '⌄';
};

function renderQuotes() {
  const visible = allQuotes.filter(q => {
    if (q.work_status !== null || q.completion_date !== null || q.archived || q.is_emergency === true) return false;
    return true;
  });
  const drafts = role === 'admin' ? visible.filter(q => q.status === 'draft') : [];
  const voting = visible.filter(q => q.status === 'voting' || q.status === 'pending');
  const onHold = visible.filter(q => q.status === 'onhold');

  const draftSection = document.getElementById('draftSection');
  if (draftSection) draftSection.style.display = role === 'admin' ? '' : 'none';

  const draftCount = document.getElementById('draftCount');
  const votingCount = document.getElementById('currentVotingCount');
  const holdCount = document.getElementById('onHoldCount');
  if (draftCount) draftCount.textContent = countQuoteProjects(drafts);
  if (votingCount) votingCount.textContent = countQuoteProjects(voting);
  if (holdCount) holdCount.textContent = countQuoteProjects(onHold);

  renderPendingQuotes(drafts, 'pendingList', 'No draft quotes.');
  renderPendingQuotes(voting, 'currentVotingList', 'No quotes are currently open for voting.');
  renderOnHoldQuotes(onHold);
}

function renderPendingQuotes(quotes, containerId = 'pendingList', emptyMessage = 'No quotes to display.') {
  const container = document.getElementById(containerId);
  if (!quotes.length) {
    container.innerHTML = '<div style="padding:36px 20px;text-align:center;color:#94a3b8;font-size:14px">' + escHtml(emptyMessage) + '</div>';
    return;
  }

  const projectMap = {};
  quotes.forEach(q => {
    const key = q.project_id || q.id;
    if (!projectMap[key]) projectMap[key] = [];
    projectMap[key].push(q);
  });

  container.innerHTML = '';
  const useProjectAccordion = containerId === 'currentVotingList';
  let projectIndex = 0;

  Object.values(projectMap).forEach(group => {
    projectIndex++;
    const first      = group[0];
    const parsed     = parseComment(first.comment);
    const projectKey = first.project_id || first.id;
    if (!projectKey) return;

    const isDraft  = group.every(q => q.status === 'draft');
    const isVoting = group.some(q => q.status === 'voting' || q.status === 'pending');

    const userVoteRow      = getUserVoteRow(projectKey);
    const selectedQuoteId  = userVoteRow?.selected_quote_id || null;
    const selectedQuote    = selectedQuoteId ? (group.find(q => q.id === selectedQuoteId) ?? null) : null;
    const userAlreadyVoted = !!(userVoteRow?.vote && userVoteRow.vote !== '');

    const projectVotes = getProjectVotes(projectKey);
    const votedRows    = projectVotes.filter(v => v.vote && v.vote !== '');

    // ── Unified Voting Engine ──────────────────────────────
    // Per-vendor approve counts (only votes that selected that vendor)
    const vendorApproveMap = {};
    group.forEach(q => { vendorApproveMap[q.id] = 0; });
    votedRows.forEach(v => {
      if (v.vote === 'approve' && v.selected_quote_id && vendorApproveMap[v.selected_quote_id] !== undefined) {
        vendorApproveMap[v.selected_quote_id]++;
      }
    });

    const totalApprovals = votedRows.filter(v => v.vote === 'approve').length;
    const declines       = votedRows.filter(v => v.vote === 'decline').length;
    const holds          = votedRows.filter(v => v.vote === 'hold').length;

    // Max approvals for any single vendor
    const vendorApproveCounts = Object.values(vendorApproveMap);
    const maxVendorApprovals  = vendorApproveCounts.length > 0 ? Math.max(...vendorApproveCounts) : 0;
    // Count vendors tied at the max
    const vendorsAtMax = vendorApproveCounts.filter(c => c === maxVendorApprovals && c > 0).length;

    // For single-quote projects use total approvals directly
    const isSingle  = group.length === 1;
    const approvals = isSingle ? totalApprovals : maxVendorApprovals;

    // Tie: multiple vendors share highest approval count → force hold
    const hasTie = !isSingle && vendorsAtMax > 1 && maxVendorApprovals > 0;

    // ── Single source of truth: calculateResult() ─────────
    const calcResult       = calculateResult({ approvals, declines, holds, hasTie, totalVoted: votedRows.length });
    const resultApproved   = calcResult === 'approved';
    const resultDeclined   = calcResult === 'declined';
    const resultHold       = calcResult === 'hold';
    const isTieHold        = resultHold && hasTie;
    const resultDetermined = resultApproved || resultDeclined || (resultHold && !hasTie);
    const isLocked         = resultDetermined;

    // Winning vendor (for approved result)
    const winnerQuoteId = resultApproved && !isSingle
      ? Object.entries(vendorApproveMap).find(([,c]) => c === maxVendorApprovals)?.[0] || null
      : null;
    const winnerQuote = winnerQuoteId ? (group.find(q => q.id === winnerQuoteId) ?? selectedQuote) : selectedQuote;

    const cat = first.category || parsed.category || 'General';
    const catNumClass = {'General':'pnum-blue','HVAC':'pnum-amber','Fire':'pnum-red','Electrical':'pnum-yellow','Security':'pnum-purple','Plumbing':'pnum-teal','Lift':'pnum-green','Legal':'pnum-pink','Other':'pnum-gray'}[cat] || 'pnum-gray';
    const catIcon = {'General':'','HVAC':'','Fire':'','Electrical':'','Security':'','Plumbing':'','Lift':'','Legal':'','Other':''}[cat] || '';
    const projectIndex_str = String(projectIndex).padStart(2,'0');
    const card = document.createElement('div');
    card.className = 'project-card';
    card.setAttribute('data-cat', cat);

    // Header
    const header = document.createElement('div');
    header.className = 'project-header';
    const headerLeft = document.createElement('div');
    headerLeft.className = 'project-header-left';
    headerLeft.innerHTML = `
      <span class="pnum ${catNumClass}">${projectIndex_str}</span>
      <div style="width:36px;height:36px;border-radius:10px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">${catIcon}</div>
      <div>
        <span class="project-title">${escHtml(first.project || first.project_title || 'Project')}</span>
        <span class="project-meta">${escHtml(cat)} · ${group.length} vendor${group.length!==1?'s':''}</span>
        ${{Normal:'<span class="badge-priority badge-priority-normal">Normal</span>',High:'<span class="badge-priority badge-priority-high">High</span>',Urgent:'<span class="badge-priority badge-priority-urgent">Urgent</span>'}[parsed.priority||'Normal']||''}
      </div>`;
    header.appendChild(headerLeft);

    const headerRight = document.createElement('div');
    headerRight.style.cssText = 'display:flex;align-items:center;gap:10px';

    if (isDraft) {
      const badge = document.createElement('span');
      badge.className = 'draft-badge';
      badge.textContent = 'Draft';
      headerRight.appendChild(badge);
      if (role === 'admin') {
        const sendBtn = document.createElement('button');
        sendBtn.className = 'send-btn';
        sendBtn.textContent = 'Send to Committee';
        sendBtn.onclick = () => sendToCommittee(group, sendBtn, projectKey);
        headerRight.appendChild(sendBtn);

        const holdBtn = document.createElement('button');
        holdBtn.className = 'quote-place-hold-btn';
        holdBtn.textContent = 'Place on Hold';
        holdBtn.onclick = () => placeProjectOnHold(group, holdBtn);
        headerRight.appendChild(holdBtn);
      }
    } else if (isVoting) {
      const badge = document.createElement('span');
      badge.className = 'voting-badge';
      badge.textContent = 'Voting';
      headerRight.appendChild(badge);
    }
    header.appendChild(headerRight);
    card.appendChild(header);

    // Admin Actions – relocated from the former Management Archive (Add Quote / Edit Project / Mark Expired)
    if (role === 'admin') {
      const adminActionsRow = document.createElement('div');
      adminActionsRow.style.cssText = 'padding:10px 20px 0;display:flex;gap:8px;flex-wrap:wrap';

      const addQuoteBtn = document.createElement('button');
      addQuoteBtn.className = 'btn-mgmt btn-mgmt-green';
      addQuoteBtn.textContent = '➕ Add Quote';
      addQuoteBtn.onclick = () => openAddQuoteToProject(projectKey, first.project || first.project_title || 'Project', cat, parsed.priority || 'Normal');
      adminActionsRow.appendChild(addQuoteBtn);

      const expireBtn = document.createElement('button');
      expireBtn.className = 'btn-mgmt btn-mgmt-red';
      expireBtn.textContent = 'Mark as Expired';
      expireBtn.onclick = () => markExpired(group, expireBtn);
      adminActionsRow.appendChild(expireBtn);

      card.appendChild(adminActionsRow);


    }

    // Vote summary bar (visible during voting)
    const VENDOR_COLORS = [
      { bg: '#dbeafe', border: '#3b82f6', dot: '#1d4ed8' },
      { bg: '#dcfce7', border: '#22c55e', dot: '#15803d' },
      { bg: '#fef3c7', border: '#eab308', dot: '#a16207' },
      { bg: '#fce7f3', border: '#ec4899', dot: '#be185d' },
      { bg: '#ede9fe', border: '#8b5cf6', dot: '#6d28d9' },
    ];
    const vendorColorMap = {};
    group.forEach((q, idx) => { vendorColorMap[q.id] = VENDOR_COLORS[idx % VENDOR_COLORS.length]; });

    // Tally summary now shown inline in the Voting / Admin Controls section title

    // Click hint banner removed

    // Vendor list
    const vendorList = document.createElement('div');
    const isMultiVendorVoting = isVoting && group.length > 1;
    vendorList.className = 'vendor-list' + (isMultiVendorVoting ? ' multi-vendor-voting' : '');

    group.forEach(q => {
      const quoteId = q.id;
      if (!quoteId) return;
      const qParsed    = parseComment(q.comment);
      const isSelected = selectedQuoteId === quoteId;
      const hasSelection = !!selectedQuoteId;

      const vendorItem = document.createElement('div');
      const isWinner = resultApproved && (isSingle || quoteId === winnerQuoteId);
      vendorItem.className = `vendor-item${isSelected ? ' is-selected' : ''}${isWinner ? ' is-winner' : ''}`;
      vendorItem.id = `vendor-${quoteId}`;
      const vColor = vendorColorMap[quoteId];
      // Option D: white background + colored left bar only
      if (vColor && !isSelected && !isMultiVendorVoting) {
        vendorItem.style.background = '#fff';
        vendorItem.style.borderLeft = `4px solid ${vColor.dot}`;
      }

      const vendorHeader = document.createElement('div');
      vendorHeader.className = `vendor-header${isSelected ? ' hdr-selected' : ''}`;
      if (vColor && !isSelected && !isMultiVendorVoting) vendorHeader.style.background = '#fff';

      const vendorContent = document.createElement('div');
      vendorContent.className = 'vendor-content';
      const selectedTagHtml = (isVoting && (isSingle || isSelected)) ? '<span class="vendor-selected-tag">✓ SELECTED</span>' : '';
      const submittedDate = q.created_at
        ? new Date(q.created_at).toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'numeric' })
        : '';
      const quoteFiles = Array.isArray(qParsed.files) ? qParsed.files : [];
      const fileReference = quoteFiles.map(file => (file.name || '').match(/\bQ[- ]?\d{3,}\b/i)?.[0].replace(/\s/g, '-')).find(Boolean) || '';
      const quoteReference = q.quote_number || q.quotation_number || q.reference ||
        qParsed.quote_number || qParsed.quotation_number || qParsed.reference || fileReference;
      vendorContent.innerHTML = `
        ${selectedTagHtml}
        <div class="vendor-name">${escHtml(q.vendor || 'Unknown Vendor')}</div>
        ${isMultiVendorVoting && (quoteReference || submittedDate) ? '<div class="vendor-quote-date">' + (quoteReference ? 'Quote: ' + escHtml(quoteReference) : '') + (quoteReference && submittedDate ? ' · ' : '') + (submittedDate ? escHtml(submittedDate) : '') + '</div>' : ''}
        <div class="vendor-meta-row">
          <div class="vendor-amount">$${Number(q.amount || 0).toLocaleString('en-AU')} + GST</div>
        </div>`;
      vendorHeader.appendChild(vendorContent);

      const statusDiv = document.createElement('div');
      statusDiv.className = 'vendor-status';

      if (isVoting && isMultiVendorVoting) {
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'quote-choice-' + projectKey;
        radio.className = 'vendor-choice-radio';
        radio.checked = isSelected;
        radio.disabled = role !== 'committee' || isLocked;
        radio.setAttribute('aria-label', 'Select ' + (q.vendor || 'vendor'));
        radio.addEventListener('click', e => e.stopPropagation());
        radio.addEventListener('change', () => {
          if (radio.checked) doUpsert(projectKey, { selected_quote_id: quoteId }, radio, '');
        });
        statusDiv.appendChild(radio);
      } else if (isVoting) {
        if (isSingle) {
          // Single quote – auto-selected, badge already in vendor-content
        } else if (isSelected) {
          if (role === 'committee' && !isLocked) {
            const deselBtn = document.createElement('button');
            deselBtn.className = 'deselect-btn';
            deselBtn.textContent = 'Change';
            deselBtn.onclick = (e) => {
              e.stopImmediatePropagation();
              doUpsert(projectKey, { selected_quote_id: null }, deselBtn, 'Change');
            };
            statusDiv.appendChild(deselBtn);
          }
        } else if (hasSelection) {
          statusDiv.innerHTML = '<span class="badge-x">✕</span>';
        } else if (role === 'committee' && !isLocked) {
          const selectBtn = document.createElement('button');
          selectBtn.className = 'select-btn';
          selectBtn.textContent = 'Select';
          selectBtn.onclick = (e) => {
            e.stopImmediatePropagation();
            doUpsert(projectKey, { selected_quote_id: quoteId }, selectBtn, 'Select');
          };
          statusDiv.appendChild(selectBtn);
        }
      }
      vendorHeader.appendChild(statusDiv);

      // Show one vendor's details at a time (display only)
      const closeOtherDetails = () => {
        vendorList.querySelectorAll('.vendor-item').forEach(it => {
          if (it === vendorItem) return;
          const d = it.querySelector('.vendor-details'); if (d) d.classList.remove('show');
          const h = it.querySelector('.vendor-header'); if (h) h.classList.remove('is-open');
          const b = it.querySelector('.btn-view-details');
          if (b) { b.classList.remove('is-open'); const sp = b.querySelector('span'); if (sp) sp.textContent = 'View Details'; }
          expandedVendors[it.id.replace('vendor-','')] = false;
        });
      };
      // View Details pulsing button — clear click affordance
      const viewBtn = document.createElement('button');
      viewBtn.className = 'btn-view-details';
      viewBtn.type = 'button';
      viewBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg><span>View Details</span>';
      viewBtn.onclick = (e) => {
        e.stopImmediatePropagation();
        const details = vendorItem.querySelector('.vendor-details');
        if (!details) return;
        const opened = details.classList.toggle('show');
        if (opened) closeOtherDetails();
        vendorHeader.classList.toggle('is-open', opened);
        viewBtn.classList.toggle('is-open', opened);
        viewBtn.querySelector('span').textContent = opened ? 'Hide Details' : 'View Details';
        expandedVendors[quoteId] = opened;
      };
      vendorContent.querySelector('.vendor-meta-row').appendChild(viewBtn);

      vendorHeader.onclick = (e) => {
        if (e.target.closest('button,input,label')) return;
        const details = vendorItem.querySelector('.vendor-details');
        if (!details) return;
        const opened = details.classList.toggle('show');
        if (opened) closeOtherDetails();
        vendorHeader.classList.toggle('is-open', opened);
        viewBtn.classList.toggle('is-open', opened);
        viewBtn.querySelector('span').textContent = opened ? 'Hide Details' : 'View Details';
        expandedVendors[quoteId] = opened;
      };

      vendorItem.appendChild(vendorHeader);

      const files = Array.isArray(qParsed.files) ? qParsed.files : [];
      const detailsDiv = document.createElement('div');
      detailsDiv.className = 'vendor-details' + (expandedVendors[quoteId] ? ' show' : '');
      if (expandedVendors[quoteId]) {
        vendorHeader.classList.add('is-open');
        viewBtn.classList.add('is-open');
        viewBtn.querySelector('span').textContent = 'Hide Details';
      }
      const mkLine = (label, val) => {
        const d = document.createElement('div'); d.className = 'detail-line';
        d.innerHTML = '<span class="detail-label">' + label + '</span><span>' + escHtml(val) + '</span>';
        return d;
      };
      if(q.notes){const nd=document.createElement('div');nd.className='detail-line';nd.innerHTML='<span class="detail-label">Notes:</span><span>'+q.notes+'</span>';detailsDiv.appendChild(nd);}else{detailsDiv.appendChild(mkLine('Notes:','—'));}
      if(qParsed.note){const id=document.createElement('div');id.className='detail-line';id.innerHTML='<span class="detail-label">Internal:</span><span>'+qParsed.note+'</span>';detailsDiv.appendChild(id);}else{detailsDiv.appendChild(mkLine('Internal:','—'));}
      detailsDiv.appendChild(mkLine('Category:', q.category || qParsed.category || '—'));
      detailsDiv.appendChild(mkLine('Priority:', qParsed.priority || '—'));
      const filesLine = document.createElement('div'); filesLine.className = 'detail-line';
      filesLine.innerHTML = '<span class="detail-label">Files:</span>';
      if (files.length) {
        const fw = document.createElement('div'); fw.className = 'detail-files attachment-grid';
        files.forEach(f => {
          const a = document.createElement('a');
          a.className = 'detail-file-link attachment-card'; a.href = '#';
          const ext = (f.name || '').split('.').pop().toLowerCase();
          const fileBadge = ext === 'pdf' ? 'PDF'
            : ['doc','docx'].includes(ext) ? 'WORD'
            : ['xls','xlsx'].includes(ext) ? 'XLS'
            : ['jpg','jpeg','png','gif','webp','svg'].includes(ext) ? 'IMG' : 'FILE';
          const badgeClass = fileBadge.toLowerCase();
          const sizeLabel = f.size ? Math.round(Number(f.size)/1024).toLocaleString('en-AU') + ' KB' : '';
          a.innerHTML = `<span class="attachment-badge attachment-badge-${badgeClass}">${fileBadge}</span><span class="attachment-info"><span class="attachment-name">${escHtml(f.name)}</span><span class="attachment-size">${sizeLabel}</span></span><span class="attachment-open">OPEN ↗</span>`;
          a.onclick = (e) => { e.preventDefault(); openFileViewer(f.path || f.url || '', f.name, f.type || ''); };
          fw.appendChild(a);
        });
        detailsDiv.appendChild(filesLine);
        detailsDiv.appendChild(fw);
      } else {
        const ns = document.createElement('span');
        ns.style.cssText = 'color:#9ca3af;margin-left:4px;font-size:13px';
        ns.textContent = 'No files attached';
        filesLine.appendChild(ns);
        detailsDiv.appendChild(filesLine);
      }
      // Admin Edit 버튼 — 기존 editQuote() 함수 호출
      const _editFinalized = group.some(q => ['approved','declined','force_approved'].includes(q.status));
      if (role === 'admin' && !_editFinalized) {
        const editRow = document.createElement('div');
        editRow.style.cssText = 'padding:10px 0 4px;display:flex;justify-content:flex-end';
        const editBtn = document.createElement('button');
        editBtn.className = 'btn-mgmt btn-mgmt-blue';
        editBtn.textContent = 'Edit';
        editBtn.onclick = (e) => { e.stopPropagation(); editQuote(quoteId); };
        editRow.appendChild(editBtn);
        detailsDiv.appendChild(editRow);
      }
      vendorItem.appendChild(detailsDiv);
      vendorList.appendChild(vendorItem);
    });

    if (isVoting && group.length > 1) {
      const step1 = document.createElement('div');
      step1.className = 'step-title';
      step1.innerHTML = '<span class="step-num">1</span>' + (isMultiVendorVoting ? 'Quotes (' + group.length + ') · Choose a vendor' : 'Choose a vendor');
      card.appendChild(step1);
    }
    card.appendChild(vendorList);

    // Draft: non-admin sees placeholder, admin still sees controls
    if (isDraft && role !== 'admin') {
      const overlay = document.createElement('div');
      overlay.className = 'draft-overlay';
      overlay.textContent = 'This quote is in draft. Waiting for admin to send to committee.';
      card.appendChild(overlay);
      container.appendChild(card);
      return;
    }

    const votingSection = document.createElement('div');
    votingSection.className = 'voting-section';

    // (Old "Voting" section removed — vote buttons now inline next to YOU HAVE NOT VOTED banner)

    // Admin force controls – always visible when voting
    if (role === 'admin' && isVoting) {
      const adminTitle = document.createElement('div');
      adminTitle.className = 'section-title';
      adminTitle.innerHTML = 'Admin Controls';
      votingSection.appendChild(adminTitle);

      const adminRow = document.createElement('div');
      adminRow.className = 'btn-admin-row';
      [
        { label: 'Force Approve', status: 'approved', cls: 'btn-approve' },
        { label: 'Force Hold',    status: 'onhold',   cls: 'btn-hold'    },
        { label: 'Force Decline', status: 'declined', cls: 'btn-decline' }
      ].forEach(({ label, status, cls }) => {
        const btn = document.createElement('button');
        btn.className = `btn-action ${cls}`;
        btn.textContent = label;
        btn.onclick = () => {
          if (status !== 'declined' && !selectedQuote && group.length > 1) { showToast('Please select a vendor first', true); return; }
          const targetId = selectedQuote?.id || group[0]?.id || null;
          forceAction(status, targetId, group, btn);
        };
        adminRow.appendChild(btn);
      });
      votingSection.appendChild(adminRow);

      const pjId = group[0]?.project_id || projectKey;
      const pjVotes = allVotes.filter(v => v.project_id === pjId);
      const votedSet = new Set(pjVotes.filter(v => v.vote).map(v => v.user_email));
      const pendingMs = committeeMembers.filter(m => m.email && !votedSet.has(m.email));

      if (pendingMs.length > 0) {
        const remindRow = document.createElement('div');
        remindRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;align-items:center';

        const isSingleVendor = group.length === 1;

        const buildPayload = (recipients) => ({
          project: group[0].project || group[0].project_title || 'Project',
          recipients,
          quotes: group.filter(q => q.vendor).map(q => ({
            vendor: q.vendor, amount: q.amount || 0,
            approvals: isSingleVendor
              ? pjVotes.filter(v => v.vote === 'approve').length
              : pjVotes.filter(v => v.vote === 'approve' && v.selected_quote_id === q.id).length,
            holds: pjVotes.filter(v => v.vote === 'hold').length,
            declines: pjVotes.filter(v => v.vote === 'decline').length
          })),
          votes: committeeMembers.map(cm => {
            const vRow = pjVotes.find(v => v.user_email === cm.email);
            const selQ = vRow?.selected_quote_id
              ? group.find(q => q.id === vRow.selected_quote_id)
              : (isSingleVendor && vRow?.vote === 'approve' ? group[0] : null);
            return { name: cm.name, committeeRole: cm.committeeRole || '', vote: vRow?.vote || '', vendor: selQ?.vendor || '' };
          }),
          totalMembers: committeeMembers.length || 8
        });

        const remindAllBtn = document.createElement('button');
        remindAllBtn.className = 'btn-mgmt btn-mgmt-blue';
        remindAllBtn.innerHTML = `Remind Non-Voters (${pendingMs.length})`;
        remindAllBtn.onclick = async () => {
          remindAllBtn.disabled = true; remindAllBtn.textContent = 'Sending...';
          try {
            const { data: { session } } = await supabase.auth.getSession();
            await fetch('https://wunsexdnqathluplkkvo.supabase.co/functions/v1/email-quote-reminder', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
              body: JSON.stringify(buildPayload(pendingMs.map(m => m.email)))
            });
            showToast(`Reminder sent to ${pendingMs.length} members`);
          } catch(e) { showToast('Failed to send reminder', true); }
          remindAllBtn.disabled = false; remindAllBtn.innerHTML = `Remind Non-Voters (${pendingMs.length})`;
        };
        remindRow.appendChild(remindAllBtn);

        const testBtn = document.createElement('button');
        testBtn.className = 'btn-mgmt';
        testBtn.style.cssText = 'background:#fff7ed;color:#9a3412;border-color:#fdba74;font-size:12px;';
        testBtn.innerHTML = `Test (Me)`;
        testBtn.onclick = async () => {
          testBtn.disabled = true; testBtn.textContent = 'Sending...';
          try {
            const { data: { session } } = await supabase.auth.getSession();
            await fetch('https://wunsexdnqathluplkkvo.supabase.co/functions/v1/email-quote-reminder', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
              body: JSON.stringify(buildPayload(['sp77249.redmyre@gmail.com']))
            });
            showToast('Test reminder sent to yourself');
          } catch(e) { showToast('Failed to send test', true); }
          testBtn.disabled = false; testBtn.innerHTML = `Test (Me)`;
        };
        remindRow.appendChild(testBtn);

        pendingMs.forEach(m => {
          const pb = document.createElement('button');
          pb.className = 'btn-mgmt';
          pb.style.cssText = 'background:#f0fdf4;color:#166534;border-color:#86efac;font-size:12px;';
          pb.innerHTML = `${m.name.split(' ')[0]}`;
          pb.onclick = async () => {
            pb.disabled = true; pb.textContent = 'Sent';
            try {
              const { data: { session } } = await supabase.auth.getSession();
              await fetch('https://wunsexdnqathluplkkvo.supabase.co/functions/v1/email-quote-reminder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
                body: JSON.stringify(buildPayload([m.email]))
              });
              showToast(`Reminder sent to ${m.name.split(' ')[0]}`);
            } catch(e) {
              showToast('Failed to send reminder', true);
              pb.disabled = false; pb.innerHTML = `${m.name.split(' ')[0]}`;
            }
          };
          remindRow.appendChild(pb);
        });

        votingSection.appendChild(remindRow);
      }
    }

    // Voting status – full committee grid (RENDERED FIRST, but moved to top via DOM)
    const voteStatusFrag = document.createDocumentFragment();
    const voteTitle = document.createElement('div');
    voteTitle.className = 'section-title';
    const voteTallyHTML = isVoting ? `<span class="tally-inline"><span class="tally-pill" style="background:#dcfce7;color:#166534">${totalApprovals}</span><span class="tally-pill" style="background:#fee2e2;color:#991b1b">${declines}</span><span class="tally-pill" style="background:#fef3c7;color:#92400e">${holds}</span></span>` : '';
    voteTitle.innerHTML = 'Voting Status' + voteTallyHTML;
    voteStatusFrag.appendChild(voteTitle);

    // Vote tally bars (display only — uses the numbers already calculated above)
    const voteTop = document.createElement('div');
    voteTop.className = 'vote-top';
    const tallyBox = document.createElement('div');
    tallyBox.className = 'tally-box';
    const tallyLeft = Math.max(0, TOTAL_VOTERS - votedRows.length);
    const tallyLead = isDraft ? 'Voting has not started'
      : resultApproved ? 'Approved'
      : resultDeclined ? 'Declined'
      : resultHold ? (isTieHold ? 'Tie – please reconsider' : 'On hold')
      : 'Not decided yet';
    const tallyRow = (cls, label, n, need) =>
      '<div class="meter m-' + cls + '"><div class="m-row"><span class="m-name">' + label + '</span><span class="m-count"><b>' + n + '</b> of ' + need + ' needed</span></div>' +
      '<div class="m-track"><div class="m-fill" style="width:' + Math.min(100, Math.round(n / need * 100)) + '%"></div></div></div>';
    tallyBox.innerHTML = '<div class="m-lead">' + tallyLead + '</div><div class="m-sub">' + tallyLeft + ' of ' + TOTAL_VOTERS + ' members still to vote</div>' +
      tallyRow('ok', 'Approve', approvals, RULES.approvalsRequired) +
      tallyRow('hold', 'Hold', holds, RULES.holdsToAutoHold) +
      tallyRow('no', 'Decline', declines, RULES.declinesToAutoDecline);
    voteTop.appendChild(tallyBox);
    voteStatusFrag.appendChild(voteTop);

    const voteGrid = document.createElement('div');
    voteGrid.className = 'voting-grid';

    const isFinalized = group.some(q => ['approved','declined','onhold','force_approved'].includes(q.status));
    const membersToShow = committeeMembers.length > 0
      ? committeeMembers
      : COMMITTEE_ORDER.map(m => ({ email: '', name: m.name, committeeRole: m.role }));

    // My vote status banner + inline action buttons (committee only)
    if (role === 'committee' && isVoting && !isLocked) {
      const myVoteRow = getUserVoteRow(projectKey);
      const hasVoted = myVoteRow && myVoteRow.vote && myVoteRow.vote !== '';

      const bannerWrap = document.createElement('div');
      bannerWrap.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap';

      const myVoteBanner = document.createElement('div');
      if (hasVoted) {
        const myVoteLabel = myVoteRow.vote === 'approve' ? 'Approve' : myVoteRow.vote === 'hold' ? 'Hold' : 'Decline';
        const mySelQ = myVoteRow.selected_quote_id
          ? group.find(q => q.id === myVoteRow.selected_quote_id)
          : (isSingle && myVoteRow.vote === 'approve' ? group[0] : null);
        const myVendorText = mySelQ ? ' → ' + escHtml(mySelQ.vendor) : '';
        myVoteBanner.style.cssText = 'padding:6px 12px;background:#dcfce7;border:1.5px solid #16a34a;border-radius:8px;font-size:13px;font-weight:800;color:#14532d;display:inline-flex;align-items:center;gap:6px;letter-spacing:0.02em;width:auto';
        myVoteBanner.innerHTML = 'YOU VOTED: ' + myVoteLabel + myVendorText;
      } else {
        myVoteBanner.style.cssText = 'padding:6px 12px;background:#fee2e2;border:1.5px solid #dc2626;border-radius:8px;font-size:13px;font-weight:800;color:#7f1d1d;display:inline-flex;align-items:center;gap:6px;letter-spacing:0.02em;width:auto;animation:pulseVote 1.8s ease-in-out infinite';
        myVoteBanner.innerHTML = 'YOU HAVE NOT VOTED YET';
      }
      bannerWrap.appendChild(myVoteBanner);

      // Inline action buttons next to the banner
      const inlineActions = document.createElement('div');
      inlineActions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';

      const canVoteNow = (selectedQuote || isSingle);

      if (hasVoted) {
        // Change Vote button
        const changeBtn = document.createElement('button');
        changeBtn.className = 'btn-action';
        changeBtn.style.cssText = 'padding:7px 14px;font-size:12px;background:#475569;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;letter-spacing:0.02em';
        changeBtn.textContent = 'Change Vote';
        changeBtn.onclick = async () => {
          changeBtn.disabled = true;
          await doUpsert(projectKey, { vote: '', selected_quote_id: null }, changeBtn, 'Change Vote');
          changeBtn.disabled = false;
        };
        inlineActions.appendChild(changeBtn);
      } else if (canVoteNow) {
        ['approve','hold','decline'].forEach(type => {
          const btn = document.createElement('button');
          btn.className = `btn-action btn-${type}`;
          btn.style.cssText = 'padding:7px 16px;font-size:12px;border:none;border-radius:8px;color:#fff;font-weight:700;cursor:pointer;letter-spacing:0.02em';
          btn.textContent = type.charAt(0).toUpperCase() + type.slice(1);
          btn.onclick = async () => {
            inlineActions.querySelectorAll('button').forEach(b => { b.disabled = true; });
            const payload = { vote: type };
            if (!isSingle && type === 'approve' && !myVoteRow?.selected_quote_id && selectedQuote) {
              payload.selected_quote_id = selectedQuote.id;
            }
            await doUpsert(projectKey, payload, btn, btn.textContent);
            inlineActions.querySelectorAll('button').forEach(b => { b.disabled = false; });
          };
          inlineActions.appendChild(btn);
        });
      }

      bannerWrap.appendChild(inlineActions);
      const step2 = document.createElement('div');
      step2.className = 'step-title step-vote';
      step2.innerHTML = '<span class="step-num">2</span>Your vote' + (selectedQuote ? ' on ' + escHtml(selectedQuote.vendor) : '');
      bannerWrap.insertBefore(step2, bannerWrap.firstChild);
      voteTop.appendChild(bannerWrap);
    }

    if (membersToShow.length > 0) {
      membersToShow.forEach(member => {
        const vRow = projectVotes.find(v => v.user_email === member.email);
        const cell = document.createElement('div');
        const isMe = member.email === user.email;
        cell.className = 'vote-cell' + (isMe ? ' vote-cell-me' : '');

        let valueText = 'Pending';
        let valueCls  = 'v-pending';

        if (vRow && vRow.vote && vRow.vote !== '') {
          const selQ = vRow.selected_quote_id
            ? group.find(q => q.id === vRow.selected_quote_id)
            : (group.length === 1 && vRow.vote === 'approve' ? group[0] : null);
          const voteLabel = vRow.vote === 'approve' ? '✓ Approve' : vRow.vote === 'hold' ? 'Hold' : '✕ Decline';
          valueCls  = vRow.vote === 'approve' ? 'v-approve' : vRow.vote === 'hold' ? 'v-hold' : 'v-decline';
          valueText = (selQ ? escHtml(selQ.vendor) + ' → ' : '') + voteLabel;
        } else if (isFinalized) {
          valueCls  = 'v-closed';
          valueText = 'Closed';
        }

        const shortRole = (member.committeeRole || '').replace('Committee Member', 'Committee');
        const memberLabel = shortRole ? escHtml(member.name) + (isMe ? ' (You)' : '') + ' (' + escHtml(shortRole) + ')' : escHtml(member.name) + (isMe ? ' (You)' : '');
        cell.innerHTML = '<span class="vote-who"><span class="vote-name">' + escHtml(member.name) + (isMe ? ' (You)' : '') + '</span>' + (shortRole ? '<span class="vote-role">' + escHtml(shortRole) + '</span>' : '') + '</span><span class="vote-value ' + valueCls + '">' + valueText + '</span>';
        voteGrid.appendChild(cell);
      });
    } else {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#94a3b8;padding:12px;text-align:center;grid-column:1/-1';
      empty.textContent = 'No votes recorded yet';
      voteGrid.appendChild(empty);
    }
    const rosterTitle = document.createElement('div');
    rosterTitle.className = 'roster-title';
    rosterTitle.textContent = 'Votes so far';
    voteStatusFrag.appendChild(rosterTitle);
    voteStatusFrag.appendChild(voteGrid);
    // Insert the entire Voting Status block at the TOP of the voting section
    votingSection.insertBefore(voteStatusFrag, votingSection.firstChild);

    // Discussion
    const commTitle = document.createElement('div');
    commTitle.className = 'section-title';
    commTitle.innerHTML = 'Discussion';
    votingSection.appendChild(commTitle);

    const thread = document.createElement('div');
    thread.className = 'pc-thread';
    thread.id = 'pcThread_' + projectKey;
    votingSection.appendChild(thread);

    const loadProjectComments = async () => {
      const { data: pcs } = await supabase.from('project_comments')
        .select('*').eq('project_id', projectKey).order('created_at', { ascending: true });
      thread.innerHTML = '';
      if (!pcs || !pcs.length) {
        thread.innerHTML = '<div style="color:#94a3b8;text-align:center;padding:10px;font-size:13px">No comments yet</div>';
        return;
      }
      pcs.forEach((pc, idx) => {
        const isOwn = pc.user_email === user.email;
        const isEven = idx % 2 === 0;
        const msgDiv = document.createElement('div');
        msgDiv.className = 'pc-msg ' + (isEven ? 'pc-msg-committee' : 'pc-msg-admin');
        const displayName = pc.user_name || allProfiles[pc.user_email] || pc.user_email?.split('@')[0] || 'Unknown';
        const nameColor = isEven ? '#2563eb' : '#166534';
        const dt = new Date(pc.created_at).toLocaleString('en-AU', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
        msgDiv.innerHTML = `<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap"><div class="pc-msg-name" style="color:${nameColor};font-weight:900;font-size:18px">${escHtml(displayName)}</div><div class="pc-msg-time" style="margin-top:0">${dt}</div>${isOwn ? '<div style="display:flex;gap:5px;margin-left:auto"><button onclick="editPc(\'' + pc.id + '\', this)" style="background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;border-radius:6px;padding:2px 10px;font-size:11px;font-weight:600;cursor:pointer">Edit</button><button onclick="deletePc(\'' + pc.id + '\', this)" style="background:#fef2f2;color:#ef4444;border:1px solid #fecaca;border-radius:6px;padding:2px 10px;font-size:11px;font-weight:600;cursor:pointer">Delete</button></div>' : ''}</div><div class="pc-msg-body">${pc.comment.includes("<") ? pc.comment : pc.comment.replace(/\n/g, "<br>")}</div>`;
        const pcMain = document.createElement('div');
        pcMain.className = 'pc-main';
        while (msgDiv.firstChild) pcMain.appendChild(msgDiv.firstChild);
        const pcAv = document.createElement('div');
        pcAv.className = 'pc-av' + (isOwn ? ' pc-av-me' : '');
        pcAv.textContent = String(displayName || '?').trim().charAt(0).toUpperCase();
        msgDiv.appendChild(pcAv);
        msgDiv.appendChild(pcMain);
        thread.appendChild(msgDiv);
      });
      thread.scrollTop = thread.scrollHeight;
    }
    loadProjectComments();

    // Add Comment
    const inputTitle = document.createElement('div');
    inputTitle.className = 'section-title';
    inputTitle.innerHTML = 'Add Comment';
    votingSection.appendChild(inputTitle);

    if (role !== 'observer') {
      const inputArea = document.createElement('div');
      inputArea.className = 'input-area';
      const editorDiv = document.createElement('div');
      editorDiv.id = 'commentEditor_' + projectKey;
      const submitBtn = document.createElement('button');
      submitBtn.className = 'submit-btn';
      submitBtn.textContent = 'Send';
      submitBtn.onclick = async () => {
        const qEditor = inputArea._quill;
        const txt = qEditor ? qEditor.root.innerHTML : '';
        const plainTxt = qEditor ? qEditor.getText().trim() : '';
        if (!plainTxt) { showToast('Please enter a comment', true); return; }
        submitBtn.disabled = true;
        const { error } = await supabase.from('project_comments').insert({
          project_id: projectKey,
          user_email: user.email,
          user_name: allProfiles[user.email] || user.email?.split('@')[0] || '',
          comment: txt
        });
        if (error) { showToast('Failed to send', true); }
        else {
          if(qEditor) qEditor.root.innerHTML = '';
          await loadProjectComments();
          if (window.logActivity) window.logActivity('QUOTE_COMMENTED', projectKey);
        }
        submitBtn.disabled = false;
      };
      inputArea.appendChild(editorDiv);
      setTimeout(()=>{
        if(window.Quill){
          inputArea._quill = new Quill('#commentEditor_' + projectKey, {theme:'snow',modules:{toolbar:[['bold','italic',{color:[]}]]},placeholder:'Type your comment...'});
        }
      }, 100);
      const submitRow = document.createElement('div');
      submitRow.className = 'submit-row';
      submitRow.appendChild(submitBtn);
      inputArea.appendChild(submitRow);
      votingSection.appendChild(inputArea);
    }

    // Result box
    const resultBox = document.createElement('div');
    let resultClass = 'result-pending';
    let resultHTML  = 'RESULT: PENDING';

    if (resultApproved) {
      resultClass = 'result-approved';
      const displayVendor = winnerQuote ? escHtml(winnerQuote.vendor) : (selectedQuote ? escHtml(selectedQuote.vendor) : '—');
      resultHTML  = '' + displayVendor + ' selected by majority';
    } else if (resultDeclined) {
      resultClass = 'result-declined';
      resultHTML  = 'RESULT: Declined';
    } else if (resultHold) {
      if (isTieHold) {
        resultClass = 'result-tie';
        resultHTML  = 'RESULT: Tie — Please reconsider your selection';
      } else {
        resultClass = 'result-onhold';
        const holdReason = (approvals >= 4 && declines >= 4) ? ' (Conflict)' : '';
        resultHTML  = 'RESULT: On Hold' + holdReason;
      }
    }

    resultBox.className = 'result-box ' + resultClass;
    resultBox.innerHTML = resultHTML;

    // Build a row that will hold result + confirm button, placed at the TOP of voting section
    const resultRow = document.createElement('div');
    resultRow.className = 'result-row';

    resultRow.appendChild(resultBox);

    if (resultDetermined) {
      const lockNotice = document.createElement('div');
      lockNotice.style.cssText = 'font-size:15px;font-weight:800;color:#dc2626;display:flex;align-items:center;gap:6px';
      lockNotice.innerHTML = 'Voting Closed';
      resultRow.appendChild(lockNotice);
    }

    // Confirm button – only when result determined
    if (role === 'admin' && isVoting && resultDetermined) {
      // BUG 1 FIX: winnerQuoteId 없으면 votes에서 직접 재계산
      let confirmQuoteId = null;
      if (resultApproved) {
        if (winnerQuoteId) {
          confirmQuoteId = winnerQuoteId;
        } else if (isSingle) {
          confirmQuoteId = group[0]?.id || null;
        } else {
          const reMap = {};
          group.forEach(q => { reMap[q.id] = 0; });
          votedRows.forEach(v => { if (v.vote === 'approve' && v.selected_quote_id && reMap[v.selected_quote_id] !== undefined) reMap[v.selected_quote_id]++; });
          const maxC = Math.max(...Object.values(reMap), 0);
          confirmQuoteId = maxC > 0 ? Object.entries(reMap).find(([,c]) => c === maxC)?.[0] || null : null;
        }
      }
      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'confirm-btn';
      confirmBtn.innerHTML = 'Confirm &amp; Send Notification';
      confirmBtn.onclick = () => confirmSelection(confirmQuoteId, group, confirmBtn, calcResult);
      resultRow.appendChild(confirmBtn);

      // NEW: Test Email button — sends preview to admin's own inbox only.
      // Does NOT touch quotes/votes tables (no status change, no vote deletion).
      const testBtn = document.createElement('button');
      testBtn.className = 'confirm-btn';
      testBtn.style.cssText = 'background:#f59e0b;margin-left:8px;';
      testBtn.innerHTML = 'Send Test Email';
      testBtn.onclick = () => sendTestEmail(confirmQuoteId, group, calcResult, votedRows, approvals, declines, holds, testBtn);
      resultRow.appendChild(testBtn);
    }

    // Insert the result row at the TOP of the voting section (before Voting Status)
    votingSection.insertBefore(resultRow, votingSection.firstChild);

    // Layout (display only): left = vendors + discussion, right = vote panel
    {
      const qcBody = document.createElement('div'); qcBody.className = 'qc-body';
      const qcMain = document.createElement('div'); qcMain.className = 'qc-main';
      const s1 = card.querySelector(':scope > .step-title'); if (s1) qcMain.appendChild(s1);
      qcMain.appendChild(vendorList);
      const qcDisc = document.createElement('div'); qcDisc.className = 'qc-discuss';
      [commTitle, thread, inputTitle].forEach(n => qcDisc.appendChild(n));
      const ia = votingSection.querySelector(':scope > .input-area'); if (ia) qcDisc.appendChild(ia);
      qcMain.appendChild(qcDisc);
      votingSection.classList.add('qc-side');
      if (isDraft) {
        votingSection.classList.add('qc-draft');
        const dn = document.createElement('div'); dn.className = 'qc-draft-note';
        dn.innerHTML = '<b>Voting has not started</b><span>Voting opens after you click Send to Committee. Vote buttons and results will appear here.</span>';
        votingSection.insertBefore(dn, votingSection.firstChild);
      }
      qcBody.appendChild(qcMain); qcBody.appendChild(votingSection);
      card.appendChild(qcBody);
    }
    if (useProjectAccordion && isVoting) {
      const accordionBody = document.createElement('div');
      accordionBody.className = 'current-voting-project-content';
      accordionBody.id = 'current-voting-content-' + projectIndex;
      accordionBody.hidden = true;

      header.classList.add('current-voting-project-toggle');
      header.setAttribute('role', 'button');
      header.setAttribute('tabindex', '0');
      header.setAttribute('aria-expanded', 'false');
      header.setAttribute('aria-controls', accordionBody.id);

      const toggleProject = () => {
        const opened = accordionBody.hidden;

        if (opened) {
          // Only one project can be open across CURRENT VOTING and ON HOLD.
          document.querySelectorAll('#currentVotingList .current-voting-project-content').forEach(otherBody => {
            if (otherBody === accordionBody) return;
            otherBody.hidden = true;
            const otherHeader = otherBody.parentElement?.querySelector('.current-voting-project-toggle');
            if (otherHeader) otherHeader.setAttribute('aria-expanded', 'false');
          });

          document.querySelectorAll('#onHoldList .onhold-project-details').forEach(otherDetails => {
            otherDetails.hidden = true;
            const otherCard = otherDetails.closest('.onhold-project-card');
            const otherHeader = otherCard?.querySelector('.onhold-list-row');
            if (otherHeader) {
              otherHeader.setAttribute('aria-expanded', 'false');
              const otherChevron = otherHeader.querySelector('.onhold-row-chevron');
              if (otherChevron) otherChevron.textContent = '⌄';
            }
          });
        }

        accordionBody.hidden = !opened;
        header.setAttribute('aria-expanded', String(opened));
      };
      header.onclick = toggleProject;
      header.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleProject();
        }
      };

      card.removeChild(header);
      while (card.firstChild) accordionBody.appendChild(card.firstChild);
      card.appendChild(header);
      card.appendChild(accordionBody);
    }
    container.appendChild(card);
  });
}



function renderOnHoldQuotes(quotes) {
  const container = document.getElementById('onHoldList');
  if (!container) return;
  container.innerHTML = '';

  if (!quotes.length) {
    container.innerHTML = '<div style="padding:28px 20px;text-align:center;color:#94a3b8;font-size:14px">No quotes are currently on hold.</div>';
    return;
  }

  const projectMap = {};
  quotes.forEach(q => {
    const key = q.project_id || q.id;
    if (!projectMap[key]) projectMap[key] = [];
    projectMap[key].push(q);
  });

  const projects = Object.values(projectMap);
  const table = document.createElement('div');
  table.className = 'onhold-table';

  projects.forEach((group, index) => {
    const first = group[0];
    const projectKey = first.project_id || first.id;
    const projectName = first.project || first.project_title || 'Project';
    const parsedFirst = parseComment(first.comment);
    const category = first.category || parsedFirst.category || 'General';
    const priority = parsedFirst.priority || 'Normal';

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'project-header onhold-list-row';
    row.setAttribute('aria-expanded', 'false');
    const holdTimestamp = first.status_changed_at || first.created_at;
    const holdDate = holdTimestamp ? new Date(holdTimestamp).toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'numeric' }) : '—';
    row.innerHTML = '<span class="project-header-left onhold-header-left">' +
      '<span class="onhold-project-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3.75h9l5 5v11.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1.5Z"/><path d="M14 3.75v5h5M8 13h8M8 16.5h8"/></svg></span>' +
      '<span class="onhold-project-heading"><span class="onhold-project-name">' + escHtml(projectName) + '</span>' +
      '<span class="onhold-meta"><span>' + escHtml(category) + '</span><span class="onhold-meta-dot">·</span><span>' + group.length + ' contractor quotation' + (group.length === 1 ? '' : 's') + '</span></span></span></span>' +
      '<span class="onhold-row-right"><span class="onhold-project-fact"><span>PRIORITY</span><strong>' + escHtml(priority) + '</strong></span>' +
      '<span class="onhold-project-fact"><span>ON HOLD SINCE</span><strong>' + escHtml(holdDate) + '</strong></span>' +
      '<span class="onhold-status-pill">ON HOLD</span><span class="onhold-row-chevron">⌄</span></span>';

    const details = document.createElement('div');
    details.className = 'onhold-project-details';
    details.hidden = true;

    row.onclick = () => {
      const opened = details.hidden;

      // Only one project can be open across CURRENT VOTING and ON HOLD.
      if (opened) {
        document.querySelectorAll('#currentVotingList .current-voting-project-content').forEach(otherBody => {
          otherBody.hidden = true;
          const otherHeader = otherBody.parentElement?.querySelector('.current-voting-project-toggle');
          if (otherHeader) otherHeader.setAttribute('aria-expanded', 'false');
        });
      }

      container.querySelectorAll('.onhold-project-card').forEach(otherCard => {
        const otherDetails = otherCard.querySelector('.onhold-project-details');
        const otherRow = otherCard.querySelector('.onhold-list-row');
        if (!otherDetails || otherDetails === details) return;
        otherDetails.hidden = true;
        if (otherRow) {
          otherRow.setAttribute('aria-expanded', 'false');
          const otherChevron = otherRow.querySelector('.onhold-row-chevron');
          if (otherChevron) otherChevron.textContent = '⌄';
        }
      });

      details.hidden = !opened;
      row.setAttribute('aria-expanded', String(opened));
      const chevron = row.querySelector('.onhold-row-chevron');
      if (chevron) chevron.textContent = opened ? '⌃' : '⌄';
    };

    if (role === 'admin') {
      const actions = document.createElement('div');
      actions.className = 'onhold-project-actions';

      const addQuoteBtn = document.createElement('button');
      addQuoteBtn.type = 'button';
      addQuoteBtn.className = 'btn-mgmt btn-mgmt-green';
      addQuoteBtn.textContent = '+ Add Quote';
      addQuoteBtn.onclick = (e) => {
        e.stopPropagation();
        openAddQuoteToProject(projectKey, projectName, category, priority);
      };
      actions.appendChild(addQuoteBtn);

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn-mgmt btn-mgmt-blue';
      editBtn.textContent = 'Edit Project';
      actions.appendChild(editBtn);

      const expireBtn = document.createElement('button');
      expireBtn.type = 'button';
      expireBtn.className = 'btn-mgmt btn-mgmt-red';
      expireBtn.textContent = 'Mark as Expired';
      expireBtn.onclick = (e) => {
        e.stopPropagation();
        markExpired(group, expireBtn);
      };
      actions.appendChild(expireBtn);

      const sendBtn = document.createElement('button');
      sendBtn.type = 'button';
      sendBtn.className = 'send-btn';
      sendBtn.textContent = 'Send to Committee';
      sendBtn.onclick = (e) => {
        e.stopPropagation();
        sendToCommittee(group, sendBtn, projectKey);
      };
      actions.appendChild(sendBtn);

      const editForm = document.createElement('div');
      editForm.className = 'edit-project-form onhold-edit-form';
      editForm.id = 'ef-form-' + projectKey;
      editForm.style.display = 'none';
      editForm.innerHTML = '<div class="edit-form-row">' +
        '<div class="edit-form-field"><label class="edit-form-label">Project Title</label><input class="edit-form-input" id="ef-title-' + projectKey + '" value="' + escHtml(projectName) + '" placeholder="Project title"></div>' +
        '<div class="edit-form-field"><label class="edit-form-label">Category</label><select class="edit-form-select" id="ef-cat-' + projectKey + '">' +
        ['General','HVAC','Fire','Electrical','Security','Plumbing','Lift','Legal'].map(v => '<option value="' + v + '"' + (v === category ? ' selected' : '') + '>' + v + '</option>').join('') +
        '</select></div>' +
        '<div class="edit-form-field"><label class="edit-form-label">Priority</label><select class="edit-form-select" id="ef-pri-' + projectKey + '">' +
        ['Normal','High','Urgent'].map(v => '<option value="' + v + '"' + (v === priority ? ' selected' : '') + '>' + v + '</option>').join('') +
        '</select></div><div><button type="button" class="btn-mgmt btn-mgmt-blue" id="ef-save-' + projectKey + '">Save</button> ' +
        '<button type="button" class="btn-mgmt" onclick="document.getElementById(\'ef-form-' + projectKey + '\').style.display=\'none\'">Cancel</button></div></div>';
      const holdSaveBtn = editForm.querySelector('#ef-save-' + CSS.escape(String(projectKey)));
      if (holdSaveBtn) {
        holdSaveBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          window.saveProjectEdit(projectKey, group.map(q => q.id));
        });
      }
      editBtn.onclick = (e) => {
        e.stopPropagation();
        editForm.style.display = editForm.style.display === 'none' ? 'block' : 'none';
      };

      details.appendChild(actions);
      details.appendChild(editForm);
    }

    const vendorList = document.createElement('div');
    vendorList.className = 'vendor-list onhold-vendor-list';

    group.forEach(q => {
      const parsed = parseComment(q.comment);
      const item = document.createElement('div');
      item.className = 'vendor-item onhold-vendor-item';

      const header = document.createElement('div');
      header.className = 'vendor-header onhold-vendor-header';
      const vendorIcon = document.createElement('span');
      vendorIcon.className = 'onhold-vendor-icon';
      vendorIcon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6.2a5 5 0 0 0-6.3 6.3l-5.1 5.1a2.1 2.1 0 0 0 3 3l5.1-5.1a5 5 0 0 0 6.3-6.3l-3 3-3-3 3-3Z"/></svg>';
      const content = document.createElement('div');
      content.className = 'vendor-content onhold-vendor-content';
      content.innerHTML = '<div class="vendor-name">' + escHtml(q.vendor || 'Unknown Vendor') + '</div><div class="onhold-vendor-subtitle">CONTRACTOR QUOTATION</div>';
      const amount = document.createElement('div');
      amount.className = 'onhold-vendor-price';
      amount.innerHTML = '<strong>$' + Number(q.amount || 0).toLocaleString('en-AU') + '</strong><span>+ GST</span>';
      const viewBtn = document.createElement('button');
      viewBtn.type = 'button';
      viewBtn.className = 'btn-view-details onhold-toggle-details';
      viewBtn.setAttribute('aria-expanded', 'false');
      viewBtn.innerHTML = '<span class="onhold-toggle-label">View Details</span><span class="onhold-toggle-chevron">⌄</span>';
      header.appendChild(vendorIcon);
      header.appendChild(content);
      header.appendChild(amount);
      header.appendChild(viewBtn);

      const detail = document.createElement('div');
      detail.className = 'onhold-vendor-detail';
      detail.hidden = true;

      const addLine = (label, value, isHtml = false, lineClass = '') => {
        const line = document.createElement('div');
        line.className = 'onhold-detail-line' + (lineClass ? ' ' + lineClass : '');
        const labelEl = document.createElement('span');
        labelEl.className = 'onhold-detail-label';
        labelEl.textContent = label;
        const valueEl = document.createElement('div');
        valueEl.className = 'onhold-detail-value';
        if (isHtml) valueEl.innerHTML = value || '—';
        else valueEl.textContent = value || '—';
        line.appendChild(labelEl);
        line.appendChild(valueEl);
        detail.appendChild(line);
      };

      addLine('Scope / Notes', q.notes || '—', true, 'onhold-detail-scope');
      addLine('Internal Notes', parsed.note || '—', true, 'onhold-detail-internal');
      addLine('Category', q.category || parsed.category || 'General', false, 'onhold-detail-category');
      addLine('Priority', parsed.priority || 'Normal', false, 'onhold-detail-priority');

      const files = Array.isArray(parsed.files) ? parsed.files : [];
      const filesLine = document.createElement('div');
      filesLine.className = 'onhold-detail-line onhold-detail-attachments';
      const filesLabel = document.createElement('span');
      filesLabel.className = 'onhold-detail-label';
      filesLabel.textContent = 'Attachments (' + files.length + ')';
      filesLine.appendChild(filesLabel);

      if (files.length) {
        const filesWrap = document.createElement('div');
        filesWrap.className = 'detail-files attachment-grid';
        files.forEach(f => {
          const ext = (f.name || '').split('.').pop().toLowerCase();
          const badge = ext === 'pdf' ? 'PDF'
            : ['doc','docx'].includes(ext) ? 'WORD'
            : ['xls','xlsx'].includes(ext) ? 'XLS'
            : ['jpg','jpeg','png','gif','webp','svg'].includes(ext) ? 'IMG' : 'FILE';
          const size = f.size ? Math.round(Number(f.size)/1024).toLocaleString('en-AU') + ' KB' : '';
          const link = document.createElement('a');
          link.href = '#';
          link.className = 'detail-file-link attachment-card';
          link.innerHTML = '<span class="attachment-badge attachment-badge-' + badge.toLowerCase() + '">' + badge + '</span>' +
            '<span class="attachment-info"><span class="attachment-name">' + escHtml(f.name || 'Attachment') + '</span><span class="attachment-size">' + size + '</span></span>' +
            '<span class="attachment-open">OPEN ↗</span>';
          link.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            openFileViewer(f.path || f.url || '', f.name || 'Attachment', f.type || '');
          };
          filesWrap.appendChild(link);
        });
        filesLine.appendChild(filesWrap);
      } else {
        const noFiles = document.createElement('span');
        noFiles.className = 'onhold-detail-value';
        noFiles.textContent = 'No files attached';
        filesLine.appendChild(noFiles);
      }
      detail.appendChild(filesLine);

      if (role === 'admin') {
        const editQuoteRow = document.createElement('div');
        editQuoteRow.className = 'onhold-edit-quote-row';
        editQuoteRow.style.cssText = 'display:flex;justify-content:flex-end;padding-top:14px;margin-top:8px;border-top:1px solid rgba(128,166,204,.2)';
        const editQuoteBtn = document.createElement('button');
        editQuoteBtn.type = 'button';
        editQuoteBtn.className = 'btn-mgmt btn-mgmt-blue';
        editQuoteBtn.textContent = 'Edit Quote';
        editQuoteBtn.onclick = (e) => {
          e.stopPropagation();
          editQuote(q.id);
        };
        editQuoteRow.appendChild(editQuoteBtn);
        detail.appendChild(editQuoteRow);
      }

      const toggleDetail = (e) => {
        if (e) e.stopPropagation();
        const opened = detail.hidden;
        detail.hidden = !opened;
        viewBtn.classList.toggle('is-open', opened);
        viewBtn.setAttribute('aria-expanded', String(opened));
        const label = viewBtn.querySelector('.onhold-toggle-label');
        if (label) label.textContent = opened ? 'Hide Details' : 'View Details';
      };
      viewBtn.onclick = toggleDetail;
      header.onclick = toggleDetail;

      item.appendChild(header);
      item.appendChild(detail);
      vendorList.appendChild(item);
    });

    details.appendChild(vendorList);
    const projectCard = document.createElement('div');
    projectCard.className = 'project-card onhold-project-card';
    projectCard.setAttribute('data-cat', category);
    projectCard.appendChild(row);
    projectCard.appendChild(details);
    table.appendChild(projectCard);
  });

  container.appendChild(table);
}

async function placeProjectOnHold(group, triggerBtn) {
  if (!requireAdmin('place projects on hold')) return;
  if (!Array.isArray(group) || !group.length || !group.every(q => q.status === 'draft')) {
    showToast('Only Draft projects can be placed on hold', true);
    return;
  }
  const projectName = group[0].project || group[0].project_title || 'this project';
  if (!confirm('Place "' + projectName + '" on hold? Committee members will be able to view the quotes without an email being sent.')) return;
  if (triggerBtn) { triggerBtn.disabled = true; triggerBtn.textContent = 'Saving…'; }
  try {
    const ids = group.map(q => q.id).filter(Boolean);
    if (!ids.length) throw new Error('No quote IDs found');
    const { error } = await supabase.from('quotes').update({
      status: 'onhold',
      status_changed_at: new Date().toISOString()
    }).in('id', ids);
    if (error) throw error;
    showToast('Project placed on hold');
    await loadData();
    renderQuotes();
  } catch (e) {
    console.error('placeProjectOnHold error:', e);
    showToast('Failed to place project on hold', true);
    if (triggerBtn) { triggerBtn.disabled = false; triggerBtn.textContent = 'Place on Hold'; }
  }
}

async function permanentlyDeleteProject(group) {
  if (!requireAdmin('permanently delete projects')) throw new Error('Administrator access required.');
  if (!Array.isArray(group) || !group.length) throw new Error('No project quotes supplied');
  const projectId = group[0].project_id || group[0].id;
  const ids = group.map(q => q.id).filter(Boolean);
  if (!projectId || !ids.length) throw new Error('Invalid project identifiers');

  const storagePaths = [];
  group.forEach(q => {
    const parsed = parseComment(q.comment);
    (Array.isArray(parsed.files) ? parsed.files : []).forEach(file => {
      const rawPath = String(file.path || '').replace(/^\/+/, '');
      const cleanPath = rawPath.replace(/^quotes\//, '');
      if (cleanPath.startsWith(String(q.id) + '/')) storagePaths.push(cleanPath);
    });
  });
  const uniquePaths = [...new Set(storagePaths)];

  // Remove the project rows first and verify the DELETE policy actually allowed it.
  const { data: deletedQuotes, error: quoteError } = await supabase
    .from('quotes').delete().in('id', ids).select('id');
  if (quoteError) throw quoteError;
  const deletedIds = new Set((deletedQuotes || []).map(row => row.id));
  if (deletedIds.size !== ids.length) {
    throw new Error('Quote deletion was blocked or incomplete. No related records were intentionally removed.');
  }

  const cleanupWarnings = [];
  const { data: existingVotes, error: voteReadError } = await supabase
    .from('votes').select('id').eq('project_id', projectId);
  if (voteReadError) {
    cleanupWarnings.push('vote records');
  } else {
    const { data: deletedVotes, error: votesError } = await supabase
      .from('votes').delete().eq('project_id', projectId).select('id');
    if (votesError || (deletedVotes || []).length !== (existingVotes || []).length) {
      cleanupWarnings.push('vote records');
    }
  }

  const { data: existingComments, error: commentReadError } = await supabase
    .from('project_comments').select('id').eq('project_id', projectId);
  if (commentReadError) {
    cleanupWarnings.push('project comments');
  } else {
    const { data: deletedComments, error: commentsError } = await supabase
      .from('project_comments').delete().eq('project_id', projectId).select('id');
    if (commentsError || (deletedComments || []).length !== (existingComments || []).length) {
      cleanupWarnings.push('project comments');
    }
  }

  for (let i = 0; i < uniquePaths.length; i += 1000) {
    const batch = uniquePaths.slice(i, i + 1000);
    const { data: removedFiles, error: storageError } = await supabase.storage.from('quotes').remove(batch);
    if (storageError || (removedFiles || []).length !== batch.length) {
      cleanupWarnings.push('attached files');
      console.error('Quote attachment cleanup incomplete:', storageError || 'Removed file count did not match requested count');
      break;
    }
  }
  return { cleanupWarnings };
}

/*
  CORE UPSERT
  - Uses supabase upsert with onConflict: 'project_id,user_email'
  - No insert/update branching
  - Strict vote-once guard
  - Strict null checks
*/
async function doUpsert(projectId, fields, triggerBtn, btnOrigText, onSuccess) {
  // PATCH 5: strict null/undefined safety
  if (!projectId || typeof projectId !== 'string' || !projectId.trim()) { showToast('Invalid project', true); return; }
  if (!user?.email || typeof user.email !== 'string' || !user.email.trim()) { showToast('Authentication error', true); return; }

  const lockKey = projectId + '|' + user.email;
  if (actionLocks.get(lockKey)) return;
  actionLocks.set(lockKey, true);

  if (triggerBtn) { triggerBtn.disabled = true; triggerBtn.textContent = '…'; }

  try {
    // Hard vote lock – re-fetch from local state, block any overwrite
    if (fields.vote !== undefined && fields.vote !== null) {
      const current = getUserVoteRow(projectId);
      // Result-lock guard: recalculate from latest allVotes before allowing vote
      const guardGroup   = allQuotes.filter(q => (q.project_id || q.id) === projectId && (q.status === 'voting' || q.status === 'pending'));
      const guardVoted   = allVotes.filter(v => v.project_id === projectId && v.vote && v.vote !== '');
      const guardSingle  = guardGroup.length === 1;
      const gVMap        = {};
      guardGroup.forEach(q => { gVMap[q.id] = 0; });
      guardVoted.forEach(v => { if (v.vote === 'approve' && v.selected_quote_id && gVMap[v.selected_quote_id] !== undefined) gVMap[v.selected_quote_id]++; });
      const gVals        = Object.values(gVMap);
      const gMaxA        = guardSingle ? guardVoted.filter(v => v.vote === 'approve').length : (gVals.length > 0 ? Math.max(...gVals) : 0);
      const gCntMax      = gVals.filter(c => c === gMaxA && c > 0).length;
      const gHasTie      = !guardSingle && gCntMax > 1 && gMaxA > 0;
      const gDec         = guardVoted.filter(v => v.vote === 'decline').length;
      const gHold        = guardVoted.filter(v => v.vote === 'hold').length;
      const gResult      = calculateResult({ approvals: gMaxA, declines: gDec, holds: gHold, hasTie: gHasTie, totalVoted: guardVoted.length });
      if (gResult !== 'pending' && !(gResult === 'hold' && gHasTie)) {
        showToast('Voting is already closed – result determined', true);
        if (triggerBtn) { triggerBtn.disabled = true; triggerBtn.textContent = btnOrigText; }
        return;
      }

      // Voting requires vendor selection (skip for single-quote projects)
      const pGroupForCheck = allQuotes.filter(q => (q.project_id || q.id) === projectId && (q.status === 'voting' || q.status === 'pending'));
      if (pGroupForCheck.length !== 1 && fields.vote !== 'hold' && fields.vote !== 'decline' && !current?.selected_quote_id) {
        showToast('Please select a vendor first', true);
        if (triggerBtn) { triggerBtn.disabled = false; triggerBtn.textContent = btnOrigText; }
        return;
      }
    }

    // INSERT / UPDATE 분기 — 중복 row 원천 차단
    const existingRow = getUserVoteRow(projectId);
    const mergedFields = {};
    Object.entries(fields).forEach(([k, v]) => { if (v !== undefined) mergedFields[k] = v; });

    let error;
    if (existingRow?.id) {
      // 기존 row → UPDATE (id 기준, 절대 중복 없음)
      ({ error } = await supabase
        .from('votes')
        .update(mergedFields)
        .eq('id', existingRow.id));
    } else {
      // 새 row → INSERT
      const insertPayload = { project_id: projectId, user_email: user.email, ...mergedFields };
      ({ error } = await supabase
        .from('votes')
        .insert(insertPayload));
    }

    if (error) throw error;

    if (onSuccess) onSuccess();

    const key = Object.keys(fields)[0];
    const msgs = {
      selected_quote_id: fields.selected_quote_id ? 'Vendor selected' : 'Selection cleared',
      vote:    `Vote recorded: ${fields.vote}`,
      comment: 'Comment submitted'
    };
    showToast(msgs[key] || '✔ Saved');
    await loadData();
    renderQuotes();

    // Notify admin when voting result is first determined (non-blocking)
    if (fields.vote) {
      try {
        const pVotes   = getProjectVotes(projectId);
        const pVoted   = pVotes.filter(v => v.vote && v.vote !== '');
        const pGroup   = allQuotes.filter(q => (q.project_id || q.id) === projectId && (q.status === 'voting' || q.status === 'pending'));
        if (pGroup.length > 0) {
          const pFirst      = pGroup[0];
          const pIsSingle   = pGroup.length === 1;
          const vMap        = {};
          pGroup.forEach(q => { vMap[q.id] = 0; });
          pVoted.forEach(v => { if (v.vote === 'approve' && v.selected_quote_id && vMap[v.selected_quote_id] !== undefined) vMap[v.selected_quote_id]++; });
          const vMapVals    = Object.values(vMap);
          const maxA        = pIsSingle ? pVoted.filter(v => v.vote === 'approve').length : (vMapVals.length > 0 ? Math.max(...vMapVals) : 0);
          const cntAtMax    = vMapVals.filter(c => c === maxA && c > 0).length;
          const pHasTie     = !pIsSingle && cntAtMax > 1 && maxA > 0;
          const pDec        = pVoted.filter(v => v.vote === 'decline').length;
          const pHold       = pVoted.filter(v => v.vote === 'hold').length;
          const pCalcResult = calculateResult({ approvals: maxA, declines: pDec, holds: pHold, hasTie: pHasTie, totalVoted: pVoted.length });
          if (pCalcResult !== 'pending' && !resultEmailSent.has(projectId)) {
            resultEmailSent.add(projectId);
            const resultLabel = pCalcResult === 'approved' ? 'Approved' : pCalcResult === 'declined' ? 'Declined' : 'On Hold';
            // Push to Jacob (admin) only
            try {
              const { data: adminProfiles } = await supabase.from('profiles').select('id').eq('role', 'admin').single();
              if (adminProfiles?.id) {
                const { data: { session: pushSession } } = await supabase.auth.getSession();
                await fetch('/api/send-push', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${pushSession.access_token}` },
                  body: JSON.stringify({ user_id: adminProfiles.id, title: `🗳 Voting Complete — ${resultLabel}`, message: `${pFirst.project || pFirst.project_title || 'Project'} — Please confirm`, url: '/pages/quotes.html' })
                });
              }
            } catch(pushErr) {}
          }
        }
      } catch(notifyErr) { console.warn('Result notification error:', notifyErr); }
    }
  } catch(e) {
    console.error('doUpsert error:', JSON.stringify(e));
    showToast('Failed to save. Please try again.', true);
    if (triggerBtn) { triggerBtn.disabled = false; triggerBtn.textContent = btnOrigText; }
  } finally {
    actionLocks.set(lockKey, false);
    if (triggerBtn && triggerBtn.textContent === '…') {
      triggerBtn.disabled = false;
      triggerBtn.textContent = btnOrigText;
    }
  }
}

// Send Draft or On Hold project → Committee voting
async function sendToCommittee(group, btn, projectKey) {
  if (!requireAdmin('send projects to Committee')) return;
  if (!Array.isArray(group) || !group.length) return;
  const isDraftProject = group.every(q => q.status === 'draft');
  const isOnHoldProject = group.every(q => q.status === 'onhold');
  if (!isDraftProject && !isOnHoldProject) {
    showToast('This project is not in Draft or On Hold', true);
    return;
  }
  const projectName = group[0].project || group[0].project_title || 'this project';
  const prompt = isOnHoldProject
    ? 'Send all On Hold quotes for "' + projectName + '" to Committee and start a new voting round? Previous votes for this project will be cleared.'
    : 'Send these quotes to committee for voting?';
  if (!confirm(prompt)) return;

  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    const ids = group.map(q => q.id).filter(Boolean);
    if (!ids.length) throw new Error('No valid quote IDs');

    // A resumed On Hold project starts a fresh vote. Clear its earlier vote rows first.
    if (isOnHoldProject) {
      const { error: voteError } = await supabase.from('votes').delete().eq('project_id', projectKey);
      if (voteError) throw voteError;
    }

    const { error } = await supabase.from('quotes').update({
      status: 'voting',
      status_changed_at: new Date().toISOString()
    }).in('id', ids);
    if (error) throw error;

    showToast('Quotes sent to committee');
    try {
      const { data: { session: pushSession } } = await supabase.auth.getSession();
      await fetch('/api/send-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${pushSession.access_token}` },
        body: JSON.stringify({ target_roles: ['admin','committee','observer'], title: '🗳 Voting Started', message: `${projectName} — Please cast your vote`, url: '/pages/quotes.html' })
      });
      await fetch('https://wunsexdnqathluplkkvo.supabase.co/functions/v1/email-quote-voting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${pushSession.access_token}` },
        body: JSON.stringify({ project: projectName, quotes: group.filter(q => q.vendor).map(q => ({ vendor: q.vendor, amount: q.amount || 0 })) })
      });
    } catch(pushErr) {}
    await loadData();
    renderQuotes();
  } catch(e) {
    console.error('sendToCommittee error:', e);
    showToast('Failed to send', true);
    if (btn) { btn.disabled = false; btn.textContent = 'Send to Committee'; }
  }
}

// Force action – deterministic status transitions
window.forceAction = async function(status, quoteId, group, triggerBtn) {
  if (!requireAdmin('change project results')) return;
  if (!Array.isArray(group) || !group.length) { showToast('Invalid group', true); return; }
  if (status === 'declined') {
    const projectName = group[0].project || group[0].project_title || 'this project';
    const vendorCount = group.length;
    if (!confirm('Permanently delete "' + projectName + '" and all ' + vendorCount + ' quote(s), votes, project comments and attached files? This cannot be undone.')) return;
  }
  if (triggerBtn) triggerBtn.disabled = true;
  try {
    const allIds = group.map(q => q.id).filter(Boolean);
    const otherIds = quoteId ? allIds.filter(id => id !== quoteId) : allIds;

    if (status === 'approved') {
      if (!quoteId) { showToast('Select a vendor first', true); if (triggerBtn) triggerBtn.disabled = false; return; }
      if (otherIds.length) {
        const { error } = await supabase.from('quotes').update({ status: 'declined', status_changed_at: new Date().toISOString() }).in('id', otherIds);
        if (error) throw error;
      }
      const { error } = await supabase.from('quotes').update({
        status: 'approved',
        status_changed_at: new Date().toISOString(),
        work_status: 'scheduled',
        work_start_date: new Date().toISOString().split('T')[0]
      }).eq('id', quoteId);
      if (error) throw error;
    } else if (status === 'declined') {
      const deleteResult = await permanentlyDeleteProject(group);
      if (deleteResult.cleanupWarnings.length) {
        showToast('Project deleted, but cleanup needs attention: ' + deleteResult.cleanupWarnings.join(', '), true);
      }
    } else if (status === 'onhold') {
      const { error } = await supabase.from('quotes').update({
        status: 'onhold',
        status_changed_at: new Date().toISOString()
      }).in('id', allIds);
      if (error) throw error;
    }

    if (status !== 'declined') showToast(`Quote set to ${status}`);
    await loadData();
    renderQuotes();
  } catch(e) {
    console.error('forceAction error:', e);
    showToast(e.message || 'Failed to apply action', true);
    if (triggerBtn) triggerBtn.disabled = false;
  }
};

// Confirm – selected → approved, others → declined (always)
// NEW: Test Email — preview the confirmation email without touching quotes/votes tables.
// Sends only to the admin's own inbox (testRecipient), never to the full committee.
window.sendTestEmail = async function(quoteId, group, calcResult, votedRows, approvals, declines, holds, triggerBtn) {
  if (triggerBtn) { triggerBtn.disabled = true; triggerBtn.textContent = 'Sending test…'; }
  try {
    const voteDetails = votedRows.map(v => ({
      name: allProfiles[v.user_email] || v.user_email,
      email: v.user_email,
      vote: v.vote
    }));
    const { data: { session: testSession } } = await supabase.auth.getSession();
    await fetch('https://wunsexdnqathluplkkvo.supabase.co/functions/v1/email-quote-confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${testSession.access_token}` },
      body: JSON.stringify({
        project: group[0].project || group[0].project_title || 'Project',
        result: calcResult,
        quotes: group.map(q => ({ vendor: q.vendor, amount: q.amount || 0 })),
        voteCounts: { approvals, declines, holds },
        project_id: group[0]?.project_id || null,
        selectedVendor: calcResult === 'approved' ? (group.find(q => q.id === quoteId)?.vendor || '') : '',
        voteDetails,
        testRecipient: user.email
      })
    });
    showToast('🧪 Test email sent to ' + user.email);
  } catch(e) {
    console.error('sendTestEmail error:', e);
    showToast('Failed to send test email', true);
  } finally {
    if (triggerBtn) { triggerBtn.disabled = false; triggerBtn.innerHTML = 'Send Test Email'; }
  }
};

window.confirmSelection = async function(quoteId, group, triggerBtn, calcResult) {
  if (!requireAdmin('confirm voting results')) return;
  if (!Array.isArray(group) || !group.length) return;
  if (triggerBtn) { triggerBtn.disabled = true; triggerBtn.textContent = 'Confirming…'; }
  try {
    // Recalculate result at confirm time — final authority, overrides UI-passed value
    const projectId    = group[0]?.project_id || group[0]?.id;
    const pVotes       = allVotes.filter(v => v.project_id === projectId);
    const pVoted       = pVotes.filter(v => v.vote && v.vote !== '');
    const pIsSingle    = group.length === 1;
    const vMap         = {};
    group.forEach(q => { vMap[q.id] = 0; });
    pVoted.forEach(v => { if (v.vote === 'approve' && v.selected_quote_id && vMap[v.selected_quote_id] !== undefined) vMap[v.selected_quote_id]++; });
    const vVals        = Object.values(vMap);
    const maxApprovals = pIsSingle ? pVoted.filter(v => v.vote === 'approve').length : (vVals.length ? Math.max(...vVals) : 0);
    const pDeclines    = pVoted.filter(v => v.vote === 'decline').length;
    const pHolds       = pVoted.filter(v => v.vote === 'hold').length;
    const tieCnt       = vVals.filter(c => c === maxApprovals && c > 0).length;
    const pHasTie      = !pIsSingle && tieCnt > 1;
    calcResult = calculateResult({ approvals: maxApprovals, declines: pDeclines, holds: pHolds, hasTie: pHasTie, totalVoted: pVoted.length });

    const allIds   = group.map(q => q.id).filter(Boolean);
    const otherIds = quoteId ? allIds.filter(id => id !== quoteId) : allIds;
    let declineCleanupWarnings = [];

    if (calcResult === 'approved') {
      // BUG 1+5 FIX: quoteId 없으면 votes에서 자동 재계산
      if (!quoteId) {
        const reMap = {};
        group.forEach(q => { reMap[q.id] = 0; });
        pVoted.forEach(v => { if (v.vote === 'approve' && v.selected_quote_id && reMap[v.selected_quote_id] !== undefined) reMap[v.selected_quote_id]++; });
        const maxC = Math.max(...Object.values(reMap), 0);
        quoteId = maxC > 0 ? Object.entries(reMap).find(([,c]) => c === maxC)?.[0] || null : null;
      }
      if (!quoteId) { showToast('No vendor selected', true); if (triggerBtn) { triggerBtn.disabled = false; triggerBtn.textContent = 'Confirm & Send Notification'; } return; }
      // Winner → approved + work_status=scheduled (single source of truth: quotes table)
      const { error: eA } = await supabase.from('quotes').update({
        status: 'approved',
        status_changed_at: new Date().toISOString(),
        work_status: 'scheduled',
        work_start_date: new Date().toISOString().split('T')[0]
      }).eq('id', quoteId);
      if (eA) throw eA;
      if (otherIds.length) {
        const { error: eD } = await supabase.from('quotes').update({ status: 'declined', status_changed_at: new Date().toISOString() }).in('id', otherIds);
        if (eD) throw eD;
      }

    } else if (calcResult === 'hold') {
      // ALL quotes → onhold
      const { error: eH } = await supabase.from('quotes').update({ status: 'onhold', status_changed_at: new Date().toISOString() }).in('id', allIds);
      if (eH) throw eH;

    } else if (calcResult === 'declined') {
      const projectName = group[0].project || group[0].project_title || 'this project';
      if (!confirm('Committee voting resulted in Declined. Permanently delete "' + projectName + '" and all related quote data, votes, comments and attachments?')) {
        if (triggerBtn) { triggerBtn.disabled = false; triggerBtn.textContent = 'Confirm & Send Notification'; }
        return;
      }
      const deleteResult = await permanentlyDeleteProject(group);
      declineCleanupWarnings = deleteResult.cleanupWarnings || [];

    } else {
      console.error('Invalid result state in confirmSelection:', calcResult);
      showToast('Invalid result state – please reload and try again', true);
      if (triggerBtn) { triggerBtn.disabled = false; triggerBtn.textContent = 'Confirm & Send Notification'; }
      return;
    }

    // NEW: votes 삭제되기 전에 이름별 투표 내역 스냅샷 (email-quote-confirm 이메일용)
    const voteDetails = pVoted.map(v => ({
      name: allProfiles[v.user_email] || v.user_email,
      email: v.user_email,
      vote: v.vote
    }));

    // 투표 완료 후 votes 삭제 (프로젝트 완료 시 깨끗하게)
    const projectIdToClean = group[0]?.project_id || group[0]?.id;
    if (projectIdToClean) {
      await supabase.from('votes').delete().eq('project_id', projectIdToClean);
    }
    showToast(declineCleanupWarnings.length
      ? 'Project deleted, but cleanup needs attention: ' + declineCleanupWarnings.join(', ')
      : '✔ Selection confirmed and notification sent');
    try {
      const { data: { session: pushSession } } = await supabase.auth.getSession();
      await fetch('/api/send-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${pushSession.access_token}` },
        body: JSON.stringify({ target_roles: ['admin','committee','observer'], title: '✔ Quote Confirmed', message: `${group[0].project || group[0].project_title || 'Project'} — ${calcResult === 'approved' ? 'Approved' : calcResult === 'declined' ? 'Declined' : 'On Hold'}`, url: calcResult === 'approved' ? '/pages/works.html' : '/pages/quotes.html' })
      });
      await fetch('https://wunsexdnqathluplkkvo.supabase.co/functions/v1/email-quote-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${pushSession.access_token}` },
        body: JSON.stringify({ project: group[0].project || group[0].project_title || 'Project', result: calcResult, quotes: group.map(q => ({ vendor: q.vendor, amount: q.amount || 0 })), voteCounts: { approvals: maxApprovals, declines: pDeclines, holds: pHolds }, project_id: group[0]?.project_id || null, selectedVendor: calcResult === 'approved' ? (group.find(q => q.id === quoteId)?.vendor || '') : '', voteDetails })
      });
    } catch(pushErr) {}
    await loadData();
    renderQuotes();
  } catch(e) {
    console.error('confirmSelection error:', e);
    showToast('Failed to confirm', true);
    if (triggerBtn) { triggerBtn.disabled = false; triggerBtn.textContent = 'Confirm & Send Notification'; }
  }
};

// Edit individual quote (opens modal pre-filled)
window.editQuote = function(id) {
  if (!requireAdmin('edit quotations')) return;
  const q = allQuotes.find(x => x.id === id);
  if (!q) return;
  const parsed = parseComment(q.comment);

  // Populate project select
  const sel = document.getElementById('projectSelect');
  sel.innerHTML = '<option value="">+ New Project</option>';
  const opt = document.createElement('option');
  opt.value = q.project_id || q.id;
  opt.textContent = q.project || q.project_title || '';
  sel.appendChild(opt);
  sel.value = q.project_id || q.id;

  document.getElementById('quoteProject').style.display  = 'none';
  document.getElementById('quoteEditId').value           = q.id;
  document.getElementById('quoteVendor').value           = q.vendor  || '';
  document.getElementById('quoteAmount').value           = q.amount  || '';
  document.getElementById('quoteCategory').value         = q.category || parsed.category || 'General';
  document.getElementById('quotePriority').value         = parsed.priority || 'Normal';
  document.getElementById('quoteNotes').value            = q.notes   || '';
  document.getElementById('quoteInternalNote').value     = parsed.note || '';
  document.getElementById('quoteCategory').disabled      = false;
  document.getElementById('quotePriority').disabled      = false;
  document.getElementById('quoteModalTitle').textContent = 'Edit Quote';
  document.getElementById('deleteQuoteBtn').style.display = 'inline-flex';
  pendingFiles = [];
  document.getElementById('fileList').innerHTML = '';

  // Render existing files with remove buttons
  window._editingExistingFiles = Array.isArray(parsed.files) ? [...parsed.files] : [];
  renderExistingFilesList();

  document.getElementById('quoteModal').classList.add('open');
  setTimeout(()=>{ if(window._initQuill) window._initQuill(q.notes||'', parsed.note||''); },50);
};

window.renderExistingFilesList = function() {
  const wrap = document.getElementById('existingFilesList');
  if (!wrap) return;
  const files = window._editingExistingFiles || [];
  if (!files.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = '<div style="font-size:12px;color:#6b7280;margin-bottom:6px;font-weight:500">Current files:</div>' +
    files.map((f, i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f8fafc;border:0.5px solid #e2e8f0;border-radius:8px;margin-bottom:6px">
        <span style="font-size:14px"></span>
        <span style="flex:1;font-size:13px;color:#1f2937;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(f.name||'(unnamed)')}</span>
        <button type="button" onclick="removeExistingFile(${i})" style="background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;border-radius:6px;padding:3px 9px;font-size:12px;font-weight:600;cursor:pointer">✕ Remove</button>
      </div>`).join('');
};

window.removeExistingFile = function(idx) {
  if (!Array.isArray(window._editingExistingFiles)) return;
  const f = window._editingExistingFiles[idx];
  if (!f) return;
  if (!confirm(`Remove file "${f.name||'(unnamed)'}" from this quote?\n\nThis will be applied when you click Save Quote.`)) return;
  window._editingExistingFiles.splice(idx, 1);
  renderExistingFilesList();
};

// Mark all quotes in project as expired (non-destructive)
window.markExpired = async function(group, btn) {
  if (!requireAdmin('mark projects as expired')) return;
  if (!Array.isArray(group) || !group.length) return;
  if (!confirm('Mark this project as Expired? This will not delete any data.')) return;
  if (btn) btn.disabled = true;
  try {
    const ids = group.map(q => q.id).filter(Boolean);
    const { error } = await supabase.from('quotes').update({ status: 'expired', status_changed_at: new Date().toISOString() }).in('id', ids);
    if (error) throw error;
    showToast('Project marked as expired');
    await loadData();
    renderQuotes();
  } catch(e) {
    console.error('markExpired error:', e);
    showToast('Failed to mark expired', true);
    if (btn) btn.disabled = false;
  }
};

// Save project edits: title, category, priority
window.saveProjectEdit = async function(projectKey, quoteIds) {
  if (!requireAdmin('edit projects')) return;
  const titleEl = document.getElementById('ef-title-' + projectKey);
  const catEl   = document.getElementById('ef-cat-'   + projectKey);
  const priEl   = document.getElementById('ef-pri-'   + projectKey);
  if (!titleEl || !catEl || !priEl) {
    showToast('Project edit fields could not be found.', true);
    return;
  }

  const newTitle = titleEl.value.trim();
  const newCat   = catEl.value;
  const newPri   = priEl.value;
  const ids = Array.isArray(quoteIds) ? quoteIds : [quoteIds];

  if (!newTitle) {
    showToast('Project title cannot be empty', true);
    return;
  }
  if (!ids.length || ids.some(id => !id)) {
    showToast('No quote records were selected for this project.', true);
    return;
  }

  try {
    // Preserve the existing JSONB-string storage format used by the quotes table.
    // Update sequentially and verify each saved row before reporting success.
    for (const qid of ids) {
      const q = allQuotes.find(x => String(x.id) === String(qid));
      if (!q) throw new Error('Quote record not found: ' + qid);

      const parsed = parseComment(q.comment);
      parsed.category = newCat;
      parsed.priority = newPri;
      const commentValue = JSON.stringify(parsed);

      const { data, error } = await supabase
        .from('quotes')
        .update({
          project: newTitle,
          project_title: newTitle,
          category: newCat,
          comment: commentValue
        })
        .eq('id', qid)
        .select('id, project, category, comment');

      if (error) throw error;
      if (!Array.isArray(data) || data.length !== 1) {
        throw new Error('Database did not confirm the update for quote ' + qid);
      }

      const savedComment = parseComment(data[0].comment);
      if (
        data[0].project !== newTitle ||
        data[0].category !== newCat ||
        savedComment.priority !== newPri
      ) {
        throw new Error('Saved values did not match the selected Project, Category and Priority.');
      }
    }

    await loadData();

    const notUpdated = ids.filter(qid => {
      const q = allQuotes.find(x => String(x.id) === String(qid));
      return !q ||
        q.project !== newTitle ||
        q.category !== newCat ||
        parseComment(q.comment).priority !== newPri;
    });
    if (notUpdated.length) {
      throw new Error('Reload verification failed for ' + notUpdated.length + ' quote record(s).');
    }

    showToast('Project and Priority saved successfully');
    renderQuotes();
  } catch(e) {
    console.error('saveProjectEdit error:', e);
    showToast('Save failed: ' + (e?.message || 'Unknown database error'), true);
  }
};

// Open quote create modal pre-filled for existing project
window.openAddQuoteToProject = function(projectId, projectName, category, priority) {
  if (!requireAdmin('add quotations')) return;
  const sel = document.getElementById('projectSelect');
  sel.innerHTML = '<option value="">+ New Project</option>';
  // Add existing project as option and select it
  const opt = document.createElement('option');
  opt.value       = projectId;
  opt.textContent = projectName;
  sel.appendChild(opt);
  sel.value = projectId;

  // Pre-fill and lock category / priority
  document.getElementById('quoteProject').style.display  = 'none';
  document.getElementById('quoteProject').value          = '';
  document.getElementById('quoteCategory').value         = category;
  document.getElementById('quotePriority').value         = priority;
  document.getElementById('quoteCategory').disabled      = true;
  document.getElementById('quotePriority').disabled      = true;

  pendingFiles = [];
  document.getElementById('fileList').innerHTML       = '';
  document.getElementById('quoteEditId').value        = '';
  document.getElementById('quoteModalTitle').textContent = 'Add Quote to ' + projectName;
  document.getElementById('deleteQuoteBtn').style.display = 'none';
  document.getElementById('quoteVendor').value  = '';
  document.getElementById('quoteAmount').value  = '';
  document.getElementById('quoteNotes').value   = '';
  document.getElementById('quoteInternalNote').value = '';
  document.getElementById('quoteModal').classList.add('open');
  setTimeout(()=>{ if(window._initQuill) window._initQuill('',''); },50);
};

// File upload
window.handleFileSelect = function(event) {
  Array.from(event.target.files).forEach(f => {
    if (!pendingFiles.find(p => p.name === f.name)) pendingFiles.push(f);
  });
  renderFileList();
  event.target.value = '';
};
function renderFileList() {
  const list = document.getElementById('fileList');
  list.innerHTML = '';
  pendingFiles.forEach((f, i) => {
    const chip = document.createElement('div');
    chip.className = 'file-chip';
    chip.innerHTML = `${escHtml(f.name)} <button onclick="removeFile(${i})">✕</button>`;
    list.appendChild(chip);
  });
}
window.removeFile = function(idx) { pendingFiles.splice(idx, 1); renderFileList(); };
async function uploadFiles(quoteId) {
  const uploaded = [];
  for (const file of pendingFiles) {
    const ext  = file.name.split('.').pop();
    const safeName = file.name.replace(/[^\w.\-]/g, '_');
    const path = `${quoteId}/${crypto.randomUUID()}-${safeName}`;
    const { error } = await supabase.storage.from('quotes').upload(path, file);
    if (error) { console.error('upload error:', error); continue; }
    uploaded.push({ name: file.name, path, type: file.type || '', size: file.size || 0 });
  }
  return uploaded;
}

// Modal
window.openCreateProject = function() {
  if (!requireAdmin('create projects')) return;
  const sel = document.getElementById('projectSelect');
  sel.innerHTML = '<option value="">+ New Project</option>';
  const seen = new Set();
  allQuotes.filter(q => ['draft','voting','pending'].includes(q.status)).forEach(q => {
    const name = q.project || q.project_title;
    if (name && !seen.has(name)) {
      seen.add(name);
      const opt = document.createElement('option');
      opt.value = q.project_id || q.id;
      opt.textContent = name;
      sel.appendChild(opt);
    }
  });
  pendingFiles = [];
  document.getElementById('fileList').innerHTML = '';
  document.getElementById('quoteEditId').value = '';
  document.getElementById('quoteModalTitle').textContent = 'Add New Quote';
  document.getElementById('deleteQuoteBtn').style.display = 'none';
  document.getElementById('quoteProject').style.display = 'block';
  document.getElementById('quoteProject').value  = '';
  document.getElementById('quoteVendor').value   = '';
  document.getElementById('quoteAmount').value   = '';
  document.getElementById('quoteCategory').value = 'General';
  document.getElementById('quotePriority').value = 'Normal';
  document.getElementById('quoteCategory').disabled = false;
  document.getElementById('quotePriority').disabled = false;
  document.getElementById('quoteNotes').value    = '';
  document.getElementById('quoteInternalNote').value = '';
  document.getElementById('quoteModal').classList.add('open');
  setTimeout(()=>{ if(window._initQuill) window._initQuill('',''); },50);
};

window.handleProjectSelect = function() {
  const sel   = document.getElementById('projectSelect');
  const isNew = sel.value === '';
  document.getElementById('quoteProject').style.display = isNew ? 'block' : 'none';
  if (!isNew) {
    const existing = allQuotes.find(q => (q.project_id || q.id) === sel.value);
    if (existing) {
      const parsed = parseComment(existing.comment);
      document.getElementById('quoteCategory').value    = existing.category || parsed.category || 'General';
      document.getElementById('quotePriority').value    = parsed.priority || 'Normal';
      document.getElementById('quoteCategory').disabled = true;
      document.getElementById('quotePriority').disabled = true;
    }
  } else {
    document.getElementById('quoteCategory').disabled = false;
    document.getElementById('quotePriority').disabled = false;
  }
};

window.closeModal = function(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
  if (id === 'quoteModal') {
    window._editingExistingFiles = [];
    const wrap = document.getElementById('existingFilesList');
    if (wrap) wrap.innerHTML = '';
  }
};

window.formatAmount = function(input) { input.value = input.value.replace(/[^0-9.]/g, ''); };

window.saveQuote = async function() {
  if (!requireAdmin('save quotations')) return;
  const sel         = document.getElementById('projectSelect');
  const isNew       = sel.value === '';
  const projectName = isNew ? document.getElementById('quoteProject').value.trim() : (sel.options[sel.selectedIndex]?.text || '');
  const vendor      = document.getElementById('quoteVendor').value.trim();
  const amount      = parseFloat(document.getElementById('quoteAmount').value.replace(/[^0-9.]/g,'')) || 0;
  const category    = document.getElementById('quoteCategory').value;
  const priority    = document.getElementById('quotePriority').value;
  const notes       = document.getElementById('quoteNotes').value.trim();
  const internalNote = document.getElementById('quoteInternalNote').value.trim();

  if (!vendor || amount <= 0) { showToast('Please fill all required fields', true); return; }

  const btn = document.getElementById('saveQuoteBtn');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    // ── 기존 견적 수정 (editId 있을 때) ──
    const editId = document.getElementById('quoteEditId').value;
    if (editId) {
      const existingQ   = allQuotes.find(x => x.id === editId);
      if (!existingQ) { showToast('Quote not found', true); btn.disabled=false; btn.textContent='Save Quote'; return; }
      const existingParsed = parseComment(existingQ.comment);
      const uploadedNew    = pendingFiles.length > 0 ? await uploadFiles(editId) : [];
      // Use edited files list (with removals) instead of existingParsed.files
      const keptExistingFiles = Array.isArray(window._editingExistingFiles) ? window._editingExistingFiles : (existingParsed.files||[]);
      const mergedFiles    = [...keptExistingFiles, ...uploadedNew];
      const updatedComment = JSON.stringify({ ...existingParsed, note: internalNote, files: mergedFiles, category, priority });
      const { error: uErr } = await supabase.from('quotes').update({
        vendor, amount, category, notes, comment: updatedComment
      }).eq('id', editId);
      if (uErr) throw uErr;
      pendingFiles = [];
      showToast('Quote updated ✓');
      closeModal('quoteModal');
      await loadData();
      renderQuotes();
      return;
    }

    if (!projectName) { showToast('Please fill all required fields', true); btn.disabled=false; btn.textContent='Save Quote'; return; }
    const quoteId   = crypto.randomUUID();
    const projectId = isNew ? crypto.randomUUID() : sel.value;
    const uploadedFiles = pendingFiles.length > 0 ? await uploadFiles(quoteId) : [];
    const commentPayload = JSON.stringify({ note: internalNote, files: uploadedFiles, category, priority });

    // Determine status — block adding to approved project
    let newStatus = 'draft';
    if (!isNew) {
      const existing = allQuotes.filter(q => (q.project_id || q.id) === projectId && q.status !== 'removed');
      if (existing.some(q => q.status === 'approved')) {
        showToast('Cannot add quote to an approved project', true);
        btn.disabled = false; btn.textContent = 'Save Quote';
        return;
      }
      if (existing.some(q => q.status === 'voting' || q.status === 'pending')) newStatus = 'voting';
      else if (existing.some(q => q.status === 'onhold')) newStatus = 'onhold';
      else if (existing.some(q => q.status === 'declined' || q.status === 'expired')) newStatus = 'voting';
    }

    const { error } = await supabase.from('quotes').insert({
      id: quoteId, project_id: projectId,
      project: projectName, project_title: projectName,
      vendor, amount, category, notes,
      comment: commentPayload,
      status: newStatus,
      is_emergency: false,
      archived: false,
      created_at: new Date().toISOString()
    });
    if (error) throw error;

    // On Hold projects stay On Hold when another tender quote is added.
    // Only legacy Declined / Expired projects retain their previous reopen behaviour.
    if (!isNew) {
      const expiredOrDeclinedIds = allQuotes
        .filter(q => (q.project_id || q.id) === projectId && ['declined','expired'].includes(q.status))
        .map(q => q.id).filter(Boolean);
      if (expiredOrDeclinedIds.length) {
        const { error: voteError } = await supabase.from('votes').delete().eq('project_id', projectId);
        if (voteError) throw voteError;
        const { error: reopenError } = await supabase.from('quotes').update({
          status: 'voting',
          status_changed_at: new Date().toISOString(),
          work_status: null,
          completion_date: null
        }).in('id', expiredOrDeclinedIds);
        if (reopenError) throw reopenError;
      }
    }
    pendingFiles = [];
    showToast('Quote created');
    closeModal('quoteModal');
    await loadData();
    renderQuotes();
  } catch(e) {
    console.error('saveQuote error:', e);
    showToast('Failed to save quote', true);
  } finally {
    btn.disabled = false; btn.textContent = 'Save Quote';
  }
};

window.deleteQuote = async function() {
  if (!requireAdmin('remove quotations')) return;
  const editId = document.getElementById('quoteEditId').value;
  if (!editId || !confirm('Remove this quote from Management?')) return;
  try {
    const q = allQuotes.find(x => x.id === editId);
    if (!q) return;
    if (q.work_status) {
      alert('This item is already in Works and cannot be deleted.');
      return;
    }
    const projId = q.project_id || editId;
    await supabase.from('votes').delete().eq('project_id', projId);
    const { error } = await supabase.from('quotes').update({ status: 'removed', status_changed_at: new Date().toISOString() }).eq('id', editId);
    if (error) throw error;
    showToast('Quote removed');
    closeModal('quoteModal');
    await loadData();
    renderQuotes();
  } catch(e) { showToast('Failed to remove', true); }
};

function requireAdmin(action = 'perform this action') {
  if (role === 'admin') return true;
  showToast('Administrator access is required to ' + action + '.', true);
  return false;
}

function showToast(message, isError = false) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.style.background = isError ? '#991b1b' : '#0f172a';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

let _viewerCurrentUrl = '';
window.openFileViewer = async function(path, name, type) {
  if (!path) return;
  try {
    let url;
    if (path.startsWith('http')) {
      url = path;
    } else {
      const cleanPath = path.replace(/^quotes\//, '');
      const { data } = await supabase.storage.from('quotes').createSignedUrl(cleanPath, 3600);
      url = data?.signedUrl;
    }
    if (!url) throw new Error('No URL');
    _viewerCurrentUrl = url;
    let html = '';
    document.getElementById('viewerFileName').textContent = name || '';
    if ((type && type.includes('pdf')) || (name && name.toLowerCase().endsWith('.pdf'))) {
      html = `<iframe src="${url}" style="width:100%;flex:1;border:none;min-height:0"></iframe>`;
    } else if (['png','jpg','jpeg','gif','webp','svg'].some(e => name?.toLowerCase().endsWith('.'+e))) {
      html = `<div style="flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;min-height:0"><img src="${url}" style="max-width:100%;max-height:100%;object-fit:contain;display:block" alt="${name}"></div>`;
    } else {
      html = `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px"><div style="font-size:52px"></div><a href="${url}" download="${name}" style="padding:12px 28px;background:#3b82f6;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">⬇ Download ${name}</a></div>`;
    }
    document.getElementById('viewerContent').innerHTML = html;
    document.getElementById('fileViewerModal').style.display = 'flex';
    document.getElementById('fileViewerModal').focus();
  } catch(e) {
    console.error('openFileViewer failed:', e);
    alert('Failed to load file');
  }
};

window.closeViewer = function() {
  document.getElementById('fileViewerModal').style.display = 'none';
  document.getElementById('viewerContent').innerHTML = '';
};
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && document.getElementById('fileViewerModal').style.display === 'flex') closeViewer();
});

window.printViewer = function() {
  if (!_viewerCurrentUrl) return;
  const w = window.open(_viewerCurrentUrl, '_blank');
  if (w) w.onload = () => { w.focus(); w.print(); };
};

init();
