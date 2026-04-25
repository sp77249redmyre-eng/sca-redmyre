# Redmyre BMS — Master Manual Part 4
## 운영 가이드 (실전 시나리오)

---

**작성일**: 2026-04-25
**작성 기준**: Part 1, 2, 3 매뉴얼 + 사장님과 실제 작업 대화 기록 (2026-04-08 ~ 2026-04-25)
**대상**: Jacob 사장님 본인 + 차기 BMS 운영자 (인수인계용)
**원칙**: 추측 없이 실제 발생한 사례와 코드 기반 사실만 기록

---

# 📋 Part 4 구성

| Section | 내용 | 시나리오/항목 수 |
|---|---|---|
| Section 1 | 자주 발생하는 장애 대응 | 5개 |
| Section 2 | 일상 운영 절차 | 5개 |
| Section 3 | 5월 SCM 발표용 요약본 | 2개 |
| Section 4 | 인수인계 체크리스트 | 4개 |

---

# 📋 Section 0: 장애 대응 일반 원칙

## 0-1. 진단 우선순위
1. **사장님 환경 문제인가** → 다른 디바이스/계정으로 재현 시도
2. **특정 유저 문제인가** → 다른 유저는 정상인지 확인
3. **시스템 전체 문제인가** → BMS 자체 다운 여부

## 0-2. 정보 수집 순서
| 순서 | 확인 |
|---|---|
| 1 | 사용자가 본 정확한 에러 메시지/증상 |
| 2 | 발생 시각 (Vercel Logs, Supabase Logs 조회 기준) |
| 3 | 사용 디바이스/브라우저 |
| 4 | 재현 가능 여부 |

## 0-3. 로그 확인 4곳
1. **Vercel Dashboard → sca-redmyre → Logs (또는 Functions)** — API 호출 로그
2. **Supabase Dashboard → Edge Functions → 함수명 → Logs** — 이메일/cleanup 로그
3. **Supabase Dashboard → Database → Logs** — DB 에러
4. **브라우저 F12 → Console** — 클라이언트 에러

## 0-4. 사장님이 자주 사용하는 대응 패턴
- DB 직접 조회: Supabase SQL Editor
- 파일 직접 확인: GitHub repo
- 사용자 강제 비번 리셋: users.html (admin-set-password)
- 캐시 문제 의심: 사용자에게 시크릿 모드/Hard Refresh 요청

---

# 🚨 Section 1: 자주 발생하는 장애 대응

## 🔴 시나리오 1: Push 알림 안 옴

### 1-1. 발생 사례 (4월 20일 사고)

**증상**: 사장님이 Kit의 complaint 답변을 했는데 본인 폰(S10)에 Push 알림 안 옴.

**조사 과정**
1. 폰 시스템 알림 권한 — 정상
2. BMS PWA 설치 + 알림 허용 — 정상
3. Vercel 환경변수 `VAPI_PUBLIC_KEY` / `VAPI_PRIVATE_KEY` / `VAPI_SUBJECT` — send-push.js 코드와 이름 일치, 정상
4. SQL로 push_subscriptions 확인 → endpoint가 `https://fcm.googleapis.com/fcm/send/...` (Google이 2024년 6월 종료한 레거시 FCM 주소)

**진짜 원인 (조사 중 발견)**
- send-push.js에서 `push_subscriptions` 쿼리 시 `select id` 사용했는데, 테이블에 `id` 컬럼이 없어서 쿼리 자체가 실패
- 실패는 조용히 `catch{}`로 삼킴 → Vercel은 Status 200 반환 → `sent: 0`으로 끝남
- **결과: 모든 Push 알림 (공지/Complaint/HVAC/Quote/Parking/Works) 전부 먹통이었음**
- 영향 기간: push_subscriptions 테이블에서 id 컬럼 제거된 시점부터 (정확한 시점 불명)

**해결**
- send-push.js의 `select id` 부분을 테이블 실제 컬럼에 맞게 수정 → 배포 → 즉시 정상

**해결 후 확인**
- 사장님 폰에 알림 정상 도착 확인
- 추가로 SQL로 전체 입주자 구독 현황 확인 → 67명 중 7명만 구독 있고 60명은 구독 없는 상태였음 → 이 부분은 입주자가 직접 BMS에서 알림 토글 ON 해야 해결

**4월 21일 정책 변경 (이 사고 직후)**
- announcements, complaints는 **Push만 보내고 이메일 발송 OFF**
- 이유: Resend/Supabase SMTP 한도 보호 (60명+ 일괄 발송 시 한도 초과 위험)
- ❌ **이메일 재추가 절대 금지** (사장님 명시)

### 1-2. 진단 절차

#### 1차: 사용자 측 확인
- 폰 시스템 알림 권한 (Android: 설정 → 앱 → BMS → 알림 / iOS: 설정 → 알림 → BMS)
- BMS 사이드바 알림 토글 ON 상태
- PWA 설치 상태 (홈화면에 BMS 아이콘 있는지)

#### 2차: DB 확인 (Supabase SQL Editor)

**해당 유저 구독 상태:**
```sql
SELECT 
  p.email, 
  p.role, 
  p.push_enabled,
  ps.updated_at,
  ps.subscription->>'endpoint' as endpoint
FROM profiles p
LEFT JOIN push_subscriptions ps ON ps.user_id = p.id
WHERE p.email = '<유저 이메일>';
```

**전체 구독 현황 (시스템 전체 문제 의심 시):**
```sql
SELECT 
  COUNT(*) FILTER (WHERE ps.user_id IS NOT NULL) AS subscribed,
  COUNT(*) FILTER (WHERE ps.user_id IS NULL) AS not_subscribed
FROM profiles p
LEFT JOIN push_subscriptions ps ON ps.user_id = p.id
WHERE p.push_enabled = true;
```

#### 3차: Vercel Logs
- Vercel Dashboard → sca-redmyre → Logs
- 시간 필터를 사고 발생 시각으로 맞춤 (Last 30 min 자동 적용 주의 — 직접 변경 필요)
- `/api/send-push` 호출 검색
- 로그 결과 해석:
  - **로그 없음** → 프론트에서 send-push 호출 자체가 안 된 것 (해당 페이지 코드 또는 트리거 확인)
  - **`sent: 0`** → 대상 구독 없음 (DB 확인)
  - **`sent: N` (N>0)인데 폰에 안 옴** → 발송은 됐는데 폰이 못 받음 (구독 endpoint 만료)

### 1-3. 해결 액션

| 상황 | 조치 |
|---|---|
| `push_enabled = false` | 유저에게 BMS 사이드바 알림 토글 ON 안내 |
| 구독 행 없음 | 알림 토글 OFF → ON (재구독) |
| 레거시 FCM endpoint | 알림 토글 OFF → ON (강제 재구독) — Chrome 자물쇠 → 사이트 설정 → 알림 차단 후 재허용도 시도 |
| Vercel Log에 send-push 자체 없음 | 호출하는 페이지 코드 확인 (announcements.html, complaints.html 등) |
| `sent: N>0`인데 안 옴 | sw.js (line 2) VAPID 키와 Vercel `VAPI_PUBLIC_KEY` 일치 여부 확인 |
| **모든 유저 전부 안 옴** | **send-push.js 자체 버그 의심** (4/20 사고처럼). Vercel Logs에서 에러 메시지 확인 |

### 1-4. 절대 하지 말 것

- ❌ VAPID 키 임의 rotation (sw.js 2줄 + Vercel 환경변수 `VAPI_PUBLIC_KEY` 두 곳 동시 업데이트 필요)
- ❌ push_subscriptions 테이블 임의 삭제 (만료 구독 자동 정리는 send-push.js 410/404 핸들러가 담당)
- ❌ announcements/complaints에 이메일 재추가 (Resend 한도 보호 — 4/21 정책)

### 1-5. 관련 파일

- `/api/send-push.js` — Vercel API (Push 발송)
- `/sw.js` — Service Worker (line 2 VAPID 키, line 30 notificationclick 핸들러)
- DB 테이블: `push_subscriptions`, `profiles.push_enabled`
- Vercel 환경변수: `VAPI_PUBLIC_KEY`, `VAPI_PRIVATE_KEY`, `VAPI_SUBJECT`

---

## 🟠 시나리오 2: 이메일 안 감

### 2-1. 발생 사례

#### 사례 A: CORS 차단 (4월 초)

**증상**: complaints 답변, quote 투표 시작 등 어떤 이메일도 안 옴. Vercel/Supabase 로그에 호출 기록 자체가 없음.

**조사 과정**
1. Supabase Edge Functions에 4개 모두 배포됨 확인 (`email-complaint-response`, `email-announcement`, `email-quote-voting`, `email-quote-confirm`)
2. 브라우저 콘솔에서 직접 fetch 호출 → 에러 발견:
   ```
   Access to fetch at 'https://wunsexdnqathluplkkvo.supabase.co/functions/v1/email-complaint-response' 
   from origin 'https://sca-redmyre.vercel.app' has been blocked by CORS policy: 
   Response to preflight request doesn't pass access control check: 
   No 'Access-Control-Allow-Origin' header is present on the requested resource.
   ```

**원인**
- Edge Function들에 CORS 헤더 자체가 없음
- 브라우저가 preflight(OPTIONS) 요청 단계에서 차단 → 함수에 도달조차 못함
- 그래서 Supabase Edge Function 로그에도 안 찍힘 (브라우저가 막아서)

**해결**
- 4개 Edge Function 전부 상단에 CORS 헤더 + OPTIONS preflight 처리 추가:
  ```typescript
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
  
  Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }
    // ... 기존 코드 ...
    return new Response(text, { 
      status: r.ok ? 200 : 500,
      headers: corsHeaders
    });
  });
  ```

#### 사례 B: Supabase SMTP 한도 초과 (announcements)

**증상**: 공지 발송 시 일부 이메일만 가고 일부는 안 옴.

**원인**
- Supabase Free tier Auth SMTP 한도: **시간당 30개**
- Redmyre는 입주자 60명+ → 한 번 공지 발송 시 한도 초과
- 일부는 발송, 일부는 silent fail

