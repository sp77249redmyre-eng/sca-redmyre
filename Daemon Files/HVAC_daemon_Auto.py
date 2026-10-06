"""
Redmyre House - HVAC Auto Daemon
Supabase에서 승인된 요청 감지 → 자동 온도 조절
+ 12시간마다 전 구역 Setpoint를 READ ONLY로 읽어 hvac_setpoints에 캐싱 (Suite별 온도 표시용)
건물 PC에서 항상 백그라운드로 실행
"""
import time
import subprocess
import sys
import os

# Credentials: secrets are no longer stored in this file. Order: environment variable, then
# Windows Credential Manager (RedmyreHVAC/*). (older note follows) read from environment variables first (Windows: setx SUPABASE_KEY "..." etc,
# then restart the terminal/service), falling back to the old hardcoded values only so this
# keeps running unchanged until the env vars are actually set. Once set, DELETE the hardcoded
# fallback values below and rotate both the Supabase service-role key and the BMS password —
# they were exposed in plain text in this file and should be treated as compromised.
# ---- Secret loading: env var > Windows Credential Manager > legacy in-source fallback ----
# Transition mode: if the value is only found in the legacy fallback, it is copied into the
# Windows Credential Manager (once) so the in-source fallback can be removed afterwards.
# Every step is wrapped: any failure silently falls back to the legacy value (old behaviour).
_SECRET_SOURCE = {}

def _win_cred():
    if sys.platform != "win32":
        return None
    import ctypes
    from ctypes import wintypes
    class CREDENTIAL(ctypes.Structure):
        _fields_ = [("Flags", wintypes.DWORD), ("Type", wintypes.DWORD),
                    ("TargetName", wintypes.LPWSTR), ("Comment", wintypes.LPWSTR),
                    ("LastWritten", wintypes.FILETIME), ("CredentialBlobSize", wintypes.DWORD),
                    ("CredentialBlob", ctypes.c_void_p), ("Persist", wintypes.DWORD),
                    ("AttributeCount", wintypes.DWORD), ("Attributes", ctypes.c_void_p),
                    ("TargetAlias", wintypes.LPWSTR), ("UserName", wintypes.LPWSTR)]
    adv = ctypes.WinDLL("advapi32", use_last_error=True)
    adv.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                              ctypes.POINTER(ctypes.POINTER(CREDENTIAL))]
    adv.CredReadW.restype = wintypes.BOOL
    adv.CredWriteW.argtypes = [ctypes.POINTER(CREDENTIAL), wintypes.DWORD]
    adv.CredWriteW.restype = wintypes.BOOL
    adv.CredFree.argtypes = [ctypes.c_void_p]
    adv.CredFree.restype = None
    return ctypes, CREDENTIAL, adv

def _cred_read(target):
    try:
        w = _win_cred()
        if not w:
            return None
        ctypes, CREDENTIAL, adv = w
        pc = ctypes.POINTER(CREDENTIAL)()
        if not adv.CredReadW(target, 1, 0, ctypes.byref(pc)):
            return None
        try:
            c = pc.contents
            raw = ctypes.string_at(c.CredentialBlob, c.CredentialBlobSize)
            return raw.decode("utf-16-le")
        finally:
            adv.CredFree(pc)
    except Exception:
        return None

def _cred_write(target, value):
    try:
        w = _win_cred()
        if not w:
            return False
        ctypes, CREDENTIAL, adv = w
        raw = value.encode("utf-16-le")
        buf = ctypes.create_string_buffer(raw, len(raw))
        c = CREDENTIAL()
        c.Type = 1
        c.TargetName = target
        c.CredentialBlobSize = len(raw)
        c.CredentialBlob = ctypes.cast(buf, ctypes.c_void_p)
        c.Persist = 2
        c.UserName = "hvac_daemon"
        return bool(adv.CredWriteW(ctypes.byref(c), 0))
    except Exception:
        return False

def _load_secret(env_name, cred_name, legacy_value):
    v = os.environ.get(env_name)
    if v:
        _SECRET_SOURCE[env_name] = "env"
        return v
    v = _cred_read(cred_name)
    if v:
        _SECRET_SOURCE[env_name] = "credential-manager"
        return v
    if legacy_value:
        saved = _cred_write(cred_name, legacy_value)
        _SECRET_SOURCE[env_name] = "legacy-fallback" + (" (saved to credential-manager)" if saved else " (save failed)")
    return legacy_value

SUPABASE_URL = os.environ.get("REDMYRE_SUPABASE_URL", "https://wunsexdnqathluplkkvo.supabase.co")
SUPABASE_KEY = _load_secret("REDMYRE_SUPABASE_KEY", "RedmyreHVAC/SUPABASE_KEY", "")

ICONTROL_URL = "http://redmyre.dyndns.biz/login"
BASE_URL     = "http://redmyre.dyndns.biz"
USERNAME     = os.environ.get("REDMYRE_BMS_USERNAME", "bm")
PASSWORD     = _load_secret("REDMYRE_BMS_PASSWORD", "RedmyreHVAC/BMS_PASSWORD", "")

TEMP_MIN_DEFAULT = 20.0
TEMP_MAX_DEFAULT = 26.0

TENANCY_SENSOR_IDS = {
    "Tenancy A": [37, 38],
    "Tenancy B": [41, 42],
    "Tenancy C": [45, 46],
    "Tenancy D": [49, 50],
    "Tenancy E": [53, 54],
    "Tenancy F": [58, 60, 59],
    "Tenancy G": [63, 64],
    "Tenancy H": [67, 68],
}

# --- Setpoint polling (read-only, for Suite별 온도 표시) ---
POLL_INTERVAL_SECONDS = 12 * 60 * 60
FLOOR_POLL_INTERVAL_SECONDS = 12 * 60 * 60  # Floor Setpoint changes slowly — twice a day is enough
FAILED_SCAN_RETRY_SECONDS = 15 * 60  # if a full scan finds zero ready levels, retry sooner than 12h
LEVELS = [1, 2, 3, 4, 5, 6]

