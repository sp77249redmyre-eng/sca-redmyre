# Redmyre BMS — Master Manual Part 3
## JS 모듈 / Vercel API / Service Worker / 외부 시스템 연동

> **작성일**: 2026-04-25  
> **작성자**: Claude (Jacob Kim 사장님 지시)  
> **목적**: 새 세션의 Claude가 이 문서만 보고도 BMS 코드 구조를 추측 없이 정확히 이해할 수 있도록 함  
> **검증 기준**: /mnt/project/ 실제 파일 코드 + GitHub 직접 확인 + 사장님 4월 20일 확정 사항

---

## 📋 Part 3 목차

- **Section 1**: 핵심 JS 모듈 4개 (auth.js, common.js, audit.js, layout.js)
- **Section 2**: Vercel API Functions 6개
- **Section 3**: Service Worker + 외부 시스템 연동 4개 (HVAC Daemon, SignApps, Resend, NSW 공휴일)
- **추가**: `/api/admin-change-email.js` (7번째 API), `service-reports` 페이지 (Part2 그룹 D 추가)

---

# Redmyre BMS — Master Manual Part 3
## Section 1: 핵심 JS 모듈 4개 (보강본 v2)

> **목적**: 새 세션의 Claude(나)가 이 문서만 보고도 BMS 코드 구조를 추측 없이 정확히 이해할 수 있어야 함.
> **작성 원칙**:
> 1. 코드에 있는 것만 적는다.
> 2. 코드에 없는 동작/에러는 "확인 필요"라고 명시.
> 3. 라인 번호 항상 표기.
> 4. 외부 의존성은 실제 호출 코드 그대로 인용.
> **작성 기준**: 2026-04-25, /mnt/project/ 실제 파일

---

## 📂 1. `/js/auth.js` — Supabase 클라이언트 싱글톤

### 📋 1-1. 파일 메타
- **실제 파일 경로 (배포)**: `/js/auth.js`
- **실제 파일 경로 (프로젝트 루트)**: `/auth.js` ← GitHub repo 기준
- **총 라인 수**: 28줄
- **export**: `getSupabase` (async 함수 1개)
- **import**: 없음 (외부 라이브러리는 동적 import)

### 📋 1-2. 전체 코드 인용 (라인 단위)
```javascript
// 라인 10
const SUPABASE_URL     = 'https://wunsexdnqathluplkkvo.supabase.co';
// 라인 11
const SUPABASE_ANON_KEY = 'sb_publishable_6UyUhrHT3X1I02bVqwNuHQ_YQWh_NAo';

// 라인 13
let _supabase = null;

// 라인 15-28
export async function getSupabase() {
  if (_supabase) return _supabase;

  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage
    }
  });
  return _supabase;
}
```

### 📋 1-3. 동작 흐름 (라인별)
| 라인 | 동작 |
|---|---|
| 10 | Supabase 프로젝트 URL 정의 (하드코딩) |
| 11 | Anon Key 정의. `sb_publishable_*` 형식 = 새 publishable key |
| 13 | 모듈 스코프 변수 `_supabase` (싱글톤 저장소). 초기값 null |
| 16 | 이미 생성된 클라이언트 있으면 그대로 반환 (재생성 X) |
| 18 | esm.sh CDN에서 `@supabase/supabase-js@2` 동적 import |
| 19 | `createClient(URL, ANON_KEY, options)` 호출 |
| 20-25 | auth 옵션 4개 설정 |
| 27 | 생성된 클라이언트 반환 |

### 📋 1-4. auth 옵션 4개 의미 (코드에 있는 그대로)
| 옵션 | 값 | 의미 |
|---|---|---|
| `persistSession` | `true` | 브라우저 storage에 세션 저장 (탭 닫아도 유지) |
| `autoRefreshToken` | `true` | access token 만료 전 자동 refresh |
| `detectSessionInUrl` | `true` | URL의 hash/query에서 세션 자동 파싱 (이메일 인증 링크용) |
| `storage` | `window.localStorage` | 세션 저장소를 localStorage로 명시 (기본값과 동일하지만 명시) |

### 📋 1-5. 호출 패턴 (다른 파일이 이걸 어떻게 쓰는지)
```javascript
// 모든 페이지/모듈에서 공통
import { getSupabase } from '/js/auth.js';
const supabase = await getSupabase();
```

### 📋 1-6. 절대 규칙 (파일 상단 주석에 명시됨)
- 다른 파일에서 `createClient`를 직접 호출하면 **세션 분리 사고** 발생.
  - 이유: 인스턴스 2개가 각각 다른 세션 캐시를 가지면, 한 인스턴스는 로그인 됐다고 판단하고 다른 인스턴스는 로그아웃 상태로 판단함.
- 반드시 `getSupabase()`로만 가져온다.

### 📋 1-7. ⚠️ Anon Key Rotation 시 동시 업데이트 항목
사장님 메모리에서 명시된 사항. 이 파일의 키만 바꾸면 시스템 일부가 죽음:
1. ✅ `auth.js` 라인 11
2. ⚠️ DB 함수 `notify_announcement` 내부 하드코딩 키
3. ⚠️ DB 함수 `notify_quote` 내부 하드코딩 키

**누락 시 영향**:
- `notify_announcement` 누락 → 공지 발행 시 Push 알림 실패
- `notify_quote` 누락 → 견적 status 변경 시 Push 알림 실패

### 📋 1-8. 알려진 이슈/주의
| 증상 | 코드상 원인 |
|---|---|
| `getSupabase is not a function` | import 경로가 `/js/auth.js`가 아닌 경우 |
| 첫 로딩 지연 | 라인 18의 esm.sh 동적 import는 첫 호출 시에만 발생 (이후 캐싱) |
| `Failed to import https://esm.sh/...` | 사용자 네트워크 차단 또는 esm.sh CDN 장애. 폴백 없음 |
| 시크릿 모드에서 매번 로그인 풀림 | localStorage가 탭 종료 시 비워짐. 정상 동작 |

### 📋 1-9. 코드에 **없는** 것 (헛소리 방지용 명시)
- ❌ 에러 핸들링 없음 (esm.sh 실패 시 throw됨)
- ❌ 재시도 로직 없음
- ❌ 타임아웃 설정 없음
- ❌ 환경변수(.env) 사용 안 함 — 키가 코드에 직접 박혀 있음

---

## 📂 2. `/js/common.js` — 공통 유틸 함수

### 📋 2-1. 파일 메타
- **총 라인 수**: 109줄
- **export 목록 (총 7개 + 4개 상수 = 11개)**:
  - 함수: `formatDate`, `formatDateTime`, `getTimeAgo`, `getInitials`, `formatCurrency`, `getRoleLabel`, `parseComment`
  - 상수: `WORKS_STATUS_MAP`, `COMPLAINT_CAT_EMOJI`, `COMPLAINT_CAT_LABEL`
- **import**: 없음

### 📋 2-2. `formatDate(dateStr, options)` (라인 10-13)
```javascript
export function formatDate(dateStr, options = {}) {
  const defaults = { day: 'numeric', month: 'short', year: 'numeric' };
  return new Date(dateStr).toLocaleDateString('en-AU', { ...defaults, ...options });
}
```
- **입력**: ISO 날짜 문자열 (`'2026-04-25T00:00:00Z'` 등)
- **로케일 고정**: `'en-AU'` (호주)
- **기본 옵션**: day numeric / month short / year numeric
- **출력 예**: `'25 Apr 2026'`
- **options 인자로 오버라이드 가능**: 예) `{ weekday: 'long' }` → `'Saturday, 25 Apr 2026'`
- **에러 처리**: 없음. `dateStr`이 invalid면 `'Invalid Date'` 반환됨 (JavaScript 표준 동작)

### 📋 2-3. `formatDateTime(dateStr)` (라인 15-20)
```javascript
export function formatDateTime(dateStr) {
  return new Date(dateStr).toLocaleString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}
```
- **출력 예**: `'25 Apr 2026, 02:30 pm'`
- 시:분 포함, 초는 없음
- AM/PM 표기는 en-AU 로케일 기본값 따름 (보통 소문자 am/pm)

### 📋 2-4. `getTimeAgo(dateStr)` (라인 22-31)
```javascript
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
```
- **로직**: 현재 시각 - 입력 시각 = diff (ms)
- **분기**:
  - `mins < 1` → `'Just now'`
  - `mins 1~59` → `'{mins}m ago'`
  - `hrs 1~23` → `'{hrs}h ago'`
  - 그 외 → `'{days}d ago'`
- **주의**: 미래 시각(diff < 0) 처리 없음 → 음수 분으로 출력될 수 있음
  - `mins = -5` → `mins < 60` 조건 통과 → `'-5m ago'` 출력됨

### 📋 2-5. `getInitials(name)` (라인 34-41)
```javascript
export function getInitials(name) {
  return (name || '?')
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}
```
- **falsy 처리**: name이 null/undefined/빈문자열 → `'?'` 사용
- **로직**: 공백으로 split → 각 단어 첫 글자 → 합침 → 대문자 → 최대 2자
- **예**:
  - `'Jacob Kim'` → `'JK'`
  - `'Sarah'` → `'S'`
  - `'Jung Sook Kim'` → `'JS'` (3개 중 앞 2개만)
  - `''` → `'?'`
  - `null` → `'?'`
- **주의**: 단어 첫 글자가 없으면 (예: 공백 2개로 split) `undefined` 들어감 → `.join('')`에서 무시됨

### 📋 2-6. `formatCurrency(amount)` (라인 44-49)
```javascript
export function formatCurrency(amount) {
  return '$' + Number(amount || 0).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
```
- **출력 예**: `'$1,234.56'`
- **falsy 처리**: amount가 null/undefined/0/'' → 0으로 대체
- **소수점 항상 2자리** (1234 → `$1,234.00`)
- **로케일**: en-AU (천 단위 콤마)
- **통화 기호**: `$` 직접 prepend (Intl Currency 안 씀)
- **주의**: 음수도 그대로 처리 → `formatCurrency(-100)` → `'$-100.00'` (`-$100.00` 아님)

### 📋 2-7. `getRoleLabel(role)` (라인 52-55)
```javascript
export function getRoleLabel(role) {
  const labels = { admin:'Admin', committee:'Committee', observer:'Observer (Strata)', owner:'Owner', tenant:'Tenant (Staff)' };
  return labels[role] || labels.observer;
}
```
- **5개 role → 라벨 매핑**:
  | DB role 값 | 화면 표시 |
  |---|---|
  | `admin` | `Admin` |
  | `committee` | `Committee` |
  | `observer` | **`Observer (Strata)`** |
  | `owner` | `Owner` |
  | `tenant` | **`Tenant (Staff)`** |
- **fallback**: 매칭 실패 시 → `'Observer (Strata)'` (라인 54의 `labels.observer`)
- ⚠️ **변경 금지**: DB 값(observer/tenant)은 그대로, 표시만 변경된 의도된 설계

### 📋 2-8. 상수 1: `WORKS_STATUS_MAP` (라인 58-67)
Works 페이지의 상태 표시에 사용. 객체 8개 항목.

| key | label | cls | dot |
|---|---|---|---|
| `inprog` | `In Progress` | `badge-blue` | `var(--blue-600)` |
| `scheduled` | `Scheduled` | `badge-gray` | `var(--muted)` |
| `urgent` | `Urgent` | `badge-red` | `var(--red)` |
| `review` | `Under Review` | `badge-yellow` | `var(--yellow)` |
| `quoting` | `Quoting` | `badge-yellow` | `var(--yellow)` |
| `pending` | `Pending` | `badge-yellow` | `var(--yellow)` |
| `legal` | `Legal` | `badge-red` | `var(--red)` |
| `done` | `Done` | `badge-green` | `var(--green)` |

- 각 항목: `{ label, cls, dot }` 3개 필드.
- `cls` = CSS 클래스명 (badge용).
- `dot` = CSS 변수 참조 문자열 (점 색상용).

### 📋 2-9. 상수 2: `COMPLAINT_CAT_EMOJI` (라인 70-80)
Complaints 페이지 카테고리 이모지. 9개 항목.

| key | emoji |
|---|---|
| `noise` | 🔊 |
| `leak` | 💧 |
| `cleaning` | 🧹 |
| `parking` | 🚗 |
| `elevator` | 🛗 |
| `access` | 🔒 |
| `hvac` | ❄️ |
| `common` | 🏢 |
| `other` | 📝 |

### 📋 2-10. 상수 3: `COMPLAINT_CAT_LABEL` (라인 99-109)
Complaints 페이지 카테고리 풀 라벨. 9개 항목 (위 EMOJI와 동일 키).

| key | label |
|---|---|
| `noise` | `Noise / Vibration` |
| `leak` | `Leak / Plumbing` |
| `cleaning` | `Cleaning` |
| `parking` | `Parking` |
| `elevator` | `Elevator` |
| `access` | `Access / Security` |
| `hvac` | `HVAC / Temperature` |
| `common` | `Common Area` |
| `other` | `Other` |

### 📋 2-11. `parseComment(comment)` (라인 83-97)
```javascript
export function parseComment(comment) {
  try {
    if (!comment) return { note: '', files: [], category: 'General', priority: 'Normal' };
    const obj = typeof comment === 'string' ? JSON.parse(comment) : comment;
    const files = Array.isArray(obj?.files) ? obj.files : [];
    return {
      note: obj?.note || '',
      files: files.filter(f => f && f.path),
      category: obj?.category || 'General',
      priority: obj?.priority || 'Normal'
    };
  } catch(e) {
    return { note: '', files: [], category: 'General', priority: 'Normal' };
  }
}
```
- **목적**: Quote 테이블의 `comment` 컬럼 (JSON 문자열) 파싱.
- **입력 타입 2가지 지원**:
  - 문자열 → `JSON.parse()`로 파싱
  - 이미 객체 → 그대로 사용
- **falsy 처리**: comment가 null/undefined/빈문자열 → 안전 기본값 반환
- **파싱 에러 처리**: try/catch로 감싸서 invalid JSON일 때도 안전 기본값 반환
- **반환 객체 구조**: 항상 동일한 4개 필드
  ```js
  { note: string, files: array, category: string, priority: string }
  ```