**해결 (4월 21일 정책 변경)**
- ❌ **announcements 이메일 발송 비활성** (Push만 사용)
- ❌ **complaints 이메일 발송 비활성** (Push만 사용)
- ✅ Resend 직접 호출하는 Edge Function들은 유지:
  - `email-quote-voting` (Committee 8명 → 안전)
  - `email-quote-confirm` (Committee 8명 → 안전)
  - `email-parking-notice` (차주 1명 → 안전)

**중요**: 발신 도메인은 SCA 회사 DNS (`scafacility.com`) 사용. Resend API 통해서 발송. Supabase Auth SMTP 안 씀.

#### 사례 C: BCC 적용 (실무 추적)

발신 시 사장님 + SCA 사무실 이메일을 BCC로 자동 포함:
- `info@scafacility.com`
- `sca.yun82@gmail.com`
- `sca.jacob77@gmail.com`

**적용 함수:**
- `email-complaint-response` ✅ BCC
- `email-quote-voting` ✅ BCC
- `email-quote-confirm` ✅ BCC
- `email-parking-notice` ❌ BCC 없음 (익명성 유지)
- `email-announcement` — 비활성

### 2-2. 진단 절차

#### 1차: Supabase Edge Function Logs
- Supabase Dashboard → Edge Functions → 해당 함수 → Logs
- 호출 시각에 로그 있나?
  - **로그 없음** → 함수에 도달 못함 (CORS 또는 호출 코드 문제)
  - **로그 있음 + 200** → 함수는 성공, Resend 발송도 성공 (받는 쪽 스팸 폴더 확인)
  - **로그 있음 + 500** → 함수 내부 에러 (RESEND_API_KEY 누락, 수신자 빈값 등)

#### 2차: Resend Dashboard 확인
- https://resend.com 로그인 (사장님 계정)
- Logs 메뉴 → 발송 이력 확인
- 실패 사유: bounced / complained / delivery_failed 등 표시됨

#### 3차: 브라우저 콘솔 (CORS 의심 시)
- F12 → Console 탭
- `Access to fetch ... blocked by CORS policy` 에러 있으면 → CORS 문제

#### 4차: 수신자 측 확인
- 스팸 폴더 / 정크 메일
- 수신자 이메일 주소 정상인지 (DB의 `primary_email` / `business_email`)

### 2-3. 해결 액션

| 상황 | 조치 |
|---|---|
| CORS 에러 | Edge Function에 CORS 헤더 + OPTIONS 처리 추가 |
| Edge Function 로그 없음 | 호출하는 페이지 코드 확인 (예: complaints.html에서 fetch 코드) |
| Edge Function 500 에러 | Supabase 환경변수 `RESEND_API_KEY` 확인 |
| 수신자 빈 배열 | DB에서 `primary_email` / `business_email` 정상 입력됐는지 확인 |
| Resend Dashboard에 bounce | 수신자 이메일 주소 오타 또는 폐쇄됨 — DB 업데이트 |
| 일부만 도착 | 받는 쪽 스팸 처리 / DNS SPF/DKIM 설정 (회사 DNS이므로 SCA IT 담당) |

### 2-4. 절대 하지 말 것

- ❌ **announcements/complaints에 이메일 재추가 금지** (4/21 정책, 한도 초과 보호)
- ❌ Supabase Auth 기본 SMTP로 회귀 금지 (시간당 30개 한도)
- ❌ Resend API Key 임의 rotation (Supabase Edge Functions 환경변수 동시 업데이트 필요)
- ❌ `email-parking-notice`에 BCC 추가 금지 (익명성 보장 — 의도된 설계)

### 2-5. 관련 파일

**Edge Functions (Supabase):**
- `email-complaint-response` — Complaint 답변 시 (요청자 + BCC)
- `email-quote-voting` — 투표 시작 시 (Committee + BCC)
- `email-quote-confirm` — 견적 확정 시 (Committee + BCC)
- `email-parking-notice` — 주차 위반 시 (차주만, BCC 없음)
- `email-announcement` — **비활성 (호출 안 함)**

**호출 페이지:**
- `complaints.html` — Push만 (이메일 OFF)
- `announcements.html` — Push만 (이메일 OFF)
- `quotes.html` — Push + 이메일 (Committee)
- `parking.html` — 전체 Push + 차주 이메일

**환경변수:**
- Supabase Edge Functions: `RESEND_API_KEY`

**도메인:**
- 발신: `notify@scafacility.com`
- Reply-To: `sp77249.redmyre@gmail.com`
- DNS: SCA 회사 도메인 (`scafacility.com`) — SPF/DKIM 인증

---

## 🟡 시나리오 3: 입주자 로그인 안 됨

### 3-1. 발생 사례

#### 사례 A: setup_complete=false 강제 리다이렉트 (4월 11일 발견)

**증상**: ikf 테스트 계정이 setup 완료 화면("Welcome!")까지 봤는데 DB에는 `setup_complete=false`로 남아있음.

**조사 과정**
- SQL 확인:
  ```sql
  SELECT email, full_name, setup_complete, unit FROM profiles WHERE email = 'ikf.jacob@gmail.com';
  -- setup_complete: false, unit: null
  ```
- setup.html의 upsert가 RLS에 막혀서 silent fail
- 화면은 성공처럼 보였지만 실제 DB 업데이트 안 됨
- 이후 layout.js에 강제 리다이렉트 3줄 추가:
  ```javascript
  if (!profile?.setup_complete && getCurrentPage() !== 'setup') {
    window.location.href = '/pages/setup.html';
    return null;
  }
  ```
- 이로써 `setup_complete=false`인 유저는 어떤 페이지를 가도 무조건 setup.html로 튕김

#### 사례 B: 일괄 비번 리셋 (4월 16일)

**배경**: 단체 초대 받은 입주자 중 한 번도 로그인 안 한 유저 44명 발생.

**해결**
- SQL로 setup 안 한 사람 전체 조회 후 비번 111111로 일괄 리셋:
  ```sql
  UPDATE auth.users
  SET 
    encrypted_password = crypt('111111', gen_salt('bf')),
    email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
    updated_at = NOW()
  WHERE last_sign_in_at IS NULL;
  ```
- Gmail BCC로 로그인 안내 발송:
  ```
  Subject: [NOTICE] SP77249 | Redmyre House BMS — Your Login Details
  
  URL: https://sca-redmyre.vercel.app/
  Email: (the email address that received this message)
  Password: 111111
  
  Jacob Kim
  Building Manager
  ```

#### 사례 C: 지미 (4월 23일) — "setup이 안 된다"

**조사**
```sql
SELECT p.email, p.role, p.setup_complete, p.last_sign_in_at,
       au.email_confirmed_at, au.last_sign_in_at as auth_last_login
FROM profiles p
LEFT JOIN auth.users au ON au.id = p.id
WHERE p.email = 'jimmyg@ignitelearning.com.au';

-- setup_complete: false, last_sign_in_at: null
-- email_confirmed_at: 4/16 (일괄 리셋 시점)
```

**해결**
- 비번 111111 이미 있으니 추가 리셋 불필요
- BMS URL + 비번 안내만 다시 전달
- index.html에서 이메일만 입력하면 `/api/check-email`이 'needs_setup' 반환 → setup.html로 자동 이동
- 거기서 이름 + 새 비번 설정 → `setup_complete=true`

### 3-2. BMS 가입/로그인 흐름 (절대 혼동 금지)

```
1. Admin이 users.html에서 초대 발송
   → profiles에 setup_complete=false 저장
   → auth.users 계정 생성 (email_confirmed_at 자동 처리)

2. (선택적) 일괄 비번 리셋 SQL → 비번 111111

3. 사용자가 Gmail로 안내 받음
   → BMS URL + 본인 이메일 + 비번 111111

4. index.html 접속 → 이메일만 입력
   → /api/check-email이 'needs_setup' 반환
   → setup.html로 자동 이동 (비번 입력 단계 건너뜀)

5. setup.html에서 이름 + 새 비번 설정
   → /api/complete-setup 호출
   → setup_complete=true

6. 정상 로그인 가능
```

**핵심**: 초대받은 사용자는 **비번 재발송 필요 없음**. index.html에서 이메일만 넣으면 setup으로 자동 진행됨. 사장님이 그렇게 설계해놓음.

### 3-3. 진단 절차

#### 1단계: SQL로 유저 상태 확인

```sql
SELECT 
  p.email, 
  p.role, 
  p.setup_complete,
  p.full_name,
  p.unit,
  p.last_sign_in_at,
  au.email_confirmed_at,
  au.last_sign_in_at as auth_last_login
FROM profiles p
LEFT JOIN auth.users au ON au.id = p.id
WHERE p.email = '<유저 이메일>';
```

#### 2단계: 결과 해석

| profiles 상태 | auth.users 상태 | 의미 | 조치 |
|---|---|---|---|
| `setup_complete=true`, `last_sign_in_at` 있음 | `auth_last_login` 있음 | 정상 사용 중 | 비번 잊었으면 admin이 비번 재설정 (users.html) |
| `setup_complete=false`, `last_sign_in_at=null` | `email_confirmed_at` 있음 | 초대만 받고 로그인 안 함 | BMS URL + 이메일만 안내 (비번 재발송 불필요) |
| profiles에 행 없음 | auth.users에 있음 | profiles 동기화 실패 | `handle_new_user` 트리거 확인 |
| profiles 있음 | auth.users 없음 | 비정상 상태 | users.html에서 삭제 후 재초대 |
| `setup_complete=false`, `last_sign_in_at` 있음 | `auth_last_login` 있음 | 로그인은 했는데 setup 안 끝냄 | layout.js가 setup.html로 강제 이동시킴 — 거기서 이름+비번 설정만 하면 됨 |

#### 3단계: 비번 모를 때

- **본인이 잊었을 때**: index.html → "Forgot password?" 링크 → reset-password.html
- **Admin이 강제 재설정**: users.html → 해당 유저 → 비번 변경 (`/api/admin-set-password` 호출, **최소 4글자**)

### 3-4. 해결 액션