BMS_OFFLINE_MESSAGE = "BMS temporarily offline for repair. We'll notify residents once access is restored — please resubmit after that."

class BMSConnectionError(Exception):
    """Raised when the daemon cannot log in / reach the iControl BMS system."""
    pass


class TargetRejectedError(Exception):
    """Slider target request refused BEFORE any BMS write because the requested target is
    no longer valid for the LIVE setpoint (e.g. building manager changed it manually since
    the 12h cache). Carries the live value so the cache can be refreshed and the tenant told."""
    def __init__(self, message, live_temp=None):
        super().__init__(message)
        self.live_temp = live_temp

class BMSReadError(Exception):
    """Raised when the current tenant setpoint cannot be safely read from BMS."""
    pass

import urllib.request
import urllib.parse
import json

def supabase_get(table, params=""):
    url = f"{SUPABASE_URL}/rest/v1/{table}?{params}"
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def supabase_patch(table, row_id, data):
    url = f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{row_id}"
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, method="PATCH", headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    })
    with urllib.request.urlopen(req) as r:
        return r.status

def supabase_insert(table, data):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    })
    with urllib.request.urlopen(req) as r:
        return r.status

def supabase_upsert(table, data, on_conflict):
    url = f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={on_conflict}"
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    })
    with urllib.request.urlopen(req) as r:
        return r.status

def upsert_setpoint(level, tenancy, value, sensor_id):
    supabase_upsert("hvac_setpoints", {
        "level": level,
        "tenancy": tenancy,
        "current_setpoint": value,
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source_sensor_id": sensor_id,
    }, on_conflict="level,tenancy")

def upsert_floor_setpoint(level, value):
    supabase_upsert("hvac_floor_setpoints", {
        "level": level,
        "current_setpoint": value,
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }, on_conflict="level")

def get_temp_limits():
    try:
        data = supabase_get("settings", "key=in.(temp_min,temp_max)")
        limits = {d["key"]: float(d["value"]) for d in data}
        return limits.get("temp_min", TEMP_MIN_DEFAULT), limits.get("temp_max", TEMP_MAX_DEFAULT)
    except:
        return TEMP_MIN_DEFAULT, TEMP_MAX_DEFAULT

def get_approved_requests():
    try:
        return supabase_get("hvac_requests", "status=eq.pending&order=id.asc")
    except Exception as e:
        print(f"[ERROR] Failed to fetch requests: {e}")
        return None

def mark_processing(req_id):
    supabase_patch("hvac_requests", req_id, {"status": "processing"})

def mark_completed(req_id, temp_before, temp_after, admin_comment=None):
    data = {
        "status": "completed",
        "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "temp_before": temp_before,
        "temp_after": float(temp_after),
    }
    if admin_comment:
        data["admin_comment"] = admin_comment
    supabase_patch("hvac_requests", req_id, data)

def mark_failed(req_id, reason="Automatic temperature adjustment failed. Building manager has been notified."):
    supabase_patch("hvac_requests", req_id, {"status": "failed", "admin_comment": reason})

def mark_rejected(req_id, reason=BMS_OFFLINE_MESSAGE):
    supabase_patch("hvac_requests", req_id, {"status": "rejected", "admin_comment": reason})

def recover_stuck_processing():
    """Runs once at daemon startup. If the daemon was killed (crash, reboot, power loss)
    while a request was mid-flight, that row is stuck forever on status=processing, since
    get_approved_requests() only ever looks at status=eq.pending — it would never be picked
    up again.

    IMPORTANT (corrected 2026-10-02, caught before deploy): this does NOT reset the row back
    to pending. read-before-write only protects against writing a STALE temperature — it does
    NOT know whether this exact request's BMS write already succeeded right before the crash.
    If it had (e.g. the daemon died in the few seconds between the last sensor's "Done!" and
    mark_completed() being called), blindly re-queuing it as pending would run the same ±0.5°C
    adjustment a second time against the real BMS — a real duplicate temperature change, not
    just a log/bookkeeping issue.

    So instead: mark any stuck 'processing' row as failed, with a clear explanation, and let
    a human decide. Worst case here is a resident has to resubmit a request that was genuinely
    never applied — mildly annoying. The alternative (auto-reset to pending) risks silently
    moving a real unit's temperature twice, which is worse. Same philosophy as BMSReadError:
    when in doubt, stop safely instead of guessing."""
    try:
        stuck = supabase_get("hvac_requests", "status=eq.processing")
    except Exception as e:
        log(f"  [recovery] Failed to check for stuck 'processing' requests: {e}")
        return
    if not stuck:
        return
    for r in stuck:
        try:
            mark_failed(
                r["id"],
                "Building manager system was restarted while this request was being "
                "processed. We could not confirm whether the temperature change was "
                "already applied. Please check the current temperature and resubmit "
                "if still needed."
            )
            log(f"  [recovery] Stuck request {r['id']} ({r.get('level')} {r.get('tenancy')}) "
                f"was left on 'processing' by a previous daemon run — marked as failed "
                f"(not auto-retried, to avoid possibly double-adjusting the BMS). "
                f"Resident should resubmit if needed.")
        except Exception as e:
            log(f"  [recovery] Failed to mark stuck request {r.get('id')} as failed: {e}")

def get_driver():
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.chrome.service import Service
    from webdriver_manager.chrome import ChromeDriverManager
    options = Options()
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=1400,900")
    # options.add_argument("--headless=new")
    service = Service(ChromeDriverManager().install())
    return webdriver.Chrome(service=service, options=options)

def login(driver):
    """Log in with ONE automatic retry. A transient failure (slow BMS, page not ready) was seen
    on 2026-10-05 12:32 and succeeded on the next attempt. Only 2 attempts total so a genuinely
    wrong/changed password can never trigger repeated login hammering."""
    try:
        _login_once(driver)
    except Exception as first_err:
        log(f"  [login] First attempt failed ({first_err}). Retrying once in 8s...")
        time.sleep(8)
        _login_once(driver)