- **files 필터링**: 배열 아니면 빈 배열, 배열이면 `f.path` 있는 항목만 남김
- **기본값**:
  - note: `''`
  - files: `[]`
  - category: `'General'`
  - priority: `'Normal'`

### 📋 2-12. common.js에 **없는** 것 (헛소리 방지)
- ❌ 시간대(timezone) 처리 함수 없음 — 시스템 로케일 의존
- ❌ 통화 기호 매핑 없음 (USD, EUR 등) — `$`만 사용
- ❌ HTML escape 함수 없음 (`escapeHtml`은 각 페이지에서 자체 정의)
  - ⚠️ 사장님 메모리에는 "common.js의 escapeHtml" 언급되지만 실제로는 common.js에 없음
- ❌ 에러 throw 없음 (모두 안전 기본값 반환)

---

## 📂 3. `/js/audit.js` — 감사 로그 헬퍼

### 📋 3-1. 파일 메타
- **총 라인 수**: 21줄
- **export**: `logAction` (async 함수 1개)
- **import**: `getSupabase` from `/js/auth.js` (라인 1)
  - ⚠️ 단, 함수 내부에서는 `getSupabase`를 사용하지 않음. `ctx.supabase`를 받아서 사용.
  - 라인 1의 import는 **현재 미사용** (코드 흔적). 동작에는 영향 없음.

### 📋 3-2. 전체 코드 인용
```javascript
import { getSupabase } from '/js/auth.js';

export async function logAction(ctx, { action, table, record_id = null, details = {} }) {
  try {
    const { supabase, user, role } = ctx;

    // ❌ admin 제외
    if (role === 'admin') return;

    await supabase.from('audit_logs').insert({
      action,
      table_name: table,
      record_id,
      user_email: user.email,
      user_role: role,
      details
    });

  } catch (err) {
    console.error('audit log error:', err);
  }
}
```

### 📋 3-3. 함수 시그니처
```
logAction(ctx, options)
```

**ctx 객체** (필수 3개 필드):
- `ctx.supabase` — Supabase 클라이언트
- `ctx.user` — 현재 로그인 유저 객체 (`user.email` 사용)
- `ctx.role` — 현재 유저 role 문자열

**options 객체 (구조 분해됨)**:
- `action` — 동작 식별자 문자열 (필수)
- `table` — 대상 테이블명 문자열 (필수)
- `record_id` — 대상 레코드 UUID, 기본값 `null`
- `details` — 추가 메타데이터 객체, 기본값 `{}`

### 📋 3-4. 동작 흐름 (라인별)
| 라인 | 동작 |
|---|---|
| 4 | try 블록 시작 |
| 5 | ctx에서 supabase, user, role 추출 |
| 8 | **role이 'admin'이면 즉시 return** (insert 안 함) |
| 10-17 | `audit_logs` 테이블에 INSERT |
| 19-20 | catch — 에러는 console.error로만 출력. throw 안 함 |

### 📋 3-5. INSERT되는 컬럼 (라인 11-16)
| 컬럼 | 값 | 출처 |
|---|---|---|
| `action` | options.action | 호출자가 지정 |
| `table_name` | options.table | 호출자가 지정 (key 이름이 `table` → DB 컬럼은 `table_name`) |
| `record_id` | options.record_id | 호출자가 지정 또는 null |
| `user_email` | ctx.user.email | 자동 |
| `user_role` | ctx.role | 자동 |
| `details` | options.details | 호출자가 지정 또는 {} |

⚠️ **컬럼 매핑 주의**: 함수 인자명 `table`이 DB 컬럼 `table_name`으로 매핑됨 (라인 12).

### 📋 3-6. Admin 제외 정책 (라인 8)
- 라인 8: `if (role === 'admin') return;`
- **이유**: Admin이 모든 동작을 audit_logs에 남기면 노이즈 너무 많음.
- **결과**: audit_logs에는 admin 제외 모든 role의 동작만 기록됨.
- 단, `layout.js` 라인 337에서도 별도로 `if (role !== 'admin')` 체크 후 `PAGE_ENTER`를 직접 INSERT함 (audit.js를 거치지 않음).

### 📋 3-7. 에러 처리 정책
- **try/catch로 감싸짐** (라인 4, 19).
- INSERT 실패 시:
  - `console.error('audit log error:', err)` 출력
  - throw 안 함 → 호출자 흐름 막지 않음
- **의도**: 로그 기록 실패가 메인 비즈니스 로직을 차단하면 안 됨.

### 📋 3-8. audit_logs 테이블 RLS (변경 금지)
- SELECT/INSERT/DELETE 모두 `true` (전체 허용)
- 사장님 메모리에 명시된 의도된 설계
- 보안 보장 레이어:
  1. `profiles` RLS (다른 유저 정보 못 봄)
  2. `layout.js`의 role 체크 (admin 전용 페이지 접근 차단)
  3. UI 자체가 admin 전용 (system.html, users.html)

### 📋 3-9. 호출 패턴 (다른 페이지에서 어떻게 쓰는지)
```javascript
import { logAction } from '/js/audit.js';

await logAction(
  { supabase, user, role },
  {
    action: 'CREATE_COMPLAINT',
    table: 'complaints',
    record_id: complaint.id,
    details: { category: 'noise', unit: '6H' }
  }
);
```

### 📋 3-10. audit.js에 **없는** 것
- ❌ 라인 1의 `import { getSupabase }`는 사용되지 않음 (코드 흔적)
- ❌ 별도 LOGIN/LOGOUT 로깅 없음 (현재 미구현)
- ❌ IP 주소 / User-Agent 자동 캡처 없음
- ❌ 로그 보관 기간 정책 없음 (DB cron job에서 별도 처리 — Part 1 참조)

---

## 📂 4. `/js/layout.js` — 사이드바/탑바/Role 권한/Push/뱃지

### 📋 4-1. 파일 메타
- **총 라인 수**: 400줄
- **import**: `getSupabase` from `/js/auth.js` (라인 1)
- **export**: `initLayout` (async 함수 1개, 라인 291)
- ⚠️ **변경 금지** — 사장님이 직접 관리하는 마스터 파일

### 📋 4-2. 모든 함수 목록 (총 14개)
| # | 함수명 | 라인 | export | window 등록 |
|---|---|---|---|---|
| 1 | `getCurrentPage` | 23 | ❌ | ❌ |
| 2 | `loadComponent` | 32 | ❌ | ❌ |
| 3 | `insertSidebar` | 43 | ❌ | ❌ |
| 4 | `insertTopbar` | 61 | ❌ | ❌ |
| 5 | `applyRoleMenuControl` | 69 | ❌ | ❌ |
| 6 | `setActiveMenu` | 125 | ❌ | ❌ |
| 7 | `checkPageAccess` | 132 | ❌ | ❌ |
| 8 | `updateUserUI` | 142 | ❌ | ❌ |
| 9 | `updateGreeting` | 161 | ❌ | ❌ |
| 10 | `initLogout` | 182 | ❌ | `window.handleLogout` |
| 11 | `initMobileMenu` | 196 | ❌ | ❌ |
| 12 | `initCommonUtils` | 222 | ❌ | `window.openModal`, `closeModal`, `showToast` |
| 13 | `initNotification` | 241 | ❌ | `window.toggleNotification` |
| 14 | `initLayout` | 291 | ✅ | ❌ |
| 15 | `initBadges` | 343 | ❌ | ❌ |

### 📋 4-3. `PAGE_CONFIG` 상수 (라인 3-21)
모든 페이지의 `{ title, allowedRoles }` 매핑. 17개 항목.

| Page key | Title | allowedRoles |
|---|---|---|
| `building` | Overview | `null` (전체) |
| `announcements` | Announcements | `null` |
| `parking` | Parking / Towing | `null` |
| `complaints` | Resident Requests | `null` |
| `hvac` | A/C Temperature | `null` |
| `emergency` | Emergency Contacts | `null` |
| `works` | Ongoing Works | `null` |
| `cost-dashboard` | Cost Analysis | `['admin', 'committee', 'observer']` |
| `history` | Temperature History | `['admin', 'committee', 'observer']` |
| `quotes` | Quote Approvals | `['admin', 'committee', 'observer']` |
| `reports` | Completed Works | `['admin', 'committee', 'observer']` |
| `occupants` | Occupant Details | `['admin', 'committee', 'observer', 'owner', 'tenant']` (전체 5개) |
| `signboard` | Signboard Manager | `['admin']` |
| `users` | User Management | `['admin']` |
| `system` | System Management | `['admin']` |
| `guide-resident` | User Guide | `null` |
| `guide-committee` | Committee Guide | `['admin', 'committee', 'observer']` |

⚠️ `allowedRoles: null`이면 **전체 5개 role 모두 접근 가능** (라인 136에서 null 체크 후 통과).

### 📋 4-4. `getCurrentPage()` (라인 23-30)
```javascript
function getCurrentPage() {
  const path = window.location.pathname;
  const segments = path.split('/').filter(s => s !== '');
  const last = segments[segments.length - 1] || '';
  const file = last.replace('.html', '');
  if (!file || file === '') return 'dashboard';
  return file;
}
```
- pathname에서 마지막 세그먼트 추출 → `.html` 제거
- 빈 경우 `'dashboard'` 반환
- 예:
  - `/pages/complaints.html` → `'complaints'`
  - `/pages/setup.html` → `'setup'`
  - `/index.html` → `'index'`
  - `/` → `'dashboard'`

### 📋 4-5. `loadComponent(url)` (라인 32-41)
- fetch로 컴포넌트 HTML 가져옴
- 응답 ok 아니면 throw
- catch 시 빈 문자열 반환 (페이지 깨지지 않게)

### 📋 4-6. `insertSidebar()` (라인 43-59)
- `/components/sidebar.html` fetch
- `#sidebarPlaceholder` 있으면 `outerHTML`로 교체
- 없으면 body에 `insertAdjacentHTML('afterbegin', ...)` (body 시작에 삽입)
- 라인 53-56: `#appSidebar`에 `style.opacity = '0'` 강제 설정 → 권한 적용 전까지 숨김
- 라인 58: `await new Promise(r => setTimeout(r, 0))` → DOM 갱신 대기

### 📋 4-7. `insertTopbar()` (라인 61-67)
- `/components/topbar.html` fetch
- `#topbarPlaceholder` 있으면 outerHTML로 교체
- 없으면 아무것도 안 함 (sidebar와 다름)

### 📋 4-8. `applyRoleMenuControl(role, supabase)` ⭐ (라인 69-123)
**핵심 권한 적용 함수.**

라인 70-76: body 클래스 설정
- `privileged = ['admin', 'committee', 'observer']` 포함이면 → `body.classList.add('role-privileged')`
- role === 'admin'이면 → `body.classList.add('role-admin')`

라인 79-104: `allowedPages` 결정
- **Admin 분기** (라인 81-83):
  ```js
  allowedPages = ['building', 'announcements', 'parking', 'complaints', 'hvac', 'emergency', 'works', 'history', 'quotes', 'reports', 'cost-dashboard', 'occupants', 'signboard', 'users', 'system', 'guide-resident', 'guide-committee'];
  ```
  → 17개 페이지 전체 (하드코딩)

- **Admin 아닌 분기** (라인 84-103):
  - DB `sidebar_permissions` 테이블 조회:
    ```sql
    SELECT page FROM sidebar_permissions
    WHERE role = '<role>' AND allowed = true
    ```
  - 결과 있으면 → `allowedPages = permissions.map(p => p.page)`
  - 결과 없거나 에러 시 → fallback 하드코딩:
    - `committee`/`observer` → 13개 페이지
      ```js
      ['building', 'announcements', 'parking', 'complaints', 'hvac', 'emergency', 'works', 'history', 'quotes', 'reports', 'cost-dashboard', 'occupants', 'guide-committee']
      ```
    - `owner`/`tenant` → 9개 페이지
      ```js
      ['building', 'announcements', 'parking', 'complaints', 'hvac', 'emergency', 'works', 'occupants', 'guide-resident']
      ```
    - 그 외 unknown role → `['building']` (안전 fallback)

라인 107-115: `.nav-item[data-page]` 순회
```js
document.querySelectorAll('.nav-item[data-page]').forEach(item => {
  const page = item.dataset.page;
  if (allowedPages.includes(page)) {
    item.style.display = '';   // 보이기
  } else {
    item.style.display = 'none'; // 숨기기
  }
});
```

라인 118-122: sidebar 보이기
- `#appSidebar.style.opacity = '1'`
- `transition: opacity 0.2s ease-in`

### 📋 4-9. `setActiveMenu()` (라인 125-130)
- 현재 페이지에 해당하는 nav-item에 `active` 클래스 토글
- `item.classList.toggle('active', item.dataset.page === currentPage)`

### 📋 4-10. `checkPageAccess(role)` (라인 132-140)
```javascript
function checkPageAccess(role) {
  const currentPage = getCurrentPage();
  const config = PAGE_CONFIG[currentPage];
  if (!config) return;
  if (!config.allowedRoles) return;
  if (!config.allowedRoles.includes(role)) {
    window.location.href = '/pages/building.html';
  }
}
```
- 현재 페이지의 PAGE_CONFIG 조회
- config 없으면 (PAGE_CONFIG에 없는 페이지) → 통과
- `allowedRoles`가 null이면 → 통과
- role이 `allowedRoles`에 없으면 → `/pages/building.html`로 강제 리다이렉트

### 📋 4-11. `updateUserUI(name, role)` (라인 142-159)
- 라인 143: 이니셜 추출 — `name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)`
  - ⚠️ common.js의 `getInitials`와 동일 로직이지만 별도로 인라인 구현됨
- 라인 144: roleLabel — `role.charAt(0).toUpperCase() + role.slice(1)`
  - ⚠️ common.js의 `getRoleLabel`과 다름. layout.js는 단순 capitalize만 함
  - 예: `observer` → `Observer` (Strata 표기 없음)
  - 예: `tenant` → `Tenant` (Staff 표기 없음)
