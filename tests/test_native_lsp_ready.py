"""Synthetic predicates/deadline tests, not proof of JDT availability."""
import unittest
from native_lsp_ready import latest_started, ready_java_session
from native_wait import Polling, WaitTimeout


def start(id, language='java'):
    return {'kind':'start','id':id,'language':language}


def status(id, value, language='java'):
    return {'kind':'server_status','id':id,'language':language,'status':value}


class NativeLspReadyTest(unittest.TestCase):
    def test_requires_new_matching_started_java_session(self):
        self.assertIsNone(ready_java_session([start(5),status(5,'ServiceReady')],5))
        self.assertIsNone(ready_java_session([start(6),status(5,'ServiceReady')],5))
        self.assertIsNone(ready_java_session([start(6,'rust'),status(6,'ServiceReady','rust')],5))
        self.assertIsNone(ready_java_session([status(6,'ServiceReady')],5))
        self.assertEqual(ready_java_session([start(6),status(6,'ServiceReady')],5),6)

    def test_ready_can_precede_started(self):
        self.assertEqual(ready_java_session([status(6,'ServiceReady'),start(6)],5),6)

    def test_latest_session_wins_over_late_old_ready(self):
        rows=[start(6),status(6,'ServiceReady'),start(7),status(6,'ServiceReady')]
        self.assertIsNone(ready_java_session(rows,5))
        self.assertEqual(ready_java_session(rows+[status(7,'ServiceReady')],5),7)

    def test_newer_other_language_start_invalidates_old_java_readiness(self):
        rows=[start(6),status(6,'ServiceReady'),start(7,'rust'),status(6,'ServiceReady')]
        self.assertIsNone(ready_java_session(rows,5))

    def test_initialize_starting_error_and_wrong_status_are_not_ready(self):
        for value in ('Starting','Started','Error','Ready',None,True):
            self.assertIsNone(ready_java_session([start(6),status(6,value)],5))
        self.assertIsNone(ready_java_session([start(6)],5))
        self.assertIsNone(ready_java_session([start(6),status(6,'ServiceReady'),status(6,'Error')],5))

    def test_malformed_identity_and_non_records_are_ignored(self):
        rows=[None,[],start(True),start('6'),start(2**53),start(5,'python3')]
        self.assertEqual(latest_started(rows),5)
        self.assertIsNone(ready_java_session(rows+[status(True,'ServiceReady')],0))
        self.assertEqual(latest_started([]),0)

    def test_missing_or_error_readiness_exhausts_existing_wait_deadline(self):
        for rows in ([start(6)],[start(6),status(6,'Error')]):
            clock=[0.0]; events=[]
            poll=Polling(clock=lambda:clock[0],sleep=lambda n:clock.__setitem__(0,clock[0]+n),emit=lambda event,**fields:events.append((event,fields)))
            with self.assertRaises(WaitTimeout):
                poll.wait_for(lambda:ready_java_session(rows,5),'Java service ready',1,phase='fixture')
            self.assertAlmostEqual(clock[0],1)
            self.assertEqual(events[-1][1]['outcome'],'deadline')


if __name__=='__main__':unittest.main()
