# Integriti 문 제어 정리 (Redmyre House) — 2026-10-06

## 1. 한 줄 요약
BMS 포털(system.html)에서 D1/D2/D3/D5 문을 Unlock/Lock 하고, 자동잠금(Auto-Lock)이 작동한다. 실제 동작은 Redmyre PC의 Door Daemon이 Integriti System Designer 창을 UI Automation으로 조작해서 수행한다. 4개 문 모두 CCTV로 실제 확인 완료. 챗이사 최종 PASS/COMPLETE.

## 2. 구조
포털(Vercel, system.html) → Supabase(명령 저장) → Door Daemon(door_daemon.py, Redmyre PC) → Integriti 창(우클릭 메뉴 Unlock/Lock) → 결과/상태를 다시 Supabase → 포털 표시(10초마다 갱신)
- 포털은 명령을 "요청"만 한다(RPC `request_door_command`). 테이블에 직접 쓰지 않는다.
- Supabase 프로젝트: wunsexdnqathluplkkvo (FREE 플랜, Disk IO 경고 → 변경 시에만 쓰기)
- 포털 주소: https://sca-redmyre.vercel.app/pages/system.html (배포 = GitHub 커밋)

## 3. 제어하는 문
| ID | Integriti 실제 이름 | 포털 표시 이름 | Auto-Lock |
|----|----|----|----|
| D1 | Front Door | Front Door | 60초 |
| D2 | Garage Roller Door 1 | Front Roller Door | 180초 |
| D3 | Car Park Door | Car Park Door | 30초 |
| D5 | Garage Roller Door 2 | Back Roller Door | 180초 |
- D4(CP Lift Call)는 제어 안 함. Unlock/Lock 외 기능(Timed Unlock, Override 등)은 쓰지 않음.
- 포털 이름은 표시용이다. 데몬은 Integriti의 실제 이름으로 안전 확인을 하므로 바꾸면 안 된다.
- Auto-Lock은 포털 각 문의 칸에 30~300초 입력 후 Save (관리자만, 변경 기록 남음).

## 4. 파일 (C:\Users\Redmyre\Desktop\HVAC_Auto)
- door_daemon.py : Door Daemon 본체
- start_door.bat : 데몬 실행(꺼지면 5초 뒤 재시작). 작업 스케줄러가 로그온 1분 뒤 실행
- install_door_task.bat : 작업 스케줄러 "Door Daemon" 등록용(관리자 권한 필요, 이미 등록됨)
- HVAC_daemon_Auto.py / start_hvac.bat / watchdog.bat : HVAC 데몬(문 제어와 별개)
- sql\3B_door_control_schema.sql, sql\3B_add_D3.sql : DB 구조
- logs\door_daemon_YYYY-MM.txt : 데몬 로그
- system.html : 포털 화면(최신본은 GitHub)

## 5. DB
- 테이블: door_status, daemon_heartbeat(name 'door'/'hvac'), door_settings, door_commands
- door_commands 상태: pending → claimed → executing → success / failed / expired / unknown / cancelled
- 문당 활성 명령 1개, 수동 명령 유효시간 60초
- 함수: request_door_command, set_door_autolock(관리자만), claim_door_command, recover_door_commands(서비스 전용)
- 문 ID 허용 목록(check): door_settings, door_commands, door_status 모두 D1,D2,D3,D5

## 6. 안전장치 (데몬이 클릭하기 전/후)
실행 전 모두 통과해야 클릭한다. 하나라도 실패하면 클릭 없이 failed로 끝낸다.
1. Integriti 창+프로세스(IntegritiSystemDesigner.exe) 확인, 최소화돼 있으면 복원
2. 화면 잠금/원격 끊김 아님, PC가 2초 이상 한가함(최대 15초 대기)
3. Doors 그리드에서 ID + 이름 일치, 현재 상태 Locked/Unlocked
4. 이미 목표 상태면 클릭 없이 success(이 경우 Auto-Lock은 만들지 않음)
5. Integriti를 앞으로 가져오고, 클릭 지점의 창이 Integriti인지 확인
6. Status 칸 우클릭 → 메뉴에서 이름이 정확히 "Unlock" 또는 "Lock"인 항목만 클릭(Unlock (Timed)..., Override 등은 절대 안 누름)
7. 마우스가 움직이면 ESC로 취소
8. 클릭 후 15초 동안 상태 확인 → 목표 상태면 success, 아니면 unknown. 자동 재시도 없음
9. 끝나면 원래 앞에 있던 창(CCTV)을 다시 앞으로 복원

Auto-Lock
- 포털 Unlock이 실제로 성공했을 때만 lock 명령(source=autolock)을 저장(3회 재시도, 실패 시 메모리 타이머+긴급 알림)
- 수동 Lock은 대기 중인 Auto-Lock을 대체
- 90초 넘게 claimed/executing이면 unknown으로 정리(재실행 없음), 데몬 시작 시 중단된 명령은 unknown 처리
- Auto-Lock이 failed/unknown/expired면 새 명령 없이 알림 1회
- 알림: 로그 + (Resend 키가 있으면) 이메일 sp77249.redmyre@gmail.com. Resend 키는 아직 미설정(Windows 자격 증명 관리자 RedmyreHVAC/RESEND_KEY)

## 7. 포털 화면 규칙
- Unlock 버튼은 Locked일 때만, Lock 버튼은 Unlocked 또는 Unknown일 때 활성. Unlock은 확인 창이 한 번 뜸
- 색: Unlock 초록, Lock 빨강, Locked 초록, Unlocked 빨강, Checking 노랑, Unknown 회색
- 문이 열려(Unlocked) 있으면 그 문 카드 전체가 형광 빨강으로 천천히 맥동(1.4초 주기, 모션 줄이기 설정이면 고정)
- 데몬이 3분 넘게 응답 없거나 Integriti를 못 읽으면 Unknown 표시

