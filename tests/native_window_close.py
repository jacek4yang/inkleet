"""One normal X11 close request; never XDestroyWindow, process kill or force exit."""
import ctypes
import ctypes.util
import json
import pathlib
import subprocess

def check_clean_close(evidence, wait_for):
    def visible():
        result = subprocess.run(["xdotool", "search", "--onlyvisible", "--name", "^墨题 InkLeet$"],
                                capture_output=True, text=True, timeout=5)
        if result.returncode not in (0, 1):
            raise RuntimeError(result.stderr)
        return result.stdout.split()
    ids = visible()
    assert len(ids) == 1, "close probe requires exactly one visible InkLeet window"
    xid = int(ids[0])
    pid = int(subprocess.check_output(["xdotool", "getwindowpid", str(xid)], text=True, timeout=5).strip())
    class Data(ctypes.Union):
        _fields_ = [("b", ctypes.c_char * 20), ("s", ctypes.c_short * 10), ("l", ctypes.c_long * 5)]
    class ClientMessage(ctypes.Structure):
        _fields_ = [("type", ctypes.c_int), ("serial", ctypes.c_ulong), ("send_event", ctypes.c_int),
                    ("display", ctypes.c_void_p), ("window", ctypes.c_ulong), ("message_type", ctypes.c_ulong),
                    ("format", ctypes.c_int), ("data", Data)]
    class Event(ctypes.Union):
        _fields_ = [("client", ClientMessage), ("pad", ctypes.c_long * 24)]
    library = ctypes.util.find_library("X11")
    assert library, "libX11 is required for the normal window-close request"
    x11 = ctypes.CDLL(library)
    x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
    x11.XInternAtom.restype = ctypes.c_ulong
    x11.XSendEvent.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_long, ctypes.POINTER(Event)]
    x11.XSendEvent.restype = ctypes.c_int
    x11.XFlush.argtypes = [ctypes.c_void_p]
    x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
    display = x11.XOpenDisplay(None)
    assert display, "could not connect to the test X server"
    try:
        event = Event()
        event.client.type = 33
        event.client.send_event = 1
        event.client.display = display
        event.client.window = xid
        event.client.message_type = x11.XInternAtom(display, b"WM_PROTOCOLS", 0)
        event.client.format = 32
        event.client.data.l[0] = x11.XInternAtom(display, b"WM_DELETE_WINDOW", 0)
        event.client.data.l[1] = 0
        assert x11.XSendEvent(display, xid, 0, 0, ctypes.byref(event)), "close request was not sent"
        x11.XFlush(display)
    finally:
        x11.XCloseDisplay(display)
    def terminated():
        if str(xid) in visible():
            return False
        status = pathlib.Path(f"/proc/{pid}/stat")
        try:
            state = status.read_text().rsplit(")", 1)[1].split()[0]
        except FileNotFoundError:
            return True
        return state in ("Z", "X")
    wait_for(terminated, "normal WM_DELETE_WINDOW request closes clean native app", seconds=15)
    (evidence / "CLOSE_NATIVE_RESULT.txt").write_text(
        "PASS: one X11 WM_PROTOCOLS/WM_DELETE_WINDOW request closed the fresh native application and its process stopped. "
        "No force destruction, process kill or WebDriver window deletion was used to obtain this result. "
        "This checks clean Linux closure, not unsaved-dialog behavior or Windows/macOS.\n")
    (evidence / "close-native-window.json").write_text(json.dumps({"window": xid, "pid": pid, "requestCount": 1}))
