# 🏢 Redmyre House BMS — Master Manual

**Strata Plan:** SP77249
**Building:** 9–13 Redmyre Road, Strathfield NSW 2135
**Units:** 52
**Building Manager:** Jacob Kim (SCA Facility Management Pty Ltd)
**BMS URL:** https://sca-redmyre.vercel.app
**GitHub:** sp77249redmyre-eng/sca-redmyre (Private)
**Supabase Project ref:** wunsexdnqathluplkkvo

**Manual 버전:** 1.0
**작성일:** 2026-04-25
**작성자:** Claude (사장님 감수)

---

## 📖 이 매뉴얼의 목적

이 매뉴얼은 **Redmyre House BMS의 완전한 기술 문서**입니다.

**용도:**
1. 사장님이 나중에 시스템을 다시 볼 때 "이게 뭐였지?" 확인
2. Claude가 다음 세션에서 정확한 정보로 작업
3. 신규 개발자/인수인계 시 완전한 참조 자료
4. 장애 발생 시 즉시 대응 가이드

**절대 원칙:**
- 이 매뉴얼의 내용은 **실제 DB/코드에서 확인된 사실**만 포함
- 추측/예상은 명시적으로 "추정"이라고 표시
- 금기사항은 **과거 사고 사례 포함**

---

## ⚠️ Claude를 위한 작업 철칙 (SQL/코드 작성 규칙)

**이 섹션은 Claude가 작업 시 반드시 지켜야 할 규칙입니다.**

### 1. 추측 금지
- 컬럼명/테이블명 **절대 추측 금지**
- 반드시 이 매뉴얼 "테이블 스키마" 섹션 확인 후 작성
- **과거 실수:**
  - `occupants.full_name` 사용 (존재 안 함)
  - 주석을 실행 SQL로 혼동해서 제공
  - JavaScript 코드를 SQL Editor에 붙이라고 안내

### 2. 실행 위치 명확히 표시
- **"Supabase SQL Editor에서 실행"** — SQL 전용
- **"F12 브라우저 콘솔에서 실행"** — JavaScript 전용
- 두 가지를 섞어서 제공하지 말 것

### 3. 코드 블록 규칙
- 코드 블록(```sql```) 안에는 **실행 가능한 SQL만**
- 설명/주석은 코드 블록 **밖에** 작성
- 주석 필요 시 PostgreSQL 주석 문법(`--`) 사용

### 4. UPDATE/DELETE 안전 절차
- **먼저 SELECT로 영향받을 데이터 확인**
- 사장님 승인 후 UPDATE/DELETE 실행
- 필요 시 원복 SQL 먼저 저장

### 5. 사장님은 코딩 전문가 아님
- 전문 용어 사용 금지
- "이 쿼리를 Supabase SQL Editor에 복붙하고 결과 주세요" 방식으로만
- 결과 해석/판단은 Claude가 담당

### 6. 작업 전 필수 절차
1. `conversation_search`로 과거 대화 확인
2. **이 Master Manual 확인** (설계 의도, 금기사항)
3. 메모리 확인
4. 확인된 사실만 말하고, 모르는 건 "모른다"
5. **추측으로 평가/비판 절대 금지**

---

## 🚨 절대 금기사항 (Never Touch)

### 과거 대형 사고 기록

#### 2026-04-08: get_my_role() 사고
- `get_my_role()` 함수를 SECURITY INVOKER로 변경 시도
- **전체 유저 role이 observer로 떨어짐**
- 즉시 SECURITY DEFINER로 원복 → 복구
- **교훈:** get_my_role() 절대 건드리지 말 것

#### 2026-04-08: Quotes Storage RLS 사고
- Storage RLS 정책 정리 시도
- **Admin/Committee까지 견적 파일 접근 불가**
- 2개월치 작업 날릴 뻔함
- 긴급 복구 → 넓게 열어두는 방식으로 원복
- **교훈:** Storage RLS는 UI 레이어에서 방어하고, RLS 자체는 건드리지 말 것

### ❌ 절대 수정 금지 목록

1. **`get_my_role()` 함수** — SECURITY DEFINER + search_path = public 유지
2. **`layout.js`** — 사이드바 메뉴 권한, 페이지 접근 제어, 푸시 알림 통합 관리
3. **`sidebar.html` / `topbar.html`** — 레이아웃 컴포넌트
4. **`audit_logs` RLS** — SELECT/INSERT/DELETE 전부 true (의도됨)
5. **투표 로직 함수 5개:**
   - `calculateResult()`
   - `doUpsert()`
   - `forceAction()`
   - `confirmSelection()`
   - `syncQuoteToWorks()`
6. **Quotes Storage RLS 정책** — 4중 방어망 구조 유지
7. **`notify_announcement`, `notify_quote` 함수의 JWT 토큰** — key rotation 시 동시 업데이트 필수

---

## 🎓 DB 개념 일반인 설명

이 섹션은 전문 용어를 쉽게 풀어서 설명합니다.

### Supabase란?
PostgreSQL 데이터베이스 + 인증 + 파일 저장소를 묶어놓은 서비스.
AWS처럼 직접 서버 관리 안 해도 백엔드 기능을 다 제공.

### PostgreSQL이란?
세계에서 가장 많이 쓰이는 오픈소스 관계형 데이터베이스.
"테이블"에 데이터가 행(row)과 열(column)로 저장됨.

### 테이블 (Table)
엑셀 시트 같은 것. 
- 행(row): 데이터 1개 (예: 입주자 1명)
- 열(column): 데이터 속성 (예: 이름, 이메일, 유닛)

### Primary Key (PK)
테이블의 **고유 식별자**. 
예: `occupants.id`는 각 입주자를 구별하는 ID.
같은 PK 값을 가진 행이 2개 있을 수 없음.

### Unique 제약
PK가 아니지만 **중복 불가능**한 컬럼.
예: `profiles.email`은 Unique라 같은 이메일로 2명 가입 불가.

### Foreign Key (FK, 외래키)
다른 테이블을 참조하는 연결.
예: `complaints.user_id`는 `profiles.id`를 가리킴.
즉 "이 민원을 누가 올렸는지" 연결.

### RLS (Row Level Security)
"누가 어떤 데이터를 볼 수 있는지" DB 차원에서 정하는 규칙.
- 프론트엔드(JS)에서 막는 건 개발자가 뚫을 수 있음
- RLS는 DB 자체에서 막아서 아무도 못 뚫음

예시: 
- admin은 모든 입주자 정보 볼 수 있음
- tenant는 본인 유닛만 볼 수 있음

### SECURITY DEFINER vs INVOKER
DB 함수가 실행될 때 **누구의 권한으로 동작하는지** 결정.

- **SECURITY INVOKER** (기본값): 함수를 호출한 사람의 권한
- **SECURITY DEFINER**: 함수를 만든 사람(보통 admin)의 권한
  - RLS를 우회할 수 있음
  - 예: `lookup_vehicle_plates()` — tenant가 불러도 admin 권한으로 돌아서 전체 차량 조회

### Trigger (트리거)
테이블에 어떤 동작(INSERT/UPDATE/DELETE)이 일어나면 **자동 실행**되는 함수.
예: `occupants` 수정 시 `updated_at` 컬럼 자동 업데이트.

### RPC (Remote Procedure Call)
"DB 함수를 프론트엔드에서 직접 호출"하는 방식.
```javascript
// 프론트엔드 코드 예시
const { data } = await supabase.rpc('lookup_vehicle_plates');
```
일반 SELECT 대신 복잡한 로직을 함수로 만들어놓고 호출.

### Edge Function
Supabase 서버리스 함수. 
- 이메일 발송, 이미지 정리 같은 서버 로직 처리
- URL로 호출 가능 (fetch로 호출)

### JWT 토큰
로그인 후 발급되는 **암호화된 신분증**.
- 요청할 때마다 이 토큰으로 "나는 누구다" 증명
- anon key: 모두에게 공개되는 키 (읽기 전용 성격)
- service_role key: 모든 권한 가진 마스터 키 (**절대 공개 금지**)

### Cron Job
정해진 시간에 **자동 실행**되는 작업.
예: 매일 새벽 3시에 오래된 이미지 삭제.

### PWA (Progressive Web App)
웹사이트를 앱처럼 설치하고 사용할 수 있는 기술.
- Service Worker로 캐시/푸시 알림 제공
- Redmyre BMS는 PWA로 구현됨

### Service Worker
브라우저 백그라운드에서 도는 스크립트.
- 푸시 알림 수신
- 오프라인 캐시
- `/sw.js` 파일에 구현됨

---

## 📊 BMS 5개 Role 체계

BMS에는 5가지 역할이 있습니다.

| Role | 화면 표시 | 주요 권한 |
|---|---|---|
| `admin` | Admin | 모든 기능, 모든 데이터 접근 |
| `committee` | Committee | 투표, 비용 조회, 전체 조회 |
| `observer` | Observer (Strata) | 전체 조회만 (수정 불가) |
| `owner` | Owner | 본인 유닛만 |
| `tenant` | Tenant (Staff) | 본인 유닛만 |

**주의:** 
- DB에 저장된 role 값은 `observer`, `tenant` (영문 소문자)
- 화면 표시명만 Observer (Strata), Tenant (Staff)로 변경됨 (common.js getRoleLabel)

### 각 role의 접근 가능 페이지

| 페이지 | admin | committee | observer | owner | tenant |
|---|---|---|---|---|---|
| building (Overview) | ✅ | ✅ | ✅ | ✅ | ✅ |
| announcements | ✅ | ✅ | ✅ | ✅ | ✅ |
| parking | ✅ | ✅ | ✅ | ✅ | ✅ |
| complaints | ✅ | ✅ | ✅ | ✅ | ✅ |
| hvac | ✅ | ✅ | ✅ | ✅ | ✅ |
| emergency | ✅ | ✅ | ✅ | ✅ | ✅ |
| works | ✅ | ✅ | ✅ | ✅ | ✅ |
| occupants | ✅ | ✅ | ✅ | ✅ | ✅ |
| guide-resident | ✅ | ✅ | ✅ | ✅ | ✅ |
| **quotes** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **reports** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **cost-dashboard** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **history** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **guide-committee** | ✅ | ✅ | ✅ | ❌ | ❌ |
| users | ✅ | ❌ | ❌ | ❌ | ❌ |
| system | ✅ | ❌ | ❌ | ❌ | ❌ |
| signboard | ✅ | ❌ | ❌ | ❌ | ❌ |

---

# 🗃️ PART 1: DB 전체 구조

## 22개 테이블 전체 목록

