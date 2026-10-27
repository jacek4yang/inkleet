"""Exercise real helper ordering with fake driver/OS responses, not native UI qualification."""
import ast
import copy
import json
import pathlib
import tempfile
import types
import unittest

SOURCE = pathlib.Path(__file__).with_name("native_smoke.py")

class HeaderActionTest(unittest.TestCase):
    def run_helper(self, header_updates=None, target_updates=None, moved_bounds=False):
        events=[];pointer={"x":0,"y":0};observations=[]
        bounds={"x":150,"y":100,"width":18,"height":21,"left":150,"right":168,"top":100,"bottom":121}
        panel={"left":0,"right":200,"top":50,"bottom":180}
        header_state={"hover":True,"opacity":1,"display":"inline-flex","visibility":"visible","enabled":True,"hit":False,
                      "bounds":bounds,"panel":panel,"viewport":{"width":250,"height":200}}
        header_state.update(header_updates or {})
        target_state={**header_state,"hit":True,"focused":True,"label":"内部结构","dpr":1}
        target_state.update(target_updates or {})
        def command(method,path,payload=None):
            if path=="/window/rect":return {"x":0,"y":0,"width":250,"height":200}
            if path.endswith('/enabled'):return True
            if path.endswith('/rect'):
                return {"x":10,"y":100,"width":180,"height":21} if 'header' in path else copy.deepcopy(bounds)
            if path=="/execute/sync":
                target=isinstance(payload['args'][0],dict)
                state=copy.deepcopy(target_state if target else header_state)
                events.append("observe-target" if target else "observe-header")
                if target:
                    state['point']={"x":payload['args'][1],"y":payload['args'][2]}
                    self.assertEqual(state['point'],pointer,"read-only target check uses the actual OS pointer point")
                    self.assertEqual(payload['args'][3],'.debug-body')
                    if moved_bounds:
                        state['bounds']['top']+=len(observations)
                        state['bounds']['y']+=len(observations)
                    observations.append(state)
                return state
            raise AssertionError(path)
        def wait(fn,label):
            for _ in range(3):
                result=fn()
                if result:return result
            raise AssertionError("not ready: "+label)
        def run(args,**kwargs):
            events.append(tuple(args))
            if args[1]=='mousemove':pointer.update(x=int(args[-2]),y=int(args[-1]))
            output=f"X={pointer['x']}\nY={pointer['y']}\n" if args[1]=='getmouselocation' else 'InkLeet\n'
            return types.SimpleNamespace(returncode=0,stdout=output,stderr='')
        with tempfile.TemporaryDirectory() as directory:
            scope={"cmd":command,"element":lambda css:css,"reveal_debug_control":lambda css:events.append(("reveal",css)),
                   "subprocess":types.SimpleNamespace(run=run),"wait_for":wait,"evidence":pathlib.Path(directory),"json":json,"EID":"element-id"}
            nodes=[node for node in ast.parse(SOURCE.read_text()).body if isinstance(node,ast.FunctionDef) and node.name in ('click_debug_header_action','click_native_node')]
            exec(compile(ast.Module(body=nodes,type_ignores=[]),str(SOURCE),"exec"),scope)
            try:scope['click_debug_header_action']('header','action')
            except AssertionError:
                self.assertNotIn(('xdotool','click','1'),events)
                raise
            self.assertTrue((pathlib.Path(directory)/'native-header-action-last-state.json').exists())
            self.assertTrue((pathlib.Path(directory)/'native-pointer-last-state.json').exists())
        return events
    def test_pre_move_miss_then_real_target_move_and_stable_hit_allows_one_click(self):
        events=self.run_helper()
        moves=[event for event in events if isinstance(event,tuple) and event[:2]==('xdotool','mousemove')]
        self.assertEqual(len(moves),2)
        self.assertEqual(moves[1][-2:],('159','110'))
        self.assertLess(events.index(moves[1]),events.index('observe-target'))
        self.assertGreaterEqual(events.count('observe-target'),2)
        self.assertEqual(events.count(('xdotool','click','1')),1)
        self.assertEqual(events[-1],('xdotool','click','1'))
    def test_hidden_header_action_never_clicked(self):
        with self.assertRaisesRegex(AssertionError,'not ready'):self.run_helper(header_updates={'opacity':0})
    def test_off_panel_header_action_never_clicked(self):
        with self.assertRaisesRegex(AssertionError,'not ready'):
            self.run_helper(header_updates={'bounds':{'width':18,'height':21,'left':150,'right':168,'top':190,'bottom':211}})
    def test_post_move_occlusion_never_clicked(self):
        with self.assertRaisesRegex(AssertionError,'not ready'):self.run_helper(target_updates={'hit':False})
    def test_post_move_hidden_or_disabled_or_not_hovered_never_clicked(self):
        for updates in ({'opacity':0},{'enabled':False},{'hover':False}):
            with self.subTest(updates=updates),self.assertRaisesRegex(AssertionError,'not ready'):self.run_helper(target_updates=updates)
    def test_post_move_panel_clip_never_clicked(self):
        with self.assertRaisesRegex(AssertionError,'not ready'):
            self.run_helper(target_updates={'panel':{'left':0,'right':160,'top':50,'bottom':180}})
    def test_unstable_bounds_never_clicked(self):
        with self.assertRaisesRegex(AssertionError,'not ready'):self.run_helper(moved_bounds=True)

if __name__=='__main__':unittest.main()