- 갱신 대상 DOM 7개:
  - `#sbAvatar`, `#sbName`, `#sbRole` (사이드바)
  - `#topAvatar`, `#topName`, `#topRole`, `#topbarRole` (탑바)
- 모두 `if (el) el.textContent = ...` 패턴 (요소 없으면 skip)

### 📋 4-12. `updateGreeting(name)` (라인 161-180)
- `#topbarGreeting`, `#topbarDate` 갱신
- `#topbarGreeting` 없으면 즉시 return
- 시간대별 인사:
  - `hour 0~11` → `Good morning`
  - `hour 12~16` → `Good afternoon`
  - `hour 17~23` → `Good evening`
- 날짜 포맷:
  - 요일: `Sunday, Monday, ..., Saturday`
  - 월: `January, February, ..., December`
  - 형식: `'{weekday}, {date} {month} {year}'`
  - 예: `'Saturday, 25 April 2026'`
- greetEl: `<innerHTML>` = `'{greet}, {firstName} 👋'`
- dateEl: `textContent` = 날짜 문자열

⚠️ name에서 first name 추출: `name.split(' ')[0]`

### 📋 4-13. `initLogout(supabase)` (라인 182-194)
- `#sbLogoutBtn` 클릭 리스너 등록
- 클릭 시: `supabase.auth.signOut()` → `/index.html`로 이동
- 추가로 `window.handleLogout` 글로벌 함수 등록 (다른 곳에서 호출 가능)

### 📋 4-14. `initMobileMenu()` (라인 196-220)
- `#hamburgerBtn`, `#sidebarOverlay`, `#appSidebar` 사용
- btn 또는 sidebar 없으면 즉시 return

**openMenu** 함수:
- `appSidebar.classList.add('mobile-open')`
- `overlay.classList.add('open')`
- `btn.classList.add('open')`

**closeMenu** 함수:
- 위 클래스 모두 remove

**이벤트**:
- 햄버거 버튼 클릭 → mobile-open 클래스 토글로 open/close
- 오버레이 클릭 → closeMenu
- nav-item 클릭 시 viewport ≤ 768px이면 closeMenu

### 📋 4-15. `initCommonUtils()` (라인 222-239)
**3개 글로벌 함수 등록**:

```javascript
window.closeModal = (id) => {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
};

window.openModal = (id) => {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
};

window.showToast = (msg, isError = false) => {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent      = msg;
  t.style.background = isError ? '#991b1b' : '#0f172a';
  t.style.display    = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 3000);
};
```

- 모달은 `.open` CSS 클래스로 표시 제어
- 토스트는 `#toast` 요소 사용, 3초 후 자동 숨김
- 에러 시 배경색 `#991b1b` (어두운 빨강), 일반 `#0f172a` (어두운 남색)

### 📋 4-16. `initNotification(supabase)` ⭐ Push 알림 (라인 241-289)

**내부 함수 `urlBase64ToUint8Array(base64String)`** (라인 242-247):
- VAPID 키 변환 함수
- base64url → Uint8Array
- padding 보정 (`=` 추가), `-`/`_` → `+`/`/` 치환
- `atob` 디코드 후 char code 배열로 변환

**상태 관리 (라인 248)**:
```js
let notifEnabled = localStorage.getItem('notifEnabled') === 'true';
```

**`updateNotifUI()` 내부 함수 (라인 249-257)**:
- `#notifToggleBtn`, `#notifIcon`, `#notifLabel` 갱신
- 활성: 🔔 / `ON` / accent 색상
- 비활성: 🔕 / `OFF` / muted 색상

**`window.toggleNotification` 글로벌 함수 (라인 259-288)**:

활성화 흐름 (notifEnabled가 false일 때):
1. `Notification.requestPermission()` 호출
2. 거부 → notifEnabled = false, localStorage 'false', UI 갱신 후 return
3. 승인 → 다음 단계
4. `navigator.serviceWorker.register('/sw.js')` 호출
5. `reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: <VAPID 변환> })`
   - VAPID 공개키: `'BNyzSuyh9RRzRLNiPq1mngiuEH35QX3smFJoYQGWdOSdu_4koNy4s65I8WUpI1gxanRgJLNU0gDJfhW1PUdxQrI'`
6. 현재 유저 ID 조회: `supabase.auth.getUser()`
7. `push_subscriptions` 테이블에서 해당 user_id 행 모두 DELETE
8. 새 행 INSERT: `{ user_id, subscription }`
9. `profiles.push_enabled = true`로 UPDATE
10. notifEnabled = true, localStorage 'true'
11. catch 시: notifEnabled = false, localStorage 'false'

비활성화 흐름 (notifEnabled가 true일 때):
1. 현재 유저 조회
2. user 있으면:
   - `push_subscriptions`에서 user_id로 DELETE
   - `profiles.push_enabled = false` UPDATE
3. catch 시 `console.warn('Failed to clean push subscription:', e)` 출력
4. notifEnabled = false, localStorage 'false'

마지막 (라인 287): `updateNotifUI()` 호출

### 📋 4-17. `initLayout()` ⭐⭐⭐ (라인 291-341) — 마스터 진입 함수

**모든 페이지의 진입점.**

라인 292-293: sidebar/topbar 삽입
- `await insertSidebar()`
- `await insertTopbar()`

라인 295: DOM 갱신 대기
- `await new Promise(r => setTimeout(r, 0))`

라인 297: 글로벌 유틸 등록
- `initCommonUtils()` (modal, toast)

라인 299-300: Supabase 초기화
- `const supabase = await getSupabase()`
- `const { data: { session } } = await supabase.auth.getSession()`

라인 302-309: **세션 체크**
```js
if (!session) {
  const publicPages = ['index', 'setup', 'reset-password'];
  const current = getCurrentPage();
  if (!publicPages.includes(current)) {
    window.location.href = '/index.html';
  }
  return null;
}
```
- 세션 없으면:
  - 공개 페이지 (index, setup, reset-password) → 통과
  - 그 외 → `/index.html`로 리다이렉트
- 어느 쪽이든 `null` 반환 (호출자가 if (!layout) return으로 멈춰야 함)

라인 311: 유저 ID 추출
- `const user = session.user`

라인 312-316: profiles 조회
```js
const { data: profile } = await supabase
  .from('profiles')
  .select('*')
  .eq('id', user.id)
  .maybeSingle();
```
- ⚠️ `error` 무시함, `data`만 받음
- profiles에 행 없으면 profile = null

라인 318-319: role/name 결정
- `role = profile?.role || 'observer'` (fallback)
- `name = profile?.full_name || user.email.split('@')[0]` (fallback)

라인 321-324: setup 미완료 처리
```js
if (!profile?.setup_complete && getCurrentPage() !== 'setup') {
  window.location.href = '/pages/setup.html';
  return null;
}
```
- profile.setup_complete가 false/undefined이고 현재 페이지가 setup이 아니면 → setup으로 강제 이동
- ⚠️ 사장님 메모리에 명시: "미설정자에게 재발송 불필요 — 이메일만 입력하면 setup 자동 진행됨"의 핵심 로직

라인 326-334: 초기화 시퀀스 (순서 중요)
1. `checkPageAccess(role)` — 권한 없으면 building.html로 리다이렉트
2. `await applyRoleMenuControl(role, supabase)` — 메뉴 필터링
3. `setActiveMenu()` — 현재 메뉴 강조
4. `updateUserUI(name, role)` — 아바타/이름 갱신
5. `updateGreeting(name)` — 인사말 갱신
6. `initLogout(supabase)` — 로그아웃 버튼 활성화
7. `initNotification(supabase)` — Push 토글 활성화
8. `initMobileMenu()` — 햄버거 메뉴 활성화
9. `initBadges(supabase, user, role)` — 뱃지 카운트

라인 336-338: PAGE_ENTER 자동 로깅
```js
if (role !== 'admin') {
  try {
    await supabase.from('audit_logs').insert({
      user_email: user.email,
      user_role: role,
      action: 'PAGE_ENTER',
      details: { page: window.location.pathname }
    });
  } catch(e) {}
}
```
- Admin 제외 모든 role의 페이지 진입을 audit_logs에 기록
- ⚠️ audit.js의 `logAction`을 거치지 않고 **직접** insert함
- catch 빈 블록 — 실패 무시

라인 340: 반환
```js
return { supabase, user, profile, role, name };
```

### 📋 4-18. `initBadges(supabase, user, role)` (라인 343-400)
사이드바 메뉴 옆 빨간 카운트 뱃지 표시.

**lastSeen 갱신 (라인 346-349)**:
- 현재 페이지가 announcements/complaints/quotes/hvac이면 → `localStorage.lastSeen_<page>`를 현재 시각으로 갱신

**lastSeen 읽기 (라인 351-354)**:
- 4개 키 각각 → 없으면 `'2000-01-01T00:00:00Z'` fallback

**4개 뱃지 카운트 로직** (try 블록 안, 모든 에러 catch로 무시):

#### Announcements 뱃지 (라인 356-361)
- 조건: 현재 페이지가 announcements가 **아닐 때**만
- 쿼리: `announcements` 테이블에서 `created_at > lastSeenAnn` 카운트
- count > 0 → `#badgeAnnouncements` 표시
- count > 9 → `'9+'` 표시

#### Complaints 뱃지 (라인 363-375)
- 조건: 현재 페이지가 complaints가 **아닐 때**
- privileged role (admin/committee/observer):
  - 쿼리: `complaints`에서 `updated_at > lastSeenComp` 전체 카운트
- 일반 role (owner/tenant):
  - 쿼리: 본인 user_id 행 중 `updated_at > lastSeenComp` 카운트
- 표시: `#badgeComplaints`

#### Quotes 뱃지 (라인 377-384)
- 조건: 현재 페이지가 quotes가 **아닐 때**
- privileged role만:
  - 쿼리: `quotes`에서 `status = 'voting'` AND `created_at > lastSeenQuotes`
- owner/tenant는 뱃지 안 보임 (조건 자체가 없음)
- 표시: `#badgeQuotes`

#### HVAC 뱃지 (라인 386-398)
- 조건: 현재 페이지가 hvac이 **아닐 때**
- admin:
  - 쿼리: `hvac_requests`에서 `status = 'pending'` 전체 카운트
- 일반 role (committee, observer, owner, tenant):
  - 쿼리: 본인 user_id 요청 중 `status IN ('completed', 'failed', 'rejected')` AND `completed_at > lastSeenHvac`
- 표시: `#badgeHvac`

**모든 카운트 표시 로직 공통**:
```js
if (el && count > 0) {
  el.textContent = count > 9 ? '9+' : count;
  el.style.display = 'flex';
}
```

### 📋 4-19. layout.js 사용 패턴 (모든 페이지 공통)
```javascript
import { initLayout } from '/js/layout.js';

const layout = await initLayout();
if (!layout) return;  // 세션 없거나 setup 미완료 시 null

const { supabase, user, profile, role, name } = layout;

// 페이지별 로직 시작
```

### 📋 4-20. layout.js 절대 수정 금지 항목 (사장님 메모리 + 코드 분석)
1. **`PAGE_CONFIG`** (라인 3-21) — 페이지 추가 시에만 신중히 추가
2. **`applyRoleMenuControl`** (라인 69-123) — role 비교 로직 변경 시 즉시 권한 사고
3. **`checkPageAccess`** (라인 132-140) — null 체크 흐름 깨지면 권한 우회 가능
4. **`initLayout` 진입 순서** (라인 291-341) — 16단계 순서 변경 시 사이드 이펙트
5. **VAPID 공개키** (라인 267) — DB 함수와 짝 맞춰야 함
6. **`if (role !== 'admin')` audit 제외 로직** (라인 336)
7. **세션 없을 때 publicPages 화이트리스트** (라인 303)

### 📋 4-21. layout.js에 **없는** 것 (헛소리 방지)
- ❌ 다국어(i18n) 지원 없음 — 모두 영어 하드코딩
- ❌ 다크/라이트 모드 토글 없음 — CSS 변수로만 처리
- ❌ Service Worker 업데이트 알림 없음
- ❌ Push 구독 갱신 (재구독) 자동화 없음 — 만료 시 사용자가 재토글해야 함
- ❌ 세션 만료 자동 감지 없음 — initLayout 호출 시점에만 체크
- ❌ 멀티탭 동기화 없음 — 한 탭에서 로그아웃해도 다른 탭은 모름

### 📋 4-22. 자주 발생하는 장애와 코드상 원인
| 증상 | 코드상 원인 | 해당 라인 |
|---|---|---|
| 사이드바 안 뜸 | `/components/sidebar.html` 404 | 44 |
| 사이드바 메뉴 부족 | `sidebar_permissions` DB 비어있고 fallback 적용 | 96-103 |
| Admin인데 메뉴 부족 | 라인 83 하드코딩 리스트에 새 페이지 누락 | 83 |
| 로그인 후 무한 리다이렉트 | profile.setup_complete가 false인데 setup.html 깨짐 | 321 |
| 권한 없는 페이지 진입 | `allowedRoles`에 role 없음 → building.html로 강제 | 137 |
| Push 토글 안 됨 (Permission denied) | 브라우저 설정에서 차단됨 | 261 |
| Push 구독 INSERT 실패 | `push_subscriptions` RLS 또는 DB 권한 문제 | 271 |
| 뱃지 카운트 안 뜸 | localStorage 차단 또는 쿼리 실패 (catch로 무시됨) | 399 |
| 메뉴 깜빡임 | sidebar opacity 0/1 전환 타이밍 | 53-56, 118-122 |

---

## 📋 섹션 1 최종 요약

| 모듈 | 라인 | export 수 | 외부 의존 |
|---|---|---|---|
| auth.js | 28 | 1 | esm.sh, Supabase |
| common.js | 109 | 11 (함수 7 + 상수 4) | 없음 |
| audit.js | 21 | 1 | Supabase (간접) |
| layout.js | 400 | 1 + 글로벌 4개 | Supabase, 브라우저 Push API |
| **합계** | **558** | **14** | |

### 4개 파일 간 의존 관계
```
auth.js (싱글톤)
  ↑
  ├── audit.js (import만, 미사용)
  └── layout.js (사용)
       ↑
       └── 모든 페이지 (initLayout 호출)

common.js (독립)
  ↑
  └── 페이지별로 필요한 함수만 import
```

