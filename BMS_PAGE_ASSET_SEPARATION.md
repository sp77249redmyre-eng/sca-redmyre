# BMS 페이지별 CSS / JavaScript 분리 운영 문서

**문서 목적:** Redmyre House BMS 포털의 코드 구조와 유지보수 기준을 정의하는 공식 문서  
**기준 브랜치:** `main` (sp77249redmyre-eng/sca-redmyre)  
**최종 확인:** 2026-11-09 GitHub API 직접 조회 기준  
**작성:** Claude (클전무), ChatGPT (챗이사) 협업 지시 기반

---

## 1. 분리 작업의 목적

CSS와 JavaScript를 페이지별로 분리한 목적은 단순한 파일 정리가 아닙니다.

1. **페이지 로딩 및 브라우저 캐싱 효율 개선** — 필요한 파일만 로드
2. **페이지별 코드 독립성 확보** — 각 페이지가 자신의 스타일과 기능을 독립 관리
3. **수정 시 타 페이지 영향 차단** — 특정 페이지 수정이 다른 페이지에 번지지 않음
4. **코드 검색·수정 범위 축소** — 문제 발생 시 해당 파일만 열면 됨
5. **운영 시스템 변경 위험 최소화** — 범위가 좁을수록 사이드 이펙트가 줄어듦
6. **신속한 오류 수정** — 어떤 파일을 고쳐야 하는지 즉시 파악 가능

---

## 2. 완료된 작업과 PR 기록

| PR | 내용 | 상태 |
|----|------|------|
| #10–17 | 주요 페이지 CSS 분리 | main 병합 완료 |
| #25 | 메인 대시보드 JavaScript 분리 (`index.html`, `js/index.js`) | main 병합 완료 |
| **#28** | 나머지 페이지 CSS·JavaScript 분리 통합 | **main 병합 완료** |
| #29 | Quotes 및 CCTV 성능 최적화 | main 병합 완료 |

> **참고:** PR #18, #20, #22–24, #26은 개별 병합되지 않았습니다. #28이 나머지 페이지 CSS/JS 분리를 통합하여 main에 병합한 최종 PR입니다.

> **검증 기준:** GitHub API (`/git/trees/main?recursive=1`) 직접 조회로 실제 파일 존재 확인. PR 설명만으로 판단하지 않음.

---

## 3. 현재 페이지별 파일 구조 (main 기준)

### 3-1. 메인 / 대시보드

| 항목 | 경로 |
|------|------|
| HTML | `index.html` |
| CSS | `css/pages/index.css` |
| JavaScript | `js/index.js` |
| 확인 상태 | ✅ GitHub main 파일 존재 확인 |

---

### 3-2. Quotes (견적)

| 항목 | 경로 |
|------|------|
| HTML | `pages/quotes.html` |
| CSS | `css/pages/quotes.css` |
| JavaScript | `js/quotes.js`, `js/quotes-quill.js` |
| 확인 상태 | ✅ GitHub main 파일 존재 확인 |

---

### 3-3. Works (공사 작업)

| 항목 | 경로 |
|------|------|
| HTML | `pages/works.html` |
| CSS | `css/pages/works.css` |
| JavaScript | `js/works.js` |
| 확인 상태 | ✅ GitHub main 파일 존재 확인 |

---

### 3-4. Parking (주차)

| 항목 | 경로 |
|------|------|
| HTML | `pages/parking.html` |
| CSS | `css/pages/parking.css` |
| JavaScript | `js/parking.js` |
| 확인 상태 | ✅ GitHub main 파일 존재 확인 |

---

### 3-5. Parking Sticker Print (주차 스티커 출력)

| 항목 | 경로 |
|------|------|
| HTML | `parking_sticker_print.html` (루트) |
| CSS | `css/pages/parking-sticker-print.css` |
| JavaScript | (없음 — 출력 전용 정적 페이지) |
| 확인 상태 | ✅ GitHub main 파일 존재 확인 |

---

### 3-6. CCTV

| 항목 | 경로 |
|------|------|
| HTML | `pages/cctv.html` |
| CSS | `css/pages/cctv.css` |
| JavaScript | `js/cctv.js`, `js/cctv-live.js` |
| 확인 상태 | ✅ GitHub main 파일 존재 확인 |

---

### 3-7. System (시스템 모니터링)

| 항목 | 경로 |
|------|------|
| HTML | `pages/system.html` |
| CSS | `css/pages/system.css` |
| JavaScript | `js/system.js`, `js/system-cctv-live-view.js`, `js/system-integriti-display.js` |
| 확인 상태 | ✅ GitHub main 파일 존재 확인 |

---

### 3-8. Announcements (공지사항)