def _login_once(driver):
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    driver.get(ICONTROL_URL)
    wait = WebDriverWait(driver, 15)
    wait.until(EC.presence_of_element_located(
        (By.CSS_SELECTOR, "input[type='text']"))).send_keys(USERNAME)
    wait.until(EC.element_to_be_clickable(
        (By.XPATH, "//input[@type='submit'] | //button"))).click()
    time.sleep(2)
    wait.until(EC.presence_of_element_located(
        (By.CSS_SELECTOR, "input[type='password']"))).send_keys(PASSWORD)
    wait.until(EC.element_to_be_clickable(
        (By.XPATH, "//input[@type='submit'] | //button"))).click()
    # Give a slow BMS up to ~15s to leave /login instead of judging after a fixed 3s
    # (a 12:32 login on 2026-10-05 failed once and succeeded two minutes later on the same credentials).
    for _ in range(30):
        time.sleep(0.5)
        if "login" not in driver.current_url.lower():
            break
    time.sleep(2)  # let the session settle before the URL check / first page load

    # Verify login actually succeeded. The form-fill/click sequence above can complete
    # with no exception thrown even when the BMS silently rejects the login — it just
    # lands back on /login. Confirmed live 2026-10-03: a full 12h scan ran all 6 levels
    # against the login page, wasting the whole cycle with "iframe never appeared" on
    # every level, with no clear error anywhere pointing at the real cause. Check the URL
    # we actually ended up on; if still on the login page, raise so the caller gets this
    # treated as a real BMSConnectionError instead of 6 confusing per-level failures.
    if "login" in driver.current_url.lower():
        raise Exception(f"Login did not succeed — still on login page ({driver.current_url}).")

def wait_for_zoning_off(driver):
    from selenium.webdriver.common.by import By
    for _ in range(60):
        try:
            poly = driver.find_element(By.ID, "root.content.Polygon1")
            if "hidden" in poly.get_attribute("style"):
                return True
        except: pass
        time.sleep(0.5)
    return False

def read_setpoint(driver, sensor_id):
    from selenium.webdriver.common.by import By
    lid = f"root.content.BoundLabel{sensor_id}"
    try:
        el = driver.find_element(By.ID, lid)
        labels = el.find_elements(By.CLASS_NAME, "-t-Label-text")
        for label in labels:
            text = label.text.strip().replace("°C", "").strip()
            try:
                val = float(text)
                if 10 <= val <= 35:
                    return val
            except: pass
    except: pass
    return None

def dump_debug_html(driver, level):
    """One-off diagnostic fallback: saves the current page's HTML if the Floor Setpoint
    value still can't be found. Never touches the BMS itself — only reads what's loaded."""
    try:
        log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
        os.makedirs(log_dir, exist_ok=True)
        safe_level = level.replace(" ", "_")
        path = os.path.join(log_dir, f'floor_setpoint_debug_{safe_level}.html')
        with open(path, 'w', encoding='utf-8') as f:
            f.write(driver.page_source)
        log(f"  [debug] Could not find 'Floor Setpoint' value — saved page HTML to {path}.")
    except Exception as e:
        log(f"  [debug] Failed to save debug page source: {e}")

def _read_floor_setpoint_once(driver):
    """One single DOM lookup attempt, no retry, no debug dump. Always re-queries the DOM
    fresh (never reuses a stale element reference from a previous attempt) so it reflects
    whatever is actually bound at the moment it's called."""
    from selenium.webdriver.common.by import By
    try:
        label_el = driver.find_element(
            By.XPATH, "//*[contains(normalize-space(text()),'Floor Setpoint')]")
    except Exception:
        return None
    try:
        label_rect = label_el.rect
        label_top = label_rect['y']
        label_right = label_rect['x'] + label_rect['width']
        candidates = driver.find_elements(By.CLASS_NAME, '-t-Label-text')
        best_val, best_dx = None, None
        for c in candidates:
            txt = c.text.strip()
            if "°C" not in txt:
                continue
            try:
                val = float(txt.replace("°C", "").strip())
            except:
                continue
            if not (10 <= val <= 35):
                continue
            r = c.rect
            if abs(r['y'] - label_top) <= 5 and r['x'] >= label_right - 2:
                dx = r['x'] - label_right
                if best_dx is None or dx < best_dx:
                    best_dx, best_val = dx, val
        return best_val
    except Exception:
        return None

def read_floor_setpoint(driver, level=None):
    """READ ONLY. Finds the 'Floor Setpoint' value (e.g. '21.0 °C') shown near the top of
    the level page. VERIFIED against the real live BMS DOM on Level 1 and Level 2
    (2026-09-24) — not guessed. The value is a separate element positioned immediately to
    the right of the 'Floor Setpoint' label, on the same row (same top, left just past the
    label's right edge). We locate the label, then pick the nearest '.../°C' value element
    on that same row. Never clicks or changes anything.

    Confirmed via live production log + debug HTML (2026-09-24, Level 5): the selector/
    geometry logic itself is correct — the debug HTML dumped right after a "failed" read
    showed the exact value (BoundLabel70 = 21.0 °C) sitting exactly where expected. Root
    cause is a race condition: Floor Setpoint (an ordPath-based history point) can bind
    slightly (~1-2s) later than the Tenancy values that _is_bms_level_ready() already
    confirmed. So this retries the lookup itself, fully re-querying the DOM each time,
    before giving up. This does NOT touch the level-readiness gate (still Tenancy-only,
    per the earlier agreed separation of concerns) — it only makes this one reader more
    patient about its own, independently-timed value. Agreed with 챗이사 2026-09-24."""
    # Not time-sensitive: this scan only runs once per 12h cycle, nothing is waiting on
    # it, so there's no reason to be stingy here. 10 attempts x 2s = up to 18s of patient
    # re-polling (same order of magnitude as the 25s level-readiness timeout) before we
    # give up and dump debug HTML. Agreed with 사장님 + 챗이사 2026-09-24.
    for attempt in range(10):
        val = _read_floor_setpoint_once(driver)
        if val is not None:
            return val
        if attempt < 9:
            time.sleep(2)
    if level:
        dump_debug_html(driver, level)
    return None

