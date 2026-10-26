"""Run only in GitHub Actions: python3 -m unittest discover -s tests -p 'test_native_wait.py' -v."""
import http.client
import json
from pathlib import Path
import tempfile
import unittest

from native_wait import NativeDiagnostics, JsonlDiagnostics, Polling, WaitTimeout, operation_label, read_only_command


class FakeClock:
    def __init__(self):
        self.now, self.sleeps = 0.0, []

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.advance(seconds)


class PollingTests(unittest.TestCase):
    def setUp(self):
        self.clock, self.events = FakeClock(), []
        self.poll = Polling(clock=self.clock, sleep=self.clock.sleep,
                            emit=lambda event, **fields: self.events.append(dict(event=event, **fields)))

    def events_named(self, name):
        return [row for row in self.events if row["event"] == name]

    def test_early_success_preserves_value(self):
        expected = {"ready": True}
        self.assertIs(self.poll.wait_for(lambda: expected, "ready"), expected)
        self.assertEqual(self.clock.sleeps, [])
        self.assertEqual(self.events_named("wait_end")[-1]["outcome"], "success")

    def test_wait_budget_must_be_finite_and_positive(self):
        for seconds in (float("nan"), float("inf"), float("-inf"), 0, -1):
            with self.subTest(seconds=seconds):
                with self.assertRaises(ValueError):
                    self.poll.wait_for(lambda: self.fail("must not call predicate"),
                                       "invalid budget", seconds=seconds)
                self.assertIsNone(self.poll.active)
                self.assertEqual(self.clock.now, 0)
                self.assertEqual(self.clock.sleeps, [])

    def test_truth_conversion_exceptions_keep_existing_polling_behavior(self):
        class FlakyTruthy:
            calls = 0
            def __bool__(self):
                self.calls += 1
                if self.calls == 1:
                    raise ValueError("not included in diagnostic fields")
                return True
        expected = FlakyTruthy()
        self.assertIs(self.poll.wait_for(lambda: expected, "truth conversion", seconds=1),
                      expected)
        self.assertEqual(expected.calls, 2)
        self.assertEqual(self.clock.sleeps, [.2])
        self.assertEqual(self.events_named("wait_end")[-1]["predicate_errors"], 1)

    def test_truthy_at_or_after_deadline_fails(self):
        for elapsed in (.5, .6):
            with self.subTest(elapsed=elapsed):
                def slow():
                    self.clock.advance(elapsed)
                    return True
                with self.assertRaises(WaitTimeout):
                    self.poll.wait_for(slow, "late result", seconds=.5)
                self.assertIsNone(self.poll.active)
                self.assertEqual(self.events_named("wait_end")[-1]["outcome"], "deadline")

    def test_poll_sleep_is_clipped_to_remaining_budget(self):
        with self.assertRaises(WaitTimeout):
            self.poll.wait_for(lambda: False, "absent", seconds=.25)
        self.assertEqual(len(self.clock.sleeps), 2)
        self.assertAlmostEqual(self.clock.sleeps[0], .2)
        self.assertAlmostEqual(self.clock.sleeps[1], .05)
        self.assertAlmostEqual(self.clock.now, .25)

    def test_slow_truth_conversion_cannot_admit_a_late_result(self):
        clock = self.clock
        class SlowTruthy:
            def __bool__(self):
                clock.advance(1)
                return True
        with self.assertRaises(WaitTimeout):
            self.poll.wait_for(lambda: SlowTruthy(), "late truth conversion", seconds=1)

    def test_predicate_errors_do_not_reset_budget(self):
        calls = []
        def fail():
            calls.append(1)
            self.clock.advance(.35)
            raise ValueError("not included in diagnostic fields")
        with self.assertRaises(WaitTimeout) as caught:
            self.poll.wait_for(fail, "still absent", seconds=1)
        self.assertEqual(len(calls), 2)
        self.assertAlmostEqual(self.clock.now, 1)
        self.assertIsInstance(caught.exception.__cause__, ValueError)

    def test_nested_success_restores_parent_budget_and_context(self):
        def outer():
            parent = self.poll.active
            def inner():
                self.clock.advance(.2)
                return True
            self.assertTrue(self.poll.wait_for(inner, "inner", seconds=10, phase="inner"))
            self.assertIs(self.poll.active, parent)
            self.assertAlmostEqual(self.poll.timeout(), .8)
            return True
        self.poll.wait_for(outer, "outer", seconds=1, phase="outer")
        starts = self.events_named("wait_start")
        self.assertEqual(starts[1]["parent_wait_id"], starts[0]["wait_id"])
        self.assertEqual(starts[1]["deadline_owner"], starts[0]["wait_id"])
        self.assertIsNone(self.poll.active)
        self.assertEqual(self.poll.timeout(), 90)

    def test_nested_inherited_timeout_keeps_outer_owner(self):
        def outer():
            def inner():
                self.clock.advance(1)
                return True
            return self.poll.wait_for(inner, "inner", seconds=10)
        with self.assertRaises(WaitTimeout) as caught:
            self.poll.wait_for(outer, "outer", seconds=1)
        starts = self.events_named("wait_start")
        self.assertEqual(caught.exception.wait_id, starts[0]["wait_id"])
        self.assertEqual([e["outcome"] for e in self.events_named("wait_end")],
                         ["deadline", "deadline"])
        self.assertIsNone(self.poll.active)

    def test_shorter_child_timeout_is_not_retried_by_parent(self):
        with self.assertRaises(WaitTimeout) as caught:
            self.poll.wait_for(
                lambda: self.poll.wait_for(lambda: False, "child", seconds=.25),
                "parent", seconds=1)
        self.assertEqual(caught.exception.wait_id, self.events_named("wait_start")[1]["wait_id"])
        self.assertEqual(self.events_named("wait_end")[-1]["attempts"], 1)
        self.assertAlmostEqual(self.clock.now, .25)
        self.assertIsNone(self.poll.active)

    def test_nested_base_exception_restores_parent(self):
        def interrupt():
            raise KeyboardInterrupt()
        def outer():
            parent = self.poll.active
            with self.assertRaises(KeyboardInterrupt):
                self.poll.wait_for(interrupt, "child")
            self.assertIs(self.poll.active, parent)
            return True
        self.assertTrue(self.poll.wait_for(outer, "parent"))
        self.assertIsNone(self.poll.active)

    def test_read_retry_is_one_attempt_and_records_recovery(self):
        timeouts = []
        def send(timeout):
            timeouts.append(timeout)
            if len(timeouts) == 1:
                raise http.client.RemoteDisconnected("private response detail")
            return "ok"
        self.assertEqual(self.poll.driver_call(send, operation="GET /element/:id/text",
                                              retry_read_only=True), "ok")
        self.assertEqual(timeouts, [90, 90])
        self.assertEqual(self.clock.sleeps, [.3])
        end = self.events_named("driver_end")[-1]
        self.assertEqual(end["retries_started"], 1)
        self.assertTrue(end["read_retry_recovered"])
        attempts = self.events_named("driver_attempt")
        self.assertEqual([a["outcome"] for a in attempts],
                         ["read_retry_scheduled", "response_received"])
        self.assertIsNone(attempts[-1]["error_type"])

    def test_second_read_reset_is_terminal_for_this_command(self):
        calls = []
        def send(timeout):
            calls.append(timeout)
            raise http.client.RemoteDisconnected()
        with self.assertRaises(http.client.RemoteDisconnected):
            self.poll.driver_call(send, operation="GET /screenshot", retry_read_only=True)
        self.assertEqual(len(calls), 2)
        self.assertFalse(self.events_named("driver_end")[-1]["read_retry_recovered"])

    def test_writes_and_actions_never_get_transport_retry(self):
        for method, path in (("POST", "/element/id/click"),
                             ("POST", "/element/id/value"),
                             ("POST", "/execute/sync"),
                             ("POST", "/actions"), ("DELETE", "/actions"),
                             ("POST", "/session")):
            with self.subTest(method=method, path=path):
                calls = []
                def send(timeout):
                    calls.append(timeout)
                    raise http.client.RemoteDisconnected()
                self.assertFalse(read_only_command(method, path))
                with self.assertRaises(http.client.RemoteDisconnected):
                    self.poll.driver_call(send, operation=operation_label(method, path),
                                          retry_read_only=read_only_command(method, path))
                self.assertEqual(len(calls), 1)

    def test_non_reset_error_never_gets_transport_retry(self):
        for error in (RuntimeError("response body"), TimeoutError(), ValueError()):
            with self.subTest(error=type(error).__name__):
                calls = []
                def send(timeout):
                    calls.append(timeout)
                    raise error
                with self.assertRaises(type(error)):
                    self.poll.driver_call(send, operation="GET /status", retry_read_only=True)
                self.assertEqual(len(calls), 1)

    def test_request_and_retry_timeout_share_wait_budget(self):
        timeouts = []
        def send(timeout):
            timeouts.append(timeout)
            if len(timeouts) == 1:
                self.clock.advance(.6)
                raise http.client.RemoteDisconnected()
            self.clock.advance(.05)
            return True
        self.assertTrue(self.poll.wait_for(
            lambda: self.poll.driver_call(send, operation="GET /status", retry_read_only=True),
            "bounded retry", seconds=1))
        self.assertAlmostEqual(timeouts[0], 1)
        self.assertAlmostEqual(timeouts[1], .1)
        self.assertTrue(self.events_named("driver_end")[-1]["read_retry_recovered"])

    def test_exhausted_retry_delay_does_not_start_another_request(self):
        calls = []
        def send(timeout):
            calls.append(timeout)
            self.clock.advance(.9)
            raise http.client.RemoteDisconnected()
        with self.assertRaises(WaitTimeout):
            self.poll.wait_for(
                lambda: self.poll.driver_call(send, operation="GET /status", retry_read_only=True),
                "no retry budget", seconds=1)
        self.assertEqual(len(calls), 1)
        self.assertAlmostEqual(self.clock.sleeps[-1], .1)
        end = self.events_named("driver_end")[-1]
        self.assertEqual(end["retries_started"], 0)
        self.assertEqual(end["error_type"], "WaitTimeout")
        self.assertFalse(end["read_retry_recovered"])

    def test_late_retry_response_is_not_recovery(self):
        calls = []
        def send(timeout):
            calls.append(timeout)
            if len(calls) == 1:
                raise http.client.RemoteDisconnected()
            self.clock.advance(.8)
            return True
        with self.assertRaises(WaitTimeout):
            self.poll.wait_for(
                lambda: self.poll.driver_call(send, operation="GET /status", retry_read_only=True),
                "late retry", seconds=1)
        end = self.events_named("driver_end")[-1]
        self.assertEqual(end["outcome"], "deadline")
        self.assertFalse(end["read_retry_recovered"])

    def test_expired_budget_does_not_send_or_sleep(self):
        def outer():
            self.clock.advance(1)
            with self.assertRaises(WaitTimeout):
                self.poll.driver_call(lambda timeout: self.fail("must not send"),
                                      operation="GET /status", retry_read_only=True)
            with self.assertRaises(WaitTimeout):
                self.poll.pause(.2)
            return True
        with self.assertRaises(WaitTimeout):
            self.poll.wait_for(outer, "expired", seconds=1)
        self.assertEqual(self.clock.sleeps, [])
        self.assertEqual(self.events_named("driver_end")[-1]["error_type"], "WaitTimeout")

    def test_diagnostics_omit_label_payload_and_exception_text(self):
        secret = "SECRET_PAYLOAD"
        def fail(timeout):
            raise RuntimeError(secret)
        with self.assertRaises(WaitTimeout):
            self.poll.wait_for(
                lambda: self.poll.driver_call(fail, operation="GET /element/:id/text"),
                secret, seconds=.1, phase="native_smoke.py:123")
        self.assertNotIn(secret, json.dumps(self.events))

    def test_sink_failure_after_mutation_does_not_replay_or_change_result(self):
        calls = []
        def broken_sink(event, **fields):
            if event == "driver_attempt":
                raise OSError("private storage path")
        poll = Polling(clock=self.clock, sleep=self.clock.sleep, emit=broken_sink)
        def send(timeout):
            calls.append(timeout)
            return True
        def outer():
            parent = poll.active
            value = poll.wait_for(
                lambda: poll.driver_call(send, operation="POST /element/:id/click"),
                "child")
            self.assertIs(poll.active, parent)
            return value
        self.assertTrue(poll.wait_for(outer, "parent"))
        self.assertEqual(len(calls), 1)
        self.assertIsNone(poll.active)
        self.assertIsNone(poll.sink)

    def test_sink_failure_preserves_original_command_error(self):
        for failing_event in ("driver_attempt", "driver_end"):
            for error in (http.client.RemoteDisconnected("private driver detail"),
                          RuntimeError("private response body")):
                with self.subTest(event=failing_event, error=type(error).__name__):
                    calls = []
                    def broken_sink(event, **fields):
                        if event == failing_event:
                            raise OSError("private storage path")
                    poll = Polling(clock=self.clock, sleep=self.clock.sleep, emit=broken_sink)
                    def send(timeout):
                        calls.append(timeout)
                        raise error
                    with self.assertRaises(type(error)) as caught:
                        poll.driver_call(send, operation="POST /element/:id/click")
                    self.assertIs(caught.exception, error)
                    self.assertEqual(len(calls), 1)
                    self.assertEqual(self.clock.sleeps, [])