| 항목 | 경로 |
|------|------|
| HTML | `pages/announcements.html` |
| CSS | `css/pages/announcements.css` |
| JavaScript | `js/announcements.js` |
| 확인 상태 | ✅ GitHub main 파일 존재 확인 |

---

### 3-9. Complaints (민원)

| 항목 | 경로 |
|------|------|
| HTML | `pages/complaints.html` |
| CSS | `css/pages/complaints.css` |
| JavaScript | `js/complaints.js`, `js/complaints-quill.js` |
| 확인 상태 | ✅ GitHub main 파일 존재 확인 |

---

### 3-10. Documents (문서)

| 항목 | 경로 |
|------|------|
| HTML | `pages/documents.html` |
| CSS | `css/pages/documents.css` |
| JavaScript | `js/documents.js` |
| 확인 상태 | ✅ GitHub main 파일 존재 확인 |

---

### 3-11. Reports (보고서)

| 항목 | 경로 |
|------|------|
| HTML | `pages/reports.html` |
| CSS | `css/pages/reports.css` |
| JavaScript | `js/reports.js` |
| 확인 상태 | ✅ GitHub main 파일 존재 확인 |

---

### 3-12. Service Reports (서비스 보고서)

| 항목 | 경로 |
|------|------|
| HTML | `pages/service-reports.html` |
| CSS | `css/service-reports.css` ⚠️ |
| JavaScript | `js/service-reports.js` |
| 확인 상태 | ✅ HTML·JS 존재 확인 / ⚠️ CSS는 `css/pages/` 아닌 `css/` 루트에 위치 |

---

### 3-13. Cost Dashboard (비용 대시보드)

| 항목 | 경로 |
|------|------|
| HTML | `pages/cost-dashboard.html` |
| CSS | `css/pages/cost-dashboard.css` |
| JavaScript | `js/cost-dashboard.js` |
| 확인 상태 | ✅ GitHub main 파일 존재 확인 |

---

### 3-14. Occupants (입주민)

| 항목 | 경로 |
|------|------|
| HTML | `pages/occupants.html` |
| CSS | `css/pages/occupants.css` |
| JavaScript | `js/occupants.js` |
| 확인 상태 | ✅ GitHub main 파일 존재 확인 |

---

### 3-15. Users (사용자 관리)

| 항목 | 경로 |
|------|------|
| HTML | `pages/users.html` |
| CSS | `css/pages/users.css` |
| JavaScript | `js/users.js`, `js/users-layout.js` |
| 확인 상태 | ✅ GitHub main 파일 존재 확인 |

---

### 3-16. Signboard (전광판)

| 항목 | 경로 |
|------|------|
| HTML | `pages/signboard.html` |
| CSS | `css/pages/signboard.css` |
| JavaScript | `js/signboard.js` |
| 확인 상태 | ✅ GitHub main 파일 존재 확인 |

---

### 3-17. Setup (초기 설정)

| 항목 | 경로 |
|------|------|
| HTML | `pages/setup.html` |
| CSS | `css/pages/setup.css` |
| JavaScript | `js/setup.js` |
| 확인 상태 | ✅ GitHub main 파일 존재 확인 |

---

### 3-18. Reset Password (비밀번호 재설정)

| 항목 | 경로 |
|------|------|
| HTML | `pages/reset-password.html` |
| CSS | `css/pages/reset-password.css` |
| JavaScript | `js/reset-password.js` |
| 확인 상태 | ✅ GitHub main 파일 존재 확인 |

---

### 3-19. Emergency (비상 연락)

| 항목 | 경로 |
|------|------|
| HTML | `pages/emergency.html` |
| CSS | `css/pages/emergency.css` |
| JavaScript | `js/emergency.js` |
| 확인 상태 | ✅ GitHub main 파일 존재 확인 |

---

### 3-20. Lift (승강기)

| 항목 | 경로 |
|------|------|
| HTML | `lift.html` (루트) |
| CSS | `css/pages/lift.css` |
| JavaScript | `js/lift.js` |
| 확인 상태 | ✅ GitHub main 파일 존재 확인 / ⚠️ HTML이 `pages/` 아닌 루트에 위치 |

---

### 3-21. Visitor Portal (방문자 포털)

| 항목 | 경로 |
|------|------|
| HTML | `welcome.html` (루트) |
| CSS | `css/pages/visitors.css` |
| JavaScript | `js/visitors.js`, `js/visitor-language.js`, `js/visitor-parking-notice.js` |
| 확인 상태 | ✅ GitHub main 파일 존재 확인 |

---

### 3-21b. Welcome (웰컴 페이지)

| 항목 | 경로 |
|------|------|
| HTML | `pages/welcome.html` |
| CSS | `css/pages/welcome.css` |
| JavaScript | `js/page-welcome.js`, `js/page-welcome-language.js`, `js/page-welcome-notice.js` |
| 확인 상태 | ✅ GitHub main 파일 존재 확인 |