| 상황 | 조치 |
|---|---|
| 초대받았는데 로그인 못함 | BMS URL + 이메일만 안내 (이메일만 넣으면 setup 진행) |
| 비번 모름 | reset-password 또는 admin이 users.html에서 강제 재설정 |
| 한 번도 로그인 안 한 사람 다수 | 일괄 비번 111111 리셋 SQL + BCC 안내 메일 |
| setup 화면에서 막힘 | 이름 길이 ≥2, 비번 길이 ≥8 확인 (`/api/complete-setup` 검증) |
| 로그인은 되는데 페이지 못 들어감 | layout.js가 setup.html로 보내는 중 → setup 완료하면 됨 |
| profiles와 auth.users 불일치 | DB에서 직접 확인 후 수동 정리 |

### 3-5. 비번 정책 차이 (혼동 주의)

| 함수 | 최소 비번 길이 |
|---|---|
| `/api/complete-setup` (사용자 본인 setup) | **8글자** |
| `/api/admin-set-password` (Admin이 재설정) | **4글자** |

- Admin이 임시 비번 발급 시 짧게 가능 (예: `1234`)
- 사용자가 setup에서 본인 비번 설정 시는 8글자 강제

### 3-6. 절대 하지 말 것

- ❌ 미로그인자에게 "비번 재발송 해주자"는 소리 금지 (이메일만 넣으면 setup 진행됨)
- ❌ layout.js의 `setup_complete` 체크 로직 제거 금지
- ❌ profiles 테이블 직접 INSERT/DELETE 금지 (`handle_new_user` 트리거가 자동 처리)
- ❌ `auth.users` 직접 삭제 금지 (users.html의 `/api/delete-user` 사용 — profiles + auth 동시 삭제)

### 3-7. 관련 파일

**프론트엔드:**
- `index.html` — 로그인 진입점
- `setup.html` — 초기 이름+비번 설정
- `reset-password.html` — 본인 비번 재설정
- `users.html` — Admin 유저 관리

**API:**
- `/api/check-email` — 이메일 입력 시 상태 반환 (`not_found` / `needs_setup` / `ready`)
- `/api/complete-setup` — setup.html에서 호출 (비번 ≥8글자)
- `/api/admin-set-password` — Admin이 강제 재설정 (비번 ≥4글자)
- `/api/send-invite` — 신규 초대
- `/api/delete-user` — 유저 삭제

**DB:**
- `profiles.setup_complete` — 핵심 플래그
- `profiles.last_sign_in_at` — 로그인 이력
- `auth.users` — Supabase Auth 시스템 테이블
- `handle_new_user` 트리거 — auth.users INSERT 시 profiles 자동 생성

---

## 🟢 시나리오 4: HVAC 요청 처리 안 됨

### 4-1. 시스템 구조 (사전 이해)

**HVAC는 BMS 단독으로 동작 안 함. 외부 시스템 2개와 연동.**

```
[BMS hvac.html] → Supabase hvac_requests 테이블 → [건물 PC HVAC Daemon] → iControl (BACnet)
```

- **BMS**: 사용자 신청 + Admin 승인까지만 담당
- **HVAC Daemon**: 건물 PC에 24시간 실행되는 Python + Selenium 스크립트
- **5초마다** Supabase의 `status='approved'` 행을 polling
- iControl 웹 인터페이스(redmyre.dyndns.biz) 자동 로그인 → 온도 조절 → 결과 DB에 기록

### 4-2. Status 흐름

```
사용자 신청 (hvac.html line 277)
  ↓
status = 'pending'
  ↓ (Admin 승인 — hvac.html line 689)
status = 'approved' + approved_at 기록
  ↓ (Daemon polling 5초마다)
status = 'processing'
  ↓ (Daemon Selenium 작업)
  ├─ 성공 → status = 'completed' + temp_before/temp_after/completed_at
  └─ 실패 → status = 'failed' + admin_comment 자동 기록
```

⚠️ **`approved` 이후 모든 status 전환은 BMS가 아니라 Daemon이 한다.** Daemon이 죽으면 BMS는 정상 동작해도 요청은 영원히 처리 안 됨.

### 4-3. 진단 절차

#### 1단계: BMS 측 확인 (Admin)

**Q1. 신청은 DB에 들어갔나?**
```sql
SELECT id, user_name, level, tenancy, type, status, created_at, approved_at, completed_at
FROM hvac_requests
WHERE created_at >= NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

| 결과 | 의미 |
|---|---|
| 행 자체가 없음 | hvac.html에서 INSERT 실패. 30분 쿨다운 차단됐거나 코드 에러 |
| `status='pending'`만 있음 | Admin이 아직 승인 안 함 |
| `status='approved'`인데 `processing`으로 안 넘어감 | **Daemon이 죽었거나 polling 멈춤** ← 시나리오 핵심 |
| `status='processing'`인데 영원히 멈춤 | Daemon이 작업 시작했는데 멈춤 (Selenium hang) |
| `status='failed'` | Daemon이 처리 시도했는데 실패 — `admin_comment` 확인 |

#### 2단계: 30분 쿨다운 확인 (사용자가 신청 못한다고 할 때)

**hvac.html line 264 로직**: 같은 `level + tenancy` 유닛에서 30분 내 신청 있으면 차단 (admin은 예외).

```sql
SELECT id, user_name, created_at
FROM hvac_requests
WHERE level = '<레벨>' 
  AND tenancy = '<테넌시>'
  AND created_at >= NOW() - INTERVAL '30 minutes'
ORDER BY created_at DESC;
```

행 있으면 → 정상 차단. 사용자에게 30분 기다리라고 안내. ⚠️ **쿨다운 로직 변경 절대 금지**.

#### 3단계: Daemon 측 확인 (건물 PC)

**Q2. Daemon 프로세스 살아있나?**
- 건물 PC 직접 확인 또는 원격 접속
- 실행 폴더의 `logs/hvac_log_{YYYY-MM}.txt` 최신 항목 확인

**로그 패턴별 의미:**

| 로그 마지막 줄 | 의미 |
|---|---|
| `[HH:MM:SS] No pending requests.` 가 5초마다 반복 | 정상 polling 중 — BMS에서 `approved` 행 못 찾음 |
| `Processing: HOT — Level 1, Tenancy A` 후 멈춤 | Selenium 작업 중 hang |
| `Failed: ...` 반복 | iControl 로그인/통신 실패 |
| 로그 자체가 멈춤 (5초마다 출력 없음) | Daemon 프로세스 죽음 또는 PC 절전모드 |
| `temp_before`가 항상 22.0°C | sensor BoundLabel 읽기 실패 → 기본값 사용 중 |

#### 4단계: Daemon 재시작

Daemon 죽었으면:
1. 건물 PC에서 Daemon 실행 폴더로 이동
2. `python HVAC_daemon.py` 재실행
3. 로그에 `Redmyre House - HVAC Auto Daemon / Checking Supabase every 5 seconds...` 출력 확인
4. 기존 `approved` 요청들 자동 처리 시작

### 4-4. 해결 액션

| 상황 | 조치 |
|---|---|
| 사용자가 "신청이 안 된다" | 30분 쿨다운 SQL 확인 → 행 있으면 정상, 30분 후 다시 시도 안내 |
| Admin이 승인했는데 처리 안 됨 | Daemon 프로세스 확인 → 죽었으면 재시작 |
| 매번 `failed` | iControl 사이트 자체 동작 확인 (브라우저로 redmyre.dyndns.biz 접속) |
| Selenium hang | Daemon 종료 후 ChromeDriver 업데이트 후 재시작 |
| temp_before=22.0°C 고정 | TENANCY_SENSOR_IDS 매핑 확인 (실제 BACnet 센서 ID와 짝) |
| BMS 페이지 자체 안 열림 | hvac.html 라인 689 RLS 확인 (admin update 권한) |

### 4-5. 절대 변경 금지 (사장님 명시)

- ❌ HVAC 30분 쿨다운 (hvac.html 260–274줄): 유닛(level+tenancy) 기준, admin 예외, cooldownModal + 카운트다운
- ❌ HVAC_daemon.py의 `SUPABASE_KEY` (Service Role Key 하드코딩 — service_role 키 rotation 시 같이 업데이트 필수)
- ❌ TENANCY_SENSOR_IDS 매핑 (실제 BACnet 센서 ID와 짝)
- ❌ ±0.5°C 조정 폭 (사용자 학습된 동작)
- ❌ Polygon1 hidden 대기 로직 (Zoning 토글 동기화 필수)

### 4-6. BMS vs Daemon 책임 분리

| 동작 | BMS (hvac.html) | Daemon (Python) |
|---|---|---|
| `pending` 생성 | ✅ | ❌ |
| `pending → approved` | ✅ (Admin UI) | ❌ |
| `approved → processing` | ❌ | ✅ |
| `processing → completed/failed` | ❌ | ✅ |
| `temp_before`, `temp_after` 기록 | ❌ | ✅ |
| `admin_comment` 자동 기록 | ❌ | ✅ (한도 클램프 또는 실패 시) |
| `completed_at` 기록 | ❌ | ✅ |
| 30분 쿨다운 | ✅ | ❌ |
| Push 알림 (Admin에게) | ✅ | ❌ |

### 4-7. 관련 파일

- `/pages/hvac.html` — 신청 + 승인 UI
- `/HVAC_daemon.py` — 건물 PC Python 스크립트 (BMS 외부)
- 건물 PC: 실행 폴더의 `logs/hvac_log_{YYYY-MM}.txt`
- DB: `hvac_requests`, `hvac_current_temps`
- 외부: `redmyre.dyndns.biz` (iControl)
- 관련 메뉴: system.html → "Open AC Control" 버튼 (iControl 직접 접속용)

### 4-8. 추가 컨텍스트 (5월 SCM 발표용)

- 6~7월 전체 AC 교체 예정 (Voyager Air)
- 교체 후 TENANCY_SENSOR_IDS 매핑 갱신 필요 가능성 있음 — Daemon 코드 수정 필요할 수도
- 현재 HVAC 시스템: BACnet → iControl 웹 → Selenium 자동화 (안정적이지만 fragile)

---

## 🔵 시나리오 5: Storage 가득 참

### 5-1. Storage 구조 사전 이해

**Supabase Free tier 한도: 1GB**

**Storage Buckets 4개:**

| 이름 | 공개 | 용량 제한 | 파일 형식 | 자동 정리 |
|---|---|---|---|---|
| `announcements` | Public | 50MB | Any | ❌ 수동 |
| `complaint-images` | Public | 5MB | jpeg, png, gif, webp, heic, pdf | ❌ 수동 |
| `parking-images` | Public | 5MB | jpeg, png, gif, webp, heic | ✅ 자동 (30일) |
| `quotes` | Public (URL 보호) | 50MB | Any | ✅ 부분 자동 (declined 30일) |

### 5-2. 자동 정리 시스템 (Cron Jobs)

매일 새벽 3시 (`0 3 * * *`)에 4개 작업 자동 실행:

| # | Cron Job | 동작 |
|---|---|---|
| 1 | `cleanup-images-job` | resolved 후 3일 경과한 주차 이미지 삭제 |
| 2 | `cleanup-parking-images-job` | 30일 경과한 모든 주차 이미지 정리 (DB 레코드는 유지) |
| 3 | `cleanup-old-votes` | 완료된 프로젝트의 24시간+ 지난 투표 정리 |
| 4 | `cleanup-old-quotes` | declined/expired/removed 30일 경과 견적 삭제 |

⚠️ **`cleanup-parking-images-job`에 Service Role Key 하드코딩됨** — service_role key rotation 시 같이 업데이트 필수.

### 5-3. 진단 절차

#### 1단계: 현재 Storage 사용량 확인

**옵션 A: System 페이지 (admin)**
- BMS → System 페이지 → Storage Buckets 섹션
- 각 버킷별 파일 수 + 용량 표시
- "Refresh" 버튼으로 갱신

**옵션 B: Supabase Dashboard**
- Supabase Dashboard → Storage
- 각 버킷 클릭 → 파일 개수 + 용량 확인

**옵션 C: SQL**
```sql
SELECT 
  bucket_id,
  COUNT(*) as file_count,
  pg_size_pretty(SUM((metadata->>'size')::bigint)) as total_size