class DiagnosticTests(unittest.TestCase):
    def test_read_only_allowlist_is_unchanged(self):
        for method, path in (("GET", "/anything"), ("POST", "/element"),
                             ("POST", "/elements"), ("POST", "/element/id/elements")):
            self.assertTrue(read_only_command(method, path))

    def test_route_labels_hide_ids_names_queries_and_unknown_paths(self):
        self.assertEqual(operation_label("GET", "/session/SECRET/element/PRIVATE/text"),
                         "GET /element/:id/text")
        self.assertEqual(operation_label("GET", "/element/PRIVATE/property/SECRET"),
                         "GET /element/:id/property/:name")
        self.assertEqual(operation_label("GET", "/SECRET?token=PRIVATE"), "GET /other")
        self.assertNotIn("SECRET", operation_label("SECRET", "/SECRET"))

    def test_jsonl_is_bounded_and_marks_truncation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "timing.jsonl"
            emit = JsonlDiagnostics(path, clock=FakeClock(), max_bytes=512)
            for _ in range(20):
                emit("wait_end", outcome="success", phase="native_smoke.py:123", elapsed_ms=10)
            raw = path.read_bytes()
            self.assertLessEqual(len(raw), 512)
            rows = [json.loads(line) for line in raw.splitlines()]
            self.assertEqual(rows[-1]["event"], "diagnostics_truncated")
            self.assertTrue(rows[-1]["later_events_omitted"])
            self.assertIn("utc", rows[0])
            self.assertIn("since_start_ms", rows[0])