---

### 3-22. Guide — Committee (위원회 가이드)

| 항목 | 경로 |
|------|------|
| HTML | `pages/guide-committee.html` |
| CSS | `css/pages/guide-committee.css` |
| JavaScript | `js/guide-committee-ac-demo-slider.js`, `js/guide-committee-ac-guide-submit.js`, `js/guide-committee-cost-select.js`, `js/guide-committee-language.js`, `js/guide-committee-layout.js` |
| 확인 상태 | ✅ GitHub main 파일 존재 확인 |

---

### 3-23. Guide — Owner (소유자 가이드)

| 항목 | 경로 |
|------|------|
| HTML | `pages/guide-owner.html` |
| CSS | `css/pages/guide-owner.css` |
| JavaScript | `js/guide-owner-ac-demo-slider.js`, `js/guide-owner-ac-guide-submit.js`, `js/guide-owner-cost-select.js`, `js/guide-owner-language.js`, `js/guide-owner-layout.js` |
| 확인 상태 | ✅ GitHub main 파일 존재 확인 |

---

### 3-24. Guide — Resident (입주민 가이드)

| 항목 | 경로 |
|------|------|
| HTML | `pages/guide-resident.html` |
| CSS | `css/pages/guide-resident.css` |
| JavaScript | `js/guide-resident-language.js`, `js/guide-resident-navigation.js` |
| 확인 상태 | ✅ GitHub main 파일 존재 확인 |

---

### 3-25. Guide — Tenant (임차인 가이드)

| 항목 | 경로 |
|------|------|
| HTML | `pages/guide-tenant.html` |
| CSS | `css/pages/guide-tenant.css` |
| JavaScript | `js/guide-tenant-ac-demo-slider.js`, `js/guide-tenant-ac-guide-submit.js`, `js/guide-tenant-language.js`, `js/guide-tenant-layout.js` |
| 확인 상태 | ✅ GitHub main 파일 존재 확인 |

---

### 3-26. Guide (Legacy) — retired

`guide.html`와 해당 페이지 전용 `guide-legacy.css`, `guide-legacy.js`, `guide-legacy-language.js`는 2026-11-09 사용 및 내부 참조 여부를 확인한 뒤 제거했습니다.

현재 역할별 가이드는 다음 페이지를 사용합니다:
- `pages/guide-resident.html`
- `pages/guide-owner.html`
- `pages/guide-tenant.html`
- `pages/guide-committee.html`

---

### 3-27. 공통 유틸리티 JS (페이지 없음)

| 파일 | 용도 |
|------|------|
| `js/layout.js` | 사이드바·탑바·공통 레이아웃 (변경 금지) |
| `js/auth.js` | 인증 처리 |
| `js/common.js` | 공통 함수 |
| `js/audit.js` | 감사 로그 |
| `js/my-profile.js` | 프로필 모달 등 |

---

---

## 4. 페이지별 수정 원칙

### 기본 원칙

| 문제 유형 | 수정 대상 파일 |
|-----------|--------------|
| 디자인, 색상, 여백, 크기 | 해당 페이지 CSS |
| 버튼 동작, 데이터 처리, 기능 오류 | 해당 페이지 JavaScript |
| HTML 요소, 화면 구조 | 해당 페이지 HTML |

**문제와 관계없는 파일은 수정하지 않습니다.**

### 연쇄 수정이 필요한 경우

HTML 구조를 변경하면 CSS 선택자나 JS 기능이 영향을 받을 수 있습니다.  
이 경우에만 추가 파일을 수정하고 **이유를 PR에 반드시 기록**합니다.

### 주의: 아직 완전하지 않은 부분

분리 작업 완료 후에도 다음이 남아 있을 수 있습니다:
- HTML의 개별 `style=""` 속성 (인라인 스타일)
- JavaScript에서 `element.style.xxx = ...`로 동적 설정하는 스타일

이를 "모두 제거됐다"고 단정하지 마세요.

---

## 5. 공통 파일 관리 원칙

다음 파일은 모든 페이지가 공유하는 영역입니다.

| 파일 | 역할 |
|------|------|
| `css/style.css` | 전역 스타일 |
| `js/layout.js` | 사이드바·탑바·레이아웃 초기화 |
| `components/sidebar.html` | 사이드바 HTML 컴포넌트 |
| `components/topbar.html` | 탑바 HTML 컴포넌트 |

**공통 파일 변경 시 필수 절차:**

1. 영향받는 페이지 목록을 먼저 파악합니다.
2. 변경 사유와 영향 범위를 기록합니다.
3. 관련 페이지 모두 회귀 테스트를 수행합니다.
4. 사장님 승인 없이 `main`에 반영하지 않습니다.