FROM storage.objects
GROUP BY bucket_id
ORDER BY SUM((metadata->>'size')::bigint) DESC;
```

#### 2단계: 어느 버킷이 가장 큰지 파악

| 버킷이 큼 | 의심 원인 |
|---|---|
| `quotes` | 견적 PDF 누적 (30일+ declined만 자동 삭제. approved/completed는 영구 보관) |
| `parking-images` | Cron이 안 돌고 있음 (정상이면 30일치만 있어야 함) |
| `complaint-images` | 자동 정리 없음. 오래된 complaint 사진이 누적 |
| `announcements` | 공지 첨부파일 누적 |

#### 3단계: 고아 파일 확인 (Storage에만 있고 DB에 없는 파일)

System 페이지의 **Orphan File Check** 카드 사용:
- Storage `quotes` 버킷의 모든 파일 listing
- DB `quotes.comment` JSON의 `files` 배열과 대조
- DB에 없는 파일 = 고아 파일 → 표시 후 삭제 가능

#### 4단계: Cron Job 동작 확인

```sql
SELECT jobname, schedule, active, last_start_time, last_end_time
FROM cron.job_run_details
ORDER BY last_start_time DESC
LIMIT 20;
```

- `last_start_time`이 어제 03:00 근처인지 확인
- 없거나 너무 오래됐으면 → Cron 멈춤. Supabase Dashboard → Database → Cron Jobs 확인

### 5-4. 해결 액션

#### A. 즉시 용량 확보 (긴급)

**A-1. System 페이지 Junk Cleanup 실행 (admin)**
- Junk File Cleanup 카드 → "Cleanup Now"
- declined/expired/removed 견적 파일 즉시 삭제

**A-2. System 페이지 Orphan File Cleanup**
- Orphan File Check 카드 → Scan → 표시된 고아 파일 확인 → Delete

**A-3. 수동 Cron 재실행 (Supabase SQL Editor)**
```sql
-- 주차 이미지 정리 (30일+)
SELECT net.http_post(
  url := 'https://wunsexdnqathluplkkvo.supabase.co/functions/v1/cleanup_parking_images',
  headers := jsonb_build_object('Authorization', 'Bearer <service_role_jwt>')
);

