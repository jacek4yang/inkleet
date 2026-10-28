"""Synthetic geometry tests; these do not qualify an actual Native screenshot."""
import copy
import unittest
from native_capture import capture_status, reveal_capture


def state():
    def target(text,top,bottom):
        return {'text':text,'bounds':{'left':20,'right':40,'top':top,'bottom':bottom,'width':20,'height':bottom-top},'clip':{'left':10,'right':100,'top':50,'bottom':200},'visible':True,'hit':True}
    return {'groups':[{'expected':2,'targets':[target('nums',100,120),target('size=2',100,120)]},{'expected':2,'targets':[target('[0]',125,145),target('[1]',150,170)]},{'expected':2,'targets':[target('5',125,145),target('9',150,170)]}],'scrollTop':0,'scrollHeight':500,'clientHeight':150,'wheel':{'x':14,'y':125}}


class CaptureTest(unittest.TestCase):
    def test_actual_text_visible_without_group_padding(self):
        s=state();s['irrelevantGroupBottom']=205
        self.assertIsNone(capture_status(s))

    def test_nested_last_leaf_clipped_fails(self):
        s=state();s['groups'][2]['targets'][1]['bounds'].update(top=190,bottom=210)
        self.assertEqual(capture_status(s),'down')

    def test_top_clipped_requires_up(self):
        s=state();s['groups'][0]['targets'][0]['bounds'].update(top=40,bottom=60)
        self.assertEqual(capture_status(s),'up')

    def test_missing_leaf_fails(self):
        s=state();s['groups'][2]['targets'].pop()
        with self.assertRaisesRegex(AssertionError,'count'):capture_status(s)

    def test_empty_primary_fails(self):
        s=state();s['groups'][0]={'expected':0,'targets':[]}
        with self.assertRaisesRegex(AssertionError,'count'):capture_status(s)

    def test_hidden_or_zero_size_fails(self):
        for field,value in [('visible',False),('width',0),('height',0)]:
            s=state();t=s['groups'][0]['targets'][0]
            (t if field=='visible' else t['bounds'])[field]=value
            with self.assertRaisesRegex(AssertionError,'painted'):capture_status(s)

    def test_horizontal_clipping_fails(self):
        s=state();s['groups'][0]['targets'][0]['clip']['right']=30
        with self.assertRaisesRegex(AssertionError,'horizontally'):capture_status(s)

    def test_occlusion_is_not_screenshot_success(self):
        s=state();s['groups'][0]['targets'][0]['hit']=False
        with self.assertRaisesRegex(AssertionError,'occluded'):capture_status(s)

    def test_all_targets_required_in_same_snapshot(self):
        s=state();s['groups'][0]['targets'][0]['bounds'].update(top=30,bottom=50)
        self.assertIsNotNone(capture_status(s))

    def test_evidence_before_real_wheel_and_final_recheck(self):
        clipped=state();clipped['groups'][2]['targets'][1]['bounds'].update(top=190,bottom=210)
        states=iter([clipped,state()]);events=[]
        result=reveal_capture(lambda:next(states),lambda s,d:events.append(('wheel',d)),lambda s:events.append(('save',s['attempt'])),lambda:events.append(('pause',)),attempts=1)
        self.assertEqual(events,[('save',0),('wheel','down'),('pause',),('save',1)])
        self.assertIsNone(capture_status(result))

    def test_exhaustion_never_returns_capture(self):
        s=state();s['groups'][2]['targets'][1]['bounds'].update(top=190,bottom=210)
        moves=[];saved=[]
        with self.assertRaisesRegex(AssertionError,'remain clipped'):
            reveal_capture(lambda:copy.deepcopy(s),lambda s,d:moves.append(d),saved.append,lambda:None,attempts=2)
        self.assertEqual(moves,['down','down']);self.assertEqual(len(saved),3)

    def test_invalid_geometry_does_not_wheel(self):
        s=state();s['groups'][0]['targets']=[];events=[]
        with self.assertRaises(AssertionError):reveal_capture(lambda:s,lambda *a:events.append('wheel'),lambda s:events.append('saved'),lambda:None)
        self.assertEqual(events,['saved'])

if __name__=='__main__':unittest.main()