## 8. Integriti 화면에서 알아낸 사실
- 프로그램: IntegritiSystemDesigner.exe (WinForms/DevExpress), 창 제목 "Doors - Inner Range Integriti System Designer"
- Doors 그리드: 자동화 ID m_gridControl, 칸 이름 "ID row N", "Name row N", "Status row N"
- 최소화하면 그리드가 UIA에서 안 보임 → 화면에 펼쳐서 CCTV 창 뒤에 두면 됨(가려져도 읽힘)
- Status 칸 우클릭 메뉴: Edit, Duplicate, Export, Delete, Recent Activity, Show Associated CCTV Footage, Show on Map, Show on Map and Show Video, Unlock, Unlock (Timed)..., Lock, Override Locked, Override Un-Locked, Remove Override, Enable/Disable DOTL Feedback, Door-User Activity/Reference Report, Configure Upcoming Schedules
- Status 값은 가끔 "Timed Unlock" 등 다른 문구가 나올 수 있음 → 데몬은 Unknown 처리
- 좌표 클릭은 맨 위에 있는 창을 누르므로 반드시 클릭 지점이 Integriti인지 확인해야 함(한 번 Claude 창을 우클릭한 적 있음)

## 9. 운영 주의
- Door Daemon 창은 최소화만 하고 닫지 말 것(닫으면 멈춤). 며칠 써본 뒤 숨김 실행 가능
- Integriti는 로그인한 채 켜두고 최소화하지 말 것(CCTV 뒤에 펼쳐두기)
- 명령 실행 중(약 10~20초)에는 마우스를 건드리지 말고, 원격 마우스는 Redmyre 모니터에 둘 것. 다른 모니터에 있으면 앞 창 전환이 실패할 수 있음
- 앞 창 전환 실패(integriti_not_foreground)는 클릭 없이 안전하게 실패하지만, 문이 열린 채 남을 수 있으니 알림이 오면 Lock 확인
- 재부팅 후 Integriti가 로그아웃돼 있으면 사장님이 로그인해야 함(자동 로그인은 보류 결정)

## 10. 문제 해결 (포털 문구 / 로그 코드)
| 코드 | 뜻 | 조치 |
|----|----|----|
| window_minimized | Integriti 최소화 | 창 펼치기(이제 데몬이 복원 시도) |
| integriti_not_running | Integriti 꺼짐 | 실행 후 로그인, Doors 탭 열기 |
| integriti_not_foreground / integriti_not_on_top | 앞으로 못 가져옴 | 마우스를 Redmyre 모니터로, 다시 시도 |
| user_active | PC 사용 중 | 마우스·키보드 놓고 다시 |
| screen_locked | 화면 잠김 | 잠금 해제 |
| menu_item_not_found | 메뉴 못 찾음 | 다시 시도, 반복되면 Integriti 화면 확인 |
| aborted_user_input | 실행 중 마우스 움직임 | 건드리지 말고 다시 |
| name_mismatch / door_row_not_found | 이름/행 불일치 | Doors 탭, Integriti 이름 확인 |
| status_not_confirmed | 15초 안에 상태 미확인 | 문 실제 상태 확인(CCTV) 후 수동 처리 |
| door_busy | 다른 명령 진행 중 | 잠시 후 |
| stale_claimed / daemon_restart | 중단 후 정리됨 | 문 상태 확인(재실행 안 함) |
- 포털이 Unknown이면: 데몬 실행 여부, Integriti 펼침/Doors 탭, logs 폴더 확인

## 11. 문 추가 방법
1. SQL: 세 테이블 door_id check와 두 RPC에 새 ID 추가 (sql\3B_add_D3.sql 참고, DB 변경은 사장님 승인 후)
2. door_daemon.py: DOORS(ID: Integriti 이름), ENABLED_DOORS에 추가
3. system.html: 문 카드 복사, DOOR_IDS, DOOR_UI_ENABLED에 추가 → GitHub 커밋
4. 읽기 전용으로 우클릭 메뉴 확인(Unlock/Lock 정확한 이름) → CCTV로 Unlock→Auto-Lock 테스트
5. 챗이사에게 PASS 받고 진행

## 12. 롤백
- 데몬 이전 버전/포털 이전 버전은 폴더 `삭제가능_백업`에 있을 수 있음(삭제 시 사라짐). 포털은 GitHub 이전 커밋으로 되돌리면 됨
- 비상 시 문을 직접 닫으려면 Integriti Doors 목록에서 해당 문 Status 칸 우클릭 → Lock

## 13. 오늘 테스트 기록 (2026-10-05~06)
- D2: 수동 Unlock/Lock 성공. 첫 Auto-Lock은 앞 창 전환 실패(integriti_not_foreground)로 실패 → 강화 후 재테스트 성공
- D5: 휴대폰으로 Unlock → 3분 뒤 Auto-Lock 성공
- D1: 60초 설정 후 Unlock → 1분 뒤 Auto-Lock 성공
- D3: DB 확대 → 읽기 전용 메뉴 점검 PASS → Unlock → 30초 Auto-Lock 성공
- 수정 이력: claimed 고착 방지 sweep, 이미 열린 문은 Auto-Lock 안 만듦, 최소화 시 복원, 앞 창 가져오기 강화, 10초 자동 갱신, 열린 문 빨강 경고, D2/D5 표시 이름 변경, 로그온 자동 시작 등록

## 14. 남은 선택 작업
- Resend 이메일 알림(키 저장 필요)
- 데몬 창 숨김 실행
- Open Integriti 버튼, Integriti 로그인 자동화(보류, 필요할 때만)