-- 오래된 견적 정리
SELECT cleanup_old_quotes();
```

#### B. 중기적 관리 (장기)

| 버킷 | 관리 방법 |
|---|---|
| `quotes` | approved/completed 견적은 1년 이상 지난 것 수동 검토 후 삭제 (이력 백업 후) |
| `parking-images` | Cron 자동 처리 — 점검만 |
| `complaint-images` | resolved 6개월 이상 된 complaint 이미지 수동 정리 |
| `announcements` | 1년 이상 된 공지 첨부파일 수동 정리 |

#### C. Supabase 유료 전환 (최후 수단)

- Free tier 1GB 한계 도달 시
- Pro plan: $25/월 → 100GB Storage
- 단, 4월 21일 이메일 정책 변경 이후 BMS는 안정적이라 1GB로도 당분간 충분

### 5-5. 절대 하지 말 것

- ❌ **`quotes` 버킷 RLS 정책 정리 시도 금지** (2026-04-08 사고 이력: 정리 시도 → Admin/Committee까지 견적 파일 접근 불가 → 2개월치 작업 날릴 뻔함 → 긴급 복구). 4중 방어망(중복 정책 15개)은 의도된 설계.
- ❌ Storage에서 파일 직접 수동 삭제 (DB와 불일치 발생) — 반드시 System 페이지 도구 사용
- ❌ `parking_reports`/`complaints`/`quotes` DB 행 직접 삭제 (Storage 파일 고아됨) — 정상 삭제 흐름 사용
- ❌ Cron Job 임의 비활성화

### 5-6. 관련 파일

**Edge Functions:**
- `cleanup-images` — resolved 주차 이미지 (3일+)
- `cleanup_parking_images` — 모든 주차 이미지 (30일+)

**DB 함수:**
- `cleanup_old_quotes()` — declined/expired 견적 (30일+)

**프론트엔드:**
- `system.html` — Storage Buckets / Orphan File Check / Junk File Cleanup 카드 (admin만)

---

# 📅 Section 2: 일상 운영 절차

## 📝 절차 1: 신규 입주자 가입 처리

### 2-1-1. 시나리오 분기

신규 입주자 추가는 두 가지 케이스로 나뉜다.

| 케이스 | 사용 페이지 | 흐름 |
|---|---|---|
| 단일 신규 입주자 (1명) | users.html | 수동 1명씩 |
| 새 occupants 등록 + 가입 동시 | occupants.html → Bulk Invite | 등록 후 일괄 |

### 2-1-2. 케이스 A: 단일 신규 입주자 (users.html)

**언제 사용**: 새 Committee 멤버, 외부 관계자, 특수 케이스 1명만 추가할 때

**절차:**
1. BMS → Users 페이지 (admin)
2. **+ Invite User** 버튼
3. 모달에서:
   - Email 입력
   - Full Name 입력 (선택, 사용자가 setup에서 변경 가능)
   - Role 선택 (admin / committee / observer / owner / tenant)
   - Unit 입력
   - **Password 입력** (사장님이 직접 설정)
4. **Send Invite** 클릭
5. 이메일 발송 안 됨 (사장님이 직접 사용자에게 안내)
6. 사장님이 Gmail로 직접 발송:
   ```
   URL: https://sca-redmyre.vercel.app/
   Email: <사용자 이메일>
   Password: <설정한 비번>
   ```
7. 사용자가 로그인 → setup_complete=false → setup.html 자동 이동 → 이름/새 비번 설정 → 완료

### 2-1-3. 케이스 B: 새 Occupant 등록 + 일괄 초대 (occupants.html)

**언제 사용**: 새 입주자가 들어왔거나, 기존 occupants 중 미가입자 일괄 처리

**절차:**

**Step 1: occupants 등록**
1. BMS → Occupants 페이지 (admin)
2. 기존 행이면 클릭 → 인라인 편집
3. 신규면 Add Row 또는 직접 추가:
   - `unit`, `business_name`, `contact_person`
   - `primary_email` (오너)
   - `business_email` (입주자, 콤마 구분 가능)
   - `phone`, `is_committee` 등
   - `license_plates` (콤마 구분)
4. 저장 시 `sync_vehicles` RPC 자동 호출 → vehicles 테이블 동기화

**Step 2: Bulk Invite 사전 검토**
1. occupants.html 상단 **🔍 Quick Search** 옆 **📧 Bulk Invite** 버튼 (admin만 보임)
2. 모달에서 초대 예정 목록 확인:
   - `is_committee = true` → 🚫 스킵 (수동 초대 필요)
   - 이미 profiles에 계정 있음 → 🚫 스킵
   - `primary_email` → 👤 owner로 초대
   - `business_email` (콤마 구분, 여러 명) → 👥 tenant로 초대
3. 사장님이 목록 검토

**Step 3: 일괄 발송**
1. **Send All Invites →** 클릭
2. 각 행이 발송 시도되며 색상 표시:
   - 🟢 성공
   - 🔴 실패
3. 결과 요약: `✅ N sent · ❌ M failed`

**Step 4: 사용자 안내 (단체 메일)**
- Gmail BCC로 일괄 발송:
  ```
  Subject: [NOTICE] SP77249 | Redmyre House BMS — Your Login Details
  
  URL: https://sca-redmyre.vercel.app/
  Email: (the email address that received this message)
  Password: 111111  ← 또는 admin이 설정한 비번
  
  Jacob Kim
  Building Manager
  ```

**Step 5: 미로그인자 추적**
- 며칠 후 SQL로 미가입자 조회:
  ```sql
  SELECT p.email, p.full_name, p.role, p.unit
  FROM profiles p
  WHERE p.setup_complete = false
    AND p.last_sign_in_at IS NULL
  ORDER BY p.role, p.email;
  ```
- 필요 시 일괄 비번 리셋:
  ```sql
  UPDATE auth.users
  SET 
    encrypted_password = crypt('111111', gen_salt('bf')),
    email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
    updated_at = NOW()
  WHERE last_sign_in_at IS NULL;
  ```

### 2-1-4. Role 자동 결정 로직

occupants.html Bulk Invite 시:

```
is_committee = true → 스킵 (별도 수동 초대로 role=committee 설정)
is_committee = false + primary_email → owner
business_email (콤마 구분, 여러 명) → tenant 다수
```

⚠️ **Committee + Owner 동시 보유**: occupants에 `is_committee=true`이면서 `primary_email`도 있으면 **Committee 우선**. role=committee로 1회만 등록. (커미티+오너 = 커미티)

### 2-1-5. 알아둘 사실

- **초대 링크 만료**: Supabase 기본 24시간. 단체 발송 후 며칠 지나도 OK — index.html에서 이메일만 넣으면 setup으로 자동 진행. 만료 무관.
- **이메일 안 와도 무관**: 비번 발송은 사장님이 Gmail로 직접 함. Supabase 초대 이메일은 사용 안 함.
- **occupants의 `unit` 자동 매핑**: profiles.unit에 자동 저장됨

### 2-1-6. 관련 파일

- `users.html` — 1명씩 수동 초대
- `occupants.html` — 입주자 등록 + Bulk Invite
- `/api/send-invite` — 초대 처리
- `/api/admin-set-password` — 비번 강제 설정
- `setup.html` — 사용자 측 첫 setup
- `index.html` — `/api/check-email`으로 'needs_setup' 분기

---

## 💼 절차 2: 견적 → 작업 → 리포트 실전 시나리오

### 2-2-1. 핵심 원리

**`quotes` 테이블 하나로 라이프사이클 전체 관리** (works/reports 별도 테이블 없음).

세 컬럼으로 페이지 분기:

| 컬럼 | 역할 |
|---|---|
| `status` | 견적 상태 (draft/voting/pending/approved/declined/expired/onhold) |
| `work_status` | 작업 상태 (NULL → scheduled → in_progress → completed) |
| `completion_date` | 완료일 (NULL = 미완료) |

**페이지별 필터:**

| 페이지 | 조건 |
|---|---|
| Quotes | `status IN (draft/voting/pending)` + `work_status IS NULL` + `completion_date IS NULL` + `archived=false` + `is_emergency=false` |
| Works | `completion_date IS NULL` + `archived=false` (+ `work_status IS NOT NULL` OR `is_emergency=true`) |
| Reports | `work_status='completed'` + `completion_date IS NOT NULL` + `archived=false` |
| History | `archived=true` 또는 거절/만료된 투표 이력 |
| Cost Dashboard | Reports 데이터 기반 비용 집계 |

### 2-2-2. 표준 흐름 (Committee 투표 → 완료까지)

#### Phase 1: 견적 등록 (Admin / Committee)

1. **Quotes 페이지** → **+ New Quote**
2. 입력:
   - Project name, Category (General/Plumbing/Electrical 등)
   - Vendor (Contractor) 선택 또는 신규 등록
   - Amount (ex GST)
   - Description
   - 첨부파일 (Storage `quotes` 버킷)
3. 저장 → `status='draft'`

#### Phase 2: 투표 시작

1. Draft 견적의 **Send to Committee** 클릭
2. 시스템 동작:
   - `status` → `'voting'`
   - 기존 votes 삭제 (재시작 시 깨끗하게)
   - **Push 알림** → admin/committee/observer
   - **이메일** (`email-quote-voting` Edge Function) → Committee 8명 + BCC 3개

#### Phase 3: 투표 (Committee)

1. Committee 멤버가 BMS 접속 → Quotes 페이지
2. 각 quote에 대해 **Approve / Decline / Hold** 선택
3. 시스템 동작 (`doUpsert` 함수):
   - 이미 투표했으면 차단 (hard lock)
   - 결과 확정됐으면 차단 (result-lock guard)
   - INSERT/UPDATE 명시적 분기 (upsert 아님)
   - 매 투표 후 `calculateResult()` 자동 실행 → admin에게 push

#### Phase 4: 결과 확정 (`calculateResult`)

**8명 Committee 기준 규칙:**

| 결과 | 조건 |
|---|---|
| APPROVED | Approve ≥ 5표 |
| DECLINED | Decline ≥ 4표 |
| HOLD | Hold ≥ 3표 OR Tie OR 4A+4D 충돌 |
| PENDING | 위 조건 모두 미달 |

**Confirm Selection (Admin):**
1. Admin이 결과 확인 → **Confirm Selection** 클릭
2. `confirmSelection()` 함수가 **DB 기준으로 재계산** (UI 값 무시):
   - APPROVED 시: winner → `status='approved'` + `work_status='scheduled'`, 다른 견적 → `status='declined'`
   - HOLD 시: 전부 `status='onhold'`
   - DECLINED 시: 전부 `status='declined'`
3. votes 삭제 (clean)
4. **Push + 이메일** (`email-quote-confirm`) → Committee 8명 + BCC 3개

#### Phase 5: 작업 진행 (Works)

1. Approved 견적은 자동으로 **Works 페이지**에 표시 (`work_status='scheduled'`)
2. 작업 진행 시:
   - `work_status` → `'in_progress'`
   - 진행 노트 추가 (`comment` JSONB)
3. 작업 완료 시:
   - `work_status` → `'completed'`
   - `completion_date` 입력
   - **Push 알림** → 전체 입주자 (`작업 완료`)

#### Phase 6: 리포트 (Reports)

1. 완료된 작업은 **Reports 페이지**에 자동 표시
2. tbl-footer에 **GST 3줄** 표시 (ex GST / GST 10% / inc GST)
3. 파일 다운로드: `supabase.storage.from('quotes').createSignedUrl(path, 3600)` (1시간 만료)

#### Phase 7: 비용 분석 (Cost Dashboard)

1. **Cost Dashboard** 페이지에서 자동 집계
2. 카테고리별 파이차트 / 월별 바차트 / Top Contractors 테이블
3. **연도별 비교 카드는 2027년 이후 활성화** (현재 데이터가 2026년 1월부터라 작년 비교 불가)

### 2-2-3. 긴급 작업 (Emergency)

긴급 작업은 투표 단계 건너뛰고 직접 Works에 등록:

1. **Works 페이지** → **+ Emergency Work**
2. 입력:
   - Title, Description, Vendor, Amount
   - Date, Category
3. 저장 → DB에 `is_emergency=true` + `work_status='in_progress'` (또는 'completed') 직접 INSERT
4. **Push/이메일 발송 안 함** (의도된 설계 — 사장님 확인됨)
5. Reports에 `work_status='completed'` 시점에 표시됨

### 2-2-4. Force Action (Admin 강제)

투표 결과와 무관하게 Admin이 강제 처리:
- **Force Approve** / **Force Decline**
- `forceAction()` 함수 → 로직 그대로, status만 강제 변경
- ⚠️ **본 함수 변경 절대 금지**

### 2-2-5. Re-open / Archive

**Re-open**: 결과 나온 견적을 다시 투표:
- `resendToVoting()` → 기존 votes 삭제 → status='voting'

**Archive**: 옛날 견적 숨기기:
- `archived=true` 설정 → 전체 페이지에서 사라짐, History에서만 조회

### 2-2-6. 절대 변경 금지 (사장님 명시)

- ❌ `calculateResult()` 함수
- ❌ `doUpsert()` 함수 (중복 투표 방지 로직)
- ❌ `forceAction()` 함수
- ❌ `confirmSelection()` 함수 (DB 재계산 로직)
- ❌ `syncQuoteToWorks()` 함수
- ❌ `RULES` 상수 (5/4/3 임계값)
- ❌ Quotes Storage 4중 방어망 (15개 정책 — 2026-04-08 사고 이력)

### 2-2-7. 관련 파일

- `quotes.html` — 견적 등록/투표 (2,130줄, 핵심 페이지)
- `works.html` — 진행 중 작업 + Emergency
- `reports.html` — 완료 리포트
- `cost-dashboard.html` — 비용 분석
- `history.html` — 종료된 건 이력
- Edge Functions: `email-quote-voting`, `email-quote-confirm`
- Storage: `quotes` 버킷 (4중 방어망)
- DB: `quotes`, `votes`, `quote_comments`, `project_comments`

---

## 📨 절차 3: Bulk Invite 발송

### 2-3-1. 사용 시나리오

- 신규 occupants 등록 후 일괄 가입 처리
- 4월 11일 단체 초대처럼 한 번에 여러 명 처리
- 미로그인자 재초대

### 2-3-2. 사전 준비

**Step 1: occupants 데이터 정리**
- 모든 행에 정확한 정보:
  - `unit`, `primary_email`, `business_email` (콤마 구분)
  - `is_committee` (true/false 정확히)
  - `phone`, `license_plates`
- 데이터 확인 SQL:
  ```sql
  SELECT unit, primary_email, business_email, is_committee
  FROM occupants
  WHERE primary_email IS NOT NULL OR business_email IS NOT NULL
  ORDER BY unit;
  ```

**Step 2: 이미 가입한 사람 확인**
- profiles 테이블과 occupants 매칭 확인:
  ```sql
  SELECT p.email, p.role, p.setup_complete, p.last_sign_in_at
  FROM profiles p
  WHERE p.email IN (
    SELECT primary_email FROM occupants WHERE primary_email IS NOT NULL
    UNION
    SELECT TRIM(unnest(string_to_array(business_email, ',')))
    FROM occupants WHERE business_email IS NOT NULL
  )
  ORDER BY p.role, p.email;
  ```

### 2-3-3. 실행 절차

1. **occupants.html → Quick Search** 옆 **📧 Bulk Invite** 클릭 (admin만)
2. 모달에 초대 예정 목록:
   - 자동 분류:
     - committee → 🚫 스킵 (수동 초대)
     - 이미 계정 있음 → 🚫 스킵
     - primary_email → 👤 owner
     - business_email → 👥 tenant (여러 명)
   - 중복 이메일 자동 제거
3. 사장님 검토
4. **Send All Invites →** 클릭
5. 행별 색상 표시:
   - 🟢 성공
   - 🔴 실패 (네트워크/이메일 형식 문제)
6. 완료: `✅ N sent · ❌ M failed`

### 2-3-4. 발송 후 안내 메일

```
Subject: [NOTICE] SP77249 | Redmyre House BMS — Your Login Details

URL: https://sca-redmyre.vercel.app/
Email: (the email address that received this message)
Password: 111111

Jacob Kim
Building Manager
```

- Gmail BCC로 한 번에 발송 (수신자끼리 이메일 공개 안 됨)
- 사용자가 본인 이메일만 입력하면 setup.html로 자동 진행

### 2-3-5. 실제 결과 추적

며칠 후 다음 SQL로 가입 현황 모니터링:

```sql
SELECT 
  COUNT(*) FILTER (WHERE last_sign_in_at IS NULL) AS never_logged_in,
  COUNT(*) FILTER (WHERE last_sign_in_at IS NOT NULL AND setup_complete = false) AS logged_in_no_setup,
  COUNT(*) FILTER (WHERE setup_complete = true) AS active,
  COUNT(*) AS total
