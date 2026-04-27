const { createClient } = require('@supabase/supabase-js');

// 에러 로깅 헬퍼 — audit_logs에 자동 기록
async function logError(supabase, errorMsg, details = {}) {
  try {
    await supabase.from('audit_logs').insert({
      action: 'api_error',
      user_email: 'system',
      details: {
        function: 'admin-edit-profile',
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

  const { user_id, new_name, new_unit, new_email, role } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'Missing user_id' });
  }

  // 입력 정규화
  const cleanName = (new_name || '').trim() || null;
  const cleanUnit = (new_unit || '').trim() || null;
  const cleanEmail = (new_email || '').toLowerCase().trim() || null;

  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  // 🔒 Admin 권한 검증
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  try {
    const token = authHeader.substring(7);
    const supabaseUser = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
    const { data: { user: currentUser } } = await supabaseUser.auth.getUser();
    if (!currentUser) {
      return res.status(401).json({ error: 'Invalid authentication' });
    }

    // 🔒 자기 자신 이메일 변경 방지
    if (currentUser.id === user_id && cleanEmail) {
      return res.status(400).json({ error: 'Cannot change your own email. Please contact another administrator or use Supabase directly.' });
    }

    // Admin role 확인
    const { data: currentProfile } = await supabaseUser
      .from('profiles')
      .select('role')
      .eq('id', currentUser.id)
      .maybeSingle();

    if (!currentProfile || currentProfile.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
  } catch (authErr) {
    console.warn('[admin-edit-profile] Auth check failed:', authErr);
    return res.status(401).json({ error: 'Invalid authentication' });
  }

  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    // 1. 변경 대상 사용자의 현재 정보 조회
    const { data: targetProfile, error: targetErr } = await supabaseAdmin
      .from('profiles')
      .select('email, full_name, unit, role')
      .eq('id', user_id)
      .maybeSingle();

    if (targetErr) throw targetErr;
    if (!targetProfile) {
      return res.status(404).json({ error: 'User not found' });
    }

    const oldEmail = targetProfile.email?.toLowerCase() || null;
    const oldName = targetProfile.full_name || null;
    const oldUnit = targetProfile.unit || null;
    const userRole = role || targetProfile.role;

    // 변경 여부 체크
    const nameChanged = cleanName !== null && cleanName !== oldName;
    const unitChanged = cleanUnit !== oldUnit;
    const emailChanged = cleanEmail !== null && cleanEmail !== oldEmail;

    // 2. 새 이메일 중복 검증
    if (emailChanged) {
      const { data: existingProfile } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('email', cleanEmail)
        .maybeSingle();

      if (existingProfile && existingProfile.id !== user_id) {
        return res.status(409).json({ error: 'This email is already used by another user' });
      }
    }

    // 3. Unit 변경 시 새 unit이 occupants에 있는지 사전 검증
    let newOccRow = null;
    if (unitChanged && cleanUnit && ['owner', 'committee', 'tenant'].includes(userRole)) {
      const { data: occRow } = await supabaseAdmin
        .from('occupants')
        .select('id, primary_email, business_email, unit')
        .eq('unit', cleanUnit)
        .maybeSingle();

      if (!occRow) {
        return res.status(409).json({
          error: `Unit ${cleanUnit} not found in occupants. Please create the unit in the Occupants page first.`
        });
      }
      newOccRow = occRow;
    }

    // ───────────────────────────────────────
    // 변경 시작
    // ───────────────────────────────────────

    // 4. Auth 이메일 변경
    if (emailChanged) {
      const { error: authUpdateErr } = await supabaseAdmin.auth.admin.updateUserById(
        user_id,
        { email: cleanEmail, email_confirm: true }
      );
      if (authUpdateErr) {
        return res.status(500).json({ error: 'Failed to update auth email: ' + authUpdateErr.message });
      }
    }

    // 5. profiles 업데이트
    const profileUpdate = {};
    if (nameChanged) profileUpdate.full_name = cleanName;
    if (unitChanged) profileUpdate.unit = cleanUnit;
    if (emailChanged) profileUpdate.email = cleanEmail;

    if (Object.keys(profileUpdate).length > 0) {
      const { error: profileUpdateErr } = await supabaseAdmin
        .from('profiles')
        .update(profileUpdate)
        .eq('id', user_id);

      if (profileUpdateErr) {
        if (emailChanged) {
          try {
            await supabaseAdmin.auth.admin.updateUserById(user_id, { email: oldEmail, email_confirm: true });
          } catch (rollbackErr) {
            console.error('[admin-edit-profile] Auth rollback failed:', rollbackErr);
          }
        }
        return res.status(500).json({ error: 'Failed to update profile: ' + profileUpdateErr.message });
      }
    }

    // ───────────────────────────────────────
    // 6. occupants 동기화
    // ───────────────────────────────────────
    let occupantsChanges = { name_synced: 0, email_replaced: 0, unit_removed: 0, unit_added: 0 };

    // 6-A. 이메일 변경 → 모든 occupants 행에서 옛 이메일 → 새 이메일 교체
    //      이름 변경 → primary_email로 등록된 행의 contact_person 동기화
    if (emailChanged || nameChanged) {
      const { data: occs } = await supabaseAdmin
        .from('occupants')
        .select('id, unit, primary_email, business_email, contact_person');

      for (const o of (occs || [])) {
        let needsUpdate = false;
        let newPrimary = o.primary_email;
        let newBusiness = o.business_email;
        let newContactPerson = o.contact_person;

        if (emailChanged && o.primary_email) {
          const list = o.primary_email.split(/[,;]/).map(e => e.trim()).filter(Boolean);
          const replaced = list.map(e => e.toLowerCase() === oldEmail ? cleanEmail : e);
          const dedupLower = new Set();
          const final = replaced.filter(e => {
            const lower = e.toLowerCase();
            if (dedupLower.has(lower)) return false;
            dedupLower.add(lower);
            return true;
          });
          if (final.join(', ') !== list.join(', ')) {
            newPrimary = final.length > 0 ? final.join(', ') : null;
            needsUpdate = true;
            occupantsChanges.email_replaced++;
          }
        }

        if (emailChanged && o.business_email) {
          const list = o.business_email.split(/[,;]/).map(e => e.trim()).filter(Boolean);
          const replaced = list.map(e => e.toLowerCase() === oldEmail ? cleanEmail : e);
          const dedupLower = new Set();
          const final = replaced.filter(e => {
            const lower = e.toLowerCase();
            if (dedupLower.has(lower)) return false;
            dedupLower.add(lower);
            return true;
          });
          if (final.join(', ') !== list.join(', ')) {
            newBusiness = final.length > 0 ? final.join(', ') : null;
            needsUpdate = true;
            occupantsChanges.email_replaced++;
          }
        }

        // 이름 동기화 — primary_email로 등록된 행만 contact_person 변경
        if (nameChanged) {
          const checkPrimary = (newPrimary || '').split(/[,;]/).map(e => e.trim().toLowerCase()).filter(Boolean);
          const targetEmailForCheck = emailChanged ? cleanEmail : oldEmail;
          if (targetEmailForCheck && checkPrimary.includes(targetEmailForCheck)) {
            if (newContactPerson !== cleanName) {
              newContactPerson = cleanName;
              needsUpdate = true;
              occupantsChanges.name_synced++;
            }
          }
        }

        if (needsUpdate) {
          const updateObj = {};
          if (newPrimary !== o.primary_email) updateObj.primary_email = newPrimary;
          if (newBusiness !== o.business_email) updateObj.business_email = newBusiness;
          if (newContactPerson !== o.contact_person) updateObj.contact_person = newContactPerson;

          const { error: updErr } = await supabaseAdmin
            .from('occupants')
            .update(updateObj)
            .eq('id', o.id);
          if (updErr) {
            console.warn(`[admin-edit-profile] occupants update failed for ${o.id}:`, updErr);
          }
        }
      }
    }

    // 6-B. Unit 변경 — 옛 unit에서 이메일 제거 + 새 unit에 이메일 추가
    if (unitChanged && ['owner', 'committee', 'tenant'].includes(userRole)) {
      const targetEmail = emailChanged ? cleanEmail : oldEmail;
      if (targetEmail) {
        // 6-B-1. 옛 unit에서 이메일 제거
        if (oldUnit) {
          const { data: oldOccRow } = await supabaseAdmin
            .from('occupants')
            .select('id, primary_email, business_email')
            .eq('unit', oldUnit)
            .maybeSingle();

          if (oldOccRow) {
            let needsUpdate = false;
            let newPrimary = oldOccRow.primary_email;
            let newBusiness = oldOccRow.business_email;

            if (oldOccRow.primary_email) {
              const list = oldOccRow.primary_email.split(/[,;]/).map(e => e.trim()).filter(Boolean);
              const filtered = list.filter(e => e.toLowerCase() !== targetEmail.toLowerCase());
              if (filtered.length !== list.length) {
                newPrimary = filtered.length > 0 ? filtered.join(', ') : null;
                needsUpdate = true;
              }
            }

            if (oldOccRow.business_email) {
              const list = oldOccRow.business_email.split(/[,;]/).map(e => e.trim()).filter(Boolean);
              const filtered = list.filter(e => e.toLowerCase() !== targetEmail.toLowerCase());
              if (filtered.length !== list.length) {
                newBusiness = filtered.length > 0 ? filtered.join(', ') : null;
                needsUpdate = true;
              }
            }

            if (needsUpdate) {
              await supabaseAdmin
                .from('occupants')
                .update({ primary_email: newPrimary, business_email: newBusiness })
                .eq('id', oldOccRow.id);
              occupantsChanges.unit_removed++;
            }
          }
        }

        // 6-B-2. 새 unit에 이메일 추가
        if (newOccRow) {
          const { data: freshOcc } = await supabaseAdmin
            .from('occupants')
            .select('id, primary_email, business_email')
            .eq('id', newOccRow.id)
            .maybeSingle();

          const targetField = (userRole === 'tenant') ? 'business_email' : 'primary_email';
          const currentValue = freshOcc?.[targetField] || '';
          const existingEmails = currentValue.split(/[,;]/).map(e => e.trim()).filter(Boolean);
          const existingLower = existingEmails.map(e => e.toLowerCase());

          if (!existingLower.includes(targetEmail.toLowerCase())) {
            const newList = [...existingEmails, targetEmail];
            const newValue = newList.join(', ');

            await supabaseAdmin
              .from('occupants')
              .update({ [targetField]: newValue })
              .eq('id', newOccRow.id);
            occupantsChanges.unit_added++;
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      changes: {
        name_changed: nameChanged,
        unit_changed: unitChanged,
        email_changed: emailChanged,
        old_email: oldEmail,
        new_email: emailChanged ? cleanEmail : null,
        old_unit: oldUnit,
        new_unit: unitChanged ? cleanUnit : null
      },
      occupants_sync: occupantsChanges
    });

  } catch (err) {
    console.error('[admin-edit-profile] error:', err);
    // 사용자 정보 변경 실패 audit 기록
    await logError(supabaseAdmin, err.message || String(err), {
      type: 'profile_edit_failed',
      user_id,
      stack: err.stack,
    });
    return res.status(500).json({ error: err.message });
  }
};