def read_current_tenancy_setpoint(driver, level, tenancy, timeout=45):
    """
    READ ONLY. Waits for the live BMS tenancy value to actually bind, then reads it.

    This is intentionally more patient than the normal 12-hour cache scan because
    this read happens immediately before a real temperature write. A stale/empty DOM
    must never be treated as a temperature value.

    Strategy:
      1. Re-query the live DOM repeatedly for up to `timeout` seconds.
      2. Try every sensor ID assigned to the tenancy.
      3. Require a valid numeric setpoint from the BMS (10-35°C).
      4. If nothing is readable, reload the level once and repeat the full wait.
      5. Return None only after both attempts fail.
    """
    from selenium.webdriver.common.by import By

    sensor_ids = TENANCY_SENSOR_IDS[tenancy]
    deadline = time.time() + timeout

    while time.time() < deadline:
        for sid in sensor_ids:
            value = read_setpoint(driver, sid)
            if value is not None:
                log(f"  [read] {level} {tenancy}: sensor {sid} → {value:.1f}°C")
                return value
        time.sleep(1)

    return None


def wait_for_tenancy_setpoint(driver, level, tenancy, timeout=45, reload_once=True):
    """
    READ ONLY. Gets a reliable live tenancy setpoint before any BMS write.

    The first attempt waits patiently for the asynchronous BMS DOM to populate.
    If it still cannot read the value, the level page is reloaded once and the
    complete wait/read cycle is repeated. No BMS controls are clicked here.
    """
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC

    level_num = level.replace("Level ", "")

    for attempt in range(2 if reload_once else 1):
        if attempt > 0:
            log(f"  [read] {level} {tenancy}: reloading BMS page for a second read attempt...")
            try:
                driver.switch_to.default_content()
                driver.get(f"{BASE_URL}/ord?station:%7Cslot:/Drivers/BacnetNetwork/Level_{level_num}")
                time.sleep(5)

                wait = WebDriverWait(driver, 20)
                iframe = wait.until(
                    EC.presence_of_element_located((By.ID, "servletViewWidget"))
                )
                driver.switch_to.frame(iframe)
            except Exception as e:
                log(f"  [read] {level} {tenancy}: reload failed ({e}).")
                break

        value = read_current_tenancy_setpoint(
            driver, level, tenancy, timeout=45
        )
        if value is not None:
            return value

        if attempt == 0 and reload_once:
            log(f"  [read] {level} {tenancy}: no live setpoint after 45s; retrying once...")

    # Final failure: save the page HTML (read-only) so the real root cause can be checked.
    try:
        ld = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
        os.makedirs(ld, exist_ok=True)
        dp = os.path.join(ld, f"tenancy_read_fail_{level.replace(' ', '_')}_{tenancy.replace(' ', '_')}.html")
        with open(dp, 'w', encoding='utf-8') as f:
            f.write(driver.page_source)
        log(f"  [read] {level} {tenancy}: saved debug HTML to {dp}")
    except Exception as e:
        log(f"  [read] debug HTML save failed: {e}")

    return None