FROM profiles;
```

미로그인 너무 많으면:
1. 일괄 비번 111111 리셋 SQL
2. 안내 메일 재발송
3. 5월 SCM에서 직접 시연하면서 옆에서 가입 유도

### 2-3-6. 관련 파일

- `occupants.html` — Bulk Invite 모달 + 발송
- `/api/send-invite` — 백엔드 처리
- DB: `profiles`, `occupants`, `auth.users`

---

## 📢 절차 4: 공지 발행 (Announcements)

### 2-4-1. 발행 절차

1. **Announcements 페이지** (admin) → **+ New Announcement**
2. 입력:
   - **Title** (제목)
   - **Content** (본문, 줄바꿈 지원)
   - **Pin** (📌 상단 고정 여부)
   - **첨부파일** (이미지/PDF, `announcements` Storage 버킷)
3. **Publish** 클릭
4. 시스템 동작:
   - DB INSERT
   - 첨부파일 Storage 업로드
   - **Push 알림** → 전체 push_enabled 유저
   - ❌ 이메일 발송 안 함 (4/21 정책 — Resend 한도 보호)

### 2-4-2. 읽음 추적

- 입주자가 공지 상세 모달 열면 → `audit_logs`에 `ANNOUNCEMENT_VIEWED` INSERT
- ⚠️ Admin은 audit_logs 자체에 기록 안 됨 (사장님이 본인 공지 읽으면 통계 오염 방지)
- Admin이 공지 클릭 → "읽음 현황" 모달:
  - 누가 읽었는지 / 안 읽었는지 명단
  - 읽음 비율

### 2-4-3. Resend (재발송)

1. 발행한 공지 우측 **📨 Resend** 버튼 (admin만)
2. 동작:
   - 기존 `audit_logs`의 `ANNOUNCEMENT_VIEWED` 기록 삭제 (재시작)
   - Push 알림 다시 발송
   - 모든 유저에게 "다시 읽어달라" 효과

### 2-4-4. Reminder (미읽음에게)

1. 읽음 현황 모달 → **🔔 Send Reminder** 버튼
2. 미읽은 사람들에게만 Push 재발송

### 2-4-5. Pin (상단 고정)

- `pinned: true`인 공지는 상단에 📌 아이콘과 함께 고정
- ORDER BY: `pinned DESC, created_at DESC`

### 2-4-6. 외부 이메일 발송 (회사 Gmail 통해)

BMS 외부에서 Gmail 통해 일괄 발송하는 경우:
- TO: Committee 8명 (참조용)
- BCC: 해당 입주자들 (프라이버시)
- HTML 본문에 BMS 링크 포함

(예시 — 2026-04 HVAC 작업 공지: TO에 Committee 8명 + Halil + SCA office, BCC에 Level 3 입주자들)

### 2-4-7. 절대 하지 말 것

- ❌ 이메일 재추가 (4/21 정책 — Resend 한도 보호)
- ❌ Admin이 공지 읽었을 때 audit_logs 기록 (현재 의도된 제외)

### 2-4-8. 관련 파일

- `announcements.html` — 발행/조회/Resend
- `/api/send-push` — Push 발송
- DB: `announcements`, `audit_logs`
- Storage: `announcements` 버킷

---

## 🚗 절차 5: 차량 등록 / 주차 신고

### 2-5-1. 차량 등록 흐름

차량 등록은 occupants.html 한 곳에서만 함. vehicles 테이블 직접 수정 금지.

```
Admin이 occupants.html에서 license_plates 수정 (콤마 구분)
  ↓
저장 시 sync_vehicles RPC 자동 호출
  ↓
vehicles 테이블 자동 동기화 (PK: plate + unit 복합키)
  ↓
parking.html에서 신고 시 lookup_vehicle_plates RPC로 매칭
```

**규칙:**
- occupants.license_plates: **단일 텍스트** (콤마 구분)
- vehicles 테이블: **각 행이 (plate, unit)** PK
- 한 사람이 여러 유닛 보유 시 같은 plate가 여러 행 (composite PK라 가능)
- ⚠️ vehicles 직접 INSERT 금지 (sync_vehicles RPC만 사용)

### 2-5-2. 차량 등록 단계

1. **Occupants 페이지** → 해당 unit 행 클릭 (인라인 편집)
2. **License Plates** 컬럼에 콤마 구분 입력:
   ```
   ABC123, XYZ789
   ```
3. 저장 → sync_vehicles 자동 동작:
   - 기존 (unit, plate) 행 DELETE
   - 새 plate들 INSERT
4. parking.html에서 즉시 매칭 가능

### 2-5-3. 주차 신고 흐름

1. **Parking 페이지** → **+ Report Illegal Parking**
2. 입력:
   - License plate 번호
   - Bay/Zone (구역)
   - 사진 첨부 (`parking-images` Storage)
3. Submit:
   - DB INSERT (`parking_reports`)
   - **Push 알림** → 전체 입주자 (`🚨 Illegal Parking Reported / Plate: XXX — Bay/Zone`)
   - 사장님은 무제한, 일반 유저는 **하루 5건 제한**
4. 시스템이 plate를 vehicles 테이블과 매칭:
   - 매칭됨 → 해당 차주(unit owner)에게 자동 이메일 발송 (`email-parking-notice` Edge Function)
   - 매칭 안 됨 → 외부 차량 (이메일 안 감, Push만 전체 알림)

### 2-5-4. 자동 이메일 (등록 차량 매칭 시)

- `email-parking-notice` Edge Function이 처리
- ⚠️ **BCC 없음** (사장님 명시 — 익명성 유지)
- 차주에게만 직접 발송

### 2-5-5. 자동 정리

- `parking-images` Storage: 매일 3AM cleanup_parking_images Cron이 30일+ 자동 삭제
- DB의 `parking_reports` 행은 유지 (이력 보존), `image_url`만 NULL 처리
- resolved 후 3일+ 이미지는 cleanup-images Edge Function이 별도 정리

### 2-5-6. 관련 파일

- `occupants.html` — 차량 등록 (인라인 편집)
- `parking.html` — 주차 신고
- `sync_vehicles()` RPC, `lookup_vehicle_plates()` RPC
- Edge Function: `email-parking-notice`, `cleanup-images`, `cleanup_parking_images`
- DB: `occupants`, `vehicles`, `parking_reports`
- Storage: `parking-images`

---

# 🎤 Section 3: 5월 SCM 발표용 요약본

## 🎬 3-1. BMS 라이브 시연 시나리오

### 3-1-1. 발표 목적

- 5월 SCM 미팅에서 Committee 8명에게 BMS 라이브 시연
- 관전자: Brett (Voyager 대표 등 외부 관계자), Committee 8명, Halil(Strata), David(SCA 동업자)
- 목표: BMS 정식 도입 동의 + Committee 활용도 증가

### 3-1-2. 시연 흐름 (15-20분)

**Phase 1: Overview (2분)**
- BMS URL 접속: `https://sca-redmyre.vercel.app/`
- Admin 계정 로그인
- **Building Overview** 화면 보여주기:
  - 실시간 카드: Lift 상태, HVAC, Water Leak, Fire Safety, Electrical 등
  - 진행 중 작업 / 미해결 민원 / 미투표 견적 카운트
  - 5월 SCM 안건과 매칭

**Phase 2: 입주자 기능 시연 (3분)**
- Committee 멤버 계정으로 로그인 (예: 사전에 Sarah 양해 받고 데모 계정 사용)
- **Complaints**: 본인이 등록한 민원 + Admin 답변 스레드
- **HVAC**: 에어컨 요청 → Admin 승인 → Daemon 자동 처리 (실제 PC 화면 함께 보여주면 강력)
- **Parking**: 불법주차 신고 (사진 + 번호판) → 차주 자동 이메일

**Phase 3: 견적 투표 시연 (5분) — 핵심**

이게 SCM의 가장 중요한 부분. Committee가 **"왜 BMS가 필요한가"** 직관적으로 이해.

1. Admin 계정으로 새 견적 등록 (예: "Roof Waterproofing")
2. 3개 vendor 견적 첨부
3. **Send to Committee** → 푸시/이메일 즉시 발송
4. Committee 멤버 폰에서 알림 확인 시연
5. Committee 계정 로그인 → 투표 시연 (Approve / Decline / Hold)
6. 5명 이상 Approve → 자동 APPROVED 결과 표시
7. **Confirm Selection** → Works 페이지에 자동 등록되는 모습

**시연 포인트**: "이걸 이메일로만 했으면 며칠 걸렸을 일이 5분 안에 끝남"

**Phase 4: Works → Reports → Cost Dashboard (3분)**
- Works 페이지: 진행 중 작업 + Emergency 추가 시연
- 작업 완료 처리 → 자동 Reports로 이동
- **Cost Dashboard**: 카테고리별 비용 / 월별 추세 / Top Contractors

**Phase 5: 관리자 기능 (2분, 시간 되면)**
- **Users 페이지**: 권한 관리 / 비번 리셋
- **Occupants**: 입주자 관리 / Bulk Invite
- **System**: Storage/DB Health 모니터링
- **Audit Log**: 모든 활동 추적 (admin 제외)

**Phase 6: 마무리 + Q&A (3-5분)**
- 보안 강조: 3중 방어 (프론트 + DB RLS + API)
- 데이터 백업: Supabase 자동
- 비용: Free tier 운영 중 (Resend 한도 안에서)
- 인수인계 가능: Master Manual 4개 파트 완비

### 3-1-3. 시연 사전 준비

**기술 점검 (전날):**
- [ ] 사장님 노트북 BMS 접속 확인 (Wi-Fi 연결, 로그인 정상)
- [ ] 폰 Push 알림 동작 확인 (Phase 3 시연용)
- [ ] HVAC Daemon 실행 상태 확인 (Phase 2 시연 시)
- [ ] 시연용 새 견적/민원 미리 한두 개 준비
- [ ] Committee 멤버 본인 계정 로그인 가능 여부 확인 (가능하면 Sarah/Laura 사전 양해)