| # | 테이블명 | 용도 | 행 수(대략) |
|---|---|---|---|
| 1 | `announcements` | 공지사항 | 수십 |
| 2 | `audit_logs` | 사용자 활동 로그 | 수천 |
| 3 | `building_cards` | Building Systems 카드 (Overview) | 11개 고정 |
| 4 | `complaint_messages` | 민원 대화 스레드 | 수백 |
| 5 | `complaints` | 민원/요청 | 수십 |
| 6 | `contractors` | 계약업체 연락처 | 수십 |
| 7 | `hvac_requests` | 온도 조절 요청 | 수백 |
| 8 | `occupants` | 입주자 정보 (마스터) | 52 |
| 9 | `parking_reports` | 주차 위반 신고 | 수백 |
| 10 | `profiles` | 로그인 계정 (Supabase Auth 연결) | 100+ |
| 11 | `project_comments` | 프로젝트 레벨 댓글 (견적 상의) | 수십 |
| 12 | `push_subscriptions` | PWA 푸시 구독 | 100+ |
| 13 | `qr_analytics` | QR 스캔 통계 | 수백 |
| 14 | `quote_comments` | 개별 견적 댓글 | 수십 |
| 15 | `quotes` | 견적/작업 (시스템의 핵심) | 수십 |
| 16 | `settings` | 시스템 설정 (key-value) | 소수 |
| 17 | `sidebar_permissions` | Role별 페이지 권한 | 85 (5role × 17페이지) |
| 18 | `signboard_entries` | 전광판 입주자 엔트리 | 52+ |
| 19 | `signboard_fullpage` | 전광판 전체 페이지(비상연락처) | 1 |
| 20 | `signboard_notice` | 전광판 공지 | 1 |
| 21 | `vehicles` | 차량 (occupants 파생) | 50+ |
| 22 | `votes` | 견적 투표 | 수십 |

---

## 테이블별 상세

### 1. `announcements` — 공지사항

**용도:** Admin이 작성하는 공지. 모든 로그인 유저가 조회.

**컬럼:**

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `created_at` | timestamptz | YES | `now()` | 작성일 |
| `title` | text | NO | - | 제목 |
| `content` | text | NO | - | 내용 |
| `category` | text | YES | `'general'` | 카테고리 |
| `pinned` | boolean | YES | `false` | 상단 고정 여부 |
| `author_id` | uuid | YES | - | 작성자 profiles.id |
| `attachments` | jsonb | YES | `'[]'` | 첨부파일 배열 |

**제약:**
- PK: `id`

**RLS 정책:**
```sql
-- SELECT: 모든 로그인 유저
qual: (auth.uid() IS NOT NULL)

-- INSERT/UPDATE/DELETE: admin만
qual: (get_my_role() = 'admin'::text)
```

**📊 Role별 프론트엔드 동작 (announcements.html):**

| 기능 | admin | 그 외 role |
|---|---|---|
| 공지 조회 | ✅ | ✅ |
| + New Announcement 버튼 (addAnnBtn) | ✅ | ❌ 숨김 |
| 공지 수정/삭제 | ✅ | ❌ |
| 재발송 버튼 (resendAnnouncement) | ✅ | ❌ |
| 읽음 표시 (audit_logs ANNOUNCEMENT_VIEWED) | 기록 안 함 | 자동 기록 |

**카테고리:** 기본값 'general'. CAT_BADGE, CAT_EMOJI로 표시.

**알림:** 공지 작성/재발송 시 `/api/send-push`만 호출. **email-announcement 호출 안 함** (Resend 한도 방지).

---

### 2. `audit_logs` — 활동 로그

**용도:** 사용자 활동 기록. System 페이지에서 조회/삭제.

**컬럼:**

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `action` | text | NO | - | 동작 유형 (예: COMPLAINT_CREATED) |
| `table_name` | text | YES | - | 영향받은 테이블 |
| `record_id` | text | YES | - | 관련 레코드 ID |
| `user_email` | text | YES | - | 사용자 이메일 |
| `user_role` | text | YES | - | 사용자 role |
| `details` | jsonb | YES | `'{}'` | 상세 정보 |
| `created_at` | timestamptz | YES | `now()` | 기록일 |

**제약:**
- PK: `id`

**RLS 정책 (⚠️ 절대 변경 금지):**
```sql
-- SELECT/INSERT/DELETE 전부 true (모든 유저)
qual: true
```

**⚠️ 왜 전체 허용인가:**
1. 입주자 활동 자동 INSERT 필요 (민원 생성 시 등)
2. System 페이지 clearAllLogs() 전체 삭제 기능 필요
3. 보안은 profiles RLS + layout.js role 체크로 이중/삼중 방어됨

---

### 3. `building_cards` — Building Systems 카드

**용도:** Overview(building.html)의 Building Systems 11개 카드.

**컬럼:**

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `position` | bigint | NO | - | 정렬 순서 (Unique) |
| `name` | text | NO | - | 카드 이름 (Lift, HVAC 등) |
| `icon` | text | YES | `'🔧'` | 이모지 아이콘 |
| `icon_bg` | text | YES | `'#f1f5f9'` | 아이콘 배경색 |
| `status` | text | YES | `'normal'` | 상태 (urgent/inprogress/pending/normal 등) |
| `note` | text | YES | - | 메모 (Contractor/Progress 합쳐서 저장) |

**제약:**
- PK: `id`
- UNIQUE: `position`

**RLS 정책:**
```sql
-- 전체 유저 조회
SELECT: true

-- Admin만 전체 관리
ALL: (get_my_role() = 'admin')
```

**📊 Role별 프론트엔드 동작 (building.html):**

| 기능 | admin | 그 외 role |
|---|---|---|
| Building Systems 카드 조회 | ✅ | ✅ |
| + Add System 버튼 (addCardBtn) | ✅ | ❌ 숨김 |
| View 팝업에서 Edit 버튼 (vpEditBtn) | ✅ | ❌ 숨김 |
| note에서 Contractor/Progress 파싱 표시 | ✅ | ✅ |

---

### 4. `complaint_messages` — 민원 대화 스레드

**용도:** 민원에 대한 대화 메시지 (Admin ↔ 입주자 양방향).

**컬럼:**

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `complaint_id` | uuid | YES | - | FK → complaints.id |
| `user_id` | uuid | YES | - | FK → profiles.id (작성자) |
| `sender_name` | text | YES | - | 작성자 이름 |
| `sender_role` | text | YES | - | 작성자 role |
| `message` | text | NO | - | 메시지 본문 |
| `created_at` | timestamptz | YES | `now()` | 작성일 |

**외래키:**
- `complaint_id` → `complaints.id`
- `user_id` → `profiles.id`

**RLS 정책:**
```sql
-- SELECT: admin/committee/observer 전체 OR 본인 민원 OR 같은 유닛 (다중 유닛 지원)
-- INSERT: 본인 auth.uid()로만 작성, 유효 role
-- UPDATE: 본인이 작성한 것만, 유효 role
-- DELETE: admin만
```

**⭐ 같은 유닛 공유 (complaints/hvac_requests와 동일):**
```sql
c.unit IN (
  SELECT occupants.unit::text
  FROM occupants
  WHERE occupants.primary_email::text = auth.email()
     OR occupants.business_email ILIKE '%' || auth.email() || '%'
)
```

**📝 수정 이력 (2026-04-25):**

이전에는 `LIMIT 1`을 사용해서 다중 유닛 Tenant의 경우 한쪽 유닛의 메시지만 조회되는 버그가 있었음.

2026-04-13에 최초 구현 시 단일 유닛 전제로 설계되었고, 이후 complaints/hvac_requests는 다중 유닛 지원으로 업데이트되었으나 complaint_messages만 `LIMIT 1`이 남아있었음.

2026-04-25 Master Manual 작성 중 발견하여 `IN` 방식으로 수정 완료.

**수정 SQL:**
```sql
DROP POLICY IF EXISTS complaint_messages_select ON complaint_messages;

CREATE POLICY complaint_messages_select ON complaint_messages
FOR SELECT
USING (
  get_my_role() = ANY (ARRAY['admin', 'committee', 'observer'])
  OR EXISTS (
    SELECT 1 FROM complaints c
    WHERE c.id = complaint_messages.complaint_id
    AND (
      c.user_id = auth.uid()
      OR c.unit IN (
        SELECT occupants.unit::text
        FROM occupants
        WHERE occupants.primary_email::text = auth.email()
           OR occupants.business_email ILIKE '%' || auth.email() || '%'
      )
    )
  )
);
```

---

### 5. `complaints` — 민원/요청

**용도:** 입주자 민원 및 요청.

**컬럼:**

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `created_at` | timestamptz | YES | `now()` | 작성일 |
| `updated_at` | timestamptz | YES | `now()` | 수정일 |
| `user_id` | uuid | YES | - | FK → profiles.id |
| `submitter_name` | text | YES | - | 작성자 이름 |
| `submitter_role` | text | YES | - | 작성자 role |
| `title` | text | NO | - | 제목 |
| `body` | text | YES | - | 본문 |
| `category` | text | YES | `'other'` | 카테고리 |
| `status` | text | YES | `'open'` | 상태 |
| `admin_response` | text | YES | - | (레거시) Admin 답변 |
| `has_photos` | boolean | YES | `false` | 사진 첨부 여부 |
| `unit` | text | YES | - | 관련 유닛 |
| `is_public` | boolean | YES | `false` | 전체 공개 여부 |

**RLS 정책 (핵심):**
```sql
-- SELECT: 
--   admin/committee/observer 전체 
--   OR auth.uid() = user_id (본인 작성)
--   OR unit이 본인 유닛 (primary_email OR business_email 매칭)

-- INSERT: admin/committee/owner/tenant
-- UPDATE: admin OR 본인
-- DELETE: admin만
```

**⚠️ 중요 설계:** **같은 유닛의 입주자끼리 민원 공유** (RLS 기반).

**⭐ 같은 유닛 민원 공유 (RLS 기반):**

`complaints_select` 정책:
```sql
admin/committee/observer 전체 OR
auth.uid() = user_id (본인 작성) OR
unit IN (본인의 유닛)
```

매칭 방식:
- `occupants.primary_email = auth.email()` (Owner)
- `occupants.business_email LIKE '%auth.email()%'` (Staff)

**예시:** 6B 유닛 (Calculus Accounting)
- Niranjan (Owner), Faizi (Staff), Javeria (Staff) 3명
- **셋 중 누구라도 민원 제출 시 → 셋 다 볼 수 있음**

이유: 같은 유닛 입주자들은 업무 협업하므로 요청 현황 공유 필요.

**📊 프론트엔드 실제 동작 (complaints.html 317-327줄):**

```javascript
const canSubmit  = ['admin','committee','owner','tenant'];  // observer 제외
const canViewAll = ['admin','committee','observer'];
```

**Role별 UI 동작:**

| Role | + New Request 버튼 | Stats 요약 | Filter Bar | Public 탭 |
|---|---|---|---|---|
| admin | ✅ | ✅ | ✅ | ❌ |
| committee | ✅ | ✅ | ✅ | ❌ |
| observer | ❌ (제출 불가) | ✅ | ✅ | ❌ |
| owner | ✅ | ❌ | ❌ | ✅ (My/Public 탭 전환) |
| tenant | ✅ | ❌ | ❌ | ✅ (My/Public 탭 전환) |

**Public 탭 동작 (owner/tenant만 보임):**
- `is_public = true`인 민원만 표시
- `get_public_complaints()` RPC 사용 (RLS 우회)
- Public 민원 클릭 시 `openPublicDetail()` (일반 `openDetail()`과 다름)
- 본인이 작성한 public 민원에는 "YOURS" 뱃지

**답변 기능:**
- Admin만 adminResponse textarea에 답변 작성
- 답변 시 자동 서명 추가 ("Jacob Kim / Building Manager / SCA Facility Management Pty Ltd")
- 일반 입주자(owner/tenant)는 답글(reply)만 가능

**알림:** email-complaint-response는 비활성. Push(send-push)만 사용.

---

### 6. `contractors` — 계약업체

**용도:** HVAC, Electrical 등 계약업체 연락처. Emergency 페이지 표시용.

