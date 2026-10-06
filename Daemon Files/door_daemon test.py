"""
Redmyre House - Door Daemon (Stage 3A: READ-ONLY STATUS MONITOR)

What it does
  - Every 5 s reads the Status of doors D1, D2, D5 from the open Integriti System Designer
    window (Doors grid) using UI Automation property reads only.
  - Writes to Supabase table door_status ONLY when a door's status changes.
  - Every 60 s writes a heartbeat row (name='door') to daemon_heartbeat.

What it NEVER does (this stage)
  - No clicks, no typing, no key presses, no menu actions, no focus changes.
  - No Unlock / Lock. No login attempts. It does not touch any window except the
    verified Integriti System Designer window (title AND process name are checked).
  - It never reads text fields (Edit controls) and never logs secrets.

If Integriti is not running / minimised / not on the Doors tab / a row or name does not
match / a read fails, the door is reported as 'Unknown' (after 2 consecutive reads = ~10 s).
Secrets: only the Supabase service key from Windows Credential Manager (RedmyreHVAC/SUPABASE_KEY)
or the environment variable REDMYRE_SUPABASE_KEY. Nothing is stored in this file.
"""
import ctypes
import datetime
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from ctypes import wintypes

POLL_SECONDS = 5
HEARTBEAT_SECONDS = 60
UNKNOWN_CONFIRM_READS = 2          # consecutive Unknown reads before Unknown is written
SUPABASE_URL = os.environ.get("REDMYRE_SUPABASE_URL", "https://wunsexdnqathluplkkvo.supabase.co")

# Door ID is the primary identifier; the name is only a safety cross-check.
DOORS = {
    "D1": "Front Door",
    "D2": "Garage Roller Door 1",
    "D3": "Car Park Door",
    "D5": "Garage Roller Door 2",
}
ALLOWED_STATUS = ("Locked", "Unlocked")   # anything else is reported as Unknown

HERE = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.path.join(HERE, "logs")


# ---------------------------------------------------------------- logging
def log(msg):
    line = "%s  %s" % (time.strftime("%Y-%m-%d %H:%M:%S"), msg)
    print(line, flush=True)
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        path = os.path.join(LOG_DIR, "door_daemon_%s.txt" % time.strftime("%Y-%m"))
        with open(path, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


_last_logged = {}


def log_once(key, msg, every=600):
    """Throttled log: same key at most once per `every` seconds."""
    now = time.time()
    if now - _last_logged.get(key, 0) >= every:
        _last_logged[key] = now
        log(msg)


# ---------------------------------------------------------------- secrets
def _cred_read(target):
    try:
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
        adv.CredFree.argtypes = [ctypes.c_void_p]
        adv.CredFree.restype = None
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


def load_key():
    return os.environ.get("REDMYRE_SUPABASE_KEY") or _cred_read("RedmyreHVAC/SUPABASE_KEY") or ""


SUPABASE_KEY = load_key()


# ---------------------------------------------------------------- supabase (urllib only)
def supabase_upsert(table, data, on_conflict):
    url = "%s/rest/v1/%s?on_conflict=%s" % (SUPABASE_URL, table, on_conflict)
    req = urllib.request.Request(url, data=json.dumps(data).encode(), method="POST", headers={
        "apikey": SUPABASE_KEY,
        "Authorization": "Bearer " + SUPABASE_KEY,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    })
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.status


def supabase_read_saved_status():
    """Read current door_status rows once at start so an unchanged state is not re-written."""
    url = "%s/rest/v1/door_status?select=door_id,status" % SUPABASE_URL
    req = urllib.request.Request(url, method="GET", headers={
        "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY})
    with urllib.request.urlopen(req, timeout=15) as r:
        rows = json.loads(r.read().decode())
    return {x["door_id"]: x["status"] for x in rows if x.get("door_id") in DOORS}


def iso_utc(ts):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts)) if ts else None


# ---------------------------------------------------------------- single instance
_mutex_handle = None


def ensure_single_instance():
    global _mutex_handle
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
    k32.CreateMutexW.restype = wintypes.HANDLE
    _mutex_handle = k32.CreateMutexW(None, False, "Global\\RedmyreDoorDaemon")
    if ctypes.get_last_error() == 183:   # ERROR_ALREADY_EXISTS
        log("Another door_daemon is already running. Exiting.")
        sys.exit(0)


# ---------------------------------------------------------------- shared state (heartbeat)
STATE = {"last_ok_read": 0.0, "info": "starting"}
HB_WAKE = threading.Event()
MIN_HB_GAP = 10          # never write heartbeats closer together than this (DB IO)


def set_info(info):
    """Update heartbeat info; wake the heartbeat thread early when it changes."""
    info = info[:100]
    if info != STATE["info"]:
        STATE["info"] = info
        HB_WAKE.set()


def heartbeat_worker():
    last_write = 0.0
    while True:
        wait = max(0.0, MIN_HB_GAP - (time.time() - last_write))
        if wait:
            time.sleep(wait)
        try:
            supabase_upsert("daemon_heartbeat", {
                "name": "door",
                "last_seen": iso_utc(time.time()),
                "last_loop": iso_utc(STATE["last_ok_read"]),   # last SUCCESSFUL Integriti read
                "info": STATE["info"][:100],
            }, "name")
        except Exception as e:
            log_once("hb_fail", "[Heartbeat] write failed (ignored): %s" % type(e).__name__)
        last_write = time.time()
        HB_WAKE.wait(HEARTBEAT_SECONDS)
        HB_WAKE.clear()


# ---------------------------------------------------------------- Integriti reader (READ ONLY)
user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
user32.EnumWindows.argtypes = [EnumWindowsProc, wintypes.LPARAM]
user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.IsIconic.argtypes = [wintypes.HWND]
user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
user32.IsWindowVisible.argtypes = [wintypes.HWND]
kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
kernel32.OpenProcess.restype = wintypes.HANDLE
kernel32.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR,
                                                ctypes.POINTER(wintypes.DWORD)]
kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
EXPECTED_EXE = "integritisystemdesigner.exe"


def _exe_name(pid):
    h = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not h:
        return ""
    try:
        buf = ctypes.create_unicode_buffer(520)
        size = wintypes.DWORD(520)
        if kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
            return os.path.basename(buf.value).lower()
    finally:
        kernel32.CloseHandle(h)
    return ""


def find_integriti_window():
    """Return (hwnd, pid) of the verified Integriti System Designer main window, or None."""
    found = []

    def cb(hwnd, _):
        try:
            n = user32.GetWindowTextLengthW(hwnd)
            if n <= 0:
                return True
            buf = ctypes.create_unicode_buffer(n + 1)
            user32.GetWindowTextW(hwnd, buf, n + 1)
            if "integriti system designer" in buf.value.lower():
                pid = wintypes.DWORD(0)
                user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                if _exe_name(pid.value) == EXPECTED_EXE:
                    found.append((hwnd, pid.value))
        except Exception:
            pass
        return True

    user32.EnumWindows(EnumWindowsProc(cb), 0)
    return found[0] if found else None


_cache = {"hwnd": None, "win": None, "grid": None}


def _reset_cache():
    _cache.update({"hwnd": None, "win": None, "grid": None})


def read_doors():
    """
    Returns (result, reason). result = {door_id: raw_status_text} on success.
    On failure result is None and reason explains why. Read-only.
    """
    from pywinauto import Desktop

    w = find_integriti_window()
    if not w:
        _reset_cache()
        return None, "integriti_not_running"
    hwnd, _pid = w
    if user32.IsIconic(hwnd) or not user32.IsWindowVisible(hwnd):
        return None, "window_minimized"

    if _cache["hwnd"] != hwnd:
        _reset_cache()
        _cache["hwnd"] = hwnd
        _cache["win"] = Desktop(backend="uia").window(handle=hwnd)
    win = _cache["win"]

    grid = _cache["grid"]
    if grid is not None:
        try:
            grid.element_info.name  # touch: raises if the element is gone
        except Exception:
            grid = None
    if grid is None:
        for t in win.descendants(control_type="Table"):
            try:
                if t.element_info.automation_id != "m_gridControl":
                    continue
                hdrs = [h.element_info.name for h in t.descendants(control_type="Header")]
                if "Door Type" in hdrs and "Status" in hdrs:
                    grid = t
                    break
            except Exception:
                continue
        if grid is None:
            _cache["grid"] = None
            return None, "doors_grid_not_found"
        _cache["grid"] = grid

    cells = {}
    for c in grid.descendants(control_type="DataItem"):
        nm = c.element_info.name or ""
        if "filter" in nm:
            continue
        for col in ("ID", "Name", "Status"):
            prefix = col + " row "
            if nm.startswith(prefix):
                row = nm[len(prefix):]
                cells.setdefault(row, {})[col] = c.iface_value.CurrentValue
    if not cells:
        _cache["grid"] = None
        return None, "doors_grid_empty"

    result = {}
    for row, d in cells.items():
        did = (d.get("ID") or "").strip()
        if did in DOORS:
            result[did] = ((d.get("Name") or "").strip(), (d.get("Status") or "").strip())
    return result, "ok"


# ================================================================ 3B: DOOR CONTROL (Unlock / Lock)
# Only the exact Integriti menu items "Unlock" and "Lock" are ever clicked.
ENABLED_DOORS = {"D1", "D2", "D3", "D5"}   # all verified: D1/D2/D5 live; D3 menu check passed (CCTV test pending)
IDLE_WAIT_SECONDS = 15            # wait this long for the PC to be idle before giving up (command TTL is 60 s)
MIN_IDLE_SECONDS = 2.0
VERIFY_SECONDS = 15
RECOVERY_EVERY = 60