**자료 준비:**
- [ ] BMS Master Manual Part 1~4 인쇄본 또는 PDF (질문 대비)
- [ ] 가이드 문서 (`guide-resident.html`, `guide-committee.html`) 출력본
- [ ] 시연 후 Q&A 예상 답변 정리

**미가입 Committee 처리:**
- 5월 SCM 시점까지도 Committee 미가입자 있으면:
  - 시연 중 직접 옆에서 가입 유도 (가장 효과적)
  - Michael(Treasurer) 우선 — 재무 책임자가 견적 승인 못하면 BMS 의미 없음

### 3-1-4. 시연 시 주의사항

- ❌ HVAC Daemon이 멈춰있는 상태에서 시연하면 망함 → 사전 점검 필수
- ❌ 라이브 시연 중 잘못된 데이터 입력 금지 → 사전 준비 견적/민원만 사용
- ❌ Committee 본인 계정 비번 강제 시연 금지 (개인정보)
- ✅ 시연 중 에러 발생 시 → 당황하지 말고 "이게 실제 시스템이라 가끔 이런 일 있음, 즉시 로그 확인 가능" 정도로 자연스럽게

---

## 📊 3-2. Committee가 실제로 보게 될 화면

### 3-2-1. Committee 멤버 시점에서 보는 화면

Committee role로 로그인 시 사이드바:
- **Building** (Overview)
- **Announcements** (공지)
- **Resident Requests** (Complaints, 빨간 뱃지: 새 답변)
- **Quote Approvals** ← **핵심 메뉴** (빨간 뱃지: 투표 대기)
- **HVAC** (에어컨 요청)
- **Parking/Towing**
- **Emergency**
- **Works** (진행 중 작업)
- **Reports** (완료 리포트)
- **Cost Dashboard** (비용)
- **History** (이력)
- **Occupants** (입주자 정보)
- **📗 Committee Guide** (사용 가이드)

### 3-2-2. 핵심 사용 시나리오 (Committee 입장)

**시나리오 A: 견적 투표 (가장 자주 함)**
1. 폰에 Push 알림 도착: `🗳️ New Quote — Vote Required`
2. 클릭 → BMS의 Quote 페이지 자동 이동
3. 견적 내용 + 첨부 PDF 확인
4. **Approve / Decline / Hold** 버튼 한 번 클릭으로 투표
5. 결과는 모든 Committee 투표 후 Admin 확정 시 알림

**시나리오 B: 공지 확인**
1. 폰에 Push 알림: `📢 New Announcement — <제목>`
2. 클릭 → 공지 상세 자동 이동
3. 읽으면 자동으로 "읽음" 처리

**시나리오 C: 비용 분석 (분기/연도별)**
1. **Cost Dashboard** 메뉴 클릭
2. 파이차트로 카테고리별 비용 한눈에
3. 월별 바차트 클릭 → 해당 월 상세
4. SCM 미팅 전 사전 검토 가능

**시나리오 D: 입주자 정보 조회**
1. **Occupants** 메뉴
2. 본인 unit 정보 확인 / 차량 등록 확인
3. ⚠️ 다른 입주자 개인정보는 제한된 정보만 (Admin/Committee 권한별 차등)

### 3-2-3. Committee가 자주 묻는 질문 + 답변

**Q1: 비번 잊었을 때?**
- A: index.html → "Forgot password?" 링크 → 이메일로 재설정 링크 받기
- 또는 사장님께 연락 → users.html에서 강제 재설정

**Q2: 다른 사람 정보 다 보이는 건 아닌가?**
- A: 본인 권한 내에서만. 일반 owner/tenant는 본인 unit만 보임. Committee는 더 넓은 권한이지만 Admin 전용 정보는 차단됨.

**Q3: 폰에 알림 안 오면?**
- A: BMS 사이드바에서 알림 토글 ON 확인. 안 되면 Chrome 브라우저에서 알림 권한 확인.

**Q4: PWA 설치 어떻게?**
- A: Chrome에서 BMS 접속 → 주소창 우측 "설치" 아이콘 클릭. iOS는 Safari → 공유 → 홈 화면에 추가.

**Q5: BMS 이메일 안 와요**
- A: 정책상 공지/민원은 Push만. 견적 투표 시작/확정만 이메일. 스팸 폴더도 확인.

---

# 📦 Section 4: 인수인계 체크리스트

## 🎯 4-1. 차기 매니저에게 넘길 정보 (개요)

이 섹션은 **사장님이 BMS 운영에서 손 떼야 할 상황** 또는 **새 매니저가 합류했을 때** 필요한 정보 정리.

### 4-1-1. 인수인계 우선순위

| 우선순위 | 항목 | 이유 |
|---|---|---|
| P0 | Master Manual 4개 파트 | 시스템 전체 이해 |
| P0 | 접근 계정 (DB/GitHub/Vercel/Supabase) | 운영에 필수 |
| P1 | 외부 시스템 (HVAC Daemon 서버, Resend) | 장애 대응에 필수 |
| P1 | Committee 연락처 + 미가입자 명단 | 미팅 운영 |
| P2 | 진행 중 안건 (옥상 누수, AC 교체 등) | 컨텍스트 |

### 4-1-2. 인수인계 자료 위치

**저장 위치**: 프로젝트 폴더 (Claude 프로젝트)
- `Redmyre_BMS_Master_Manual_Part1.md` (DB / 인프라)
- `Redmyre_BMS_Master_Manual_Part2.md` (페이지 + 데이터 플로우)
- `Redmyre_BMS_Master_Manual_Part3.md` (JS 모듈 + API + 외부 연동)
- `Redmyre_BMS_Master_Manual_Part4.md` (운영 가이드 — 이 문서)

---

## 🔑 4-2. 접근 권한 인수인계

### 4-2-1. 핵심 계정

**현재 소유자**: Jacob Kim (sp77249.redmyre@gmail.com)

| 시스템 | 계정 / 위치 | 권한 |
|---|---|---|
| **GitHub** | `sp77249redmyre-eng/sca-redmyre` (Private) | Owner |
| **Vercel** | sca-redmyre 프로젝트 | Owner |
| **Supabase** | Project ref: `wunsexdnqathluplkkvo` | Owner / DB Admin |
| **Resend** | `notify@scafacility.com` 발신 도메인 | API Key 보유 |
| **건물 PC (HVAC Daemon)** | 건물 내 물리 PC | RDP / 직접 접속 |
| **iControl (BACnet)** | http://redmyre.dyndns.biz/login | 별도 계정 |
| **BMS Admin** | `sp77249.redmyre@gmail.com` | role=admin |
| **SCA 회사 시스템** | scafacility.com 메일 등 | SCA 사무실 |

### 4-2-2. 인수인계 절차 (시스템별)

**GitHub:**
1. 새 매니저 GitHub 계정 받기
2. Repo Settings → Collaborators → Add (Admin 권한)
3. 또는 Repo 자체를 SCA 조직 계정으로 이전

**Vercel:**
1. Vercel Team에 새 매니저 추가
2. 또는 프로젝트 ownership 이전 (Account Settings → Transfer)
3. 환경변수 (`VAPI_*`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 등) 그대로 유지

**Supabase:**
1. Supabase Project → Settings → Team → Invite
2. 새 매니저 이메일 + Owner 권한
3. ⚠️ Project Owner 이전 시 결제 계정도 함께 이전

**Resend:**
1. Resend 계정 로그인 정보 인계
2. 또는 새 계정 만들고 도메인 인증 (`scafacility.com`)
3. API Key 발급 → Supabase Edge Functions 환경변수 업데이트

**HVAC Daemon (건물 PC):**
1. 건물 PC 물리 접근 또는 RDP 정보
2. Daemon 실행 폴더 위치 (`HVAC_daemon.py`)
3. Python + Selenium + ChromeDriver 환경 확인
4. iControl 로그인 정보 (Daemon 내부 하드코딩)
5. 자동 실행 설정 확인 (Windows 작업 스케줄러 또는 NSSM 서비스)

**BMS Admin 계정:**
1. users.html에서 새 매니저 계정 → role=admin 변경
2. 또는 SQL:
   ```sql
   UPDATE profiles SET role = 'admin' WHERE email = '<새매니저이메일>';
   ```
3. 기존 admin은 보안상 즉시 role 변경

### 4-2-3. 환경변수 / API Key 목록

**Vercel 환경변수 (Production):**
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `VAPI_PUBLIC_KEY` (Web Push VAPID)
- `VAPI_PRIVATE_KEY`
- `VAPI_SUBJECT`

**Supabase Edge Functions 환경변수:**
- `RESEND_API_KEY`
- (필요시) 기타 Edge Function별 시크릿

**HVAC Daemon 하드코딩 (Python 파일 내):**
- `SUPABASE_URL`
- `SUPABASE_KEY` (Service Role Key — ⚠️ rotation 시 같이 업데이트)
- iControl URL + 로그인 정보

**DB 함수 내부 하드코딩 (Supabase):**
- `notify_announcement()` — anon key
- `notify_quote()` — anon key
- `cleanup-parking-images-job` Cron — service_role key

### 4-2-4. 절대 잊으면 안 되는 것

- ❌ Supabase anon key는 공개 키지만, **DB 함수 2개에 하드코딩**되어 있어서 rotation 시 같이 업데이트해야 함 (notify_announcement, notify_quote)
- ❌ Service Role key rotation 시 **HVAC_daemon.py**, **Vercel `SUPABASE_SERVICE_ROLE_KEY`**, **Cron `cleanup-parking-images-job`** 3곳 모두 업데이트 필요
- ❌ VAPID 키 rotation 시 **Vercel `VAPI_PUBLIC_KEY`**, **sw.js line 2 하드코딩** 동시 업데이트 필요
- ❌ Resend API Key rotation 시 Edge Functions 환경변수 업데이트
- ❌ 도메인 SPF/DKIM 설정은 SCA IT 담당 (scafacility.com)

---

## 🛠️ 4-3. 외부 시스템 인수인계

### 4-3-1. HVAC Python Daemon

**서버**: 건물 내 PC (24시간 운영)