**컬럼:**

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `service` | text | NO | - | 서비스 유형 |
| `company` | text | NO | - | 회사명 |
| `contact_name` | text | YES | - | 담당자 |
| `phone` | text | YES | - | 전화번호 |
| `email` | text | YES | - | 이메일 |
| `website` | text | YES | - | 웹사이트 |
| `notes` | text | YES | - | 비고 |
| `position` | integer | YES | `0` | 정렬 순서 |
| `name` | text | YES | - | (레거시) 이름 |

**RLS 정책:**
```sql
-- SELECT: admin/committee/observer만 (직접 조회)
-- INSERT/UPDATE/DELETE: admin만
```

**⚠️ 실제 동작 (중요):**
- **emergency.html에서 모든 role이 Contractors 섹션 조회 가능**
- `get_contractors()` SECURITY DEFINER RPC로 RLS 우회
- Owner/Tenant도 계약업체 연락처 볼 수 있음 (전화, 이메일 포함)
- **Admin만 Add/Edit/Delete 버튼 표시** (emergency.html 283-285줄)

**코드:**
```javascript
// emergency.html 288줄
const { data } = await supabase.rpc('get_contractors');
// → 모든 role이 접근 가능 (RLS 우회)
```

**📊 Role별 프론트엔드 동작 (emergency.html):**

| 기능 | admin | committee | observer | owner | tenant |
|---|---|---|---|---|---|
| Contractors 조회 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Contractors + Add/Edit/Delete | ✅ | ❌ | ❌ | ❌ | ❌ |
| Committee Members 카드 조회 | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Committee Members 카드 클릭** → occupants로 이동 | ✅ | ✅ | ✅ | ❌ | ❌ |

**핵심 설계 (emergency.html 419줄):**
```javascript
const canNavigate = ['admin', 'observer', 'committee'].includes(role);
```

- Owner/Tenant: Committee 카드는 보이지만 **클릭 불가** (세부정보 접근 차단)
- Admin/Committee/Observer: 클릭 시 해당 Committee 멤버의 occupants 카드로 이동 + 녹색 반짝

**Committee 카드 구조 (get_committee_members RPC):**
- 직책 순서: Chairman → Treasurer → Secretary → Committee Member
- 대표 유닛 표시 (Michelle → 3H, Laura → 4A)
- 다중 유닛 보유 시 괄호로 추가 표시

**전화번호 표시:** 여러 개 있으면 `/` 또는 `,` 기준 첫 번째만.

---

### 7. `hvac_requests` — 온도 조절 요청

**용도:** 에어컨 온도 조절 요청 (30분 쿨다운 적용).

**컬럼:**

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `created_at` | timestamptz | YES | `now()` | 요청일 |
| `user_id` | uuid | YES | - | FK → profiles.id |
| `user_name` | text | YES | - | 요청자 이름 |
| `type` | text | NO | - | hot/cold |
| `level` | text | NO | - | 층 |
| `tenancy` | text | NO | - | 유닛 |
| `comment` | text | YES | - | 메모 |
| `status` | text | YES | `'pending'` | 상태 |
| `approved_at` | timestamptz | YES | - | 승인일 |
| `completed_at` | timestamptz | YES | - | 완료일 |
| `admin_comment` | text | YES | - | Admin 메모 |
| `temp_before` | numeric | YES | - | 변경 전 온도 |
| `temp_after` | numeric | YES | - | 변경 후 온도 |

**RLS 정책:**
```sql
-- SELECT: admin/committee/observer 전체 OR 본인 OR 같은 유닛
-- INSERT: admin/committee/owner/tenant
-- UPDATE: admin만
-- DELETE: admin만
```

**⚠️ 30분 쿨다운:** hvac.html 프론트엔드에서 구현 (**같은 유닛 전체 기준**).

**⭐ 30분 쿨다운 설계 이유 (중요):**

같은 유닛(예: 4D)에 여러 사람이 있는 경우:
- Eva (Owner)가 10:00에 hot 요청 → 처리됨
- 10:05에 Y Jin (Staff)이 또 cold 요청 → **차단됨** (30분 내)
- Hansung (Staff)도 마찬가지로 차단

**왜 유닛 단위로 막는가:**
- HVAC 시스템은 온도 변경 시 1회당 0.5°C만 조정 (시스템 보호)
- 같은 유닛 A가 요청 직후 B가 또 요청하면 에어컨이 계속 토글됨 → 시스템 과부하
- 같은 유닛 입주자들은 한 공간에 있으므로 한 사람만 요청하면 충분
- **입주자 간 협의 유도** (누가 요청할지 내부 조율)

**따라서 hvac_requests RLS로 같은 유닛 요청을 서로 볼 수 있게 설계:**
- A가 이미 요청한 것을 B가 확인 → 중복 요청 안 함
- 30분 후 둘 다 다시 요청 가능

**📊 Role별 프론트엔드 동작 (hvac.html 396-420줄):**

| Role | 화면 구성 |
|---|---|
| admin | **Admin 패널만** (adminPanel) — 요청 처리, 승인, 온도 기록 |
| committee | 요청 제출(submit-form) + 본인+유닛 요청(userPanel) + Observer 패널(전체 조회) |
| observer | 요청 제출 **불가** + Observer 패널만 (전체 조회) |
| owner | 요청 제출 + **본인 + 같은 유닛 다른 사람 요청**(userPanel) |
| tenant | 요청 제출 + **본인 + 같은 유닛 다른 사람 요청**(userPanel) |

**⭐ 같은 유닛 요청 공유 (RLS 기반):**

`hvac_requests_select` 정책:
```sql
admin/committee/observer 전체 OR
auth.uid() = user_id (본인) OR
tenancy IN (본인의 유닛)
```

**예시:** 4D 유닛 (Hansung / Stepping Stone / JP Group)
- Eva (Owner), Hansung (Staff), Y Jin (Staff) 3명
- **셋 중 누구라도 HVAC 요청 시 → 셋 다 볼 수 있음**

이유: 같은 유닛의 입주자들은 서로 업무 협업하므로 요청 현황 공유 필요.

**Realtime 구독:**
- 모든 role이 `hvac_requests` 테이블 변경사항 실시간 수신
- 승인/완료 시 Push 알림

**30분 쿨다운 로직 (hvac.html 260줄 근처):**
- **같은 유닛(tenancy) 기준 30분에 1회 제한** (유저 기준 아님!)
- Admin은 쿨다운 없음
- 쿨다운 상태면 overlay 표시 + 남은 시간 카운트다운
- 빨간 경고문구 상시 표시: "30분~1시간 시스템 온도를 자주 바꿀 수 없습니다"

**⚠️ 절대 원칙:**
같은 유닛(tenancy) 기준 30분 제한은 **BMS 핵심 안전 장치**.
유저 ID 기준으로 바꾸면 에어컨 시스템 과부하 발생 가능.
**절대 수정 금지.**

---

### 8. `occupants` — 입주자 정보 (마스터 테이블)

**⭐ 이 테이블은 BMS의 가장 중요한 마스터 데이터입니다.**

**컬럼:**

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `lot` | integer | NO | - | Lot 번호 |
| `unit` | varchar | NO | - | 유닛명 (UNIQUE) |
| `level` | varchar | YES | - | 층 |
| `suite` | varchar | YES | - | Suite |
| `business_name` | text | YES | - | 업체명 |
| `contact_person` | varchar | YES | - | 담당자 |
| `primary_email` | varchar | YES | - | 주 이메일 (Owner용) |
| `business_email` | text | YES | - | 사업 이메일 (**콤마 분리**, Staff용) |
| `phone` | text | YES | - | 전화번호 |
| `is_committee` | boolean | YES | `false` | Committee 여부 |
| `committee_role` | varchar | YES | - | Chairman/Treasurer/Secretary |
| `license_plates` | text | YES | - | 차량 번호 (**콤마 분리**, 마스터 데이터) |
| `owner_type` | varchar | YES | - | Owner/Tenant |
| `status` | varchar | YES | `'Active'` | 상태 |
| `created_at` | timestamptz | YES | `now()` | 등록일 |
| `updated_at` | timestamptz | YES | `now()` | 수정일 |

**제약:**
- PK: `id`
- UNIQUE: `unit`

**트리거:**
- `set_updated_at` — UPDATE 시 `update_updated_at_column()` 함수 실행

**RLS 정책 (⚠️ 매우 중요):**
```sql
-- SELECT:
--   admin/committee/observer 전체 OR
--   profiles.unit = occupants.unit OR
--   profiles.email = occupants.primary_email OR
--   profiles.email이 occupants.business_email 콤마 리스트에 포함

-- UPDATE:
--   admin 전체 OR
--   (committee/owner/tenant이고 위 SELECT와 같은 매칭)

-- INSERT/DELETE: admin만
```

**⚠️ 핵심 설계:**
- **occupants.license_plates가 마스터, vehicles는 파생**
- license_plates 수정 시 반드시 `sync_vehicles()` RPC 호출
- vehicles 직접 INSERT/DELETE 금지

**⚠️ 실제 권한 매트릭스 (정확히 정리):**

**📖 조회 (Read):**

| Role | 조회 범위 |
|---|---|
| Admin | 전체 조회 |
| Committee | 전체 조회 |
| Observer | 전체 조회 |
| Owner | 전체 조회 (본인 유닛 아닌 것은 회색 + 클릭 불가) |
| Tenant | 전체 조회 (본인 유닛 아닌 것은 회색 + 클릭 불가) |

**✏️ 수정 (Edit):**

| Role | 수정 범위 |
|---|---|
| Admin | **전체 유닛 수정 가능** |
| Committee | **본인 유닛만** 수정 가능 |
| Owner | **본인 유닛만** 수정 가능 |
| Tenant | **본인 유닛만** 수정 가능 (단, Owner 정보는 수정 불가) |
| Observer | **수정 불가** (읽기 전용) |

**📋 Tenant 전용 제한 — Owner 정보 보호:**

Tenant가 본인 유닛 수정 시, **아래 2개 필드는 disabled**:
- ❌ Contact Person (오너 이름)
- ❌ Primary Email (오너 이메일)

**이유:** Tenant(Staff)는 건물주 개인 정보를 수정하면 안 됨.

**⚠️ 필드별 상세 권한 (occupants.html 1101-1119줄):**

| 필드 | Admin | Committee(본인유닛) | Owner(본인유닛) | Tenant(본인유닛) |
|---|---|---|---|---|
| Business Name | ✅ | ✅ | ✅ | ✅ |
| Business Email | ✅ | ✅ | ✅ | ✅ |
| **Contact Person** (오너 이름) | ✅ | ✅ | ✅ | ❌ disabled |
| **Primary Email** (오너 이메일) | ✅ | ✅ | ✅ | ❌ disabled |
| Phone | ✅ | ✅ | ✅ | ✅ |
| License Plates | ✅ | ✅ | ✅ | ✅ |
| **Is Committee** | ✅ | ❌ disabled | ❌ 숨김 | ❌ 숨김 |
| **Committee Role** | ✅ | ❌ disabled | ❌ 숨김 | ❌ 숨김 |

**⚠️ 저장 흐름 (occupants.html 1163-1180줄):**
```javascript
// 1단계: occupants 업데이트 (RLS로 본인 유닛 체크)
await supabase.from('occupants').update(data).eq('id', id);

// 2단계: vehicles 동기화 (sync_vehicles RPC로 RLS 우회)
await supabase.rpc('sync_vehicles', { 
  p_unit: unit, 
  p_owner_name: ownerName, 
  p_plates: plates 
});
```