# ---------------------------------------------------------------- Integriti open-hours (hard-coded copy)
# Used ONLY to decide whether an Auto-Lock should be created. Never used to lock/unlock anything.
# Holidays are NOT handled: on a public holiday a portal Unlock inside these hours gets no Auto-Lock -> lock it manually.
# Source: Integriti Time Periods TP3 (Front Door) and TP2 (Garage Roller Door 1 & Car Park Door), checked 2026-10-06.
# All times are Australia/Sydney local time (daylight saving included), independent of the PC clock setting.
# Format: weekday (0=Mon .. 6=Sun) -> (start "H:M:S", end "H:M:S"). Missing weekday = never open.
# D5 (Garage Roller Door 2) is always locked -> no open window.
# If Integriti times change, update this table. Failing safe = Auto-Lock is created (old behaviour).
_MF = ("06:58:00", "19:00:00")
OPEN_HOURS = {
    "D1": {0: _MF, 1: _MF, 2: _MF, 3: _MF, 4: _MF, 5: ("06:58:00", "19:00:00"), 6: ("08:00:00", "17:00:00")},
    "D2": {0: ("06:58:45", "19:00:00"), 1: ("06:58:45", "19:00:00"), 2: ("06:58:45", "19:00:00"),
           3: ("06:58:45", "19:00:00"), 4: ("06:58:45", "19:00:00"), 5: ("06:58:45", "15:00:00")},
    "D3": {0: ("06:58:45", "19:00:00"), 1: ("06:58:45", "19:00:00"), 2: ("06:58:45", "19:00:00"),
           3: ("06:58:45", "19:00:00"), 4: ("06:58:45", "19:00:00"), 5: ("06:58:45", "15:00:00")},
    "D5": {},
}


try:
    from zoneinfo import ZoneInfo
    SYDNEY = ZoneInfo("Australia/Sydney")      # handles daylight saving automatically (needs: pip install tzdata on Windows)
except Exception:
    SYDNEY = None                              # unknown -> is_open_hours() returns False (Auto-Lock created = old behaviour)


def _hms(t):
    h, m, s = (int(x) for x in t.split(":"))
    return h * 3600 + m * 60 + s


def is_open_hours(door_id, ts):
    """True only if Integriti itself keeps this door unlocked at time ts (local PC time). Anything unsure -> False."""
    try:
        if SYDNEY is None:
            log_once("no_tz", "[Schedule] Australia/Sydney timezone data missing (pip install tzdata). Open-hours check disabled.", 3600)
            return False
        dt = datetime.datetime.fromtimestamp(ts, SYDNEY)
        win = OPEN_HOURS.get(door_id, {}).get(dt.weekday())
        if not win:
            return False
        sec = dt.hour * 3600 + dt.minute * 60 + dt.second
        return _hms(win[0]) <= sec < _hms(win[1])
    except Exception:
        return False
ALERT_TO = os.environ.get("REDMYRE_ALERT_TO", "sp77249.redmyre@gmail.com")
MEM_AUTOLOCK = {}                 # door_id -> due epoch (only when the DB autolock could not be scheduled)
_alert_last = {}


class _LII(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]


class _PT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


user32.GetLastInputInfo.argtypes = [ctypes.POINTER(_LII)]
user32.GetForegroundWindow.restype = wintypes.HWND
user32.GetForegroundWindow.argtypes = []
user32.SetForegroundWindow.argtypes = [wintypes.HWND]
user32.IsWindow.argtypes = [wintypes.HWND]
user32.GetCursorPos.argtypes = [ctypes.POINTER(_PT)]
user32.WindowFromPoint.argtypes = [_PT]
user32.WindowFromPoint.restype = wintypes.HWND
user32.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
user32.GetAncestor.restype = wintypes.HWND
user32.OpenInputDesktop.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
user32.OpenInputDesktop.restype = wintypes.HANDLE
user32.CloseDesktop.argtypes = [wintypes.HANDLE]
kernel32.GetTickCount.restype = wintypes.DWORD


def idle_seconds():
    li = _LII()
    li.cbSize = ctypes.sizeof(li)
    if not user32.GetLastInputInfo(ctypes.byref(li)):
        return 0.0
    return ((kernel32.GetTickCount() - li.dwTime) & 0xFFFFFFFF) / 1000.0


def screen_locked():
    h = user32.OpenInputDesktop(0, False, 0x0100)
    if not h:
        return True               # locked / secure desktop / RDP disconnected
    user32.CloseDesktop(h)
    return False


def cursor_pos():
    p = _PT()
    user32.GetCursorPos(ctypes.byref(p))
    return (p.x, p.y)


def foreground_pid():
    pid = wintypes.DWORD(0)
    user32.GetWindowThreadProcessId(user32.GetForegroundWindow(), ctypes.byref(pid))
    return pid.value


def pid_at_point(x, y):
    h = user32.WindowFromPoint(_PT(int(x), int(y)))
    if not h:
        return 0
    root = user32.GetAncestor(h, 2)
    pid = wintypes.DWORD(0)
    user32.GetWindowThreadProcessId(root or h, ctypes.byref(pid))
    return pid.value