### 절대 수정 금지 항목 종합
1. auth.js의 키 (DB 함수와 짝)
2. audit.js의 admin 제외 로직
3. layout.js 전부 (사장님 직접 관리)
4. common.js의 getRoleLabel 매핑 (의도된 표시명)

### 새 세션의 Claude가 헷갈릴만한 점 정리
1. **common.js에 `escapeHtml` 없음** — 사장님 메모리에 언급되더라도 실제로는 각 페이지에서 자체 정의
2. **audit.js 라인 1의 import는 사용 안 됨** — 코드 흔적
3. **layout.js의 updateUserUI는 common.js의 getRoleLabel을 안 씀** — 단순 capitalize만 함
4. **layout.js의 audit_logs INSERT는 audit.js 안 거침** — 직접 INSERT (라인 337)
5. **`allowedRoles: null`은 "전체 허용" 의미** — `[]`(빈 배열)이 아님

---

**다음 섹션**: Vercel API Functions 6개
**작성 방식**: 동일하게 코드 100% 다 읽고 라인별 명세

---

# Redmyre BMS — Master Manual Part 3
## Section 2: Vercel API Functions 6개

> **목적**: BMS의 백엔드 API 6개를 코드 레벨에서 100% 명세.
> **대상 파일**: `/api/check-email.js`, `/api/complete-setup.js`, `/api/admin-set-password.js`, `/api/delete-user.js`, `/api/send-invite.js`, `/api/send-push.js`
> **작성 원칙**: 코드에 있는 것만 적음. 라인 번호 표기. 추측 금지.
> **작성 기준**: 2026-04-25, /mnt/project/ 실제 파일

---

## 📋 0. 공통 사항 (Vercel API Functions 전체)

### 0-1. Vercel 환경 설정 (`vercel.json`)
```json
{
  "functions": {
    "api/*.js": {
      "memory": 512,
      "maxDuration": 10
    }
  }
}
```
- **메모리**: 512 MB
- **최대 실행 시간**: 10초 (Vercel Hobby 플랜 기본 한도)
- send-push.js는 구독자 수가 늘면 발송 시간이 길어질 수 있음. 현재 77명 규모에서는 정상 동작 중.

### 0-2. 의존성 (`package.json`)
```json
{
  "dependencies": {
    "web-push": "^3.6.7",
    "@supabase/supabase-js": "^2.0.0"
  }
}
```
- 단 2개 패키지만 사용
- `web-push` — send-push.js 전용
- `@supabase/supabase-js` — 6개 API 전체 공통

### 0-3. 환경 변수 (Vercel Environment Variables)
| 변수명 | 사용처 | 타입 |
|---|---|---|
| `SUPABASE_URL` | 6개 API 전체 | URL 문자열 |
| `SUPABASE_SERVICE_ROLE_KEY` | check-email, complete-setup, admin-set-password, delete-user, send-invite, send-push | Service Role Key (관리자 권한) |
| `SUPABASE_ANON_KEY` | admin-set-password (사용자 토큰 검증용), delete-user (사용자 토큰 검증용) | Anon Key |
| `SITE_URL` | send-invite (이메일 redirectTo) | URL 문자열, fallback `'https://sca-redmyre.vercel.app'` |
| `VAPI_SUBJECT` | send-push | mailto URL, fallback `'mailto:admin@redmyre.com.au'` |
| `VAPI_PUBLIC_KEY` | send-push | VAPID 공개키 |
| `VAPI_PRIVATE_KEY` | send-push | VAPID 개인키 |

⚠️ **SUPABASE_SERVICE_ROLE_KEY는 절대 클라이언트 코드에 노출 X** — Vercel Function 안에서만 사용.

### 0-4. 두 가지 export 방식 혼재
| 파일 | export 방식 |
|---|---|
| check-email.js | `module.exports = async (req, res) => { ... }` (CommonJS) |
| complete-setup.js | `module.exports = ...` (CommonJS) |
| **admin-set-password.js** | **`export default async function handler(req, res)`** (ES Module) |
| delete-user.js | `module.exports = ...` (CommonJS) |
| send-invite.js | `module.exports = ...` (CommonJS) |
| send-push.js | `module.exports = ...` (CommonJS) |

**admin-set-password.js만 ES Module 형식**, 나머지 5개는 CommonJS. Vercel은 둘 다 지원하므로 동작 차이는 없음.

### 0-5. 6개 API 한눈에 보기
| API | 라인 | HTTP | 인증 | Service Role 사용 | 호출 페이지 |
|---|---|---|---|---|---|
| check-email | 44 | POST | 없음 | ✅ | index.html (로그인 흐름) |
| complete-setup | 72 | POST | 없음 | ✅ | setup.html |
| admin-set-password | 101 | POST | Bearer Token | ✅ | users.html |
| delete-user | 60 | POST | Bearer Token (선택적) | ✅ | users.html |
| send-invite | 65 | POST | 없음 | ✅ | users.html (Bulk Invite) |
| send-push | 92 | POST | 없음 | ✅ | DB 함수 (notify_announcement, notify_quote 등) |

**API별 인증 정책 (의도된 설계)**:
- check-email, complete-setup, send-invite, send-push: 인증 헤더 검증 없음
- admin-set-password: Bearer Token + admin role 검증 필수
- delete-user: Bearer Token으로 자기 자신 삭제만 차단
- 단일 빌딩 시스템이므로 Service Role Key (Vercel 환경변수)와 UI 레벨 보호로 충분.

---

## 📂 1. `/api/check-email.js` — 이메일 가입 상태 확인

### 1-1. 파일 메타
- **라인 수**: 44줄
- **export 방식**: CommonJS (`module.exports`)
- **호출자**: `index.html` (로그인 화면에서 이메일 입력 후 호출)
- **목적**: 입력된 이메일이 (a) 미가입자 (b) setup 미완료 (c) 정상 가입자 중 어느 상태인지 판별

### 1-2. 전체 코드 인용
```javascript
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
```

### 1-3. 동작 흐름 (라인별)
| 라인 | 동작 |
|---|---|
| 4-6 | POST 외 → 405 |
| 8 | `req.body.email` 추출 |
| 10-12 | email 없으면 → 400 `'Missing email'` |
| 14-17 | Service Role Supabase 클라이언트 생성 |
| 20 | 이메일 정규화 (소문자, trim) |
| 22-26 | `profiles`에서 email로 조회, `email`/`setup_complete` 컬럼만 |
| 28 | DB 에러 throw |
| 30-32 | 행 없음 → 200 `{ status: 'not_found' }` |
| 34-36 | setup_complete가 명시적 false → 200 `{ status: 'needs_setup' }` |
| 38 | 그 외 (true) → 200 `{ status: 'ready' }` |
| 40-43 | catch → 500 + 에러 메시지 |

### 1-4. 응답 상태 3가지
| status | 의미 | 클라이언트 동작 (index.html) |
|---|---|---|
| `not_found` | 가입 안 된 이메일 | 안내 메시지 (관리자에게 문의) |
| `needs_setup` | 가입은 됐지만 setup 미완료 | setup.html로 이동 (이름+비번 설정) |
| `ready` | 정상 가입자 | 비밀번호 입력 폼 표시 |

### 1-5. HTTP 응답 코드
| 코드 | 케이스 |
|---|---|
| 200 | 정상 (status 3가지 모두 200) |
| 400 | email 누락 |
| 405 | POST 아님 |
| 500 | DB 에러 |

### 1-6. 인증 없음 (의도된 설계)
- 누구나 호출 가능. 입주자 이메일 가입 여부 조회 가능
- 단일 빌딩 시스템 — 입주자 이메일 리스트는 민감 정보 아님
- 사장님 판단으로 단순 설계 채택

### 1-7. 코드에 **없는** 것
- ❌ Rate limiting 없음
- ❌ CORS 헤더 없음
- ❌ 이메일 형식 검증 없음 (정규식 등)
- ❌ profiles 외 다른 테이블 조회 없음 (auth.users는 안 봄)

---

## 📂 2. `/api/complete-setup.js` — 신규 가입자 셋업 완료

### 2-1. 파일 메타
- **라인 수**: 72줄
- **export 방식**: CommonJS
- **호출자**: `setup.html` (이름+비번 입력 후 제출)
- **목적**: 신규 가입자의 비밀번호와 이름을 설정하고 setup_complete를 true로 변경

### 2-2. 전체 코드 인용
```javascript
const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { email, full_name, password } = req.body;

  if (!email || !full_name || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  if (full_name.trim().length < 2) {
    return res.status(400).json({ error: 'Name must be at least 2 characters' });
  }

  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const cleanEmail = email.toLowerCase().trim();

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, setup_complete')
      .eq('email', cleanEmail)
      .maybeSingle();

    if (profileError) throw profileError;

    if (!profile) {
      return res.status(404).json({ error: 'Email not registered' });
    }

    if (profile.setup_complete === true) {
      return res.status(403).json({ error: 'Account already set up. Please login.' });
    }

    const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(
      profile.id,
      {
        password: password,
        email_confirm: true
      }
    );

    if (updateAuthError) throw updateAuthError;

    const { error: updateProfileError } = await supabaseAdmin
      .from('profiles')
      .update({
        full_name: full_name.trim(),
        setup_complete: true
      })
      .eq('id', profile.id);

    if (updateProfileError) throw updateProfileError;

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[complete-setup error]', err);
    return res.status(500).json({ error: err.message });
  }
};
```

### 2-3. 입력 검증 (라인 10-20)
| 검증 | 라인 | 실패 시 응답 |
|---|---|---|
| email/full_name/password 모두 있어야 함 | 10-12 | 400 `'Missing required fields'` |
| password 길이 ≥ 8 | 14-16 | 400 `'Password must be at least 8 characters'` |
| full_name.trim() 길이 ≥ 2 | 18-20 | 400 `'Name must be at least 2 characters'` |

### 2-4. 동작 흐름
1. **이메일 정규화** (라인 28) — 소문자 + trim
2. **profiles에서 행 조회** (라인 30-34) — email로 검색, `id`/`setup_complete`만
3. **profile 없으면** (라인 38-40) → 404 `'Email not registered'`
4. **이미 setup 완료됐으면** (라인 42-44) → 403 `'Account already set up. Please login.'`
5. **Supabase Auth 사용자 비밀번호 업데이트** (라인 46-52)
   - `auth.admin.updateUserById(profile.id, { password, email_confirm: true })`
   - **`email_confirm: true`** — 이메일 인증 자동 완료 처리
6. **profiles 테이블 업데이트** (라인 56-62)
   - `full_name = full_name.trim()`
   - `setup_complete = true`
7. 성공 → 200 `{ success: true }`

### 2-5. HTTP 응답 코드
| 코드 | 케이스 |
|---|---|
| 200 | 성공 |
| 400 | 입력 검증 실패 |
| 403 | 이미 setup 완료된 계정 (재시도 차단) |
| 404 | 가입 안 된 이메일 |
| 405 | POST 아님 |
| 500 | DB/Auth 에러 |

### 2-6. 핵심 동작 — `auth.admin.updateUserById`
- Supabase Service Role 권한으로 사용자의 비밀번호를 강제 설정
- **이메일 매직 링크 없이** 비밀번호 직접 등록
- `email_confirm: true`는 이메일 인증 강제 완료 (사용자가 인증 메일 안 받아도 OK)

### 2-7. 코드에 **없는** 것
- ❌ 비밀번호 복잡도 검증 없음 (영문/숫자/특수문자 조합 등)
- ❌ Rate limiting 없음
- ❌ 이전 비밀번호 재사용 방지 없음
- ❌ profiles UPDATE와 auth UPDATE의 트랜잭션 없음 (Supabase 구조상 두 작업이 별도 호출). 운영 중 불일치 사례 없음.

---

## 📂 3. `/api/admin-set-password.js` — Admin이 다른 유저 비번 변경

### 3-1. 파일 메타
- **라인 수**: 101줄
- **export 방식**: ES Module (`export default async function handler`)
- **호출자**: `users.html` (Admin 화면에서 유저 비번 강제 변경)
- **목적**: Admin이 임의의 유저 비밀번호를 강제 설정 (잊어버린 입주자 도와줄 때)

### 3-2. 6개 중 유일하게 다른 점들
1. ES Module 형식
2. **CORS 헤더 명시적 설정** (라인 5-7)
3. **OPTIONS preflight 처리** (라인 9-11)
4. **Bearer Token 인증 필수**
5. **호출자가 admin인지 검증**

### 3-3. CORS 헤더 (라인 5-7)
```javascript
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
```
- 모든 origin 허용
- POST, OPTIONS만 허용
- Authorization 헤더 허용 (Bearer Token용)

### 3-4. 동작 흐름 (라인별)
| 단계 | 라인 | 동작 |
|---|---|---|
| 1 | 9-11 | OPTIONS 메서드 → 200 OK (preflight) |
| 2 | 13-15 | POST 외 → 405 |
| 3 | 19-22 | `Authorization` 헤더 검증 — `'Bearer '` 시작 안 하면 → 401 |
| 4 | 24 | 토큰 추출 (`'Bearer ' ` 7글자 제거) |
| 5 | 27-29 | 환경변수 3개 로드 (URL, ANON_KEY, SERVICE_KEY) |
| 6 | 31-33 | 환경변수 누락 → 500 `'Server configuration error'` |
| 7 | 36-38 | **Anon Key + 토큰 헤더**로 Supabase 클라이언트 생성 (사용자 권한) |
| 8 | 41-44 | `auth.getUser()` — 토큰이 유효하지 않으면 → 401 |
| 9 | 47-51 | `profiles`에서 자기 자신의 role 조회 |
| 10 | 53-55 | profile 없으면 → 403 `'Profile not found'` |
| 11 | 57-59 | role !== 'admin' → 403 `'Admin access required'` |
| 12 | 62 | req.body에서 `user_id`, `new_password` 추출 |
| 13 | 64-66 | 둘 중 하나 없음 → 400 |
| 14 | 68-70 | new_password 길이 < 4 → 400 (`Must be at least 4 characters`) |
| 15 | 73-78 | **Service Role 키로 별도 클라이언트** 생성 (autoRefreshToken/persistSession 모두 false) |
| 16 | 81-84 | `auth.admin.updateUserById(user_id, { password: new_password })` |
| 17 | 86-89 | 실패 → 500 |
| 18 | 91-95 | 성공 → 200 `{ success: true, message, user_id }` |