즉 **2단계 동작:**
- occupants 수정 → RLS 체크
- vehicles 수정 → RPC로 RLS 우회 (SECURITY DEFINER)

**📊 Admin 전용 기능 (occupants.html):**
- **Quick Search** (adminSearchSection) — 전체 유닛 검색 (유닛번호/업체명/차량번호/이메일)
- **Bulk Invite** — 여러 입주자 한 번에 초대 발송
- **Export Excel** — 전체 데이터 엑셀로 내보내기

**🔑 Owner/Tenant 본인 유닛 판별 로직 (occupants.html):**

```javascript
// myOwnedUnits = 본인이 접근 가능한 유닛들
// 매칭 방식 3가지 OR:
// 1. profiles.email = occupants.primary_email (Owner)
// 2. profiles.email이 occupants.business_email 콤마 리스트에 포함 (Staff)
// 3. profiles.unit = occupants.unit (fallback)
```

**다중 유닛 처리:**
- Sarah (Owner): 1A/1B/1C → primary_email로 3개 유닛 매칭
- Kit Lau (Owner): 3A/3B/3C/3E → primary_email로 4개 유닛 매칭
- Hajun (Tenant): 2H/6G → business_email 매칭으로 2개 유닛

**탭 표시:**
- 모든 층 탭 표시 (Ground, Level 1~6, External)
- 본인 유닛 없는 층 탭도 클릭 가능 (조회만)
- 본인 유닛 아닌 카드는 회색 처리 + 클릭 불가 (restricted)
- 본인 유닛 카드 클릭 시 녹색 반짝 애니메이션 (highlight-flash)

---

### 9. `parking_reports` — 주차 위반 신고

**컬럼:**

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `created_at` | timestamptz | YES | `now()` | 신고일 |
| `reported_by` | uuid | YES | - | FK → profiles.id |
| `reporter_name` | text | YES | - | 신고자 이름 (Admin만 봄) |
| `plate` | text | NO | - | 차량 번호 |
| `location` | text | NO | - | 위치 |
| `violation` | text | NO | - | 위반 유형 |
| `comment` | text | YES | - | 메모 |
| `status` | text | YES | `'active'` | active/resolved |
| `resolved_at` | timestamptz | YES | - | 해결일 |
| `image_url` | text | YES | - | (단일) 이미지 URL |
| `user_id` | uuid | YES | - | (보조) 신고자 ID |
| `image_urls` | jsonb | YES | `'[]'` | (다중) 이미지 URL 배열 |

**RLS 정책:**
```sql
-- SELECT: 모든 인증 유저
-- INSERT: 모든 인증 유저
-- UPDATE/DELETE: admin만
```

**⚠️ 익명성:** 
- `reporter_name`은 DB에 저장되지만 **일반 유저에겐 숨김**
- parking.html에서 `role==='admin'`일 때만 표시

**자동 정리 (Cron 매일 3AM):**
- 해결된 신고: 3일 경과 시 이미지 삭제 (cleanup-images)
- 전체 신고: 30일 경과 시 이미지 전부 삭제 (cleanup_parking_images)

**📊 Role별 프론트엔드 동작 (parking.html):**

| 기능 | admin | committee | observer | owner | tenant |
|---|---|---|---|---|---|
| 위반 신고 제출 | ✅ 무제한 | ✅ 하루 5건 | ✅ 하루 5건 | ✅ 하루 5건 | ✅ 하루 5건 |
| 전체 신고 조회 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 신고자 이름 조회 | ✅ | ❌ 숨김 | ❌ 숨김 | ❌ 숨김 | ❌ 숨김 |
| Warning Notice 프린트 | ✅ | ✅ | ✅ | ✅ | ✅ |
| ✓ Mark Resolved 버튼 | ✅ | ❌ | ❌ | ❌ | ❌ |
| Delete 버튼 | ✅ | ❌ | ❌ | ❌ | ❌ |

**중요:**
- 모든 로그인 유저가 신고 가능
- Admin 외에는 하루 5건 제한 (parking.html 287-293줄)
- **익명성:** 일반 유저에겐 신고자 이름 숨김 (703줄)
- **Warning Notice PDF**는 iframe 방식으로 생성 (모바일 팝업 차단 해결)

**등록 차량 위반 시 자동 이메일:**
- occupants에 등록된 번호판(license_plates)과 매칭되는 차량 신고 시
- email-parking-notice Edge Function 호출
- 해당 유닛 owner+tenant에게 경고 이메일 자동 발송

---

### 10. `profiles` — 로그인 계정

**⭐ Supabase Auth(auth.users)와 연결되는 계정 정보.**

**컬럼:**

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| `id` | uuid | NO | - | PK (auth.users.id와 동일) |
| `email` | text | YES | - | 이메일 (UNIQUE) |
| `role` | text | NO | - | admin/committee/observer/owner/tenant |
| `updated_at` | timestamptz | YES | `now()` | 수정일 |
| `full_name` | text | YES | - | 이름 |
| `setup_complete` | boolean | YES | `false` | 비번/이름 설정 완료 여부 |
| `permissions` | jsonb | YES | `'{}'` | 추가 권한 |
| `unit` | varchar | YES | - | 기본 유닛 (초대 시 입력) |
| `push_enabled` | boolean | YES | `true` | 푸시 알림 수신 여부 |
| `last_sign_in_at` | timestamptz | YES | - | 최근 로그인 시각 |

**제약:**
- PK: `id`
- UNIQUE: `email`

**트리거:**
- `trg_profiles_updated` — UPDATE 시 `touch_updated_at()` 실행

**RLS 정책:**
```sql
-- SELECT: admin/committee/observer 전체 OR 본인
-- INSERT: 본인 auth.uid() = id
-- UPDATE: admin 또는 본인 (단, role 변경은 본인이 못 함)
-- DELETE: admin만
```

**⚠️ role 변경 방지 로직:**
```sql
profiles_update_own:
  with_check: (auth.uid() = id) AND (role = 현재 본인 role)
```
→ 본인이 본인 role을 바꿔서 admin 되는 공격 방지.

---

### 11. `project_comments` — 프로젝트 레벨 댓글

**용도:** 견적 프로젝트에 대한 Admin/Committee 논의 댓글.

**컬럼:**

| 컬럼 | 타입 | NULL | 기본값 |
|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` |
| `project_id` | text | NO | - |
| `user_email` | text | NO | - |
| `user_name` | text | NO | - |
| `comment` | text | NO | - |
| `created_at` | timestamptz | YES | `now()` |

**RLS 정책:**
```sql
-- SELECT: admin/committee/observer
-- INSERT/UPDATE: admin/committee
-- DELETE: 본인 작성자만
```

**⚠️ 원복 SQL (응급 시):**
```sql
DROP POLICY IF EXISTS project_comments_select ON project_comments;
DROP POLICY IF EXISTS project_comments_insert ON project_comments;
DROP POLICY IF EXISTS project_comments_delete ON project_comments;
CREATE POLICY project_comments_admin_only ON project_comments FOR ALL
  USING (get_my_role() = 'admin') WITH CHECK (get_my_role() = 'admin');
```

---

### 12. `push_subscriptions` — PWA 푸시 구독

**컬럼:**

| 컬럼 | 타입 | NULL |
|---|---|---|
| `user_id` | uuid | NO (PK) |
| `email` | text | YES |
| `subscription` | jsonb | NO |
| `updated_at` | timestamptz | YES |

**외래키:** `user_id` → `profiles.id`

**RLS 정책:**
```sql
-- ALL: 본인 auth.uid() = user_id
-- SELECT 추가: admin 전체 조회 가능 (/api/send-push에서 사용)
```

---

### 13. `qr_analytics` — QR 스캔 통계

**컬럼:**

| 컬럼 | 타입 | NULL |
|---|---|---|
| `id` | bigint | NO (serial PK) |
| `event_type` | text | NO |
| `created_at` | timestamptz | YES |

**RLS 정책:**
```sql
-- INSERT: 모두 (로그인 없이도)
-- SELECT: admin만
```

---

### 14. `quote_comments` — 개별 견적 댓글

**용도:** 특정 견적(quote)에 대한 Admin/Committee 논의.

**컬럼:**

| 컬럼 | 타입 | NULL | 기본값 |
|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` |
| `project_id` | text | NO | - |
| `user_id` | uuid | YES | - |
| `sender_name` | text | YES | - |
| `sender_role` | text | YES | - |
| `comment` | text | NO | - |
| `created_at` | timestamptz | YES | `now()` |

**외래키:** `user_id` → `profiles.id`

**RLS 정책:**
```sql
-- SELECT: admin/committee/observer
-- INSERT/UPDATE: admin/committee
-- DELETE: admin만
```

---

### 15. `quotes` — 견적 및 작업 (⭐ BMS 핵심 테이블)

**⭐ BMS가 만들어진 이유. Quote → Work → Report 전체 플로우의 중심.**

**컬럼:**

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `project` | text | NO | - | 프로젝트명 (레거시) |
| `vendor` | text | NO | - | 업체명 |
| `category` | text | NO | - | 카테고리 |
| `amount` | numeric | NO | - | 금액 (ex GST) |
| `notes` | text | YES | - | 비고 |
| `comment` | jsonb | YES | - | 댓글 (레거시) |
| `status` | text | YES | `'pending'` | pending/voting/approved/declined/expired |
| `created_at` | timestamptz | YES | `now()` | 생성일 |
| `is_forced` | boolean | YES | `false` | 강제 승인 여부 |
| `source` | text | YES | `'quote'` | 출처 |
| `completion_date` | date | YES | - | **완료일 (Reports 이동 트리거)** |
| `work_status` | text | YES | - | **작업 상태 (Works 단계)** |
| `expiry_date` | date | YES | - | 만료일 |
| `hold_reason` | text | YES | - | 보류 사유 |
| `display_updated_at` | timestamptz | YES | - | 표시용 수정일 |
| `is_emergency` | boolean | YES | `false` | 긴급 여부 |
| `project_id` | text | NO | - | 프로젝트 ID (그룹 견적 묶음) |
| `project_title` | text | YES | - | 프로젝트 제목 |
| `is_selected` | boolean | YES | `false` | 선정 여부 |
| `project_status` | text | YES | `'pending'` | 프로젝트 상태 |
| `archived` | boolean | YES | `false` | 아카이브 여부 |
| `work_start_date` | date | YES | - | 작업 시작일 |

**RLS 정책:**
```sql
-- SELECT: 
--   admin/committee/observer 전체 OR
--   (owner/tenant이고 completion_date IS NULL AND work_status IS NOT NULL AND archived = false)
--   → 즉 owner/tenant는 "진행 중인 작업"만 조회 가능

-- INSERT: admin만
-- UPDATE: admin/committee
-- DELETE: admin만
```

**⭐ 데이터 플로우 (사장님이 BMS 만든 이유):**

```
[QUOTES 페이지 — 시작점]
  1. Admin 견적 업로드
  2. Admin "투표 시작" 버튼 → Committee 이메일+푸시
  3. Committee 투표 → 자동 선정 (calculateResult)
  4. Admin에게 결과 이메일+푸시
  5. Admin "승인 완료" 버튼 → Committee+Observer 이메일+푸시
     (syncQuoteToWorks 실행)
     ↓
[WORKS 페이지 — 진행]
  6. work_status 업데이트
  7. Admin "Complete" 처리
  8. Admin completion_date 입력
     ↓
[REPORTS 페이지 — 종착역]
  9. 완료된 작업 영구 기록
```