---

## 6. 보호 대상 파일 및 작업 제외 범위

다음 항목은 사장님의 별도 지시 없이 절대 수정하지 않습니다.

| 대상 | 사유 |
|------|------|
| `pages/hvac.html` | 별도 관리 대상 |
| `pages/history.html` | 별도 관리 대상 |
| `js/layout.js` | 전체 레이아웃에 영향 |
| `components/sidebar.html` | 모든 페이지 사이드바 |
| `components/topbar.html` | 모든 페이지 탑바 |
| Supabase DB 스키마 | 운영 데이터 직접 영향 |
| API / Edge Functions | 운영 로직 직접 영향 |
| `sca-facility-recreation.html` | 별도 SCA Facility 마이크로사이트 |

---

## 7. 운영 시스템 변경 절차

BMS는 실제 건물 관리에 사용 중인 운영 시스템입니다.  
모든 변경은 반드시 아래 절차를 따릅니다.

1. 현재 `main` 코드와 문제 현상을 확인합니다.
2. 문제가 발생한 페이지와 파일을 특정합니다.
3. 별도 브랜치에서 최소 범위로 수정합니다.
4. 해당 파일 외 불필요한 변경이 없는지 diff로 확인합니다.
5. Vercel Preview에서 화면과 기능을 검증합니다.
6. 다른 페이지에 영향을 주지 않는지 확인합니다.
7. PR을 제출하고 변경 내용을 보고합니다.
8. **사장님의 명시적 승인 후 병합합니다.**

> `main`에 직접 커밋하지 않습니다.  
> Preview 배포 성공 ≠ 기능 검증 완료.

---

## 8. 검증 및 승인 기준

코드 분리 완료와 실제 기능 정상 작동은 별개의 검증 항목입니다.  
다음 항목을 구분하여 기록해야 합니다.

| 검증 항목 | 설명 |
|-----------|------|
| ① GitHub 파일 구조 확인 | main 브랜치에 파일이 실제로 존재하는가 |
| ② CSS/JS 분리 여부 확인 | HTML에서 `<style>`·`<script>` 블록이 외부 파일로 이동됐는가 |
| ③ Vercel Preview 배포 확인 | Preview URL에서 오류 없이 배포됐는가 |
| ④ 브라우저 화면 확인 | 실제 브라우저에서 화면이 정상 렌더링되는가 |
| ⑤ 실제 기능 테스트 | 버튼·데이터·로직이 정상 작동하는가 |
| ⑥ 회귀 테스트 | 다른 페이지에 영향이 없는가 |

**확인하지 않은 항목은 완료로 표시하지 않습니다.**

---

## 9. 향후 유지보수 담당자를 위한 주의사항

### 새 페이지 추가 시

새 페이지를 만들 때 반드시 다음 파일을 생성합니다.

```
pages/<페이지명>.html
css/pages/<페이지명>.css
js/<페이지명>.js        ← 기능이 필요한 경우에만 생성
```

HTML에 `<style>` 블록이나 인라인 `<script>` 블록을 사용하지 않습니다.  
JavaScript가 필요하지 않은 페이지(출력 전용 등)는 빈 JS 파일을 만들지 않습니다. 실제 필요한 자산만 생성합니다.

### 기존 페이지 수정 시

- CSS만 고칠 때: `css/pages/<페이지명>.css`만 수정
- JS만 고칠 때: `js/<페이지명>.js`만 수정
- HTML 구조를 고칠 때: 연쇄 영향 파일을 먼저 파악 후 수정

### 절대 하지 말아야 할 것

- `main`에 직접 push
- `js/layout.js`, `components/sidebar.html`, `components/topbar.html` 무단 수정
- `pages/hvac.html`, `pages/history.html` 수정
- DB 스키마 무단 변경
- 사장님 승인 전 PR 병합

### 현재 미확인 항목

| 항목 | 내용 |
|------|------|
| Legacy Guide | 2026-11-09: `guide.html` 및 전용 CSS/JS 제거 완료. 역할별 가이드 페이지 유지 |
| `lift.html` (루트) | 다른 페이지들과 달리 `pages/` 하위가 아닌 루트에 위치 |
| `parking_sticker_print.html` (루트) | 루트 위치. 의도된 구조인지 확인 필요 |
| 인라인 `style=""` 잔존 여부 | 각 페이지 HTML에 개별 style 속성이 얼마나 남아 있는지 미확인 |

---

*이 문서는 ChatGPT(챗이사)가 정리한 작업 기록을 기반으로 Claude(클전무)가 GitHub main 브랜치 실제 파일 구조를 직접 조회하여 작성한 공식 기준 문서입니다.*  
*모든 작업자(Claude, ChatGPT 포함)는 이 문서를 기준으로 BMS를 유지보수합니다.*