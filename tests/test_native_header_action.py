"""Unit checks for the native hover/action ordering; not native UI qualification."""
import ast
import copy
import json
import pathlib
import tempfile
import types
import unittest

SOURCE = pathlib.Path(__file__).with_name("native_smoke.py")

class HeaderActionTest(unittest.TestCase):
    def run_helper(self, **updates):
        events=[]
        state={"hover":True,"opacity":1,"display":"inline-flex","visibility":"visible","enabled":True,"hit":True,
               "bounds":{"width":18,"height":21,"left":150,"right":168,"top":100,"bottom":121},
               "panel":{"left":0,"right":200,"top":50,"bottom":180},"viewport":{"width":250,"height":200}}
        state.update(updates)
        def command(method,path,payload=None):
            if path=="/window/rect":return {"x":0,"y":0,"width":250,"height":200}
            if path.endswith('/rect'):return {"x":10,"y":100,"width":180,"height":21}
            events.append("observe")
            return copy.deepcopy(state)
        def wait(fn,label):
            if not fn():raise AssertionError("not revealed")
        with tempfile.TemporaryDirectory() as directory:
            scope={"cmd":command,"element":lambda css:css,"reveal_debug_control":lambda css:events.append(("reveal",css)),
                   "subprocess":types.SimpleNamespace(run=lambda args,check:events.append(("pointer",args))),
                   "wait_for":wait,"click_debug_action":lambda css:events.append(("click",css)),"evidence":pathlib.Path(directory),"json":json}
            node=next(node for node in ast.parse(SOURCE.read_text()).body if isinstance(node,ast.FunctionDef) and node.name=="click_debug_header_action")
            exec(compile(ast.Module(body=[node],type_ignores=[]),str(SOURCE),"exec"),scope)
            try:scope["click_debug_header_action"]("header","action")
            except AssertionError:
                self.assertFalse(any(isinstance(e,tuple) and e[0]=="click" for e in events))
                raise
        return events
    def test_hover_then_observe_then_single_click(self):
        events=self.run_helper()
        self.assertEqual(events[0],("reveal","header"))
        self.assertEqual(events[1][0],"pointer")
        self.assertEqual(events[1][1][1],"mousemove")
        self.assertEqual(events[2:], ["observe",("click","action")])
    def test_hidden_action_never_clicked(self):
        with self.assertRaisesRegex(AssertionError,"not revealed"):self.run_helper(opacity=0)
    def test_off_panel_action_never_clicked(self):
        with self.assertRaisesRegex(AssertionError,"not revealed"):
            self.run_helper(bounds={"width":18,"height":21,"left":150,"right":168,"top":190,"bottom":211})
    def test_occluded_action_never_clicked(self):
        with self.assertRaisesRegex(AssertionError,"not revealed"):self.run_helper(hit=False)

if __name__=="__main__":unittest.main()
