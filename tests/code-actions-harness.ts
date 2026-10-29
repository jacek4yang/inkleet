import {EditorView} from '@codemirror/view';
import {EditorState} from '@codemirror/state';
import {basicSetup} from 'codemirror';
import {languageIntelligence} from '../src/intelligence';
const intelligence=languageIntelligence('rust',text=>{document.querySelector('#status')!.textContent=text;},()=>{});
const view=new EditorView({state:EditorState.create({doc:'fn solve() { let value = 1; }\n',extensions:[basicSetup,EditorView.contentAttributes.of({'aria-label':'Code action fixture'}),intelligence.extensions]}),parent:document.querySelector('#editor')!});
Object.assign(window,{__codeActionView:view,__codeActionIntelligence:intelligence});
void intelligence.connect(view);