user32.AttachThreadInput.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.BOOL]
user32.BringWindowToTop.argtypes = [wintypes.HWND]
kernel32.GetCurrentThreadId.restype = wintypes.DWORD


def force_foreground(hwnd, pid, win):
    """Bring Integriti to the front. Windows blocks SetForegroundWindow when this process has had no recent input
    (e.g. an Auto-Lock 3 min after the last click), so attach to the foreground thread's input queue (no key presses)."""
    for _ in range(3):
        if foreground_pid() == pid:
            return True
        try:
            win.set_focus()
        except Exception:
            pass
        time.sleep(0.4)
        if foreground_pid() == pid:
            break
        fg = user32.GetForegroundWindow()
        fg_tid = user32.GetWindowThreadProcessId(fg, None) if fg else 0
        me = kernel32.GetCurrentThreadId()
        attached = bool(fg_tid and fg_tid != me and user32.AttachThreadInput(me, fg_tid, True))
        try:
            user32.BringWindowToTop(hwnd)
            user32.SetForegroundWindow(hwnd)
        finally:
            if attached:
                user32.AttachThreadInput(me, fg_tid, False)
        time.sleep(0.6)
    time.sleep(0.6)
    return foreground_pid() == pid


def send_esc_if_integriti(pid):
    if foreground_pid() == pid:
        from pywinauto.keyboard import send_keys
        send_keys("{ESC}")


def find_menu_button(pid, label):
    """Centre of the popup-menu Button whose name is EXACTLY `label` (never the main window)."""
    from pywinauto.uia_element_info import UIAElementInfo
    for top in UIAElementInfo().children():
        try:
            if top.process_id != pid:
                continue
            r = top.rectangle
            if (r.right - r.left) > 600 or (r.bottom - r.top) > 900:
                continue          # the main window, not a popup
            stack = [(top, 0)]
            while stack:
                el, d = stack.pop()
                if d >= 4:
                    continue
                for k in el.children():
                    if k.control_type == "Button" and (k.name or "") == label:
                        kr = k.rectangle
                        return ((kr.left + kr.right) // 2, (kr.top + kr.bottom) // 2)
                    stack.append((k, d + 1))
        except Exception:
            continue
    return None


def find_door_row(win, did):
    """Return (cells_dict, grid) for door `did` or None. cells_dict has 'ID','Name','Status' elements."""
    for t in win.descendants(control_type="Table"):
        try:
            if t.element_info.automation_id != "m_gridControl":
                continue
            hdrs = [h.element_info.name for h in t.descendants(control_type="Header")]
            if "Door Type" not in hdrs or "Status" not in hdrs:
                continue
            rows = {}
            for c in t.descendants(control_type="DataItem"):
                nm = c.element_info.name or ""
                if "filter" in nm:
                    continue
                for col in ("ID", "Name", "Status"):
                    if nm.startswith(col + " row "):
                        rows.setdefault(nm[len(col) + 5:], {})[col] = c
            for d in rows.values():
                if "ID" in d and d["ID"].iface_value.CurrentValue.strip() == did and "Name" in d and "Status" in d:
                    return d
        except Exception:
            continue
    return None


def execute_command(cmd, on_start):
    """
    Returns (status, result_status, error, clicked).
    status: success | failed | unknown.  Nothing is clicked unless EVERY pre-check passes.
    After the single menu click, the result is success or unknown - NEVER an automatic retry.
    """
    from pywinauto import Desktop, mouse
    did, action = cmd["door_id"], cmd["action"]
    target = "Unlocked" if action == "unlock" else "Locked"
    label = "Unlock" if action == "unlock" else "Lock"
    if did not in ENABLED_DOORS:
        return ("failed", None, "door_not_enabled", False)
    w = find_integriti_window()
    if not w:
        return ("failed", None, "integriti_not_running", False)
    hwnd, pid = w
    if screen_locked():
        return ("failed", None, "screen_locked", False)
    prev_fg0 = user32.GetForegroundWindow()
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, 9)          # SW_RESTORE: only the verified Integriti window; focus is checked again below
        time.sleep(2.0)
        if prev_fg0 and prev_fg0 != hwnd and user32.IsWindow(prev_fg0):
            try:
                user32.SetForegroundWindow(prev_fg0)
            except Exception:
                pass
            time.sleep(0.5)
    if user32.IsIconic(hwnd) or not user32.IsWindowVisible(hwnd):
        return ("failed", None, "window_minimized", False)
    waited = 0
    while idle_seconds() < MIN_IDLE_SECONDS:
        if waited >= IDLE_WAIT_SECONDS:
            return ("failed", None, "user_active", False)
        time.sleep(1)
        waited += 1
    prev_fg = user32.GetForegroundWindow()
    clicked = False
    try:
        win = Desktop(backend="uia").window(handle=hwnd)
        row = find_door_row(win, did)
        if not row:
            return ("failed", None, "door_row_not_found", False)
        if row["Name"].iface_value.CurrentValue.strip() != DOORS[did]:
            return ("failed", None, "name_mismatch", False)
        before = row["Status"].iface_value.CurrentValue.strip()
        if before == target:
            return ("success", target, "already_" + target.lower(), False)
        if before not in ALLOWED_STATUS:
            return ("failed", None, "status_unknown_before", False)
        force_foreground(hwnd, pid, win)
        if screen_locked() or foreground_pid() != pid:
            try:
                fg = user32.GetForegroundWindow()
                n = user32.GetWindowTextLengthW(fg)
                buf = ctypes.create_unicode_buffer(n + 1)
                user32.GetWindowTextW(fg, buf, n + 1)
                fpid = wintypes.DWORD(0)
                user32.GetWindowThreadProcessId(fg, ctypes.byref(fpid))
                log("[Diag] foreground is exe=%s title=%r (could not bring Integriti to front)" % (_exe_name(fpid.value), buf.value[:60]))
            except Exception:
                pass
            return ("failed", None, "integriti_not_foreground", False)
        rc = row["Status"].element_info.rectangle
        cx, cy = (rc.left + rc.right) // 2, (rc.top + rc.bottom) // 2
        if pid_at_point(cx, cy) != pid:
            return ("failed", None, "integriti_not_on_top", False)
        if not on_start():
            return ("failed", None, "claim_lost", False)
        row["Status"].click_input(button="right")
        time.sleep(1.0)
        pos = cursor_pos()
        item = find_menu_button(pid, label)
        if item is None:
            send_esc_if_integriti(pid)
            return ("failed", None, "menu_item_not_found", False)
        ix, iy = item
        cur = cursor_pos()
        if abs(cur[0] - pos[0]) > 3 or abs(cur[1] - pos[1]) > 3 or foreground_pid() != pid or pid_at_point(ix, iy) != pid:
            send_esc_if_integriti(pid)
            return ("failed", None, "aborted_user_input", False)
        clicked = True                       # point of no return
        mouse.click(button="left", coords=(ix, iy))
        t_end = time.time() + VERIFY_SECONDS
        last = "Unknown"
        while time.time() < t_end:
            time.sleep(1.0)
            try:
                res, _why = read_doors()
                if res and did in res and res[did][0] == DOORS[did]:
                    last = res[did][1] if res[did][1] in ALLOWED_STATUS else "Unknown"
                    if last == target:
                        return ("success", target, None, True)
            except Exception:
                pass
        return ("unknown", last, "status_not_confirmed_%ds" % VERIFY_SECONDS, True)
    except Exception as e:
        if clicked:
            return ("unknown", None, "exception_after_click:" + type(e).__name__, True)
        try:
            send_esc_if_integriti(pid)
        except Exception:
            pass
        return ("failed", None, "exception:" + type(e).__name__, False)
    finally:
        try:
            if prev_fg and prev_fg != hwnd and user32.IsWindow(prev_fg):
                user32.SetForegroundWindow(prev_fg)     # put the CCTV / previous window back on top
        except Exception:
            pass