**주요 정보:**
- 위치: 건물 PC 직접 또는 RDP 접속
- 파일: `HVAC_daemon.py`, `requirements.txt`, `logs/`
- 의존성: Python 3.x, Selenium, ChromeDriver, supabase-py, requests
- 자동 실행: Windows Task Scheduler 또는 NSSM 서비스로 등록 (재부팅 시 자동 시작)

**점검 방법:**
1. RDP/물리 접속
2. 로그 폴더 확인: `logs/hvac_log_{YYYY-MM}.txt` 최신 항목
3. `[HH:MM:SS] No pending requests.` 5초마다 출력 = 정상
4. 멈춰있으면 Python 프로세스 재시작

**필수 환경:**
- iControl 사이트 (redmyre.dyndns.biz) 항상 접근 가능
- Supabase 인터넷 연결 항상 유지
- 건물 PC 절전모드 OFF
- ChromeDriver 버전과 Chrome 버전 일치

**6~7월 AC 교체 후 주의:**
- TENANCY_SENSOR_IDS 매핑 변경 가능성
- iControl URL/UI 변경 시 Selenium 코드 수정 필요
- Voyager 대표(Brett)와 매핑 정보 사전 협의

### 4-3-2. SignApps Express (전광판)

**위치**: 건물 로비 디지털 사이니지

**파일 구조:**
- 540×960 JPEG 4장 (Page 1, 2, 3, 4)
- 수동 업로드 방식 (Cron 자동화 없음)
- 변경 시 직접 SignApps 접속 → 업로드

**현재 작업 중 (사장님 메모리):**
- Page 1~3: 흰바탕 + 검정 + 골드라인 디자인 완료
- Page 4: 디자인 검토 중

**관련 파일:**
- `signboard.html` (BMS 내 미리보기)
- 캡처: `html2canvas` 라이브러리 사용

⚠️ **html2canvas 치명적 버그 (절대 반복 금지)**:
- img를 감싼 div가 `display:inline-block + border` 조합이면 이미지 캡처 못하고 빈 박스로 나옴
- QR/로고 이미지 넣을 때 img를 별도 wrapper div 안에 inline-block+border로 감싸지 말 것
- 테두리 필요 시: 부모 카드 자체에 border 주고 img는 margin:0 auto로 직접 배치

### 4-3-3. Resend (이메일)

**계정**: 사장님 개인 Resend 계정
**무료 한도**: 일 100통, 월 3,000통
**도메인**: `scafacility.com` (SCA 회사 도메인 인증됨)
**발신 주소**: `notify@scafacility.com`
**Reply-To**: `sp77249.redmyre@gmail.com`

**Edge Functions 사용:**
- `email-complaint-response`
- `email-quote-voting`
- `email-quote-confirm`
- `email-parking-notice`
- (`email-announcement` — 비활성)

**한도 모니터링**: Resend Dashboard → Usage

### 4-3-4. NSW 공휴일 API (date.nager.at)

**URL**: https://date.nager.at/api/v3/PublicHolidays/{year}/AU
**인증**: 없음 (공개 API)
**무료**: 무제한
**사용 위치**: `emergency.html` 1곳만 (Manager 카드 시간 체크용)
**캐싱 없음** — 페이지 로드마다 호출 (무제한이라 OK)

---

## 📋 4-4. 운영 컨텍스트 인수인계

### 4-4-1. 진행 중 안건 (2026-04-25 기준)

| 안건 | 상태 | 컨텍스트 |
|---|---|---|
| Lift | Urgent / TK Elevator | TK Elevator 안전 사고 대응 중 |
| HVAC | InProgress / Voyager Air | 6~7월 전체 AC 교체 예정 |
| Water Leak | Urgent | L6 + B1 부식 우려 |
| Fire Safety | Pending | 커미티 승인 대기 |
| Electrical | Investigation | 우체통 + 전체 circuit audit / 보험 연결 |
| Roof Waterproofing | Urgent | (옥상 누수 별건) |
| Roof Fascia | Pending | |
| Garden | Pending | 입구 자갈 |
| Garage | InProgress | 붐게이트 견적 수집 |
| Access Control | Pending | 계단 보안문 / 5월 SCM 안건 |
| 2 Raw Square | Investigation | Mills Oakley / Halil |
| **옥상 누수 (Lot 50)** | **보류 중** | AP Wireless 소유 105㎡ 구역. 쿨링타워 + 통신장비 공존. 쿨링타워 소유권 불명확. **스트라타 변호사 선임 필요**. SCM 미팅 안건 예정. 견적 보류 중. |

### 4-4-2. Committee 8명 정보

| 이름 | 역할 | 유닛 | 이메일 |
|---|---|---|---|
| Jimmy Gupta | Chairman | 6H | jimmyg@ignitelearning.com.au |
| Michael | Treasurer | 5G (also 5H) | michael@efstratiou.com.au |
| Michelle | Secretary | 3H (on behalf of Dr. Jung Sook Kim) | jskmhc@gmail.com |
| Sudesh | Committee Member | 5B (also 4G/5D) | sudesh@taxwealth.com.au |
| Niranjan | Committee Member | 6B (also 6C) | niranjan@calculus.net.au |
| Sarah | Committee Member | 1A (also 1B/1C) | redmyremedical@gmail.com |
| Laura | Committee Member | 4A (also 2D) | laurachoo2@gmail.com |
| Eva | Committee Member | 4D | evachensolicitor@gmail.com |

### 4-4-3. 업무 시간 / 연락처

**Jacob Kim 본인:**
- Mobile: 0478 705 406
- Email: sp77249.redmyre@gmail.com / info@scafacility.com
- 근무: 월/수/금 8AM-4PM
- 그 외 시간: SCA 사무실 1300 785 007

**SCA Facility Management:**
- Office: 1300 785 007
- Web: www.scafacility.com
- 동업자: David

**외부 관계자:**
- Halil — Strata Manager
- Brett — Voyager Air 대표 (HVAC 교체 담당)

### 4-4-4. 절대 변경/제거 금지 항목 (사장님 명시 통합 정리)

#### 코드/로직
- ❌ `layout.js` (사장님이 직접 관리)
- ❌ `get_my_role()` 함수
- ❌ Voting 핵심 로직: `calculateResult()`, `doUpsert()`, `forceAction()`, `confirmSelection()`, `syncQuoteToWorks()`
- ❌ HVAC 30분 쿨다운 (hvac.html 260–274줄)
- ❌ HVAC_daemon.py: `SUPABASE_KEY`, `TENANCY_SENSOR_IDS`, ±0.5°C 조정 폭, Polygon1 hidden 대기 로직
- ❌ Quotes Storage 4중 방어망 (15개 정책)
- ❌ BMS role 표시명 변경 시 layout.js/complaints.html/hvac.html 비교 로직 (DB role값은 observer/tenant, 화면만 Observer (Strata)/Tenant (Staff))

#### DB
- ❌ `audit_logs` RLS (SELECT/INSERT/DELETE 전부 true — 의도적, profiles RLS + layout.js role 체크로 다중 보안)
- ❌ DB 구조/RLS (명시적 요청 전엔 절대 변경 X)
- ❌ Supabase Key 임의 rotation (notify_announcement, notify_quote, HVAC_daemon, Cron 동시 업데이트 필요)

#### 정책
- ❌ Complaints 이메일 재추가 (4/21 정책 — Push만)
- ❌ Announcements 이메일 발송 (Resend 한도 보호)
- ❌ email-parking-notice에 BCC 추가 (익명성 유지)

#### 운영
- ❌ Storage 직접 수동 삭제 (DB 불일치 발생)
- ❌ profiles/auth.users 직접 INSERT/DELETE (트리거/API 사용)

### 4-4-5. project_comments RLS 원상복구 SQL (변경 시 사용)

```sql
DROP POLICY IF EXISTS project_comments_select ON project_comments;
DROP POLICY IF EXISTS project_comments_insert ON project_comments;
DROP POLICY IF EXISTS project_comments_delete ON project_comments;
CREATE POLICY project_comments_admin_only ON project_comments
  FOR ALL USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');
```

### 4-4-6. 인수인계 후 첫 1주일 체크리스트

새 매니저가 인수받은 후 첫 주에 해야 할 일:

- [ ] Master Manual Part 1, 2, 3, 4 정독
- [ ] Admin 계정으로 BMS 모든 메뉴 한 번씩 클릭해보기
- [ ] HVAC Daemon PC 물리 접속 + 로그 확인
- [ ] Vercel / Supabase Dashboard 각각 로그인 + Logs 메뉴 위치 확인
- [ ] Resend Dashboard 로그인 + 발송 이력 확인
- [ ] 테스트용 견적 등록 → Committee 1명에게 양해 구한 후 투표 → Confirm 시연
- [ ] 테스트 공지 발행 → 본인 폰으로 Push 알림 도착 확인
- [ ] System 페이지 → Storage 사용량 / DB Health 점검
- [ ] Committee 8명에게 인수인계 알림 메일 발송
- [ ] 진행 중 안건 12개 + 옥상 누수 건 별도로 파악

---

# 📝 Part 4 마무리

## 핵심 원칙

1. **변경 전 conversation_search로 과거 이력 확인** — 사장님과 이미 결정한 사항이 있을 수 있음
2. **추측 금지, 코드/Master Manual 기반 사실만** — 모르면 "모른다"고 명시
3. **사장님이 "된다"면 그게 팩트** — 코드 추측보다 우선
4. **미리보기 먼저 → 사장님 승인 → 실제 파일 수정** — 직접 수정 금지
5. **Cloudflare 오염 (email-protection, data-cfemail) 체크 후 전달** — 사장님께는 언급 금지

## Master Manual 전체 구성 (4개 파트)

| Part | 내용 | 줄 수 |
|---|---|---|
| Part 1 | DB / 인프라 (테이블, RLS, 함수, 트리거, Edge Functions, Cron, Storage) | 2,488 |
| Part 2 | 페이지 + 시스템 데이터 플로우 (21개 HTML, 240개 함수, Mermaid 12개) | 6,101 |
| Part 3 | JS 모듈 / API / 외부 연동 (auth, common, audit, layout, 6개 API, sw.js, 외부 4종) | 2,387 |
| **Part 4** | **운영 가이드 (장애 대응, 일상 운영, SCM 발표, 인수인계)** | **이 문서** |

---

**문서 끝.**