class NativeDiagnosticsTests(unittest.TestCase):
    def test_phase_progress_survives_both_journal_caps(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            emit = NativeDiagnostics(root, clock=FakeClock(), detail_bytes=512,
                                     phase_bytes=512)
            for index in range(30):
                emit("driver_end", operation="GET /element/:id/text")
                emit("wait_start", wait_id=index, phase="native_smoke.py:1600",
                     budget_ms=25000, label="PRIVATE", payload="PRIVATE")
            emit("wait_end", wait_id=29, phase="native_smoke.py:1600",
                 outcome="success", elapsed_ms=10, label="PRIVATE")
            for name in ("native-timing.jsonl", "native-phases.jsonl"):
                rows = [json.loads(line) for line in (root/name).read_text().splitlines()]
                self.assertEqual(rows[-1]["event"], "diagnostics_truncated")
                self.assertLessEqual((root/name).stat().st_size, 512)
            latest = json.loads((root/"native-phase-latest.json").read_text())
            self.assertEqual(latest["wait_id"], 29)
            self.assertEqual(latest["outcome"], "success")
            self.assertNotIn("PRIVATE", (root/"native-phase-latest.json").read_text())
            self.assertNotIn("PRIVATE", (root/"native-phases.jsonl").read_text())

    def test_observation_failure_does_not_change_wait_result(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            emit = NativeDiagnostics(root)
            def broken(*args, **kwargs):
                raise OSError("unavailable")
            emit.detail = emit.phases = broken
            emit.latest = root / "missing" / "latest.json"
            self.assertEqual(Polling(emit=emit).wait_for(lambda: 42, "private", 1), 42)


if __name__ == "__main__":
    unittest.main()