def adjust_temperature(level, tenancy, req_type, temp_min, temp_max, requested_target=None):
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.common.action_chains import ActionChains
    from selenium.webdriver.common.keys import Keys

    driver = None
    last_driver_err = None
    for attempt in range(2):
        try:
            driver = get_driver()
            break
        except Exception as e:
            last_driver_err = e
            log(f"  [driver] {level} {tenancy}: Chrome failed to start (attempt {attempt+1}/2): {e}")
            time.sleep(5)
    if driver is None:
        raise BMSConnectionError(f"Chrome could not be started after 2 attempts: {last_driver_err}")

    try:
        print(f"  Logging in to iControl...")
        try:
            login(driver)
        except Exception as e:
            raise BMSConnectionError(f"Login/connection failed: {e}")

        level_num = level.replace("Level ", "")
        driver.get(f"{BASE_URL}/ord?station:%7Cslot:/Drivers/BacnetNetwork/Level_{level_num}")
        time.sleep(5)

        wait = WebDriverWait(driver, 20)
        iframe = wait.until(EC.presence_of_element_located((By.ID, "servletViewWidget")))
        driver.switch_to.frame(iframe)

        # SAFETY + RELIABILITY:
        # Do not use a guessed/default temperature. Wait for the live BMS value,
        # retry once after a full page reload, and only then allow any write action.
        current_temp = wait_for_tenancy_setpoint(
            driver, level, tenancy, timeout=45, reload_once=True
        )

        if current_temp is None:
            raise BMSReadError(
                f"Could not safely read current temperature for {level} {tenancy} "
                "after two 45-second read attempts. No BMS setpoint change was made."
            )

        sensor_ids = TENANCY_SENSOR_IDS[tenancy]

        # TARGET MODE (new slider requests): the frontend stores the requested target
        # in the existing hvac_requests.temp_after column.  The live BMS setpoint
        # above is ALWAYS used as the reference point, so a stale page value can
        # never bypass the ±2.0°C safety window.  Legacy requests without a target
        # continue to use the original ±0.5°C behaviour below.
        if requested_target is not None:
            try:
                target = round(float(requested_target), 1)
            except (TypeError, ValueError):
                raise BMSReadError(
                    f"Invalid requested target temperature: {requested_target!r}. No BMS setpoint change was made."
                )

            # Hard safety range, narrowed further by the admin settings (temp_min/temp_max),
            # then by the live current setpoint ±2.0°C.
            HARD_MIN = max(18.0, float(temp_min))
            HARD_MAX = min(25.0, float(temp_max))
            min_allowed = max(HARD_MIN, round(current_temp - 2.0, 1))
            max_allowed = min(HARD_MAX, round(current_temp + 2.0, 1))

            if abs((target * 2) - round(target * 2)) > 1e-9:
                raise TargetRejectedError(
                    f"Requested target {target:.1f}°C is not a 0.5°C increment. No BMS setpoint change was made.",
                    live_temp=current_temp,
                )

            if target < HARD_MIN or target > HARD_MAX:
                raise TargetRejectedError(
                    f"Requested target {target:.1f}°C is outside the allowed limits "
                    f"{HARD_MIN:.1f}–{HARD_MAX:.1f}°C. No BMS setpoint change was made.",
                    live_temp=current_temp,
                )

            if target < min_allowed or target > max_allowed:
                raise TargetRejectedError(
                    f"Requested target {target:.1f}°C is outside the allowed range "
                    f"{min_allowed:.1f}–{max_allowed:.1f}°C based on live current setpoint "
                    f"{current_temp:.1f}°C. No BMS setpoint change was made.",
                    live_temp=current_temp,
                )

            new_temp = target
            print(
                f"  Target request: {current_temp:.1f}°C → {new_temp:.1f}°C "
                f"(allowed {min_allowed:.1f}–{max_allowed:.1f}°C)"
            )
        else:
            # Legacy request behaviour — unchanged.
            if req_type == "hot":
                new_temp = current_temp - 0.5
            else:
                new_temp = current_temp + 0.5

            if new_temp < temp_min:
                print(f"  Temperature {new_temp}°C is below minimum {temp_min}°C, setting to {temp_min}°C")
                new_temp = temp_min
            if new_temp > temp_max:
                print(f"  Temperature {new_temp}°C is above maximum {temp_max}°C, setting to {temp_max}°C")
                new_temp = temp_max

        admin_comment = None
        if requested_target is None:  # min/max notes only make sense for the legacy ±0.5°C buttons
            if new_temp == temp_min:
                admin_comment = f"Already at minimum temperature ({int(temp_min)}°C). No further reduction possible."
            elif new_temp == temp_max:
                admin_comment = f"Already at maximum temperature ({int(temp_max)}°C). No further increase possible."

        new_temp_str = str(round(new_temp, 1))
        print(f"  Current: {current_temp}°C → New: {new_temp_str}°C ({req_type})")

        cb = wait.until(EC.element_to_be_clickable((By.ID, "root.content.CheckBox")))
        ActionChains(driver).move_to_element(cb).click().perform()
        wait_for_zoning_off(driver)
        time.sleep(2)

        success = 0
        for i, sid in enumerate(sensor_ids, 1):
            print(f"  [{i}/{len(sensor_ids)}] BoundLabel{sid} → {new_temp_str}°C")
            lid = f"root.content.BoundLabel{sid}"

            # Retry this one sensor up to 2 times before giving up on it and moving to
            # the next sensor. A single sensor can fail on a one-off DOM/click timing
            # glitch (confirmed live 2026-10-02: BoundLabel58 failed while BoundLabel60/59
            # succeeded right after, same tenancy, same page) — re-locating the element
            # fresh and retrying once recovers from that instead of leaving the unit stuck.
            sensor_done = False
            for sensor_attempt in range(2):
                try:
                    el = wait.until(EC.presence_of_element_located((By.ID, lid)))
                    driver.execute_script("arguments[0].scrollIntoView({block:'center'});", el)
                    time.sleep(1)

                    try:
                        poly = driver.find_element(By.ID, "root.content.Polygon1")
                        if "hidden" not in poly.get_attribute("style"):
                            cb2 = driver.find_element(By.ID, "root.content.CheckBox")
                            ActionChains(driver).move_to_element(cb2).click().perform()
                            wait_for_zoning_off(driver)
                            time.sleep(2)
                    except: pass

                    override_clicked = False
                    for attempt in range(15):
                        ActionChains(driver).move_to_element(el).context_click().perform()
                        time.sleep(2)
                        try:
                            override_btn = driver.find_element(
                                By.XPATH, "//*[normalize-space(text())='Override']")
                            override_btn.click()
                            override_clicked = True
                            break
                        except: pass
                        try:
                            driver.find_element(By.XPATH,
                                "//*[contains(text(),'Active') or contains(text(),'Inactive')]")
                            driver.find_element(By.TAG_NAME, "body").send_keys(Keys.ESCAPE)
                            time.sleep(1)
                            try:
                                cb2 = driver.find_element(By.ID, "root.content.CheckBox")
                                ActionChains(driver).move_to_element(cb2).click().perform()
                                wait_for_zoning_off(driver)
                                time.sleep(2)
                            except: pass
                            continue
                        except: pass
                        driver.find_element(By.TAG_NAME, "body").send_keys(Keys.ESCAPE)
                        time.sleep(1)

                    if not override_clicked:
                        print(f"    Failed to find Override menu")
                        log(f"  [sensor] {level} {tenancy}: BoundLabel{sid} — attempt {sensor_attempt+1}/2: could not open Override menu after 15 attempts")
                        if sensor_attempt == 0:
                            time.sleep(2)
                            continue
                        break

                    time.sleep(3)
                    temp_input = wait.until(EC.presence_of_element_located(
                        (By.CSS_SELECTOR, "span.slot-value input[type='text']")))
                    temp_input.click()
                    time.sleep(0.5)
                    temp_input.send_keys(Keys.CONTROL + 'a')
                    time.sleep(0.3)
                    temp_input.send_keys(new_temp_str)
                    time.sleep(0.5)

                    ok_btn = wait.until(EC.element_to_be_clickable(
                        (By.CSS_SELECTOR, "input[type='submit'][value='Ok']")))
                    ok_btn.click()
                    time.sleep(3)
                    print(f"    Done!")
                    sensor_done = True
                    break

                except Exception as e:
                    print(f"    Failed: {e}")
                    log(f"  [sensor] {level} {tenancy}: BoundLabel{sid} — attempt {sensor_attempt+1}/2 failed: {e}")
                    try: driver.find_element(By.TAG_NAME, "body").send_keys(Keys.ESCAPE)
                    except: pass
                    time.sleep(1)
                    if sensor_attempt == 0:
                        time.sleep(2)

            if sensor_done:
                success += 1

        try:
            cb = driver.find_element(By.ID, "root.content.CheckBox")
            ActionChains(driver).move_to_element(cb).click().perform()
            time.sleep(3)
        except: pass

        driver.switch_to.default_content()
        return success, len(sensor_ids), new_temp_str, current_temp, admin_comment

    finally:
        driver.quit()