# ---------------------------------------------------------------- 3B: database helpers
def _rest(method, path, data=None, prefer=None):
    headers = {"apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY,
               "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request("%s/rest/v1/%s" % (SUPABASE_URL, path),
                                 data=None if data is None else json.dumps(data).encode(),
                                 method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as r:
        body = r.read().decode()
        return json.loads(body) if body else None


def _patch(cid, fields, extra="", retries=3):
    if not cid:
        return True
    for i in range(retries):
        try:
            r = _rest("PATCH", "door_commands?id=eq.%s%s" % (cid, extra), fields, "return=representation")
            return bool(r)
        except Exception as e:
            log_once("patch_fail", "[Cmd] DB update failed (%s), try %d" % (type(e).__name__, i + 1), 5)
            time.sleep(2)
    return False


def _audit(action, who, details):
    try:
        _rest("POST", "audit_logs", {"action": action, "user_email": who, "user_role": "system",
                                     "details": details}, "return=minimal")
    except Exception as e:
        log("[Audit] write failed (ignored for results): %s" % type(e).__name__)


def _resend_key():
    return os.environ.get("REDMYRE_RESEND_KEY") or _cred_read("RedmyreHVAC/RESEND_KEY") or ""


def send_alert(subject, body):
    """Email via Resend (if a key is stored). Failure is logged only; it never triggers a door action."""
    log("[ALERT] %s | %s" % (subject, body))
    key = _resend_key()
    if not key:
        log_once("no_resend", "[Alert] no RedmyreHVAC/RESEND_KEY in Credential Manager: email not sent", 3600)
        return
    try:
        req = urllib.request.Request("https://api.resend.com/emails", method="POST", data=json.dumps({
            "from": "Redmyre BMS <notify@scafacility.com>", "to": [ALERT_TO],
            "subject": "[Redmyre BMS] " + subject,
            "html": "<table width='100%%'><tr><td style='font-family:Arial,sans-serif;font-size:14px'>%s</td></tr></table>" % body,
        }).encode(), headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=15).read()
    except Exception as e:
        log_once("alert_mail_fail", "[Alert] email failed: %s" % type(e).__name__, 600)


def alert_throttled(key, subject, body, every=3600):
    if time.time() - _alert_last.get(key, 0) >= every:
        _alert_last[key] = time.time()
        send_alert(subject, body)


def schedule_autolock(door_id, parent_id, who):
    """After a successful portal Unlock: persist ONE autolock command. Retry 3x in ~10 s, else in-memory fail-safe."""
    secs = 180
    try:
        r = _rest("GET", "door_settings?door_id=eq.%s&select=autolock_seconds" % door_id)
        secs = int(r[0]["autolock_seconds"])
    except Exception:
        pass
    due = time.time() + secs
    if is_open_hours(door_id, due):
        # Integriti keeps this door unlocked until closing time - an Auto-Lock now would lock it during opening hours.
        log("[%s] Auto-Lock skipped: open hours (Integriti locks it at closing time)" % door_id)
        _patch(parent_id, {"error": "autolock_skipped_open_hours"})
        return True
    body = {"door_id": door_id, "action": "lock", "source": "autolock", "requested_by": "system:autolock",
            "scheduled_at": iso_utc(due), "expires_at": iso_utc(due + 3600),
            "autolock_seconds_snapshot": secs, "parent_command_id": parent_id}
    for i in range(3):
        try:
            _rest("POST", "door_commands", body, "return=minimal")
            log("[%s] Auto-Lock scheduled in %d s" % (door_id, secs))
            return True
        except urllib.error.HTTPError as e:
            if e.code == 409:                       # already exists for this Unlock (idempotent)
                return True
            log("[%s] Auto-Lock schedule failed (try %d): HTTP %s" % (door_id, i + 1, e.code))
        except Exception as e:
            log("[%s] Auto-Lock schedule failed (try %d): %s" % (door_id, i + 1, type(e).__name__))
        time.sleep(3)
    MEM_AUTOLOCK[door_id] = due
    _patch(parent_id, {"error": "autolock_not_scheduled"})
    send_alert("CRITICAL: Auto-Lock not scheduled (%s)" % door_id,
               "Door %s was unlocked but the Auto-Lock could not be saved. The daemon will try to lock it at the due time from memory. Please check the door." % door_id)
    return False


def run_one(cmd):
    cid, did, action = cmd.get("id"), cmd["door_id"], cmd["action"]
    log("[%s] command %s %s (source=%s, by=%s)" % (did, action, (cid or "mem")[:8], cmd.get("source"), cmd.get("requested_by")))
    started = {"v": False}

    def on_start():
        ok = _patch(cid, {"status": "executing", "started_at": iso_utc(time.time())}, "&status=eq.claimed")
        started["v"] = ok
        return ok

    try:
        st, rs, err, clicked = execute_command(cmd, on_start)
    except Exception as e:
        st, rs, err, clicked = ("unknown" if started["v"] else "failed"), None, "exception:" + type(e).__name__, started["v"]
    log("[%s] result: %s %s %s" % (did, st, rs, err))
    ok = _patch(cid, {"status": st, "result_status": rs, "error": err, "finished_at": iso_utc(time.time())})
    if not ok:
        log("[%s] could not save result; restart recovery will mark it unknown" % did)
    _audit("door_command_result", cmd.get("requested_by") or "system",
           {"door": did, "action": action, "command": cid, "status": st, "result": rs, "error": err})
    # Auto-Lock ONLY when this command really changed the door (menu was clicked). An already-unlocked door is not ours.
    if st == "success" and action == "unlock" and cmd.get("source") == "manual" and clicked:
        schedule_autolock(did, cid, cmd.get("requested_by"))
    if st == "success" and action == "lock":
        MEM_AUTOLOCK.pop(did, None)
    return st


def process_commands():
    pend = _rest("GET", "door_commands?status=eq.pending&scheduled_at=lte.%s&select=id&limit=1" % iso_utc(time.time()))
    if not pend:
        return
    for cmd in (_rest("POST", "rpc/claim_door_command", {}) or []):
        run_one(cmd)


def process_mem_autolock():
    for did, due in list(MEM_AUTOLOCK.items()):
        if time.time() >= due:
            st = run_one({"id": None, "door_id": did, "action": "lock", "source": "autolock", "requested_by": "system:autolock-mem"})
            if st == "success":
                MEM_AUTOLOCK.pop(did, None)
            else:
                MEM_AUTOLOCK[did] = time.time() + 30
                alert_throttled("mem_" + did, "CRITICAL: Auto-Lock failed (%s)" % did,
                                "Door %s could not be locked automatically. Please lock it manually." % did, 600)


def sweep_stale_commands():
    """Commands are executed synchronously in this thread, so a claimed/executing row older than 90 s is stale
    (its result could not be saved). Close it as unknown - NEVER re-run it."""
    try:
        _rest("PATCH", "door_commands?status=in.(claimed,executing)&claimed_at=lt.%s" % iso_utc(time.time() - 90),
              {"status": "unknown", "error": "stale_claimed", "finished_at": iso_utc(time.time())}, "return=minimal")
    except Exception as e:
        log_once("sweep_fail", "[Sweep] failed: %s" % type(e).__name__, 300)


def recovery_and_alerts(saved):
    sweep_stale_commands()
    since = iso_utc(time.time() - 86400)
    ul = _rest("GET", "door_commands?action=eq.unlock&source=eq.manual&status=eq.success&finished_at=gte.%s&select=id,door_id,error" % since) or []
    if ul:
        al = _rest("GET", "door_commands?source=eq.autolock&created_at=gte.%s&select=parent_command_id" % since) or []
        have = {a["parent_command_id"] for a in al}
        for u in ul:
            if (u.get("error") or "").startswith(("already_", "autolock_skipped")):
                continue                      # no-op Unlock, or Auto-Lock deliberately skipped (open hours)
            if u["id"] in have or u["door_id"] in MEM_AUTOLOCK or saved.get(u["door_id"]) == "Locked":
                continue
            due = time.time()
            try:
                _rest("POST", "door_commands", {
                    "door_id": u["door_id"], "action": "lock", "source": "autolock", "requested_by": "system:autolock",
                    "scheduled_at": iso_utc(due), "expires_at": iso_utc(due + 3600),
                    "autolock_seconds_snapshot": 30, "parent_command_id": u["id"]}, "return=minimal")
                send_alert("Auto-Lock recovered (%s)" % u["door_id"],
                           "An Unlock had no Auto-Lock. A Lock was scheduled immediately for %s." % u["door_id"])
            except Exception as e:
                log_once("recov_fail", "[Recovery] could not create Auto-Lock: %s" % type(e).__name__, 300)
    bad = _rest("GET", "door_commands?source=eq.autolock&status=in.(failed,unknown,expired)&alert_sent_at=is.null&select=id,door_id,status,error") or []
    for b in bad:
        send_alert("Auto-Lock %s (%s)" % (b["status"], b["door_id"]),
                   "Auto-Lock for door %s ended as %s (%s). Please check that the door is locked." % (b["door_id"], b["status"], b.get("error") or "-"))
        _patch(b["id"], {"alert_sent_at": iso_utc(time.time())}, "&alert_sent_at=is.null", 1)


# ---------------------------------------------------------------- main loop
def evaluate(result, reason):
    """Map a read to {door_id: (status, why)}; never guesses."""
    out = {}
    for did, expected_name in DOORS.items():
        if result is None:
            out[did] = ("Unknown", reason)
        elif did not in result:
            out[did] = ("Unknown", "door_row_not_found")
        else:
            name, raw = result[did]
            if name != expected_name:
                out[did] = ("Unknown", "name_mismatch")
            elif raw in ALLOWED_STATUS:
                out[did] = (raw, "ok")
            else:
                out[did] = ("Unknown", "unexpected_status")
                log_once("raw_" + did, "[%s] unexpected Status text: %r" % (did, raw))
    return out


def main():
    if not SUPABASE_KEY:
        log("FATAL: Supabase key not found in environment / Credential Manager. Exiting.")
        sys.exit(1)
    ensure_single_instance()
    log("=" * 50)
    log("Door Daemon 3B started. Doors: %s. Control enabled for: %s" % (", ".join(DOORS), ", ".join(sorted(ENABLED_DOORS))))
    threading.Thread(target=heartbeat_worker, name="heartbeat", daemon=True).start()
    try:
        n = _rest("POST", "rpc/recover_door_commands", {})
        log("Recovery: %s interrupted command(s) marked unknown (never re-run)" % n)
    except Exception as e:
        log("Recovery call failed: %s" % type(e).__name__)
    last_recovery = 0.0
    down_since = None

    saved = {}            # door_id -> status last written successfully
    try:
        saved = supabase_read_saved_status()
        log("Loaded saved door status: %s" % saved)
    except Exception as e:
        log("Could not read saved door status (will write current state once): %s" % type(e).__name__)
    unknown_count = {d: 0 for d in DOORS}

    while True:
        try:
            try:
                result, reason = read_doors()
            except Exception as e:
                _reset_cache()
                result, reason = None, "status_read_failed"
                log_once("read_fail", "[Read] failed: %s" % type(e).__name__)

            states = evaluate(result, reason)
            read_ok = result is not None and all(s[0] != "Unknown" for s in states.values())
            write_failed = False

            for did, (status, why) in states.items():
                if status == "Unknown":
                    unknown_count[did] += 1
                    # debounce: a single failed read must not flip the door to Unknown
                    if saved.get(did) is not None and unknown_count[did] < UNKNOWN_CONFIRM_READS:
                        continue
                else:
                    unknown_count[did] = 0
                if saved.get(did) == status:
                    continue                      # unchanged -> NO database write
                try:
                    supabase_upsert("door_status", {
                        "door_id": did, "name": DOORS[did], "status": status,
                        "updated_at": iso_utc(time.time()),
                    }, "door_id")
                    saved[did] = status
                    log("[%s] %s -> %s (%s)" % (did, DOORS[did], status, why))
                except Exception as e:
                    write_failed = True
                    log_once("w_" + did, "[%s] DB write failed, will retry: %s" % (did, type(e).__name__), 60)

            # "read OK" and "saved to DB OK" are separate: a failed save must never leave the
            # portal showing an old Locked/Unlocked. Portal treats status_write_failed as Unknown.
            if write_failed:
                set_info("status_write_failed")
            elif read_ok:
                STATE["last_ok_read"] = time.time()
                set_info("ok")
            else:
                why = sorted({w for (s, w) in states.values() if s == "Unknown"})
                set_info("unknown: " + ",".join(why))
            # --- 3B: Integriti-down alert (5 min), commands, auto-lock, recovery
            if result is None and reason in ("integriti_not_running", "window_minimized"):
                down_since = down_since or time.time()
                if time.time() - down_since > 300:
                    alert_throttled("integriti_down", "Integriti not available",
                                    "Integriti is not running or is minimised (%s). Door control and status are unavailable." % reason)
            else:
                down_since = None
        except Exception as e:
            log_once("loop", "[Loop] error (continuing): %s" % type(e).__name__, 60)
        try:
            process_mem_autolock()
            process_commands()
            if time.time() - last_recovery >= RECOVERY_EVERY:
                last_recovery = time.time()
                recovery_and_alerts(saved)
        except Exception as e:
            log_once("cmd_loop", "[Cmd] loop error (continuing): %s" % type(e).__name__, 60)
        time.sleep(POLL_SECONDS)


def schedule_selftest():
    """Dry run: prints what Auto-Lock decision would be made. Touches no door, no DB, no Integriti."""
    if SYDNEY is None:
        print("FAIL: Australia/Sydney timezone data not found. Run: pip install tzdata")
        return 1
    D = lambda *a: datetime.datetime(*a, tzinfo=SYDNEY)
    cases = [  # (door, datetime, expected_open)
        ("D1", D(2026, 10, 7, 10, 0), True), ("D1", D(2026, 10, 7, 6, 57), False), ("D1", D(2026, 10, 7, 6, 58), True),
        ("D1", D(2026, 10, 7, 18, 59, 59), True), ("D1", D(2026, 10, 7, 19, 0), False),
        ("D1", D(2026, 10, 10, 18, 0), True), ("D1", D(2026, 10, 10, 19, 1), False),
        ("D1", D(2026, 10, 4, 8, 0), True), ("D1", D(2026, 10, 4, 7, 59), False),     # DST starts 2026-10-04
        ("D1", D(2026, 4, 5, 16, 59), True), ("D1", D(2026, 4, 5, 17, 0), False),      # DST ends 2026-04-05
        ("D1", D(2026, 10, 11, 7, 59), False), ("D1", D(2026, 10, 11, 8, 0), True),
        ("D1", D(2026, 10, 11, 16, 59), True), ("D1", D(2026, 10, 11, 17, 0), False),
        ("D2", D(2026, 10, 7, 10, 0), True), ("D2", D(2026, 10, 7, 6, 58, 30), False), ("D2", D(2026, 10, 7, 6, 58, 45), True),
        ("D2", D(2026, 10, 7, 19, 0), False), ("D2", D(2026, 10, 10, 14, 59), True), ("D2", D(2026, 10, 10, 15, 0), False),
        ("D2", D(2026, 10, 11, 10, 0), False),
        ("D3", D(2026, 10, 7, 10, 0), True), ("D3", D(2026, 10, 10, 16, 0), False), ("D3", D(2026, 10, 11, 10, 0), False),
        ("D5", D(2026, 10, 7, 10, 0), False), ("D5", D(2026, 10, 10, 10, 0), False),
    ]
    bad = 0
    for did, dt, exp in cases:
        got = is_open_hours(did, dt.timestamp())
        ok = (got == exp)
        bad += 0 if ok else 1
        print("%-4s %s %s  open=%-5s -> %s   %s" % (did, dt.strftime("%a %Y-%m-%d %H:%M:%S"), "", got,
              "NO Auto-Lock" if got else "Auto-Lock", "PASS" if ok else "FAIL (expected open=%s)" % exp))
    print("RESULT: %s (%d/%d)" % ("ALL PASS" if not bad else "FAILED", len(cases) - bad, len(cases)))
    return bad


if __name__ == "__main__":
    if "--test-schedule" in sys.argv:
        sys.exit(1 if schedule_selftest() else 0)
    try:
        main()
    except KeyboardInterrupt:
        log("Stopped by user.")
