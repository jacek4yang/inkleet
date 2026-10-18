"""Deadline-aware polling and content-free WebDriver timing for native tests.

This module does not start the application, send input, or import native_smoke.
urllib timeouts bound blocking operations, not the wall time of arbitrary code.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
import http.client
import json
import math
import re
import sys
import time


def _diagnostic_warning():
    try:
        print("WARNING: native timing diagnostics disabled after a logging failure", file=sys.stderr)
    except Exception:
        pass  # Telemetry must never change the outcome or replay an action.


class WaitTimeout(AssertionError):
    def __init__(self, owner):
        super().__init__(f"{owner.label}: wait budget exhausted")
        self.wait_id = owner.wait_id


@dataclass
class _Wait:
    wait_id: int
    phase: str
    label: str
    deadline: float
    owner: object = None


def read_only_command(method, path):
    # Preserve the existing cmd allowlist. execute/sync is deliberately excluded.
    return method == "GET" or (
        method == "POST"
        and (path in ("/element", "/elements") or path.endswith("/elements"))
    )


def operation_label(method, path):
    """Use route templates only; never log session/element IDs or payloads."""
    verb = method if method in ("GET", "POST", "DELETE") else "OTHER"
    if path.startswith("/session/"):
        path = re.sub(r"^/session/[^/]+", "", path)
    if path in ("", "/status", "/session", "/element", "/elements",
                "/element/active", "/window", "/window/rect", "/window/handles",
                "/screenshot", "/actions", "/execute/sync"):
        route = path or "/session/:id"
    elif re.fullmatch(r"/element/[^/]+/(text|rect|enabled|click|clear|value|elements)", path):
        route = re.sub(r"^/element/[^/]+", "/element/:id", path)
    elif re.fullmatch(r"/element/[^/]+/(attribute|property)/[^/]+", path):
        route = "/element/:id/" + path.split("/")[3] + "/:name"
    else:
        route = "/other"
    return verb + " " + route


class JsonlDiagnostics:
    """A bounded stream; a final marker makes missing later samples explicit."""
    def __init__(self, path, *, clock=time.monotonic, max_bytes=8 * 1024 * 1024):
        if max_bytes < 512:
            raise ValueError("diagnostic byte budget must be at least 512")
        self.path, self.clock, self.max_bytes = path, clock, max_bytes
        self.started, self.written, self.closed = clock(), 0, False
        try:
            path.write_bytes(b"")
        except OSError:
            self.closed = True
            _diagnostic_warning()

    def __call__(self, event, **fields):
        if self.closed:
            return
        record = dict(event=event, utc=datetime.now(timezone.utc).isoformat(),
                      since_start_ms=round((self.clock() - self.started) * 1000, 3),
                      **fields)
        raw = (json.dumps(record, ensure_ascii=True, separators=(",", ":")) + "\n").encode()
        if self.written + len(raw) > self.max_bytes - 256:
            raw = b'{"event":"diagnostics_truncated","later_events_omitted":true}\n'
            self.closed = True
        with self.path.open("ab") as stream:
            stream.write(raw)
        self.written += len(raw)


class Polling:
    def __init__(self, *, clock=time.monotonic, sleep=time.sleep, emit=None):
        self.clock, self.sleep, self.sink = clock, sleep, emit
        self.active = None
        self.sequence = 0

    def emit(self, event, **fields):
        if self.sink is not None:
            try:
                self.sink(event, **fields)
            except Exception:
                self.sink = None
                _diagnostic_warning()

    def _id(self):
        self.sequence += 1
        return self.sequence

    def _context(self):
        return dict(wait_id=self.active.wait_id if self.active else None,
                    phase=self.active.phase if self.active else "outside-wait")

    def check(self):
        if self.active and self.clock() >= self.active.deadline:
            raise WaitTimeout(self.active.owner)

    def timeout(self, limit=90):
        if not self.active:
            return limit
        remaining = self.active.deadline - self.clock()
        if remaining <= 0:
            raise WaitTimeout(self.active.owner)
        return min(limit, remaining)

    def pause(self, seconds):
        self.sleep(self.timeout(seconds))
        self.check()

    def wait_for(self, fn, label, seconds=25, *, phase="poll"):
        if not math.isfinite(seconds) or seconds <= 0:
            raise ValueError("wait budget must be finite and positive")
        self.check()
        started, parent = self.clock(), self.active
        current = _Wait(self._id(), phase, label, started + seconds)
        current.owner = current
        if parent and parent.deadline <= current.deadline:
            current.deadline, current.owner = parent.deadline, parent.owner
        self.active = current
        attempts, errors, last, maximum = 0, 0, None, 0.0
        outcome = "error"
        try:
            self.emit("wait_start", **self._context(),
                      parent_wait_id=parent.wait_id if parent else None,
                      deadline_owner=current.owner.wait_id,
                      budget_ms=round((current.deadline - started) * 1000, 3))
            while True:
                self.check()
                attempts += 1
                began = self.clock()
                try:
                    value = fn()
                    self.check()
                    ready = bool(value)
                except WaitTimeout:
                    # A nested wait's owner must survive; do not poll it again.
                    raise
                except Exception as error:
                    last, ready = error, False
                    errors += 1
                finally:
                    maximum = max(maximum, self.clock() - began)
                self.check()  # A truthy result at or beyond the deadline is late.
                if ready:
                    outcome = "success"
                    return value
                self.pause(.2)
        except WaitTimeout as error:
            outcome = "deadline"
            if error.wait_id == current.wait_id and last is not None:
                raise error from last
            raise
        finally:
            elapsed = self.clock() - started
            context = self._context()
            self.active = parent
            self.emit("wait_end", **context, outcome=outcome, attempts=attempts,
                      predicate_errors=errors, error_type=type(last).__name__ if last else None,
                      elapsed_ms=round(elapsed * 1000, 3),
                      max_predicate_ms=round(maximum * 1000, 3),
                      overrun_ms=round(max(0, self.clock() - current.deadline) * 1000, 3))

    def driver_call(self, send, *, operation, retry_read_only=False):
        """send(timeout) runs once, with at most one RemoteDisconnected read retry."""
        started, command_id, retries = self.clock(), self._id(), 0
        outcome, error_type = "error", None
        context = self._context()
        try:
            self.emit("driver_start", **context, command_id=command_id, operation=operation)
            for attempt in (1, 2):
                timeout = self.timeout()
                retries = attempt - 1
                began, attempt_outcome, error_type = self.clock(), "error", None
                try:
                    value = send(timeout)
                    self.check()
                    attempt_outcome = "response_received"
                    outcome = "response_received"
                    return value
                except http.client.RemoteDisconnected as error:
                    error_type = type(error).__name__
                    if not retry_read_only or attempt == 2:
                        raise
                    attempt_outcome = "read_retry_scheduled"
                except WaitTimeout:
                    attempt_outcome, error_type = "deadline", "WaitTimeout"
                    raise
                except Exception as error:
                    error_type = type(error).__name__
                    raise
                finally:
                    self.emit("driver_attempt", **context, command_id=command_id,
                              operation=operation, attempt=attempt, outcome=attempt_outcome,
                              timeout_ms=round(timeout * 1000, 3),
                              elapsed_ms=round((self.clock() - began) * 1000, 3),
                              error_type=error_type)
                self.pause(.3)
        except WaitTimeout:
            outcome, error_type = "deadline", "WaitTimeout"
            raise
        finally:
            self.emit("driver_end", **context, command_id=command_id, operation=operation,
                      outcome=outcome, retries_started=retries,
                      read_retry_recovered=(retries == 1 and outcome == "response_received"),
                      elapsed_ms=round((self.clock() - started) * 1000, 3),
                      error_type=error_type)