import logging
import os

log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, f'hvac_log_{time.strftime("%Y-%m")}.txt')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    handlers=[
        logging.FileHandler(log_file, encoding='utf-8'),
        logging.StreamHandler()
    ]
)

def log(msg):
    logging.info(msg)

log("Secret sources: " + ", ".join(f"{k}={v}" for k, v in _SECRET_SOURCE.items()))
if not SUPABASE_KEY or not PASSWORD:
    log("FATAL: required secret(s) not found in env / Windows Credential Manager. Exiting; start_hvac.bat will retry.")
    sys.exit(1)

def _is_bms_level_ready(driver):
    """READ ONLY. Returns True only once REAL tenancy data has been bound into this Level
    page — not just once the DOM skeleton exists. Found via live diagnostic logging on
    2026-09-24: the Px widget renders ~104 empty '-t-Label-text' skeleton elements
    immediately, then fills them in asynchronously as BMS values arrive. Checking 'label
    elements > 0' passes on the empty skeleton and reads garbage; checking for at least ONE
    real tenancy value is what actually distinguishes a loaded page from a skeleton one
    (confirmed: failed levels had a fixed 178448-byte skeleton HTML with no real values;
    succeeded levels had real, varying values). Checks every tenancy, not just Tenancy A,
    since any single tenancy could individually lag behind the rest of the page.
    Deliberately does NOT require Floor Setpoint here: tenancy data (read every cycle) and
    Floor Setpoint (read once per 2 cycles) are two independent things going to two
    different Supabase tables, so a slow-loading Floor Setpoint widget should not cause the
    whole level's tenancy reads to be thrown away — read_floor_setpoint() has its own
    None-safe retry/debug-dump handling and is called separately regardless of this check."""
    try:
        for sensor_ids in TENANCY_SENSOR_IDS.values():
            for sid in sensor_ids:
                if read_setpoint(driver, sid) is not None:
                    return True
        return False
    except Exception:
        return False

def _wait_for_bms_level_ready(driver, level, timeout=25):
    """READ ONLY. Polls _is_bms_level_ready() once a second until it passes or timeout runs
    out. Returns True/False. Never clicks or changes anything."""
    start = time.time()
    while time.time() - start < timeout:
        if _is_bms_level_ready(driver):
            return True
        time.sleep(1)
    return False