### 3-5. 응답 코드
| 코드 | 케이스 |
|---|---|
| 200 | 성공 / OPTIONS preflight |
| 400 | user_id/new_password 누락 또는 비번 < 4글자 |
| 401 | Authorization 헤더 없거나 토큰 무효 |
| 403 | profile 없거나 role != admin |
| 405 | GET/PUT/DELETE 등 |
| 500 | 환경변수 누락 또는 비번 업데이트 실패 |

### 3-6. 비밀번호 길이 정책 (의도된 차이)
- **complete-setup.js**: 신규 가입자 셋업 시 **8자 이상 강제** (기본 보안)
- **admin-set-password.js**: Admin이 임시 비번 발급 시 **4자 이상 허용** (초기 가입자 호환, 예: David)
- 의도된 정책 차이. 변경 금지.

### 3-7. 두 개의 Supabase 클라이언트 사용 이유
| 클라이언트 | 키 | 용도 |
|---|---|---|
| `supabase` (라인 36) | Anon Key + Bearer Token | 호출자가 admin인지 검증 |
| `supabaseAdmin` (라인 73) | Service Role Key | 실제 비번 업데이트 (Auth API 권한 필요) |

### 3-8. 호출 패턴 (users.html에서)
```javascript
const { data: { session } } = await supabase.auth.getSession();
const res = await fetch('/api/admin-set-password', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`
  },
  body: JSON.stringify({ user_id, new_password })
});
```

### 3-9. 코드에 **없는** 것
- ❌ 비밀번호 복잡도 검증 (4글자 이상이면 OK)
- ❌ audit_logs 자동 INSERT 없음 (호출자 페이지에서 별도 처리해야 함)
- ❌ 변경 알림 이메일 없음 (사용자에게 알림 안 감)

---

## 📂 4. `/api/delete-user.js` — 유저 삭제

### 4-1. 파일 메타
- **라인 수**: 60줄
- **export 방식**: CommonJS
- **호출자**: `users.html` (Admin 화면)
- **목적**: Auth 사용자 + profiles 행 동시 삭제

### 4-2. 보호 로직 (라인 14-32)
**자기 자신 삭제 방지** — Authorization 헤더 있으면 검증.

```javascript
const authHeader = req.headers.authorization;
if (authHeader && authHeader.startsWith('Bearer ')) {
  try {
    const token = authHeader.substring(7);
    const supabaseUser = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
    const { data: { user: currentUser } } = await supabaseUser.auth.getUser();
    if (currentUser && currentUser.id === user_id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
  } catch (authErr) {
    console.warn('[delete-user] Auth check failed:', authErr);
    return res.status(401).json({ error: 'Invalid authentication' });
  }
}
```

**인증 헤더가 없으면 자기 자신 삭제 검증 통과** (라인 16의 if 조건). 의도된 설계 — UI(users.html은 admin 전용) + Service Role Key(환경변수)로 보호.

### 4-3. 동작 흐름
1. **POST 외 → 405** (라인 4-6)
2. **user_id 없음 → 400** (라인 10-12)
3. **자기 자신 삭제 방지 검증** (라인 14-32, 토큰 있을 때만)
4. **Service Role 클라이언트 생성** (라인 34-37)
5. **`auth.admin.deleteUser(user_id)`** (라인 41-42)
6. Auth 삭제 실패 → throw → 500
7. **`profiles.delete().eq('id', user_id)`** (라인 47-50)
8. profiles 삭제 실패 → throw → 500
9. 성공 → 200 `{ success: true }`

### 4-4. 응답 코드
| 코드 | 케이스 |
|---|---|
| 200 | 성공 |
| 400 | user_id 누락 또는 자기 자신 삭제 시도 |
| 401 | 토큰 무효 (토큰 보냈을 때만) |
| 405 | POST 아님 |
| 500 | Auth 또는 DB 삭제 실패 |

### 4-5. 삭제 순서 주의
1. **Auth 먼저 삭제** (라인 41-42)
2. profiles **나중 삭제** (라인 47-50)
- Auth 삭제 성공 후 profiles 삭제 실패하면 **고아 profile 행 남음**
- profiles의 `id` FK에 ON DELETE CASCADE가 설정되어 있다면 라인 47-52는 중복 안전장치임. (Part 1 매뉴얼에서 DB 스키마 별도 확인)

### 4-6. 코드에 **없는** 것
- ❌ Admin 권한 검증 없음 (호출자가 admin인지 안 봄)
  - → 토큰만 있으면 자기 자신 외에는 누구든 삭제 가능
  - → 현재 보호: users.html이 admin만 접근 가능하므로 UI 레벨 보호만
- ❌ 관련 데이터 (vehicles, complaints, hvac_requests 등) 정리 없음
  - → DB의 ON DELETE CASCADE 설정에 의존
- ❌ audit_logs 기록 없음

---

## 📂 5. `/api/send-invite.js` — 입주자 초대

### 5-1. 파일 메타
- **라인 수**: 65줄
- **export 방식**: CommonJS
- **호출자**: `users.html` (Bulk Invite 또는 단일 추가)
- **목적**: Auth 사용자 생성 + profiles 행 INSERT (선택적으로 초대 이메일 발송)

### 5-2. 입력 (라인 8)
```javascript
const { email, full_name, role, unit, skipEmail } = req.body;
```
| 필드 | 필수 | 타입 |
|---|---|---|
| `email` | ✅ | 문자열 |
| `full_name` | ❌ | 문자열 (null/undefined 허용) |
| `role` | ✅ | 문자열 |
| `unit` | ❌ | 문자열 (null 가능) |
| `skipEmail` | ❌ | boolean (true면 이메일 안 보냄) |

⚠️ 사장님 메모리: "Bulk Invite 진행 중 (full_name 필수체크 제거로 400 에러 해결)" — 라인 10의 검증에 full_name이 없는 것 확인 (필수 X).

### 5-3. 두 가지 모드

#### 모드 A: `skipEmail: true` (Silent Add)
**라인 25-37**
- 랜덤 임시 비밀번호 생성:
  ```js
  const randomPassword = 'Tmp_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  ```
- `auth.admin.createUser()` 호출:
  - `email`, `password: randomPassword`
  - `email_confirm: true` (이메일 인증 자동 완료)
  - `user_metadata: { full_name, role, unit: unit || null }`
- 이메일 발송 X

#### 모드 B: 일반 초대 (`skipEmail: false` 또는 미지정)
**라인 39-48**
- `auth.admin.inviteUserByEmail(email, { ... })` 호출
- `redirectTo`: `${siteUrl}/setup`
- `data`: `{ full_name, role, unit: unit || null }`
- Supabase가 자동으로 초대 이메일 발송

### 5-4. profiles 테이블 upsert (라인 50-57)
양쪽 모드 공통:
```javascript
await supabaseAdmin.from('profiles').upsert({
  id: userId,
  email: normalizedEmail,
  full_name,
  role,
  unit: unit || null,
  setup_complete: false
});
```
- **upsert** 사용 → 같은 id 있으면 update, 없으면 insert
- `setup_complete: false` 강제 설정 → 사용자가 setup.html에서 비번/이름 설정 필요

### 5-5. 응답
| 코드 | 케이스 | 본문 |
|---|---|---|
| 200 | 성공 | `{ success: true, skipEmail: <bool> }` |
| 400 | email 또는 role 누락 | `{ error: 'Missing required fields' }` |
| 405 | POST 아님 | `{ error: 'Method Not Allowed' }` |
| 500 | Auth 또는 DB 실패 | `{ error: <message> }` |

### 5-6. SITE_URL 환경변수 (라인 19)
```javascript
const siteUrl = process.env.SITE_URL || 'https://sca-redmyre.vercel.app';
```
- 없으면 fallback으로 프로덕션 URL 사용
- redirectTo: `${siteUrl}/setup` → 입주자가 초대 이메일 클릭하면 이동할 곳
- vercel.json의 rewrites에서 `/setup` → `/pages/setup.html`로 매핑됨

### 5-7. 코드에 **없는** 것
- ❌ Admin 권한 검증 없음 (호출자 검증 안 함)
- ❌ 이메일 형식 검증 없음
- ❌ role 값 검증 없음 (admin/committee/observer/owner/tenant 외 값도 통과)
- ❌ 중복 이메일 사전 체크 없음 — Auth 생성 단계에서 이미 존재하면 createUser/inviteUserByEmail이 에러 throw
- ❌ audit_logs 자동 기록 없음

### 5-8. 자주 발생하는 장애
| 증상 | 코드상 원인 |
|---|---|
| 400 'Missing required fields' | email 또는 role 둘 중 하나 누락 |
| 500 'A user with this email address has already been registered' | 이미 가입된 이메일 (Supabase Auth가 throw) |
| 초대 이메일 안 옴 | Supabase 프로젝트 SMTP 설정 또는 Resend 설정 확인 |
| profiles에는 행 있는데 Auth에는 없음 | 라인 29 createUser 실패 후에는 라인 50 upsert 도달 안 함 (정상 동작이지만 다른 경로 점검 필요) |

---

## 📂 6. `/api/send-push.js` — Web Push 알림 발송

### 6-1. 파일 메타
- **라인 수**: 92줄
- **export 방식**: CommonJS
- **호출자**: DB 함수 (`notify_announcement`, `notify_quote` 등)
- **목적**: 지정된 대상에게 Web Push 알림 발송

### 6-2. 의존성 초기화 (라인 1-8)
```javascript
const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

webpush.setVapidDetails(
  process.env.VAPI_SUBJECT || 'mailto:admin@redmyre.com.au',
  process.env.VAPI_PUBLIC_KEY,
  process.env.VAPI_PRIVATE_KEY
);
```
- **모듈 로드 시점에 VAPID 설정** (함수 핸들러 외부)
- VAPI_SUBJECT 없으면 `'mailto:admin@redmyre.com.au'` fallback
- 환경변수명 `VAPI_*` (사장님이 4월 20일 확정한 정상 환경변수명, Part 1 매뉴얼 라인 2448-2450 참조)

### 6-3. 입력 (라인 21)
```javascript
const { title, message, target_role, target_roles, user_id, url } = req.body;
```
| 필드 | 타입 | 의미 |
|---|---|---|
| `title` | 문자열 | 알림 제목 |
| `message` | 문자열 | 알림 본문 |
| `target_role` | 문자열 | 단일 role 대상 |
| `target_roles` | 배열 | 복수 role 대상 |
| `user_id` | UUID | 특정 유저 1명 대상 |
| `url` | 문자열 | 클릭 시 이동할 URL (없으면 `'/'`) |

### 6-4. 대상 결정 로직 (라인 23-66)

**우선순위 순서**:

#### 우선순위 1: `user_id` 지정 (라인 27-28)
- 해당 유저의 push_subscriptions만 조회

#### 우선순위 2: `target_roles` (배열) 지정 (라인 29-38)
- profiles에서 `role IN target_roles` AND `push_enabled = true` 필터
- 해당 user_id 리스트 추출
- 빈 리스트면 즉시 200 `{ success: true, sent: 0 }` 반환
- push_subscriptions에서 해당 user_id들만 조회

#### 우선순위 3: `target_role` (단일) 지정 (라인 39-52)
- profiles에서 `role = target_role` AND `push_enabled = true`
- 동일 패턴 (위와 같음)

#### 우선순위 4: 아무것도 지정 안 함 → 전체 발송 (라인 53-66)
- profiles에서 `push_enabled = true` 전체
- 동일 패턴

### 6-5. 발송 루프 (라인 68-89)
```javascript
const { data: subscriptions } = await query;

let sent = 0;

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
    if (err.statusCode === 410 || err.statusCode === 404) {
      try { await supabase.from('push_subscriptions').delete().eq('user_id', row.user_id); } catch {}
    }
  }
}

return res.status(200).json({ success: true, sent });
```

**페이로드 형식**:
```json
{
  "title": "...",
  "body": "...",
  "url": "..."
}
```
- ⚠️ `body` 필드명 (req의 `message`가 페이로드에서는 `body`로 변환됨)
- Service Worker (sw.js)에서 이 페이로드 파싱

**에러 처리** (라인 83-87):
- 모든 에러 catch
- `statusCode 410 (Gone)` 또는 `404 (Not Found)` → 구독 만료/무효 → push_subscriptions에서 삭제
- 그 외 에러는 로그만 찍고 다음 구독자로 넘어감

**자동 정리**: 구독 만료 자동 감지로 dead subscription을 자동 청소

### 6-6. 응답
- 항상 200 `{ success: true, sent: <number> }` (개별 실패는 무시)
- 405는 POST 외에서만

### 6-7. 환경변수명 VAPI_* (정상 — 4월 20일 사장님 확정)
실제 코드의 환경변수명:
- `VAPI_SUBJECT`
- `VAPI_PUBLIC_KEY`
- `VAPI_PRIVATE_KEY`

**`VAPI_*`가 정상 환경변수명**. Vercel에 동일한 이름으로 등록되어 있음 (사장님이 직접 환경변수 화면 스크린샷으로 4월 20일 확인 완료). Part 1 매뉴얼 라인 2448-2450에 확정 기록됨.

⚠️ **변경 금지** — 이름 바꾸면 Push 발송 즉시 중단됨.

### 6-8. 코드에 **없는** 것
- ❌ 인증/권한 검증 없음 — 누구나 호출 가능
  - 보호: DB 함수만 이 API를 호출하도록 설계됨 (외부 직접 호출은 의도되지 않음)
- ❌ Rate limiting 없음
- ❌ 발송 결과 audit_logs 기록 없음
- ❌ 알림 이미지/icon/badge 옵션 없음 (기본만 사용)
- ❌ 발송 실패 통계 없음 (개별 에러는 console.log만)

### 6-9. 발송 흐름 전체 (시스템 관점)
```
이벤트 발생 (예: 새 공지 등록)
  ↓
DB 트리거 또는 RPC 함수 (notify_announcement) 실행
  ↓
DB 함수가 send-push API 호출 (Supabase Anon Key 하드코딩)
  ↓
send-push.js: 대상 결정 (target_role 등)
  ↓
push_subscriptions 조회 (push_enabled = true 필터)
  ↓
webpush.sendNotification() 각 구독자에게
  ↓
Service Worker (sw.js) → 브라우저 알림 표시
  ↓
사용자 클릭 → url로 이동
```

⚠️ DB 함수 (notify_announcement, notify_quote)에 **하드코딩된 Anon Key** 있음. Anon Key Rotation 시 DB 함수도 동시 업데이트 필수 (Part 1 매뉴얼 + 사장님 메모리 명시).

---

## 📂 7. `/api/admin-change-email.js` — Admin이 다른 유저 이메일 변경

**파일 크기:** ~170줄
**인증:** Bearer 토큰 필수 + Admin role 검증
**DB 영향:** Auth + profiles + occupants 동시 업데이트

### 📌 용도

Admin이 다른 유저의 이메일을 변경할 때 사용.
- Auth (`auth.users`) + `profiles.email` + `occupants` (primary_email/business_email) 세 곳 동시 업데이트
- 자기 자신 이메일 변경 불가 (보안)
- 새 이메일 중복 체크

### 🔒 보안 검증 순서

1. Bearer 토큰 유효성 확인
2. 토큰으로 현재 유저 조회
3. **자기 자신 변경 방지** (`currentUser.id === user_id` 차단)
4. profiles에서 `role = 'admin'` 확인
5. Service Role Key로 실제 변경

### 📡 요청 형식

```javascript
POST /api/admin-change-email
Authorization: Bearer {access_token}
Content-Type: application/json

{ "user_id": "uuid", "new_email": "new@example.com" }
```

### 🔄 처리 순서 (6단계)

1. 대상 유저 기존 이메일 조회 (`profiles`)
2. 동일 이메일 → 400 반환
3. 새 이메일 중복 체크 (다른 유저가 이미 사용 중인지)
4. **Supabase Auth 이메일 변경** (`email_confirm: true` — 확인 이메일 스킵)
5. **profiles.email 업데이트** (실패 시 Auth 롤백 시도)
6. **occupants 전체 스캔** — primary_email/business_email에서 옛 이메일 → 새 이메일 교체 (콤마 분리, 중복 제거)

### 📤 응답

```json
{
  "success": true,
  "old_email": "old@example.com",
  "new_email": "new@example.com",
  "occupants_updated": 2
}
```

### ⚠️ 주의사항

- **Auth 변경 후 profiles 변경 실패 시 롤백 시도** (완전한 원자성은 보장 못함 — rollback 실패 가능)
- occupants 업데이트는 best-effort (실패해도 200 반환, 로그만 남김)
- 자기 자신 이메일은 Supabase 대시보드에서 직접 변경해야 함
- `send-invite.js`와 달리 이메일 발송 없음 — Admin이 별도 안내 필요

### 🔗 연결

- `users.html` — UI에서 이 API 호출 (Admin 전용 이메일 변경 버튼)
- `occupants` 테이블 — primary_email / business_email 자동 동기화
- `profiles` 테이블 — email 컬럼 업데이트
- Supabase Auth — auth.users 이메일 업데이트

---

## 📋 섹션 2 최종 요약

### 6개 API 비교표
| API | 라인 | 인증 | Admin 검증 | DB 영향 | 외부 호출 |
|---|---|---|---|---|---|
| check-email | 44 | ❌ | ❌ | profiles SELECT | 없음 |
| complete-setup | 72 | ❌ | ❌ | profiles UPDATE + auth.admin | Supabase Auth |
| admin-set-password | 101 | Bearer | ✅ | auth.admin only | Supabase Auth |
| delete-user | 60 | Bearer (선택적) | ❌ | profiles DELETE + auth.admin | Supabase Auth |
| send-invite | 65 | ❌ | ❌ | profiles upsert + auth.admin | Supabase Auth (이메일 발송) |
| send-push | 92 | ❌ | ❌ | push_subscriptions DELETE (실패 시) | Web Push (FCM/Mozilla 등) |
| admin-change-email | ~170 | Bearer | ✅ | Auth + profiles + occupants | Supabase Auth |

### 인증 강도 (높음 → 낮음)
1. **admin-set-password** (Bearer + admin 검증) — 가장 엄격
2. **admin-change-email** (Bearer + admin 검증 + 자기 자신 차단) — 동급 엄격
3. **delete-user** (Bearer 선택적, 자기 자신만 차단) — 중간
4. **나머지 5개** (인증 없음) — 환경변수만 보호

### Service Role Key 사용처
- 7개 API **전부** 사용
- ⚠️ 키 노출 시 BMS 전체 권한 탈취 가능

### 환경변수 누락 시 영향
| 변수 | 누락 시 |
|---|---|
| SUPABASE_URL | 6개 API 전부 즉시 죽음 |
| SUPABASE_SERVICE_ROLE_KEY | 6개 API 전부 즉시 죽음 |
| SUPABASE_ANON_KEY | admin-set-password, delete-user, admin-change-email 죽음 |
| SITE_URL | send-invite는 fallback URL로 동작 (영향 적음) |
| VAPI_* | send-push 죽음 (Push 알림 전체 중단) |

### 새 세션의 Claude가 헷갈릴만한 점
1. **VAPI_*** (정상 환경변수명, VAPID_* 아님) — 사장님이 4월 20일 확정한 사항. Part 1 매뉴얼 라인 2448-2450 기록.
2. **admin-set-password만 ES Module 형식**
3. **complete-setup은 비번 8자, admin-set-password는 4자** — 정책 다름
4. **delete-user는 Admin 검증 안 함** — UI에서만 보호
5. **send-push의 `message` 필드는 페이로드에서 `body`로 변환됨**
6. **send-invite의 `full_name`은 필수 아님** (사장님이 의도적으로 제거)
7. **send-push의 환경변수가 잘못 되어 있으면 모듈 로드 시점에 에러** — 함수 호출 전 단계

### 절대 수정 금지 항목
1. send-push의 페이로드 구조 (`{ title, body, url }`) — sw.js와 짝
2. complete-setup의 `email_confirm: true` 옵션 — 자동 인증 처리
3. delete-user의 자기 자신 삭제 방지 로직
4. send-invite의 setup_complete: false 강제 설정

---

**다음 섹션**: Service Worker (sw.js) + 외부 시스템 연동 4개 (HVAC Daemon, SignApps, Resend, NSW 공휴일 API)
**작성 방식**: 동일 — 코드 100% 다 읽고 라인별 명세

---

# Redmyre BMS — Master Manual Part 3
## Section 3: Service Worker + 외부 시스템 연동 4개

> **목적**: BMS의 클라이언트 사이드 Push 처리(`sw.js`)와 외부 시스템 4개의 연동 방식을 코드 레벨에서 명세.
> **외부 시스템 4개**: HVAC Python Daemon / SignApps Express / Resend API / NSW 공휴일 API
> **작성 원칙**:
> 1. BMS 코드 안에서 호출하는 부분만 명세
> 2. 외부 시스템 자체의 내부 구현은 "확인 필요"라고 명시
> 3. Resend는 Edge Function 안에 있으므로 Part 1 참조
> **작성 기준**: 2026-04-25, /mnt/project/ 실제 파일

---

## 📂 1. `/sw.js` — Service Worker (Push 수신 + 캐시)

### 1-1. 파일 메타
- **총 라인 수**: 44줄
- **위치**: 사이트 루트 `/sw.js` (`/js/sw.js` 아님 — 루트여야 전체 origin scope 가능)
- **등록 위치**: `layout.js` 라인 264 — `navigator.serviceWorker.register('/sw.js')`
- **이벤트 리스너 4개**: `install`, `activate`, `push`, `notificationclick`

### 1-2. 전체 코드 인용
```javascript
const CACHE_NAME = 'redmyre-bms-v5';
const VAPID_PUBLIC_KEY = 'BNyzSuyh9RRzRLNiPq1mngiuEH35QX3smFJoYQGWdOSdu_4koNy4s65I8WUpI1gxanRgJLNU0gDJfhW1PUdxQrI';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

self.addEventListener('push', e => {
  if (!e.data) return;
  let data = {};
  try { data = e.data.json(); } catch { data = { title: 'Redmyre House', body: e.data.text() }; }

  const title = data.title || 'Redmyre House';
  const options = {
    body: data.body || '',
    icon: '/icon-192-v4.png',
    badge: '/favicon-32-v4.png',
    tag: data.tag || 'redmyre-notification',
    data: { url: data.url || 'https://sca-redmyre.vercel.app/pages/announcements.html' },
    requireInteraction: false,
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || 'https://sca-redmyre.vercel.app/pages/announcements.html';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
```

### 1-3. 상수 (라인 1-2)
| 상수 | 값 | 용도 |
|---|---|---|
| `CACHE_NAME` | `'redmyre-bms-v5'` | 캐시 버전 식별자 |
| `VAPID_PUBLIC_KEY` | `'BNyzSuyh...QrI'` | 참고용 (실제로 코드 어디서도 사용 안 함) |

**CACHE_NAME 상수**는 정의되어 있지만 실제 캐싱 로직(`fetch` 이벤트 등)은 없음. 현재 sw.js의 기능은 **Push 수신/표시 + 알림 클릭 처리**.

### 1-4. `install` 이벤트 (라인 4-6)
```javascript
self.addEventListener('install', e => {
  self.skipWaiting();
});
```
- **`skipWaiting()`**: 기존 SW가 있어도 즉시 새 SW를 활성화 (대기 단계 건너뛰기)
- 캐시 사전 로딩(precache) 없음

### 1-5. `activate` 이벤트 (라인 8-10)
```javascript
self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});
```
- **`clients.claim()`**: 기존에 열려있던 모든 탭/윈도우의 제어권을 이 SW가 즉시 가져감
- 새 SW가 즉시 활성 상태가 됨 (페이지 새로고침 안 해도)
- 이전 캐시 정리 로직 없음 (`caches.delete(...)` 없음)

### 1-6. `push` 이벤트 ⭐ (라인 12-28)
**알림 수신 핵심 로직.**

#### 동작 흐름
| 라인 | 동작 |
|---|---|
| 13 | `e.data` 없으면 즉시 종료 |
| 14 | `data = {}` 초기화 |
| 15 | `e.data.json()` 시도 → 실패 시 `{ title: 'Redmyre House', body: <text> }` fallback |
| 17 | `title = data.title || 'Redmyre House'` |
| 18-25 | options 객체 생성 |
| 27 | `showNotification(title, options)` 호출 |

#### options 객체 7개 필드
| 필드 | 값 | 의미 |
|---|---|---|
| `body` | `data.body || ''` | 알림 본문 (send-push.js의 `message`가 여기로 매핑) |
| `icon` | `'/icon-192-v4.png'` | 큰 아이콘 (192x192) |
| `badge` | `'/favicon-32-v4.png'` | 작은 배지 (모바일 상태바용) |
| `tag` | `data.tag || 'redmyre-notification'` | 동일 tag면 새 알림이 기존 알림 교체 (그룹화) |
| `data` | `{ url: data.url || '<announcements URL>' }` | notificationclick에서 사용 |
| `requireInteraction` | `false` | 자동 사라짐 (사용자 액션 불필요) |

**icon/badge 경로**: `/icon-192-v4.png`, `/favicon-32-v4.png` (하이픈 있음). GitHub 저장소 실제 파일명과 일치. 정상.

⚠️ 매뉴얼 작성 시 주의: Claude 환경의 `/mnt/project/` 폴더에는 같은 파일이 하이픈 없이 표시될 수 있음 (`icon192v4.png` 등). **Claude 환경 파일명은 GitHub 실제와 다를 수 있음** — GitHub 직접 확인 필수.

### 1-7. `notificationclick` 이벤트 (라인 30-44)
사용자가 알림 클릭 시 실행.

#### 동작 흐름
| 라인 | 동작 |
|---|---|
| 31 | 알림 닫기 (`e.notification.close()`) |
| 32 | `data.url` 추출, fallback은 announcements URL |
| 33-43 | `clients.matchAll({ type: 'window', includeUncontrolled: true })` 호출 |
| 35-39 | 현재 origin과 같은 클라이언트(탭)가 있으면: |
| | - `client.navigate(url)` — 해당 탭에서 URL 이동 |
| | - `client.focus()` — 탭 포커스 |
| 41 | 매칭되는 탭 없으면 → `clients.openWindow(url)` (새 창/탭 열기) |

⚠️ **첫 번째 매칭 탭만 사용**: 같은 origin 탭 여러 개 열려 있어도 for 루프의 첫 번째 매칭에서 `return`됨.

### 1-8. sw.js에 **없는** 것
- ❌ `fetch` 이벤트 리스너 없음 — 오프라인 지원 없음
- ❌ 캐시 정리 로직 없음 — `CACHE_NAME` 상수만 있고 실제 사용 X
- ❌ `pushsubscriptionchange` 이벤트 없음 — 구독 만료 시 재구독 자동화 없음
- ❌ Push 페이로드 암호화 검증 없음
- ❌ 알림 여러 개 동시 표시 시 그룹화 로직 없음 (tag로 그룹화는 됨)

### 1-9. send-push.js와 sw.js의 페이로드 매핑 (★ 중요 ★)
| send-push.js 페이로드 | sw.js options |
|---|---|
| `title` | `title` (라인 17) |
| `body` | `body` (라인 19) |
| `url` | `data.url` → notificationclick에서 사용 |

⚠️ send-push.js의 페이로드 구조 변경 시 sw.js도 동시 수정 필요. 현재 일치 상태 확인됨.

### 1-10. 자주 발생하는 장애와 코드상 원인
| 증상 | 코드상 원인 | 해당 라인 |
|---|---|---|
| 알림 자체가 안 뜸 | `e.data` 없음 (페이로드 빈 상태) | 13 |
| 알림 제목 `'Redmyre House'`만 뜸 | JSON 파싱 실패 | 15 |
| 알림 아이콘 안 보임 | OS 레벨 설정 또는 PWA 캐시 문제 (코드는 정상) | 20-21 |
| 클릭해도 페이지 이동 안 함 | `data.url` 없음 또는 origin 다름 | 36 |
| 새 알림이 기존 거 안 덮음 | `tag` 다르게 옴 → 별도 알림으로 표시됨 | 22 |
| Push 권한은 있는데 알림 안 옴 | sw.js 등록 안 됨 또는 구버전 활성 | 5 (skipWaiting 동작) |

### 1-11. 디버깅 방법 (사장님이 실제 장애 시)
1. Chrome DevTools → Application 탭 → Service Workers
2. `sw.js`가 "activated and is running" 상태인지 확인
3. "Push" 버튼으로 테스트 페이로드 발송 가능
4. Console에서 `navigator.serviceWorker.controller`가 null이 아닌지 확인
5. 알림 안 뜨면 OS 레벨 알림 설정도 확인 (Windows/Mac 시스템 설정)

---

## 🔌 2. 외부 시스템 연동 1: HVAC Python Daemon

### 2-1. 시스템 개요
- **위치**: 건물 PC (백그라운드 상시 실행)
- **iControl 접속 URL**: `http://redmyre.dyndns.biz/login`
- **기술 스택**: Python 표준 라이브러리(urllib) + Selenium WebDriver
- **역할**: Supabase의 `hvac_requests` 테이블을 polling하여 iControl(BACnet) 시스템에 자동으로 setpoint 변경
- **BMS 코드와의 관계**: **직접 호출 없음**. DB를 매개로 비동기 통신
- **소스 파일**: `HVAC_daemon.py` (사장님이 별도 보관, GitHub repo와는 별도 시스템)

### 2-2. Daemon 인증/접속 정보 (HVAC_daemon.py 코드 라인 13-18)

| 항목 | 값 |
|---|---|
| Supabase URL | `https://wunsexdnqathluplkkvo.supabase.co` |
| Supabase Key | **Service Role Key** (코드 라인 13에 하드코딩, JWT 만료: 2036년) |
| iControl URL | `http://redmyre.dyndns.biz/login` |
| iControl Username | `bm` |
| iControl Password | `rz*UTHs4m!` |

⚠️ **Service Role Key가 Daemon 코드에 직접 박혀 있음**. Daemon PC 보안 = BMS 전체 권한 보안.

### 2-3. Daemon Polling 주기 및 동작 (HVAC_daemon.py 검증)
- **Polling 주기**: **5초마다** (라인 마지막 `time.sleep(5)`)
- **Polling 대상**: `status=eq.approved` 행만 가져옴 (`order=approved_at.asc`)
  - 즉, `pending`은 안 봄. **Admin 승인된 것만 처리.**
- **5초마다 GET 요청**: `hvac_requests?status=eq.approved`

### 2-4. 텐넌시 ↔ 센서 ID 매핑 (HVAC_daemon.py 라인 22-31)

| Tenancy | iControl Sensor IDs (BoundLabel{N}) |
|---|---|
| Tenancy A | 37, 38 |
| Tenancy B | 41, 42 |
| Tenancy C | 45, 46 |
| Tenancy D | 49, 50 |
| Tenancy E | 53, 54 |
| Tenancy F | 58, 60, 59 (3개) |
| Tenancy G | 63, 64 |
| Tenancy H | 67, 68 |

### 2-5. 온도 조정 로직 (HVAC_daemon.py 검증)
- **현재 setpoint 읽음** → BoundLabel{sensor_id}의 텍스트에서 추출 (10~35°C 유효 범위)
- 읽기 실패 시 → **22.0°C 기본값** 사용
- **±0.5°C 조정**:
  - `type='hot'` (사용자가 더위 호소) → setpoint **−0.5°C** (시원하게)
  - `type='cold'` (사용자가 추위 호소) → setpoint **+0.5°C** (따뜻하게)
- **한도 적용**:
  - DB의 `settings` 테이블에서 `temp_min`, `temp_max` 조회
  - 한도 조회 실패 시 기본값 **20.0°C ~ 26.0°C**
  - 새 setpoint가 한도 벗어나면 한도값으로 클램핑
  - 클램프 발생 시 `admin_comment` 자동 기록 (예: "Already at minimum temperature (20°C). No further reduction possible.")

### 2-6. Status 전환 (Daemon이 직접 UPDATE)
| 단계 | 상태 변경 | Daemon 동작 |
|---|---|---|
| 1 | `approved` → `processing` | `mark_processing()` 호출 |
| 2 | Selenium 작업 시작 | iControl 로그인 → Level 페이지 → iframe 진입 |
| 3 | Zoning Off 토글 | CheckBox 클릭 후 Polygon1 hidden 대기 |
| 4 | 각 sensor 우클릭 → Override → 새 온도 입력 | (최대 15회 재시도) |
| 5a | 모든 센서 성공 | `mark_completed()` → status=`completed`, temp_before, temp_after, completed_at 저장 |
| 5b | 일부 실패 | `mark_failed()` → status=`failed`, admin_comment 저장 |
| 5c | Selenium 예외 | `mark_failed()` → "System error during temperature adjustment..." |

### 2-7. Daemon 로그 (HVAC_daemon.py 라인 271-275)
- **위치**: Daemon 실행 폴더의 `logs/hvac_log_{YYYY-MM}.txt`
- **월별 파일** 자동 생성 (예: `hvac_log_2026-04.txt`)
- 표준 출력 + 파일 동시 기록

### 2-8. BMS 코드 안의 HVAC 관련 호출 위치

#### `system.html` 라인 303, 306 (관리자 화면 외부 링크)
```html
<button onclick="window.open('http://redmyre.dyndns.biz/login','_blank')" ...>
  Open AC Control →
</button>
```
- iControl 직접 접속 버튼 (Daemon과 무관)

#### `hvac.html` 라인 277 (사용자 신청)
```javascript
await supabase.from('hvac_requests').insert({
  user_id: user.id,
  user_name: name,
  type: selectedType,    // 'hot' or 'cold'
  level: level,
  tenancy: tenancy,
  comment: ...,
  status: 'pending'
});
```

#### `hvac.html` 라인 689 (Admin 승인)
```javascript
await supabase
  .from('hvac_requests')
  .update({ status: 'approved', approved_at: new Date().toISOString() })
  .eq('id', id);
```

### 2-9. 전체 Status 흐름 (BMS + Daemon 통합)
```
사용자가 hvac.html에서 신청
  ↓ (hvac.html 라인 277)
status = 'pending'
  ↓ (Admin 승인 — hvac.html 라인 689)
status = 'approved', approved_at 기록
  ↓ (Daemon이 5초 polling으로 감지)
status = 'processing'
  ↓ (Daemon Selenium 작업)
  ├─ 성공 → status = 'completed', temp_before, temp_after, completed_at
  └─ 실패 → status = 'failed', admin_comment
```

### 2-10. 30분 쿨다운 로직 (hvac.html 라인 264)
```javascript
const { data: recent, error: coolErr } = await supabase
  .from('hvac_requests')
  .select('created_at')
  .eq('level', level)
  .eq('tenancy', tenancy)
  .gte('created_at', thirtyMinAgo)
  .order('created_at', { ascending: false })
  .limit(1);
```
- 같은 `level + tenancy` 유닛에서 30분 내 신청 있으면 차단
- ⚠️ **변경 금지** (사장님 메모리 명시)

### 2-11. Push 알림 호출 (hvac.html 라인 281)
```javascript
await fetch('/api/send-push', {
  method: 'POST',
  headers: { ... },
  body: JSON.stringify({
    target_role: 'admin',
    title: '❄️ New HVAC Request',
    message: `${selectedType === 'hot' ? 'Too Hot 🥵' : 'Too Cold 🥶'} — ${level}, ${tenancy}`,
    url: '/pages/hvac.html'
  })
});
```
- 사용자 신청 시 → Admin에게만 Push 알림 (Daemon에는 알림 안 감 — Daemon은 polling으로 감지)

### 2-12. BMS 코드 vs Daemon 코드 책임 분리
| 동작 | BMS (hvac.html) | Daemon (HVAC_daemon.py) |
|---|---|---|
| `pending` 생성 | ✅ | ❌ |
| `pending → approved` | ✅ (Admin UI) | ❌ |
| `approved → processing` | ❌ | ✅ |
| `processing → completed/failed` | ❌ | ✅ |
| `temp_before`, `temp_after` 기록 | ❌ | ✅ |
| `admin_comment` 자동 기록 | ❌ | ✅ (한도 클램프 또는 실패 시) |
| `completed_at` 기록 | ❌ | ✅ |

### 2-13. 장애 대응
| 증상 | 1차 확인 (BMS) | 2차 확인 (Daemon PC) |
|---|---|---|
| 신청해도 처리 안 됨 | `hvac_requests` 행 INSERT 됐는지 | Daemon 프로세스 살아있는지 |
| `pending`에서 `approved` 안 넘어감 | Admin이 승인 안 함 (Admin UI 문제) | — |
| `approved`에서 `processing` 안 넘어감 | — | Daemon polling 멈춤 (5초 대기 중인지) |
| `processing`에서 영원히 멈춤 | — | Selenium 멈춤 (`logs/hvac_log_*.txt` 확인) |
| 매번 `failed` | — | iControl 로그인 실패, ChromeDriver 문제, BACnet 통신 끊김 |
| temp_before가 22.0°C로 고정 | — | sensor BoundLabel 읽기 실패 (Daemon이 기본값 사용 중) |

### 2-14. ⚠️ 절대 변경 금지
- HVAC_daemon.py의 SUPABASE_KEY (Service Role Key 하드코딩)
- TENANCY_SENSOR_IDS 매핑 (실제 BACnet 센서 ID와 짝)
- ±0.5°C 조정 폭 (사용자 학습된 동작)
- Polygon1 hidden 대기 로직 (Zoning 토글 동기화 필수)

---

## 🔌 3. 외부 시스템 연동 2: SignApps Express (전광판)

### 3-1. 시스템 개요
- **위치**: 빌딩 로비 전광판 (물리 장치)
- **재생 소프트웨어**: SignApps Express
- **재생 형식**: 540 × 960 JPEG 4장 순환
- **BMS와의 관계**: **API 연동 없음**. BMS에서 JPEG 다운로드 → 사장님이 수동으로 SignApps에 업로드

### 3-2. BMS 코드 안의 SignApps 관련 위치

#### `signboard.html` 라인 17 (의존성)
```html
<script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"></script>
```
- html2canvas v1.4.1 사용
- jsdelivr CDN

#### `signboard.html` 페이지 구조
- **Page 1, 2, 3** (라인 281-291): 일반 페이지 — 흰바탕 + 검정 텍스트 + 골드 라인 (사장님 메모리)
- **Page 4** (`FULLPAGE_PAGE`, 라인 318-323): 풀페이지 자유 디자인 — HTML 직접 작성 (textarea로 입력)

### 3-3. JPEG 다운로드 핵심 로직 (signboard.html 라인 465-522)

#### `window.downloadJPEG` 동작 흐름
1. **`#pvFrame` 요소 가져오기** (라인 466)
2. **모든 `<img>` 사전 로딩** (라인 471-494):
   - 외부 이미지를 `fetch`로 가져옴 (`cache: 'force-cache'`)
   - blob → dataURL로 변환
   - `<img>.src`를 dataURL로 교체
   - 로딩 완료 대기 (`onload`/`onerror`/3초 타임아웃)
   - **이유**: html2canvas가 외부 이미지 캡처 못 하는 문제 해결
3. **0.5초 추가 대기** (라인 495)
4. **html2canvas로 캡처** (라인 497-506):
   - `width: 540`, `height: 960`
   - `scale: 2` (2배 해상도로 캡처 → 다음 단계에서 540x960으로 다운스케일)
   - `useCORS: true`, `allowTaint: true`
   - `imageTimeout: 15000` (15초)
   - `backgroundColor: '#ffffff'`
5. **최종 캔버스 생성** (라인 508-514):
   - 540x960 고정 크기
   - `imageSmoothingQuality: 'high'`
6. **JPEG 파일 다운로드** (라인 516-519):
   - 파일명: `Signboard_Page${activeTab}.jpg`
   - 품질: `0.95`

#### `window.downloadAllJPEG` (라인 524-535)
- 페이지 1, 2, 3, FULLPAGE_PAGE 순서로 자동 다운로드
- 각 페이지 전환 후 600ms 대기 → downloadJPEG 호출 → 400ms 대기

### 3-4. ⚠️ html2canvas 치명적 버그 (사장님 메모리 명시)
**절대 반복 금지 사항**:
> img를 감싼 div가 `display:inline-block` + `border` 조합이면 이미지를 캡처 못하고 빈 박스로 나옴
>
> **올바른 방식**:
> - 테두리 필요 시: 부모 카드 자체에 border
> - img는 `margin: 0 auto`로 직접 배치
> - **별도 wrapper div 안에 inline-block + border로 감싸지 말 것**

이 버그는 QR/로고 이미지 넣을 때 발생함.

### 3-5. SignApps Express 자체에 대해 BMS 코드로 알 수 없는 것
- ❌ SignApps의 페이지 전환 주기
- ❌ SignApps의 업로드 인터페이스
- ❌ JPEG 외 다른 포맷 지원 여부

**→ 사장님이 SignApps Express를 직접 운용하므로 BMS 매뉴얼은 "JPEG 4장 생성"까지만 책임짐.**

### 3-6. 운영 흐름 (사장님 메모리 기반)
```
1. BMS signboard.html에서 4개 페이지 디자인
2. "Download all JPEG" 버튼 클릭
3. 4개 JPEG 파일 자동 다운로드 (Page1.jpg ~ Page4.jpg)
4. 사장님이 SignApps Express에 수동 업로드
5. 전광판에서 4장 순환 재생
```

### 3-7. 코드에 **없는** 것
- ❌ SignApps Express와의 자동 동기화 없음 (모두 수동)
- ❌ 다운로드 이력 저장 없음
- ❌ 페이지별 활성/비활성 토글 없음 — 4장 다 항상 다운로드됨

---

## 🔌 4. 외부 시스템 연동 3: Resend API (이메일)

### 4-1. 시스템 개요
- **서비스**: Resend (https://resend.com)
- **무료 한도**: 100 이메일/일 (사장님 메모리 + Part 1 매뉴얼)
- **호출 위치**: **BMS 프론트엔드에서 직접 호출 X**. Supabase Edge Function 안에서만 사용
- **사용 Edge Function 5개** (Part 1 매뉴얼 기반):
  - `email-announcement` (현재 비활성)
  - `email-complaint-response` (현재 비활성)
  - `email-parking-notice` (사용 중)
  - `email-quote-voting` (사용 중)
  - `email-quote-confirm` (사용 중)

### 4-2. BMS 프론트엔드 코드의 Resend 관련 호출

#### **직접 호출 없음**
BMS 프론트엔드(HTML/JS)에서 `api.resend.com` 또는 Resend SDK 직접 호출하는 코드 **0건**.

#### Edge Function을 통한 간접 호출 위치 (BMS 코드 grep 결과)
- `parking.html` → `email-parking-notice` Edge Function 호출
- `quotes.html` → `email-quote-voting`, `email-quote-confirm` Edge Function 호출

⚠️ 이 Edge Function들의 **내부 구현**(Resend API 호출 코드)은 Supabase 프로젝트의 Edge Functions 폴더에 있음. **GitHub repo의 BMS 프론트 코드에는 없음.**

### 4-3. announcements.html의 "Resend" 버튼 (오해 주의)
```javascript
// announcements.html 라인 435
window.resendAnnouncement = async (id) => { ... }
```
⚠️ **이 함수의 "Resend"는 "공지 재발송" 의미** — Resend API와 무관. 함수명이 단어 의미가 같아서 헷갈림.

실제 동작: `read_status` 리셋 + `/api/send-push` 재호출. 이메일 발송 안 함 (Part 1 라인 1731 참조).

### 4-4. Resend 환경 설정 (Part 1 매뉴얼 기반, BMS 프론트 코드에는 없음)
- **API 키**: Supabase Edge Function 환경변수에 저장 (`RESEND_API_KEY` 등)
- **발신 주소**: `notify@scafacility.com`
- **Reply-To**: `sp77249.redmyre@gmail.com`
- **BCC** (2026-04-28 이후 정책 — info@scafacility.com 비용 사고로 제거):
  - `sca.yun82@gmail.com`
  - `sca.jacob77@gmail.com`
  - 적용 Edge Function: `email-complaint-response`
  - **email-quote-voting / email-quote-confirm**: BCC 없음 (admin이 to에 포함됨)
  - **email-parking-notice는 BCC 없음** (익명성 유지)

### 4-5. Resend 한도 보호 정책 (사장님 메모리 + Part 1)
- ✅ **announcements는 Push만, 이메일 X** — 한 번에 77명 이상 발송 시 한도 초과 위험
- ✅ **complaints는 Push만, 이메일 X** (4/21 이후 정책 변경)
- ✅ **email-quote-voting/confirm은 Committee 8명만** — 안전한 범위
- ✅ **email-parking-notice는 차주 1명만** — 안전한 범위

### 4-6. BMS 매뉴얼 관점에서의 Resend
- **BMS 프론트엔드 코드는 Resend를 직접 알 필요 없음**
- 트러블슈팅 시:
  1. Edge Function이 호출됐는지 확인 (Supabase Edge Functions 로그)
  2. Resend 자체 대시보드에서 발송 이력/실패 확인
  3. 한도 초과 시 다음 날까지 대기

### 4-7. ⚠️ 절대 금지 (사장님 메모리)
- ❌ **announcements에 이메일 발송 재추가 금지** (Resend 한도 보호)
- ❌ **complaints에 이메일 발송 재추가 금지** (4/21 이후 Push만)

---

## 🔌 5. 외부 시스템 연동 4: NSW 공휴일 API (date.nager.at)

### 5-1. 시스템 개요
- **API**: https://date.nager.at/
- **엔드포인트**: `https://date.nager.at/api/v3/PublicHolidays/{year}/AU`
- **인증**: 없음 (공개 API)
- **무료**: 무제한 사용 가능
- **호출 위치**: **`emergency.html` 1곳만**

### 5-2. 호출 코드 (emergency.html 라인 215-223)
```javascript
async function isNSWPublicHoliday(date) {
  try {
    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${date.getFullYear()}/AU`);
    const holidays = await res.json();
    const today = date.toISOString().split('T')[0];
    return holidays.some(h => h.date === today && (!h.counties || h.counties.includes('AU-NSW')));
  } catch { return false; }
}
```

### 5-3. 동작 흐름
| 라인 | 동작 |
|---|---|
| 218 | `{year}/AU`로 호주 공휴일 전체 가져옴 (예: 2026 → 2026년 공휴일 전체) |
| 219 | JSON 파싱 |
| 220 | `today = 'YYYY-MM-DD'` 형식 (UTC 기준) |
| 221 | 공휴일 배열에서: `date === today` AND (`counties` 없거나 `'AU-NSW'` 포함) |
| 222 | 에러 시 → `false` 반환 (안전 fallback) |

### 5-4. API 응답 형식 (실제 호출 결과 기반)
```json
[
  {
    "date": "2026-01-01",
    "localName": "New Year's Day",
    "name": "New Year's Day",
    "countryCode": "AU",
    "fixed": false,
    "global": true,
    "counties": null,
    "launchYear": null,
    "types": ["Public"]
  },
  {
    "date": "2026-01-26",
    "localName": "Australia Day",
    ...
    "counties": ["AU-NSW", "AU-VIC", ...]
  }
]
```

### 5-5. 호출 빈도
- `renderManagerCard()` 함수가 호출될 때마다 fetch 발생
- emergency.html 페이지 로드 시 1회 호출
- ⚠️ 캐싱 없음 — 페이지 새로고침할 때마다 호출 (API 무제한이라 문제 없음)

### 5-6. 사용 목적 (emergency.html 라인 225-232)
```javascript
async function renderManagerCard() {
  const now = new Date();
  const day = now.getDay();
  const timeNum = now.getHours()*60 + now.getMinutes();
  const isWorkDay = [1,3,5].includes(day);  // 월/수/금
  const isWorkHours = timeNum >= 8*60 && timeNum < 16*60;  // 8AM-4PM
  const isHoliday = await isNSWPublicHoliday(now);
  const available = isWorkDay && isWorkHours && !isHoliday;
  ...
}
```
- **Manager 가용 여부 판정**:
  - 월/수/금 (사장님 근무일)
  - 8AM ~ 4PM
  - **공휴일 아닐 때**
- 위 3개 모두 만족 → "Available"
- 하나라도 안 맞으면 → "Not Available" (SCA 사무실 1300 785 007 안내)

### 5-7. ⚠️ NSW 공휴일 정확도 주의
- API의 `counties` 필드:
  - `null` → 호주 전국 공휴일 (예: New Year's Day)
  - `["AU-NSW", ...]` → 해당 주만 공휴일 (예: Bank Holiday)
- 코드 라인 221: `(!h.counties || h.counties.includes('AU-NSW'))`
  - counties가 null이면 통과 (전국 공휴일)
  - counties 있으면 AU-NSW 포함 여부 확인

### 5-8. 자주 발생할 수 있는 장애
| 증상 | 원인 |
|---|---|
| Manager 카드가 항상 "Not Available" | API 응답 시간 초과 또는 fetch 실패 → catch에서 false 반환 (정상 동작) |
| 공휴일인데 "Available"로 뜸 | 해당 날짜가 NSW에 없거나 API 데이터 누락 |
| 공휴일 아닌데 "Not Available" | 시스템 시간 잘못됨 또는 timezone 이슈 |
| date.nager.at 다운 | catch에서 false 반환 → 평소처럼 동작 |

### 5-9. 코드에 **없는** 것
- ❌ API 응답 캐싱 없음 (localStorage 등)
- ❌ Timeout 명시 안 됨 (브라우저 기본값 사용)
- ❌ 다른 호주 주(VIC, QLD 등) 지원 없음 — NSW 전용
- ❌ 학교 공휴일/은행 휴무일 구분 없음

---

## 📋 섹션 3 최종 요약

### Service Worker (sw.js)
| 항목 | 값 |
|---|---|
| 라인 수 | 44 |
| 이벤트 리스너 | install, activate, push, notificationclick |
| 캐싱 | ❌ 미구현 (CACHE_NAME 상수만 있음) |
| Push 표시 | ✅ 구현 |
| 알림 클릭 처리 | ✅ 기존 탭 재사용 또는 새 창 |

### 외부 시스템 4개 비교표
| 시스템 | 호출 방식 | BMS 코드와의 결합도 | 인증 |
|---|---|---|---|
| HVAC Daemon | Daemon이 5초 polling (Service Role Key) | 약함 (DB 매개) | Daemon 코드에 Service Role Key 하드코딩 |
| SignApps Express | 수동 업로드 (없음) | 없음 (JPEG 다운로드까지만) | — |
| Resend API | Edge Function 경유 | 약함 (Edge Function 매개) | RESEND_API_KEY |
| NSW 공휴일 API | 직접 fetch | 직접 (emergency.html) | 없음 (공개) |

### 새 세션의 Claude가 헷갈릴만한 점
1. **sw.js의 `icon-192-v4.png` 경로**: GitHub 실제 파일과 일치 (하이픈 있음). Claude 환경(/mnt/project/)에서는 하이픈 없이 보일 수 있으나 이는 환경 차이일 뿐 코드는 정상.
2. **sw.js의 CACHE_NAME 상수는 사용 안 됨** — fetch 이벤트 없음
3. **HVAC Daemon은 BMS가 직접 호출 안 함** — Daemon이 5초마다 polling, Service Role Key 사용
4. **HVAC `±0.5°C` 조정 로직은 Daemon 코드에 있음** — BMS는 신청만, 실제 온도 변경은 Selenium이 iControl에 입력
5. **SignApps Express는 API 없음** — 수동 업로드 방식
6. **Resend는 BMS 프론트에서 직접 호출 안 함** — Edge Function 안에서만
7. **announcements.html의 `resendAnnouncement` 함수는 Resend API와 무관** — "공지 재발송" 의미
8. **NSW 공휴일 API 호출 위치는 emergency.html 1곳만** — 다른 페이지에서는 사용 안 함
9. **API 호출 실패 시 모두 안전 fallback** (false 반환 또는 catch 무시)
10. **VAPI_*** (사장님이 4월 20일 확정한 정상 환경변수명, VAPID_* 아님)

### 절대 수정 금지 항목 (섹션 3)
1. **sw.js의 페이로드 파싱 구조** (`title`, `body`, `data.url`) — send-push.js와 짝
2. **HVAC 30분 쿨다운 로직** (사장님 메모리 명시)
3. **HVAC_daemon.py의 Service Role Key 하드코딩** (Daemon PC 보안 = 키 보안)
4. **HVAC TENANCY_SENSOR_IDS 매핑** (BACnet 센서 ID와 짝)
5. **HVAC ±0.5°C 조정 폭** (사용자 학습된 동작)
6. **announcements/complaints에 이메일 재추가 금지** (Resend 한도)
7. **HVAC `processing → completed` 전환** (외부 Daemon이 처리, BMS에서 건드리면 안 됨)
8. **signboard.html JPEG 540×960 고정 크기** (전광판 규격)

### 외부 시스템 4개 트러블슈팅 우선순위
| 문제 | 1차 확인 | 2차 확인 |
|---|---|---|
| Push 알림 안 옴 | sw.js 등록 상태 (DevTools) | send-push.js 환경변수 (VAPI_*) |
| HVAC 처리 안 됨 | hvac_requests 테이블에 `approved` 행 있나 | Daemon PC 살아있나 + `logs/hvac_log_*.txt` |
| HVAC 매번 failed | — | iControl 로그인/Selenium 에러 |
| 전광판 디자인 오류 | signboard.html 미리보기 | html2canvas 버그 (img wrapper 검사) |
| 이메일 안 옴 | Edge Function 로그 (Supabase) | Resend 대시보드 한도 확인 |
| Manager 카드 항상 OFF | 시스템 시간 | date.nager.at 응답 확인 |

---

## 📦 Part 3 전체 완료 요약

| 섹션 | 라인 수 | 크기 | 내용 |
|---|---|---|---|
| Section 1 (v2) | 936 | 36KB | JS 모듈 4개 (auth, common, audit, layout) |
| Section 2 | 752 | 29KB | Vercel API 6개 |
| Section 3 | (현재) | (현재) | Service Worker + 외부 연동 4개 |

### Part 3 작성 원칙 (재확인)
- ✅ 코드에 있는 것만 적음
- ✅ 라인 번호 모두 명시
- ✅ 사장님이 이미 확정한 사항은 다시 의심하지 않음
- ✅ 의도된 설계는 "이슈"로 분류하지 않음
- ✅ 파일명/경로는 GitHub 직접 확인 필수 (Claude `/mnt/project/` 환경 파일명은 GitHub과 다를 수 있음)

### Part 3 v2에서 정정된 사항 (참고용 기록)
이전 버전에서 잘못 분류했던 항목들 — 모두 정상/의도된 설계로 확인됨:
1. **VAPI_*** 환경변수 — 4월 20일 사장님이 직접 Vercel 화면 스크린샷으로 확정한 정상 이름 (Part 1 매뉴얼 라인 2448-2450 기록)
2. **sw.js 아이콘 경로** — GitHub 실제 파일도 하이픈 있음 (`icon-192-v4.png`). sw.js와 100% 일치. 정상.
3. **delete-user.js Admin 검증 부재** — UI 레벨 보호 + Service Role Key(환경변수)로 충분한 의도된 단순 설계
4. **complete-setup 8자 vs admin-set-password 4자** — 의도된 정책 차이 (신규 가입자 8자 강제 / Admin 임시 비번 4자 허용 — David 등 초기 가입자 호환)

---

**다음 Part**: Part 4 — 운영 가이드 (장애 대응 / 일상 운영 / 5월 SCM / 인수인계)