**⚠️ 절대 수정 금지 함수:**
- `calculateResult()` — 투표 결과 계산
- `doUpsert()` — 투표 저장
- `forceAction()` — 강제 승인
- `confirmSelection()` — 선정 확정
- `syncQuoteToWorks()` — Works 이동

---

### 16. `settings` — 시스템 설정

**컬럼:**

| 컬럼 | 타입 | NULL |
|---|---|---|
| `key` | text | NO (PK) |
| `value` | text | NO |

**RLS 정책:**
```sql
-- ALL: admin만
```

---

### 17. `sidebar_permissions` — Role별 페이지 권한

**용도:** layout.js에서 사이드바 메뉴 표시/숨김 판단.

**컬럼:**

| 컬럼 | 타입 | NULL | 기본값 |
|---|---|---|---|
| `id` | uuid | NO | `uuid_generate_v4()` |
| `role` | text | NO | - |
| `page` | text | NO | - |
| `allowed` | boolean | YES | `true` |
| `updated_at` | timestamptz | YES | `now()` |

**제약:**
- PK: `id`
- UNIQUE: (`role`, `page`)

**RLS 정책:**
```sql
-- SELECT: admin 전체 OR 본인 role에 해당하는 것
-- ALL: admin만 (쓰기)
```

---

### 18. `signboard_entries` — 전광판 입주자 엔트리

**용도:** 1층 전광판(SignApps Express 540×960)에 표시할 입주자 정보.

**컬럼:**

| 컬럼 | 타입 | NULL | 기본값 |
|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` |
| `floor` | text | NO | - |
| `sort_order` | integer | NO | `0` |
| `business_name` | text | NO | - |
| `display_name_alt` | text | YES | - |
| `sub_info` | text | YES | - |
| `unit_display` | text | NO | - |
| `page` | integer | NO | `1` |
| `created_at` | timestamptz | YES | `now()` |
| `updated_at` | timestamptz | YES | `now()` |

**RLS 정책:**
```sql
-- SELECT: 모두 (welcome.html용)
-- ALL: admin만
```

**페이지 구성:**
- Page 1: G + L1 + L2 (14개, 25초)
- Page 2: L3 + L4 (18개, 25초)
- Page 3: L5 + L6 (18개, 25초)
- Page 4: Emergency Contacts (signboard_fullpage, 20초)

---

### 19. `signboard_fullpage` — 전광판 전체 페이지

**용도:** Page 4(Emergency Contacts) 콘텐츠.

**컬럼:**

| 컬럼 | 타입 | NULL | 기본값 |
|---|---|---|---|
| `id` | integer | NO | `1` (single row) |
| `content` | text | YES | - |
| `updated_at` | timestamptz | YES | `now()` |

**RLS:** admin만

---

### 20. `signboard_notice` — 전광판 공지

**용도:** (현재 미사용, 향후 확장용)

**컬럼:** signboard_fullpage와 동일 구조.

**RLS:** admin만

---

### 21. `vehicles` — 차량 (occupants 파생)

**⚠️ 이 테이블은 `occupants.license_plates`에서 파생됩니다. 직접 수정 금지.**

**컬럼:**

| 컬럼 | 타입 | NULL |
|---|---|---|
| `plate` | text | NO |
| `unit` | text | NO |
| `owner_name` | text | YES |

**제약:**
- PK: (`plate`, `unit`) — **복합키** (같은 번호판 다른 유닛 가능)

**RLS 정책:**
```sql
-- SELECT: admin OR (profiles.unit = vehicles.unit OR profiles.email = primary_email)
-- UPDATE: 위와 동일 (committee/owner/tenant)
-- ALL: admin (모든 권한)
```

**⚠️ 설계 원칙:**
- `occupants.license_plates`가 **마스터**
- `vehicles`는 `sync_vehicles()` RPC로만 수정
- 직접 INSERT/DELETE 금지

**⚠️ 실제 수정 흐름 (occupants.html에서):**
```javascript
// 1. occupants.license_plates 업데이트 (RLS 체크)
await supabase.from('occupants').update({ license_plates: '...' }).eq('id', id);

// 2. vehicles 동기화 (sync_vehicles RPC → SECURITY DEFINER로 RLS 우회)
await supabase.rpc('sync_vehicles', { 
  p_unit: '2D', 
  p_owner_name: 'Smile Physio', 
  p_plates: ['FFS57U', 'FLU02H'] 
});
```

**왜 2단계로 하는가:**
- 1단계(occupants): Owner/Tenant가 본인 유닛만 수정하도록 RLS로 제한
- 2단계(vehicles): RLS가 복잡해서 RPC로 우회 (SECURITY DEFINER)
- vehicles RLS는 존재하지만 실제로는 RPC가 무시하고 동작

**⚠️ parking.html 접근 방식:**
- `lookup_vehicle_plates()` SECURITY DEFINER RPC로 전체 조회
- 모든 유저가 차량→유닛 매칭 조회 가능 (의도된 설계)

---

### 22. `votes` — 견적 투표

**컬럼:**

| 컬럼 | 타입 | NULL | 기본값 |
|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` |
| `quote_id` | uuid | YES | - |
| `user_id` | uuid | YES | - |
| `vote` | text | YES | - |
| `created_at` | timestamptz | YES | `now()` |
| `user_email` | text | NO | - |
| `comment` | text | YES | - |
| `selected` | boolean | YES | `false` |
| `updated_at` | timestamptz | YES | `now()` |
| `project_id` | text | YES | - |
| `selected_quote_id` | text | YES | - |

**제약:**
- PK: `id`
- UNIQUE: (`quote_id`, `user_email`) — 같은 견적 중복 투표 방지
- UNIQUE: (`project_id`, `user_email`) — 같은 프로젝트 중복 투표 방지

**외래키:** `user_id` → `profiles.id`

**트리거:**
- `trg_votes_updated` — UPDATE 시 `touch_updated_at()` 실행

**RLS 정책:**
```sql
-- SELECT: admin/committee/observer
-- INSERT: admin/committee
-- UPDATE: admin/committee이고 user_email이 본인
-- DELETE 정책 없음 (자동 정리 Cron으로만 삭제)
```

**⚠️ 자동 정리 (Cron 매일 3AM):**
`cleanup-old-votes` — 완료된 프로젝트의 24시간 이상 지난 투표 삭제.

---

## 🔗 테이블 간 외래키 관계

```
profiles (중심)
  ↑
  ├─ complaints.user_id
  ├─ complaint_messages.user_id
  ├─ hvac_requests.user_id
  ├─ parking_reports.reported_by
  ├─ push_subscriptions.user_id
  ├─ quote_comments.user_id
  └─ votes.user_id

complaints
  ↑
  └─ complaint_messages.complaint_id
```

**⚠️ auth.users ↔ profiles:**
- auth.users 테이블(Supabase 관리)에 계정 생성
- 트리거 `on_auth_user_created`로 profiles 자동 생성
- profiles.id = auth.users.id (동일 UUID)

---

# 🛠️ PART 1.2: DB 함수 (16개)

## 함수 전체 목록

| # | 함수명 | SECURITY DEFINER | search_path | 용도 |
|---|---|---|---|---|
| 1 | `admin_set_role` | ✅ | public, auth | Admin role 변경 |
| 2 | `cleanup_old_quotes` | ❌ | - | 오래된 견적 정리 (Cron용) |
| 3 | `get_all_occupants_public` | ✅ | public | 전체 입주자 공개 정보 |
| 4 | `get_committee_members` | ✅ | public | Committee 멤버 조회 |
| 5 | `get_contractors` | ✅ | public | 계약업체 조회 (owner/tenant용) |
| 6 | `get_my_role` | ✅ | public | **현재 유저 role 조회 (RLS 핵심)** |
| 7 | `get_public_complaint_messages` | ✅ | public | 공개 민원 메시지 조회 |
| 8 | `get_public_complaints` | ✅ | public | 공개 민원 목록 조회 |
| 9 | `handle_new_user` | ✅ | public, auth | 신규 유저 자동 profiles 생성 |
| 10 | `lookup_vehicle_plates` | ✅ | public | 차량 전체 조회 (parking용) |
| 11 | `notify_announcement` | ✅ | **❌ 누락** | 공지 이메일 발송 (비활성) |
| 12 | `notify_quote` | ✅ | **❌ 누락** | 견적 이메일 발송 (레거시) |
| 13 | `sync_last_sign_in` | ✅ | public | 로그인 시각 동기화 |
| 14 | `sync_vehicles` | ✅ | **❌ 누락** | 차량 동기화 |
| 15 | `touch_updated_at` | ❌ | - | updated_at 트리거용 |
| 16 | `update_updated_at_column` | ❌ | - | updated_at 트리거용 |

**⚠️ search_path 누락 3개 함수:**
- `notify_announcement`, `notify_quote`, `sync_vehicles`
- 실전 보안 영향 없음 (Supabase 일반 유저 스키마 생성 권한 없음)
- 베스트 프랙티스 위반 (나중에 개선 가능)
- **현재 동작 중이므로 건드리지 말 것**

---

## 함수별 상세

### 1. `get_my_role()` ⭐ (RLS 시스템의 핵심)

**⚠️ 절대 수정 금지 — 2026-04-08 대형 사고 원인 함수.**

```sql
CREATE OR REPLACE FUNCTION public.get_my_role()
  RETURNS text
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
  SELECT role FROM profiles WHERE id = auth.uid();
$function$
```

**용도:** 현재 로그인한 유저의 role 반환.

**사용처:** 거의 모든 RLS 정책에서 호출.

**⚠️ SECURITY DEFINER 이유:**
- 호출한 유저가 profiles 조회 권한 없어도 동작
- SECURITY INVOKER로 바꾸면 profiles SELECT RLS에 걸려서 무한 루프 발생 → 전체 시스템 마비

**절대 변경하지 말 것:**
- LANGUAGE (sql 유지)
- STABLE 유지
- SECURITY DEFINER 유지
- SET search_path 유지

---

### 2. `lookup_vehicle_plates()` ⭐

**용도:** parking.html에서 전체 차량 조회 (RLS 우회).

```sql
CREATE OR REPLACE FUNCTION public.lookup_vehicle_plates()
  RETURNS TABLE(plate text, unit text, owner_name text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
  SELECT plate, unit, owner_name FROM vehicles;
$function$
```

**호출 방식:**
```javascript
// parking.html
const { data } = await supabase.rpc('lookup_vehicle_plates');
```

**⚠️ 왜 SECURITY DEFINER인가:**
- 모든 유저(owner/tenant 포함)가 주차 신고 시 차량→유닛 매칭해야 함
- vehicles 테이블 RLS는 본인 유닛만 보임 → RPC로 우회

---

### 3. `sync_vehicles(p_unit, p_owner_name, p_plates[])` ⭐

**용도:** occupants.license_plates 변경 시 vehicles 테이블 동기화.