def poll_all_setpoints(read_floor=False):
    """READ ONLY. Override는 절대 클릭하지 않고, BMS 값도 변경하지 않음.
    Level 1~6을 순서대로 열어 각 Tenancy의 현재 setpoint를 읽어 hvac_setpoints에 upsert.
    read_floor=True면 같은 페이지에서 Floor Setpoint도 같이 읽어 hvac_floor_setpoints에 upsert
    (별도 스캔 없이 12시간에 한 번만, 매번 돌리는 tenancy 스캔에 얹어서 처리)."""
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC

    driver = get_driver()
    try:
        try:
            login(driver)
        except Exception as e:
            raise BMSConnectionError(f"Login/connection failed: {e}")

        ready_levels = 0
        floor_success_count = 0
        for level_num in LEVELS:
            level = f"Level {level_num}"
            try:
                driver.get(f"{BASE_URL}/ord?station:%7Cslot:/Drivers/BacnetNetwork/Level_{level_num}")
                time.sleep(5)

                wait = WebDriverWait(driver, 20)

                # Diagnostic snapshot BEFORE switching into the iframe, so we can tell a bad
                # navigation/page-load apart from a DOM-selector problem. Added after Level 6
                # failed on ALL 8 tenancies + Floor Setpoint at once on 2026-09-24 — that kind
                # of total failure points at the page/iframe not being ready, not 9 selectors
                # being wrong at once.
                try:
                    iframes_top = driver.find_elements(By.TAG_NAME, "iframe")
                    log(f"  [diag] {level}: url={driver.current_url} title={driver.title!r} "
                        f"top_html_len={len(driver.page_source)} iframe_count={len(iframes_top)}")
                except Exception as e:
                    log(f"  [diag] {level}: pre-iframe diagnostic failed: {e}")

                try:
                    iframe = wait.until(EC.presence_of_element_located((By.ID, "servletViewWidget")))
                except Exception as e:
                    log(f"  [poll] {level}: servletViewWidget iframe never appeared, skipping level: {e}")
                    try:
                        shot_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
                        os.makedirs(shot_dir, exist_ok=True)
                        driver.save_screenshot(os.path.join(shot_dir, f'{level.replace(" ", "_")}_no_iframe.png'))
                    except Exception:
                        pass
                    continue

                driver.switch_to.frame(iframe)

                # Gate on REAL data, not just DOM skeleton existing. See _is_bms_level_ready.
                ready = _wait_for_bms_level_ready(driver, level, timeout=25)

                if not ready:
                    log(f"  [poll] {level}: BMS data not ready after 25s, reloading once...")
                    try:
                        driver.switch_to.default_content()
                        driver.get(f"{BASE_URL}/ord?station:%7Cslot:/Drivers/BacnetNetwork/Level_{level_num}")
                        time.sleep(5)
                        iframe = wait.until(EC.presence_of_element_located((By.ID, "servletViewWidget")))
                        driver.switch_to.frame(iframe)
                        ready = _wait_for_bms_level_ready(driver, level, timeout=25)
                    except Exception as e:
                        log(f"  [poll] {level}: reload failed: {e}")
                        ready = False

                # Diagnostic snapshot + screenshot either way, so a failure log always shows
                # exactly what the browser was looking at.
                try:
                    floor_anchor = len(driver.find_elements(
                        By.XPATH, "//*[contains(normalize-space(text()),'Floor Setpoint')]")) > 0
                    tenancy_a_anchor = len(driver.find_elements(
                        By.XPATH, "//*[contains(normalize-space(text()),'Tenancy A')]")) > 0
                    label_count = len(driver.find_elements(By.CLASS_NAME, "-t-Label-text"))
                    log(f"  [diag] {level}: ready={ready} iframe_html_len={len(driver.page_source)} "
                        f"label_count={label_count} floor_anchor={floor_anchor} tenancy_a_anchor={tenancy_a_anchor}")
                    shot_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
                    os.makedirs(shot_dir, exist_ok=True)
                    driver.save_screenshot(os.path.join(shot_dir, f'{level.replace(" ", "_")}.png'))
                except Exception as e:
                    log(f"  [diag] {level}: diagnostic failed: {e}")

                if not ready:
                    log(f"  [poll] {level}: BMS content not ready after retry, skipping level entirely "
                        f"(no sensor reads attempted, so no false could-not-read spam).")
                    driver.switch_to.default_content()
                    continue

                ready_levels += 1
                failed_tenancies = []
                for tenancy, sensor_ids in TENANCY_SENSOR_IDS.items():
                    value, used_sid = None, None
                    for sid in sensor_ids:
                        value = read_setpoint(driver, sid)
                        if value is not None:
                            used_sid = sid
                            break
                    if value is not None:
                        upsert_setpoint(level, tenancy, value, used_sid)
                    else:
                        failed_tenancies.append((tenancy, sensor_ids))

                # Retry once after a short extra wait. Verified live against the real BMS
                # DOM on 2026-09-24: all sensor IDs resolve fine once the page has had time
                # to finish rendering, so a first-pass miss is a timing issue, not a bad
                # selector — this retry covers the slow-load cases seen in production logs.
                if failed_tenancies:
                    time.sleep(3)
                    for tenancy, sensor_ids in failed_tenancies:
                        value, used_sid = None, None
                        for sid in sensor_ids:
                            value = read_setpoint(driver, sid)
                            if value is not None:
                                used_sid = sid
                                break
                        if value is not None:
                            upsert_setpoint(level, tenancy, value, used_sid)
                        else:
                            log(f"  [poll] {level} {tenancy}: could not read any sensor, skipped")

                if read_floor:
                    floor_value = read_floor_setpoint(driver, level)
                    if floor_value is not None:
                        upsert_floor_setpoint(level, floor_value)
                        floor_success_count += 1
                    else:
                        log(f"  [poll] {level}: could not read Floor Setpoint, skipped")

                driver.switch_to.default_content()

            except Exception as e:
                log(f"  [poll] {level} scan failed: {e}")
                try: driver.switch_to.default_content()
                except: pass

        return ready_levels, floor_success_count
    finally:
        driver.quit()

# ---- Heartbeat (status only; never affects HVAC logic) ----
_HB_STATE = {"last_loop": 0.0, "last_err_log": 0.0}

def _hb_iso(ts):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts)) if ts else None

def _heartbeat_worker():
    import threading  # noqa: F401
    while True:
        try:
            supabase_upsert("daemon_heartbeat", {
                "name": "hvac",
                "last_seen": _hb_iso(time.time()),
                "last_loop": _hb_iso(_HB_STATE["last_loop"]),
                "info": "running",
            }, "name")
        except Exception as e:
            try:
                if time.time() - _HB_STATE["last_err_log"] > 600:
                    _HB_STATE["last_err_log"] = time.time()
                    log(f"  [Heartbeat] write failed (ignored): {type(e).__name__}")
            except Exception:
                pass
        time.sleep(60)

def start_heartbeat():
    try:
        import threading
        _HB_STATE["last_loop"] = time.time()
        threading.Thread(target=_heartbeat_worker, name="heartbeat", daemon=True).start()
    except Exception:
        pass

