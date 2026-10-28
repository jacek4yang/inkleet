import assert from 'node:assert/strict';
/** Actual pointer center, not a hand-picked safe pixel or a JavaScript click. */
export async function checkInlineRawAction(page, node) {
  const header=node.locator(':scope > .debug-variable');
  const label=header.locator(':scope > button:first-child');
  const action=header.locator(':scope > .debug-raw-toggle');
  assert.equal(await action.count(),1,'captured map must expose an explicit raw fallback');
  const order=await header.evaluate(header=>{
    const action=header.querySelector(':scope > .debug-raw-toggle');
    return action?.previousElementSibling===header.querySelector(':scope > button:first-child');
  });
  assert.ok(order,'raw action belongs directly after the variable name, not at the scroll edge');
  const nameBounds=await label.boundingBox(),actionBounds=await action.boundingBox();
  assert.ok(nameBounds&&actionBounds);
  assert.ok(actionBounds.x>=nameBounds.x+nameBounds.width-1&&actionBounds.x-nameBounds.x-nameBounds.width<=12,'raw action remains beside its variable name');
  await page.mouse.move(nameBounds.x+nameBounds.width/2,nameBounds.y+nameBounds.height/2);
  const x=actionBounds.x+actionBounds.width/2,y=actionBounds.y+actionBounds.height/2;
  await page.mouse.move(x,y);
  assert.ok(await action.evaluate((button,{x,y})=>{
    const hit=document.elementFromPoint(x,y),style=getComputedStyle(button);
    return button.matches(':hover')&&Number(style.opacity)>0&&(hit===button||button.contains(hit));
  },{x,y}),'center must really hover/hit the raw action');
  await page.mouse.click(x,y);
  await node.locator(':scope > .debug-tree-children > .debug-tree-node > .debug-variable > button[aria-label="[raw]"]').waitFor();
  const close=await action.boundingBox();assert.ok(close);
  const closePoint={x:close.x+close.width/2,y:close.y+close.height/2};
  await page.mouse.move(closePoint.x,closePoint.y);
  assert.ok(await action.evaluate((button,{x,y})=>{
    const hit=document.elementFromPoint(x,y),style=getComputedStyle(button);
    return button.matches(':hover')&&Number(style.opacity)>0&&(hit===button||button.contains(hit));
  },closePoint),'close center must really hover/hit the raw action');
  await page.mouse.click(closePoint.x,closePoint.y);
  await node.locator(':scope > .debug-tree-children > .debug-tree-node > .debug-variable > button[aria-label="[raw]"]').waitFor({state:'detached'});
  return {name:nameBounds,action:actionBounds,center:{x,y}};
}