```sql
CREATE OR REPLACE FUNCTION public.sync_vehicles(
  p_unit text, p_owner_name text, p_plates text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  DELETE FROM vehicles WHERE unit = p_unit;

  INSERT INTO vehicles (plate, unit, owner_name)
  SELECT
    UPPER(REGEXP_REPLACE(p, '[^A-Za-z0-9]', '', 'g')) AS plate,
    p_unit,
    p_owner_name
  FROM UNNEST(p_plates) AS p
  WHERE LENGTH(TRIM(p)) >= 2
  ON CONFLICT (plate, unit) DO UPDATE
  SET owner_name = EXCLUDED.owner_name;
END;
$function$
```

**동작:**
1. 해당 유닛의 모든 vehicles 삭제
2. 받은 번호판 배열에서 특수문자 제거 + 대문자 변환
3. 2자 이상만 INSERT
4. 중복 시 owner_name 업데이트

**호출:**
```javascript
await supabase.rpc('sync_vehicles', {
  p_unit: '2D',
  p_owner_name: 'Smile Physio',
  p_plates: ['FFS57U', 'FLU02H', 'FNJ68D', 'YMA34C']
});
```

**⚠️ 설계 원칙:**
- `vehicles` 테이블 직접 INSERT/DELETE 금지
- 반드시 `occupants.license_plates` 수정 → `sync_vehicles()` 호출 순서 준수

---

### 4. `get_all_occupants_public()`

**용도:** welcome.html(방문객 페이지)에서 전체 입주자 조회.

```sql
RETURNS TABLE(id uuid, unit text, level text, business_name text, contact_person text, is_committee boolean)
```

**공개 정보만 반환:** 이메일/전화번호 제외.

---

### 5. `get_committee_members()`

**용도:** emergency.html에서 Committee 멤버 조회 (owner/tenant용).

```sql
RETURNS TABLE(unit text, contact_person text, committee_role text, business_name text, primary_email text, phone text)
WHERE is_committee = true
```

---

### 6. `get_contractors()`

**용도:** emergency.html에서 owner/tenant도 계약업체 조회 가능하게.

contractors 테이블 RLS가 admin/committee/observer만 허용이라 owner/tenant는 RPC로 우회.

---

### 7. `get_public_complaints()`, `get_public_complaint_messages(uuid)`

**용도:** 공개(is_public=true) 민원 및 메시지만 반환.
complaints.html에서 "Public" 탭 구현에 사용.

---

### 8. `handle_new_user()` (트리거 함수)

