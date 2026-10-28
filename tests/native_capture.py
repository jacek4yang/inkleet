"""Read-only screenshot geometry with real-wheel scrolling; never an input click helper."""

CAPTURE_SNAPSHOT = r"""
const panel=document.querySelector(arguments[0]),specs=arguments[1];
if(!panel) return null;
const rect=e=>e.getBoundingClientRect().toJSON();
const describe=e=>e?{tag:e.tagName,className:String(e.className),bounds:rect(e)}:null;
const p=rect(panel),viewport={left:0,top:0,right:innerWidth,bottom:innerHeight};
const wheel={x:Math.floor(p.left+4),y:Math.floor(p.top+p.height/2)};
return {panel:p,viewport,wheel,scrollTop:panel.scrollTop,scrollHeight:panel.scrollHeight,clientHeight:panel.clientHeight,
  wheelHitStack:document.elementsFromPoint(wheel.x,wheel.y).slice(0,8).map(describe),
  groups:specs.map(spec=>({expected:spec.count,targets:[...document.querySelectorAll(spec.css)].map(e=>{
    const r=rect(e),style=getComputedStyle(e);let visible=style.display!=='none'&&style.visibility==='visible'&&Number(style.opacity)>0;
    const clip={...viewport};const ancestors=[];
    for(let a=e.parentElement;a;a=a.parentElement){
      const s=getComputedStyle(a),b=rect(a);
      visible=visible&&s.display!=='none'&&s.visibility==='visible'&&Number(s.opacity)>0;
      if(/auto|scroll|hidden|clip/.test(s.overflowX)){clip.left=Math.max(clip.left,b.left+a.clientLeft);clip.right=Math.min(clip.right,b.left+a.clientLeft+a.clientWidth);}
      if(/auto|scroll|hidden|clip/.test(s.overflowY)){clip.top=Math.max(clip.top,b.top+a.clientTop);clip.bottom=Math.min(clip.bottom,b.top+a.clientTop+a.clientHeight);}
      if(ancestors.length<8)ancestors.push({tag:a.tagName,className:String(a.className),bounds:b,scrollTop:a.scrollTop,scrollHeight:a.scrollHeight,clientHeight:a.clientHeight,overflowX:s.overflowX,overflowY:s.overflowY});
    }
    clip.left=Math.max(clip.left,p.left);clip.right=Math.min(clip.right,p.right);
    clip.top=Math.max(clip.top,p.top);clip.bottom=Math.min(clip.bottom,p.bottom);
    const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return {text:e.textContent,bounds:r,clip,visible,hit:e===hit||e.contains(hit),actualHit:describe(hit),ancestors};
  })}))};
"""


def capture_status(state):
    """Require every requested label/value, not the whitespace surrounding its group."""
    if not state or not state.get('groups'):
        raise AssertionError('missing screenshot geometry')
    targets=[]
    for group in state['groups']:
        if group['expected'] <= 0 or len(group['targets']) != group['expected']:
            raise AssertionError('screenshot target count changed or is empty')
        targets.extend(group['targets'])
    ready=True
    for target in targets:
        r,c=target['bounds'],target['clip']
        if not target['visible'] or r['width'] <= 0 or r['height'] <= 0:
            raise AssertionError('screenshot target has no painted bounds')
        if r['left'] < c['left'] or r['right'] > c['right']:
            raise AssertionError('screenshot target is horizontally clipped')
        ready = ready and r['top'] >= c['top'] and r['bottom'] <= c['bottom'] and target['hit']
    if ready:return None
    if any(t['bounds']['bottom'] > t['clip']['bottom'] for t in targets):return 'down'
    if any(t['bounds']['top'] < t['clip']['top'] for t in targets):return 'up'
    raise AssertionError('screenshot text is occluded despite in-bounds geometry')


def reveal_capture(snapshot, wheel, save, pause, attempts=12):
    """Save every observation before any wheel action; finish only on strict visibility."""
    for attempt in range(attempts+1):
        state=snapshot()
        save({'attempt':attempt,'state':state})
        direction=capture_status(state)
        if direction is None:return state
        if attempt==attempts:break
        wheel(state,direction)
        pause()
    raise AssertionError('screenshot labels/values remain clipped after real wheel scrolling')