def main():
    log("=" * 55)
    log("  Redmyre House - HVAC Auto Daemon")
    log("  Checking Supabase every 5 seconds...")
    log("  Setpoint polling every 12 hours (read-only)")
    log("  Press Ctrl+C to stop")
    log("=" * 55)

    recover_stuck_processing()

    last_poll = 0
    last_floor_poll = 0

    start_heartbeat()

    while True:
        _HB_STATE["last_loop"] = time.time()
        try:
            requests = get_approved_requests()
            if requests is None:
                log("  [Supabase] Failed to read pending HVAC requests. No request state assumed; retrying in 30s.")
                time.sleep(30)
                continue

            if requests:
                print(f"\n[{time.strftime('%H:%M:%S')}] Found {len(requests)} approved request(s)!")
                temp_min, temp_max = get_temp_limits()
                log(f"  Temperature limits: {temp_min}°C – {temp_max}°C")

                for req in requests:
                    req_id    = req["id"]
                    level     = req["level"]
                    tenancy   = req["tenancy"]
                    req_type  = req["type"]
                    user_name = req.get("user_name", "Unknown")

                    print(f"\n  Processing: {req_type.upper()} — {level}, {tenancy} (by {user_name})")
                    mark_processing(req_id)

                    try:
                        requested_target = req.get("temp_after")

                        success_count, sensor_count, new_temp, current_temp, admin_comment = adjust_temperature(
                            level, tenancy, req_type, temp_min, temp_max, requested_target)

                        # Update the cached setpoint immediately whenever AT LEAST ONE sensor
                        # actually changed — not just on full success. Previously this only ran
                        # inside the full-success branch, so any partial failure (one sensor out
                        # of two/three) left the tenant-facing "Current Setting" stuck on the old
                        # value until the next scheduled poll (this was the stale-cache bug).
                        if success_count > 0:
                            try:
                                upsert_setpoint(level, tenancy, float(new_temp), None)
                            except Exception as e:
                                log(f"  [poll] Immediate setpoint cache update failed (non-fatal): {e}")

                        if success_count == sensor_count:
                            mark_completed(req_id, current_temp, new_temp, admin_comment)
                            log(f"  ✓ Completed! {level} {tenancy} → {current_temp}°C → {new_temp}°C")
                        else:
                            mark_failed(req_id, "Some sensors could not be adjusted. Building manager will retry manually.")
                            log(f"  ✗ Partial/failed: {level} {tenancy} — {success_count}/{sensor_count} sensors adjusted")
                            print(f"  ✗ Failed! Some sensors not adjusted")

                    except BMSConnectionError as e:
                        log(f"  ✗ BMS system unreachable — {level} {tenancy}: {e}")
                        mark_rejected(req_id)
                        remaining = [r for r in requests if r["id"] != req_id]
                        for r in remaining:
                            mark_rejected(r["id"])
                            log(f"  ✗ Auto-rejected: {r['level']} {r['tenancy']} (BMS offline)")
                        log("  BMS offline — waiting 60s before retrying...")
                        time.sleep(60)
                        break

                    except TargetRejectedError as e:
                        log(f"  ✗ TARGET REJECTED (no BMS change) — {level} {tenancy}: {e}")
                        live = e.live_temp
                        if live is not None:
                            try:
                                upsert_setpoint(level, tenancy, float(live), None)
                            except Exception as ce:
                                log(f"  [poll] Cache refresh after rejection failed (non-fatal): {ce}")
                            msg = (f"The temperature changed before your request could be applied. "
                                   f"The current temperature is now {float(live):.1f}°C. "
                                   f"Please select your desired temperature again.")
                        else:
                            msg = "Your request could not be applied. Please select your desired temperature again."
                        # 'rejected' (not 'failed'): the front-end does not count rejected requests toward the 30-min cooldown.
                        mark_rejected(req_id, msg)
                        print("  ✗ Rejected safely — no BMS temperature change was made")

                    except BMSReadError as e:
                        log(f"  ✗ SAFE STOP — {level} {tenancy}: {e}")
                        mark_failed(
                            req_id,
                            "Current BMS temperature could not be read safely. "
                            "No temperature change was made. Please retry."
                        )
                        print("  ✗ Failed safely — no BMS temperature change was made")

                    except Exception as e:
                        log(f"  ✗ Error — {level} {tenancy}: {e}")
                        mark_failed(req_id, f"System error during temperature adjustment. Building manager has been notified.")

            else:
                print(f"[{time.strftime('%H:%M:%S')}] No pending requests.", end="\r", flush=True)

                # Idle time only: setpoint polling never preempts request handling above.
                now = time.time()
                if now - last_poll >= POLL_INTERVAL_SECONDS:
                    do_floor = (now - last_floor_poll) >= FLOOR_POLL_INTERVAL_SECONDS
                    log(f"  [poll] Starting setpoint scan (read-only){' + Floor Setpoint' if do_floor else ''}...")
                    ready_levels = 0
                    floor_success_count = 0
                    try:
                        ready_levels, floor_success_count = poll_all_setpoints(read_floor=do_floor)
                        log(f"  [poll] Setpoint scan complete. {ready_levels}/{len(LEVELS)} levels had real data.")
                        # Only mark the floor scan as fully done once EVERY level's Floor
                        # Setpoint was actually read — not just "at least one". Marking it done
                        # on a partial success (e.g. 5/6 levels) would leave the one missing
                        # level stale for a full 12h until the next scheduled floor cycle.
                        if do_floor and floor_success_count == len(LEVELS):
                            last_floor_poll = now
                    except Exception as e:
                        log(f"  [poll] Setpoint scan failed (non-fatal, will retry next cycle): {e}")

                    # Retry sooner (15 min) instead of waiting the full 12h whenever this
                    # cycle came back with nothing usable — either every tenancy level failed,
                    # or this was a Floor Setpoint cycle and Floor Setpoint failed everywhere.
                    # Without the second condition, a Floor-only failure would sit stale for up
                    # to 12h (the tenants would see no Floor value at all that whole time) even
                    # though the tenancy data next to it was refreshing fine every 12h.
                    floor_incomplete_this_cycle = do_floor and floor_success_count < len(LEVELS)
                    if ready_levels == 0 or floor_incomplete_this_cycle:
                        reasons = []
                        if ready_levels == 0:
                            reasons.append("no tenancy levels ready")
                        if floor_incomplete_this_cycle:
                            reasons.append(f"Floor Setpoint only {floor_success_count}/{len(LEVELS)} levels")
                        # (last_poll is set BEHIND "now" by (POLL_INTERVAL - RETRY), so the
                        # "now - last_poll >= POLL_INTERVAL" check above fires again once
                        # exactly RETRY seconds have passed — verified with a numeric check:
                        # now - (now - POLL_INTERVAL + RETRY) = POLL_INTERVAL - RETRY at t=now,
                        # and grows to POLL_INTERVAL at t=now+RETRY, which is exactly when the
                        # condition trips. Do not "fix" this to now + POLL_INTERVAL - RETRY —
                        # that pushes last_poll into the FUTURE and delays the next attempt by
                        # ~11.75h instead of shortening it to 15 min.)
                        log(f"  [poll] Retrying in 15 min instead of 12h ({', '.join(reasons)}).")
                        last_poll = now - POLL_INTERVAL_SECONDS + FAILED_SCAN_RETRY_SECONDS
                    else:
                        last_poll = now

        except Exception as e:
            print(f"\n[ERROR] {e}")

        time.sleep(5)

if __name__ == "__main__":
    main()