**⚠️ 신규 가입의 핵심. 이게 깨지면 가입 전체 마비.**

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, role, unit, full_name)
  VALUES (
    NEW.id,
    LOWER(NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'observer'),
    NEW.raw_user_meta_data->>'unit',
    NEW.raw_user_meta_data->>'full_name'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$
```

**트리거:** `on_auth_user_created` (auth.users INSERT 시)

**동작:**
- auth.users에 새 계정 생성되면 자동 실행
- profiles 테이블에 같은 id로 행 추가
- role이 없으면 기본값 'observer'
- 이미 있으면 아무것도 안 함

---

### 9. `sync_last_sign_in()` (트리거 함수)

**용도:** auth.users.last_sign_in_at → profiles.last_sign_in_at 동기화.

**트리거 2개:**
- `on_auth_sign_in` (auth.users UPDATE)
- `on_auth_sign_in_insert` (auth.users INSERT, last_sign_in_at NOT NULL인 경우)

**이유:** auth.users 직접 조회는 불편하니 profiles에 복사해서 쿼리.

---

### 10. `admin_set_role(p_email, p_role)`

**용도:** Admin이 다른 유저의 role을 변경할 때.

**제약:**
- 호출자가 admin이어야 함
- 변경 가능 role: admin/committee/observer (owner/tenant 제외)

---

### 11. `notify_announcement()`, `notify_quote()` (레거시)

**⚠️ 현재 트리거로 연결되어 있지 않음.**

두 함수 모두:
- SECURITY DEFINER로 선언됨
- search_path 누락 (베스트 프랙티스 위반)
- 내부에 **Supabase anon key JWT 하드코딩됨**

**왜 연결 안 되어 있나:**
- `notify_announcement`: Resend 무료 한도 방지로 **의도적 비활성**
- `notify_quote`: Edge Function body 포맷 불일치 (레거시)

**실제 이메일 발송 방식:**
- 프론트엔드(announcements.html, quotes.html)에서 직접 Edge Function `fetch()` 호출
- DB 트리거 사용 안 함

**⚠️ Supabase key rotation 시 주의:**
- 이 2개 함수 내부의 JWT 토큰도 함께 업데이트 필요
- 안 하면 (미래에 다시 트리거 연결 시) 연동 끊김

---

### 12. `cleanup_old_quotes()`

**용도:** 오래된 declined/expired 견적 삭제 (Cron 매일 3AM).

```sql
DELETE FROM quotes
WHERE status IN ('declined','expired','removed')
AND work_status IS NULL
AND completion_date IS NULL
AND created_at < NOW() - INTERVAL '30 days';
```

**보호 대상:** 승인된 견적, 진행 중인 작업, 완료된 작업, 활성 견적.

---

### 13-14. `touch_updated_at()`, `update_updated_at_column()`

**용도:** UPDATE 시 updated_at 컬럼 자동 갱신.

```sql
-- touch_updated_at (profiles, votes 트리거용)
BEGIN
  new.updated_at = now();
  return new;
END;

-- update_updated_at_column (occupants 트리거용)
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
```

**⚠️ 두 함수 차이 없음.** 같은 로직이지만 히스토리상 2개 존재.

---

# 🔔 PART 1.3: 트리거 (6개)

## 트리거 전체 목록

| # | 스키마 | 테이블 | 트리거명 | 타이밍 | 이벤트 | 실행 함수 |
|---|---|---|---|---|---|---|
| 1 | auth | users | on_auth_sign_in | AFTER | UPDATE | sync_last_sign_in() |
| 2 | auth | users | on_auth_sign_in_insert | AFTER | INSERT | sync_last_sign_in() |
| 3 | auth | users | on_auth_user_created | AFTER | INSERT | handle_new_user() |
| 4 | public | occupants | set_updated_at | BEFORE | UPDATE | update_updated_at_column() |
| 5 | public | profiles | trg_profiles_updated | BEFORE | UPDATE | touch_updated_at() |
| 6 | public | votes | trg_votes_updated | BEFORE | UPDATE | touch_updated_at() |

## 트리거 동작 설명

### auth.users 트리거 3개 (가입/로그인)

**on_auth_user_created:**
- 새 사용자가 가입하면 자동으로 `profiles` 테이블에 행 추가
- role 기본값 'observer'
- 이게 깨지면 → **신규 가입자가 BMS 사용 불가** (profiles 없음)

**on_auth_sign_in, on_auth_sign_in_insert:**
- 로그인 시각을 profiles에 복사
- users.html에서 마지막 로그인 시각 표시에 사용

### public 트리거 3개 (updated_at 자동 갱신)

**set_updated_at (occupants):**
- 입주자 정보 수정 시 updated_at 자동 업데이트
- "마지막 수정 누가 언제" 추적

**trg_profiles_updated (profiles):**
- 계정 정보 수정 시 updated_at 자동 업데이트

**trg_votes_updated (votes):**
- 투표 수정(예: 의견 변경) 시 updated_at 자동 업데이트

---

# ⚡ PART 1.4: Edge Functions (7개)

## 🔔 각 페이지별 알림 방식 정리 (중요)

BMS는 **Push 알림**과 **Email 발송** 2가지 알림 채널을 운영합니다.
페이지/이벤트별로 사용 방식이 다릅니다.

| 이벤트 | Push 알림 | Email 발송 | 수신 대상 |
|---|---|---|---|
| **공지 작성** (announcements) | ✅ send-push | ❌ 없음 | 전체 유저 (Push만) |
| **공지 재발송** (announcements) | ✅ send-push | ❌ 없음 | 전체 유저 |
| **민원 생성** (complaints) | ✅ send-push | ❌ 없음 | Admin (Push만) |
| **Admin 답변** (complaints) | ✅ send-push | ❌ 없음 | 민원 작성자 (Push만) |
| **입주자 답글** (complaints) | ✅ send-push | ❌ 없음 | Admin (Push만) |
| **HVAC 요청** (hvac) | ✅ send-push | ❌ 없음 | Admin (Push만) |
| **HVAC 승인** (hvac) | ✅ send-push | ❌ 없음 | 요청자 (Push만) |
| **HVAC 완료** (hvac) | ✅ send-push | ❌ 없음 | 요청자 (Push만) |
| **견적 투표 시작** (quotes) | ✅ send-push | ✅ email-quote-voting | admin/committee/observer |
| **투표 완료 (자동)** (quotes) | ✅ send-push | ❌ 없음 | **Admin만** (Push로 "확인 필요" 알림) |
| **견적 승인 완료** (quotes) | ✅ send-push | ✅ email-quote-confirm | admin/committee/observer |
| **주차 위반 신고** (parking) | ❌ 없음 | ✅ email-parking-notice | 해당 유닛 owner+tenant |

**핵심 원칙:**
- **Push는 적극 사용** (무료, 빠름)
- **Email은 중요/공식 건만** (Resend 한도 + 스팸 방지)
- 견적 관련만 이메일+Push 둘 다 (공식 문서 필요)
- 주차 위반만 이메일 단독 (Push 구독 안 한 입주자 대응)

---

## Edge Function 전체 목록

| # | 이름 | 상태 | 호출 방식 |
|---|---|---|---|
| 1 | `email-announcement` | **비활성** (Resend 한도 방지) | 프론트 호출 없음 |
| 2 | `email-complaint-response` | **비활성** (Push로 대체) | 프론트 호출 없음 |
| 3 | `email-parking-notice` | 사용 중 | parking.html |
| 4 | `email-quote-voting` | 사용 중 | quotes.html |
| 5 | `email-quote-confirm` | 사용 중 | quotes.html |
| 6 | `cleanup-images` | 사용 중 | Cron (매일 3AM) |
| 7 | `cleanup_parking_images` | 사용 중 | Cron (매일 3AM) |

---

## 1. email-announcement (현재 프론트엔드에서 호출 안 됨)

**용도:** 새 공지 발송 시 전체 유저에게 이메일.

**수신자:**
- `profiles` 전체 이메일
- `occupants.business_email` (콤마 분리)
- 중복 제거

**발신:** `notify@scafacility.com`
**Reply-To:** `sp77249.redmyre@gmail.com`

**⚠️ 현재 동작:**
- **announcements.html은 이 Edge Function을 호출하지 않음**
- 공지 작성 시 `/api/send-push`만 호출 (Push 알림만)
- announcements.html 408줄, 442줄, 524줄 모두 send-push만 사용

**⚠️ 왜 비활성인가:**
- 한 번에 77명+ 이메일 발송
- Resend 무료 플랜 일일 한도(100/일) 초과 위험
- 다른 이메일(민원, 견적 등) 발송 터질 우려
- **Edge Function 코드는 보관** (미래 사용 시 프론트에서 호출만 추가하면 됨)

**트리거 연결:**
- notify_announcement DB 함수는 이 Edge Function을 호출하게 되어 있으나
- **DB 트리거로 등록되지 않음** (레거시)

---

## 2. email-complaint-response (비활성)

**용도:** 민원 답변 이메일 (양방향 — admin↔resident).

**설계 (원래):**
```javascript
if (sender_role === 'admin') {
  // Admin 답변 → 민원 작성자한테만
  recipients = [requester.email];
} else {
  // 입주자 추가 답변 → Admin 전체한테
  recipients = admins.map(a => a.email);
}
```

**⚠️ 비활성 이유:**
- 이메일이 너무 많이 발송됨
- 현재는 **Push 알림만 사용** (complaints.html 624, 784, 790줄)
- Edge Function 코드는 보관

**발송 시 BCC:** sca.yun82@gmail.com, sca.jacob77@gmail.com (info@scafacility.com 제거됨 — 2026-04-28 비용 폭탄 사건)

---

## 3. email-parking-notice (사용 중)

**용도:** 등록 차량 주차 위반 시 해당 유닛 owner+tenant에게 경고 이메일.

**호출 위치:** parking.html

**수신자 결정:**
```javascript
occupants.primary_email + business_email (콤마 분리) → 중복 제거
```

**발신:** `Redmyre House <notify@scafacility.com>`

**⚠️ BCC 없음** (익명성 유지 — 누가 신고했는지 외부에 알리지 않음)

**템플릿:** 빨간색 URGENT 테마, 위반 상세 + 워닝 스티커 경고 + 방문자 주차 안내.

---

## 4. email-quote-voting (사용 중)

**용도:** 견적 투표 시작 시 Admin/Committee/Observer 전체에게 이메일.

**호출 위치:** quotes.html (투표 시작 버튼)

**수신자:**
```sql
SELECT email FROM profiles WHERE role IN ('admin', 'committee', 'observer')
```

**Fallback:** 빈 경우 `ikf.jacob@gmail.com` (사장님 테스트 이메일)

**BCC:** sca.yun82@gmail.com, sca.jacob77@gmail.com (info@scafacility.com 제거됨 — 2026-04-28 비용 폭탄 사건)

**body 형식:**
```json
{ 
  "record": { 
    "project": "Lift Repair", 
    "quotes": [{"vendor": "...", "amount": 5000}, ...] 
  } 
}
```

---

## 5. email-quote-confirm (사용 중)

**용도:** 견적 승인 완료 시 Admin/Committee/Observer 전체에게 이메일.

**호출 위치:** quotes.html (승인 완료 버튼)

**수신자/BCC:** email-quote-voting과 동일.

**body 형식:**
```json
{
  "record": {
    "project": "Lift Repair",
    "result": "approved",  // approved/declined/hold
    "quotes": [{"vendor": "...", "amount": 5000}, ...]
  }
}
```

**템플릿:** 결과 색상 구분 (approved=녹색, declined=빨강, hold=노랑).

---

## 6. cleanup-images (사용 중)

**용도:** 해결된 주차 리포트의 이미지 삭제 (3일 경과).

**Cron:** 매일 03:00 AM

**동작:**
```sql
SELECT id, image_url FROM parking_reports
WHERE status = 'resolved' AND resolved_at < NOW() - INTERVAL '3 days'
```
1. Storage `parking-images` 버킷에서 파일 삭제
2. DB의 image_url을 NULL로 업데이트

**⚠️ image_urls (배열) 미처리** — 구버전 방식. cleanup_parking_images로 보완.

---

## 7. cleanup_parking_images (사용 중)

**용도:** 30일 경과한 모든 주차 리포트 이미지 정리.

**Cron:** 매일 03:00 AM

**동작:**
```sql
SELECT id, image_url, image_urls FROM parking_reports
WHERE created_at < NOW() - INTERVAL '30 days'
AND (image_url IS NOT NULL OR image_urls IS NOT NULL)
```
1. `image_url` + `image_urls` 배열 둘 다 파싱
2. Storage에서 실제 파일 삭제
3. DB의 image_url, image_urls를 NULL로 업데이트
4. **parking_reports 레코드 자체는 유지** (이력 보존)

**⚠️ Cron에 Service Role Key 하드코딩됨** — key rotation 시 이 Cron도 업데이트 필수.

---

# ⏰ PART 1.5: Cron Jobs (4개)

## Cron Job 전체 목록

| # | 이름 | 스케줄 | 작업 |
|---|---|---|---|
| 1 | `cleanup-images-job` | `0 3 * * *` (매일 3AM) | Edge Function 호출: cleanup-images |
| 2 | `cleanup-parking-images-job` | `0 3 * * *` (매일 3AM) | Edge Function 호출: cleanup_parking_images |
| 3 | `cleanup-old-votes` | `0 3 * * *` (매일 3AM) | SQL: 완료된 프로젝트 투표 삭제 |
| 4 | `cleanup-old-quotes` | `0 3 * * *` (매일 3AM) | 함수 호출: `cleanup_old_quotes()` |

## Cron Job 상세

### 1. cleanup-images-job

```sql
SELECT net.http_post(
  url := 'https://wunsexdnqathluplkkvo.supabase.co/functions/v1/cleanup-images',
  headers := '{"Content-Type": "application/json"}'::jsonb,
  body := '{}'::jsonb
);
```

### 2. cleanup-parking-images-job

**⚠️ Service Role Key 하드코딩 주의**

```sql
SELECT net.http_post(
  url := 'https://wunsexdnqathluplkkvo.supabase.co/functions/v1/cleanup_parking_images',
  headers := jsonb_build_object(
    'Authorization', 'Bearer <service_role_jwt>'
  )
);
```

### 3. cleanup-old-votes

```sql
DELETE FROM votes v
WHERE
  EXISTS (
    SELECT 1 FROM quotes q3
    WHERE q3.project_id = v.project_id
    AND q3.created_at < NOW() - INTERVAL '24 hours'
  )
  AND EXISTS (
    SELECT 1 FROM quotes q
    WHERE q.project_id = v.project_id
    AND (
      q.work_status IS NOT NULL
      OR q.status NOT IN ('draft', 'voting', 'pending')
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM quotes q2
    WHERE q2.project_id = v.project_id
    AND q2.status IN ('draft', 'voting', 'pending')
    AND q2.work_status IS NULL
  );
```

**동작:** 프로젝트가 완료/확정되고 24시간 지난 투표 정리.

### 4. cleanup-old-quotes

```sql
SELECT cleanup_old_quotes();
```

**동작:** declined/expired/removed 상태이고 30일 지난 견적 삭제.

---

# 📁 PART 1.6: Storage Buckets (4개)

## Storage 전체 목록

| 이름 | 공개 | 용량 제한 | 파일 형식 | 용도 |
|---|---|---|---|---|
| `announcements` | Public | 50MB | Any | 공지 첨부파일 |
| `complaint-images` | Public | 5MB | 이미지+PDF | 민원 사진 |
| `parking-images` | Public | 5MB | 이미지 | 주차 위반 사진 |
| `quotes` | **Private** | 50MB | Any | 견적서 PDF (⚠️ 4중 방어망) |

---

## ⚠️⚠️⚠️ Quotes Storage 4중 방어망 — 절대 건드리지 말 것

### 역사적 사고 (2026-04-08)
Storage RLS 정책 정리 시도 → Admin/Committee까지 견적 파일 접근 불가 → **2개월치 작업 날릴 뻔함** → 긴급 복구.

### 현재 설계 (의도됨)

**Storage RLS는 느슨하게 열려 있음** ("모든 인증 유저 SELECT 가능")

**실제 접근 차단은 4중 UI 방어망으로 구현:**

#### 레이어 1: 사이드바 차단 (layout.js)
- `quotes`, `reports`, `cost-dashboard` 메뉴를 owner/tenant에게서 숨김

#### 레이어 2: 페이지 리다이렉트 (layout.js `checkPageAccess`)
- URL 직접 입력해도 building.html로 강제 이동

#### 레이어 3: UI 렌더 차단 (works.html 545줄)
```javascript
if (_canViewInternal && parsed.files && parsed.files.length > 0) {
  filesHtml += `<div class="file-preview" onclick="openFileViewer(...)">...`;
}
```
- `_canViewInternal = ['admin','committee','observer'].includes(role)`
- owner/tenant는 파일 버튼 자체가 HTML에 없음

#### 레이어 4: Signed URL 1시간 만료
```javascript
await supabase.storage.from('quotes').createSignedUrl(path, 3600);
```
- 공유된 URL도 1시간 후 자동 차단

### ❌ 절대 하지 말 것
- storage.objects의 quotes 관련 정책 DROP/ALTER 금지
- "중복 정책 정리" 명목으로도 건드리지 말 것
- 더 엄격하게 만들고 싶어도 금지 — 4/8 사고 재현

### 📋 만약 정리가 불가피하면
1. Admin 계정으로 먼저 파일 업로드/조회 테스트
2. Committee 계정으로 조회 테스트
3. Owner 계정으로 접근 불가 확인
4. 이 순서 한 번이라도 깨지면 즉시 원복

---

## Storage 정책 목록 (23개)

### quotes 버킷 (중복 많음, 건드리지 말 것)

| 정책명 | 동작 | 조건 |
|---|---|---|
| Admins can upload quote files | INSERT | admin만 |
| Admins can upload quote files 1jcgk1j_0 | INSERT | admin만 (중복) |
| quotes_bucket_write_admin | INSERT | admin만 |
| storage_admin_insert_quotes | INSERT | admin만 |
| quotes_storage_insert | INSERT | bucket_id만 체크 |
| Allow public read 1jcgk1j_0 | SELECT | bucket_id만 체크 |
| Authenticated users can read quote files | SELECT | bucket_id만 체크 |
| Committee can view quote files | SELECT | admin/committee |
| Committee can view quote files 1jcgk1j_0 | SELECT | admin/committee (중복) |
| quotes_bucket_read_auth | SELECT | bucket_id만 체크 |
| quotes_storage_read | SELECT | bucket_id만 체크 |
| storage_read_quotes_authed | SELECT | bucket_id만 체크 |
| quotes_bucket_delete_admin | DELETE | admin만 |
| storage_admin_delete_quotes | DELETE | admin만 |
| storage_admin_update_quotes | UPDATE | admin만 |

### complaint-images 버킷

| 정책명 | 동작 | 조건 |
|---|---|---|
| Anyone can view complaint images | SELECT | 모두 |
| Authenticated users can upload complaint images | INSERT | 인증된 유저 |
| Authenticated users can delete complaint images | DELETE | 인증된 유저 |

### parking-images 버킷

| 정책명 | 동작 | 조건 |
|---|---|---|
| Allow public read | SELECT | 모두 |
| Allow authenticated upload | INSERT | 인증된 유저 |

(DELETE 정책 없음 — cleanup Edge Function이 service_role로 정리)

### announcements 버킷

| 정책명 | 동작 | 조건 |
|---|---|---|
| announcements_storage_read | SELECT | 모두 |
| announcements_storage_insert | INSERT | admin만 |
| announcements_storage_delete | DELETE | admin만 |

---

# 🔐 PART 1.7: 하드코딩 키 보안 경고

## 🔔 Service Worker (`/sw.js`)

**⚠️ PWA 푸시 알림의 핵심 컴포넌트.**

**VAPID Public Key (하드코딩됨):**
```javascript
const VAPID_PUBLIC_KEY = 'BNyzSuyh9RRzRLNiPq1mngiuEH35QX3smFJoYQGWdOSdu_4koNy4s65I8WUpI1gxanRgJLNU0gDJfhW1PUdxQrI';
```

**Cache 버전:**
```javascript
const CACHE_NAME = 'redmyre-bms-v5';
```

**이벤트 처리:**
- `install`: `self.skipWaiting()` — 즉시 새 버전 설치
- `activate`: `clients.claim()` — 모든 탭 즉시 제어
- `push`: 알림 표시 (title, body, icon, url)
- `notificationclick`: 기존 탭이 있으면 해당 URL로 이동, 없으면 새 창

**⚠️ VAPID Key 교체 시:**
- sw.js의 VAPID_PUBLIC_KEY
- Vercel 환경변수 VAPI_PUBLIC_KEY, VAPI_PRIVATE_KEY
- 둘 다 동시 업데이트 필수

**⚠️ CACHE_NAME 변경 시:**
- 버전 숫자 올리면 (`v5` → `v6`) 기존 캐시 무효화
- 사용자 측에서 새 버전으로 자동 업데이트

---

## 발견된 하드코딩 키 위치

### 1. DB 함수 `notify_announcement`
- **키 종류:** Supabase anon key (JWT)
- **위치:** 함수 내부 `Authorization: Bearer ...`
- **위험도:** 낮음 (anon key는 원래 공개 키)

### 2. DB 함수 `notify_quote`
- **키 종류:** Supabase anon key (JWT)
- **위치:** 함수 내부 `Authorization: Bearer ...`
- **위험도:** 낮음

### 3. Cron Job `cleanup-parking-images-job`
- **키 종류:** Supabase **service_role** key (JWT)
- **위치:** Cron command의 Authorization 헤더
- **위험도:** 중간 (service_role은 모든 RLS 우회 가능)
- **보호:** cron.job 테이블은 DB 관리자만 조회 가능 → 외부 노출 제한적

### 4. `auth.js` (프론트엔드)
- **키 종류:** Supabase anon key
- **위치:** `SUPABASE_ANON_KEY = 'sb_publishable_...'`
- **위험도:** 없음 (프론트엔드 anon key는 원래 공개)

## ⚠️ Supabase Key Rotation 시 필수 절차

**anon key 변경 시:**
1. `notify_announcement` 함수 내 키 업데이트
2. `notify_quote` 함수 내 키 업데이트
3. `auth.js` 키 업데이트
4. 이 3개 순서대로 동시 진행

**service_role key 변경 시:**
1. Cron Job `cleanup-parking-images-job` 내 키 업데이트
2. Vercel 환경변수 `SUPABASE_SERVICE_ROLE_KEY` 업데이트
3. Supabase Edge Functions 환경변수 확인

**⚠️ 하나라도 빠뜨리면:**
- 이메일 발송 중단
- 이미지 정리 실패
- Vercel API (check-email, send-invite 등) 전체 실패

**권장:** 실전 운영 중에는 key rotation 절대 하지 말 것. 필요 시 위 절차 완벽히 준비 후 진행.

---


# 🚑 PART 1.8: 응급 복구 SQL

## 상황별 복구 SQL

### 1. project_comments RLS 원복

**증상:** project_comments 정책 수정 후 댓글 작성 불가 또는 보안 이슈.

```sql
DROP POLICY IF EXISTS project_comments_select ON project_comments;
DROP POLICY IF EXISTS project_comments_insert ON project_comments;
DROP POLICY IF EXISTS project_comments_update ON project_comments;
DROP POLICY IF EXISTS project_comments_delete ON project_comments;

CREATE POLICY project_comments_select ON project_comments FOR SELECT
  USING (get_my_role() = ANY (ARRAY['admin','committee','observer']));

CREATE POLICY project_comments_insert ON project_comments FOR INSERT
  WITH CHECK (get_my_role() = ANY (ARRAY['admin','committee']));

CREATE POLICY project_comments_update ON project_comments FOR UPDATE
  USING (get_my_role() = ANY (ARRAY['admin','committee']));

CREATE POLICY project_comments_delete ON project_comments FOR DELETE
  USING (user_email = (auth.jwt() ->> 'email'::text));
```

### 2. get_my_role() 복구 (4/8 사고 유형)

**증상:** 전체 유저 role이 observer로 떨어짐.

```sql
CREATE OR REPLACE FUNCTION public.get_my_role()
  RETURNS text
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
  SELECT role FROM profiles WHERE id = auth.uid();
$function$;
```

### 3. occupants RLS 원복

**증상:** 다중 유닛 owner/tenant가 본인 유닛 못 봄.

```sql
DROP POLICY IF EXISTS occupants_select ON occupants;
DROP POLICY IF EXISTS occupants_update ON occupants;

CREATE POLICY occupants_select ON occupants FOR SELECT
USING (
  get_my_role() IN ('admin','committee','observer')
  OR EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND (
      profiles.unit::text = occupants.unit::text
      OR LOWER(profiles.email) = LOWER(occupants.primary_email::text)
      OR (
        occupants.business_email IS NOT NULL
        AND occupants.business_email <> ''
        AND LOWER(profiles.email) = ANY (
          string_to_array(LOWER(REPLACE(occupants.business_email, ' ', '')), ',')
        )
      )
    )
  )
);

CREATE POLICY occupants_update ON occupants FOR UPDATE
USING (
  get_my_role() = 'admin'
  OR (
    get_my_role() IN ('committee','owner','tenant')
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND (
        profiles.unit::text = occupants.unit::text
        OR LOWER(profiles.email) = LOWER(occupants.primary_email::text)
        OR (
          occupants.business_email IS NOT NULL
          AND occupants.business_email <> ''
          AND LOWER(profiles.email) = ANY (
            string_to_array(LOWER(REPLACE(occupants.business_email, ' ', '')), ',')
          )
        )
      )
    )
  )
);
```

### 4. 차량 전체 리셋 (occupants.license_plates 기준)

**증상:** vehicles와 occupants.license_plates 동기화 깨짐.

```sql
-- 1. 현재 상태 확인
SELECT unit, license_plates FROM occupants WHERE license_plates IS NOT NULL;

-- 2. 전체 유닛에 대해 sync_vehicles 실행
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT unit, contact_person, license_plates FROM occupants WHERE license_plates IS NOT NULL LOOP
    PERFORM sync_vehicles(
      r.unit::text,
      COALESCE(r.contact_person::text, ''),
      string_to_array(r.license_plates, ', ')
    );
  END LOOP;
END $$;

-- 3. 검증
SELECT COUNT(*) FROM vehicles;
```

### 5. 비밀번호 일괄 리셋 (111111)

**증상:** 입주자들이 비번 못 찾겠다고 요청.

```sql
-- 미로그인 + 셋업 미완료 유저만 대상 (기존 유저는 건드리지 말 것)
-- Supabase Auth Admin API를 통해 해야 함 (DB 직접 수정 불가)
-- admin-set-password.js API 참조
```

**⚠️ 실제 비번 리셋은 Supabase Auth에서. DB 직접 수정 불가.**

### 6. 트리거 복구 (handle_new_user)

**증상:** 신규 가입이 profiles에 반영 안 됨.

```sql
-- 함수 재생성
CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, role, unit, full_name)
  VALUES (
    NEW.id,
    LOWER(NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'observer'),
    NEW.raw_user_meta_data->>'unit',
    NEW.raw_user_meta_data->>'full_name'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- 트리거 재생성
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();
```

---

# 📋 Part 1 체크리스트

## DB 현황 확인 쿼리 모음

### 모든 테이블에 RLS 활성화 여부
```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```
**기대 결과:** 22개 테이블 전부 `rowsecurity = true`

### 모든 RLS 정책 조회
```sql
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd;
```
**기대 결과:** 60+ 정책

### SECURITY DEFINER 함수 전체
```sql
SELECT proname, prosecdef, proconfig
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
ORDER BY proname;
```
**기대 결과:** 16개 함수 (13개는 search_path 있음, 3개는 없음)

### 트리거 전체
```sql
SELECT n.nspname, c.relname, t.tgname
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal
  AND n.nspname IN ('public', 'auth')
ORDER BY n.nspname, c.relname;
```
**기대 결과:** 6개 트리거 (public 3 + auth 3)

### Cron 작업 확인
```sql
SELECT jobid, jobname, schedule, active FROM cron.job;
```
**기대 결과:** 4개 작업 전부 active=true

### Storage 버킷 확인
```sql
SELECT name, public, file_size_limit, allowed_mime_types
FROM storage.buckets;
```
**기대 결과:** 4개 (quotes=private, 나머지 3개=public)

---

# ✅ PART 1 완료

**Part 1 내용:**
- 22개 테이블 완전 상세 (컬럼, 제약, RLS)
- 16개 DB 함수 (SECURITY DEFINER 표시 포함)
- 6개 트리거 (public + auth)
- 7개 Edge Functions (사용 여부 명시)
- 4개 Cron Jobs
- 4개 Storage Buckets + Quotes 4중 방어망
- 하드코딩 키 보안 경고
- 응급 복구 SQL 6가지

---

# 🌐 PART 1.9: Vercel 설정

## vercel.json URL Rewrites

**용도:** 깔끔한 URL을 실제 /pages/*.html 파일로 연결.

```json
{
  "rewrites": [
    { "source": "/", "destination": "/index.html" },
    { "source": "/building", "destination": "/pages/building.html" },
    { "source": "/announcements", "destination": "/pages/announcements.html" },
    { "source": "/complaints", "destination": "/pages/complaints.html" },
    { "source": "/works", "destination": "/pages/works.html" },
    { "source": "/quotes", "destination": "/pages/quotes.html" },
    { "source": "/reports", "destination": "/pages/reports.html" },
    { "source": "/parking", "destination": "/pages/parking.html" },
    { "source": "/hvac", "destination": "/pages/hvac.html" },
    { "source": "/history", "destination": "/pages/history.html" },
    { "source": "/emergency", "destination": "/pages/emergency.html" },
    { "source": "/users", "destination": "/pages/users.html" },
    { "source": "/occupants", "destination": "/pages/occupants.html" },
    { "source": "/cost-dashboard", "destination": "/pages/cost-dashboard.html" },
    { "source": "/system", "destination": "/pages/system.html" },
    { "source": "/signboard", "destination": "/pages/signboard.html" },
    { "source": "/guide-resident", "destination": "/pages/guide-resident.html" },
    { "source": "/guide-committee", "destination": "/pages/guide-committee.html" },
    { "source": "/setup", "destination": "/pages/setup.html" },
    { "source": "/reset-password", "destination": "/pages/reset-password.html" }
  ]
}
```

## Vercel Functions 설정

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

- 메모리: 512MB
- 최대 실행 시간: 10초

## package.json 의존성

```json
{
  "name": "sca-redmyre",
  "private": true,
  "dependencies": {
    "web-push": "^3.6.7",
    "@supabase/supabase-js": "^2.0.0"
  }
}
```

## 환경변수 (Vercel 대시보드에 설정)

| 변수명 | 용도 |
|---|---|
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_ANON_KEY` | 프론트엔드용 공개 키 |
| `SUPABASE_SERVICE_ROLE_KEY` | API 서버용 관리자 키 ⚠️ |
| `VAPI_SUBJECT` | Push 알림 주체 이메일 |
| `VAPI_PUBLIC_KEY` | VAPID 공개 키 |
| `VAPI_PRIVATE_KEY` | VAPID 비공개 키 ⚠️ |
| `SITE_URL` | BMS 사이트 URL (send-invite에서 사용) |

**⚠️ Service Role Key 노출 시 보안 사고 발생.**

---

**다음:**
- Part 2 — 페이지 (20개 HTML)
- Part 3 — JS/API/외부 연동
- Part 4 — 운영 가이드 + 금기사항

---
