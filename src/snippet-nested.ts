
import {ChangeSet,EditorSelection,type Text,type Transaction} from "@codemirror/state";
import type {SnippetField} from "./snippet-prepare.ts";
import {snippetLimits} from "./snippet-budget.ts";
export type NestedField=SnippetField&{originPath:number[];sourceOrder:number};
export type NestedPlan={changes:ChangeSet;fields:NestedField[];selection:EditorSelection};
type Limits={copies:number;operations:number};
class Refused extends Error{}
class Budget{
 work=0;copies=0;readonly limits:Limits;
 constructor(limits:Partial<Limits>){this.limits={copies:snippetLimits.copies,operations:2000000,...limits};}
 step(n=1){this.work+=n;if(this.work>this.limits.operations)throw new Refused();}
 copy(n:number){if(!Number.isSafeInteger(n)||n<0)throw new Refused();this.copies+=n;if(this.copies>this.limits.copies)throw new Refused();}
 slice(doc:Text,from:number,to:number){if(to<from||to-from>snippetLimits.output)throw new Refused();this.copy(to-from);return doc.sliceString(from,to);}
}
type Index={byId:Map<number,NestedField>;children:Map<number|null,NestedField[]>;groups:Map<string,NestedField[]>;parents:Map<string,Set<string>>;order:string[]};
function descendant(f:NestedField,a:NestedField,b:Budget){b.step(a.originPath.length);return f.originPath.length>a.originPath.length&&a.originPath.every((n,i)=>f.originPath[i]===n);}
function relative(f:NestedField,a:NestedField,b:Budget){b.step(f.originPath.length);return f.originPath.slice(a.originPath.length).join(".");}
function choices(a:SnippetField,b:SnippetField,budget:Budget){
 if(!a.choices||!b.choices)return a.choices===b.choices;
 if(a.choices.length!==b.choices.length)return false;
 return a.choices.every((s,i)=>{budget.step(1+Math.max(s.length,b.choices![i].length));return s===b.choices![i];});
}
function subtree(root:NestedField,index:Index,b:Budget){
 const result:NestedField[]=[],pending=[...(index.children.get(root.id)??[])];
 while(pending.length){b.step();const f=pending.pop()!;result.push(f);pending.push(...(index.children.get(f.id)??[]));if(result.length>snippetLimits.occurrences)throw new Refused();}
 return result;
}
function indexFields(fields:NestedField[],length:number,b:Budget):Index{
 if(fields.length>snippetLimits.occurrences)throw new Refused();
 const byId=new Map<number,NestedField>(),children=new Map<number|null,NestedField[]>(),groups=new Map<string,NestedField[]>(),paths=new Set<string>(),ordinals=new Set<number>();
 for(const f of fields){
  b.step(1+f.originPath.length);
  if(![f.id,f.sourceOrder,f.from,f.to,...f.originPath].every(n=>Number.isSafeInteger(n)&&n>=0)||f.from>f.to||f.to>length||f.derived||f.final&&f.parent!==null||!f.group||byId.has(f.id)||ordinals.has(f.sourceOrder)||!f.originPath.length||f.originPath.length>snippetLimits.depth)throw new Refused();
  const path=f.originPath.join(".");if(paths.has(path))throw new Refused();paths.add(path);ordinals.add(f.sourceOrder);byId.set(f.id,f);
  const siblings=children.get(f.parent)??[];siblings.push(f);children.set(f.parent,siblings);
  const occurrences=groups.get(f.group)??[];occurrences.push(f);groups.set(f.group,occurrences);
 }
 if(groups.size>snippetLimits.groups)throw new Refused();
 for(const f of fields){
  b.step();if(f.parent===null){if(f.originPath.length!==1)throw new Refused();continue;}
  const p=byId.get(f.parent);if(!p||f.from<p.from||f.to>p.to||f.originPath.length!==p.originPath.length+1||!descendant(f,p,b))throw new Refused();
 }
 for(const siblings of children.values()){
  siblings.sort((a,z)=>a.sourceOrder-z.sourceOrder);
  for(let i=1;i<siblings.length;i++){b.step();if(siblings[i-1].to>siblings[i].from)throw new Refused();}
 }
 for(const occurrences of groups.values())occurrences.sort((a,z)=>a.sourceOrder-z.sourceOrder);
 const parents=new Map<string,Set<string>>(),indegree=new Map<string,number>();
 for(const g of groups.keys()){parents.set(g,new Set());indegree.set(g,0);}
 for(const f of fields){
  b.step();if(f.parent===null)continue;const p=byId.get(f.parent)!.group;if(p===f.group)throw new Refused();
  if(!parents.get(f.group)!.has(p)){parents.get(f.group)!.add(p);indegree.set(p,indegree.get(p)!+1);}
 }
 const queue=[...groups.keys()].filter(g=>indegree.get(g)===0),order:string[]=[];
 for(let i=0;i<queue.length;i++){b.step();const g=queue[i];order.push(g);for(const p of parents.get(g)!){const n=indegree.get(p)!-1;indegree.set(p,n);if(!n)queue.push(p);}}
 if(order.length!==groups.size)throw new Refused();
 return {byId,children,groups,parents,order};
}
function isomorphic(index:Index,b:Budget,doc?:Text){
 for(const occurrences of index.groups.values()){
  const source=occurrences[0],template=[source,...subtree(source,index,b)],value=doc?b.slice(doc,source.from,source.to):undefined;
  for(const destination of occurrences.slice(1)){
   const actual=[destination,...subtree(destination,index,b)];if(actual.length!==template.length)throw new Refused();
   const paths=new Map(actual.map(f=>[relative(f,destination,b),f]));
   for(const f of template){
    b.step();const other=paths.get(relative(f,source,b));
    if(!other||other.group!==f.group||other.final!==f.final||other.from-destination.from!==f.from-source.from||other.to-destination.from!==f.to-source.from||!choices(other,f,b))throw new Refused();
   }
   if(doc&&b.slice(doc,destination.from,destination.to)!==value)throw new Refused();
  }
 }
}
/** Validated parser preorder becomes immutable occurrence paths once, not per edit. */
export function initializeNestedFields(input:SnippetField[],doc:Text,limits:Partial<Limits>={}):NestedField[]|null{
 try{
  const b=new Budget(limits),fields:NestedField[]=[],byId=new Map<number,NestedField>(),slots=new Map<number|null,number>();
  if(input.length>snippetLimits.occurrences)throw new Refused();
  for(let i=0;i<input.length;i++){
   b.step();const f=input[i],p=f.parent===null?null:byId.get(f.parent);if(f.parent!==null&&!p||byId.has(f.id))throw new Refused();
   const slot=slots.get(f.parent)??0;slots.set(f.parent,slot+1);
   const next={...f,sourceOrder:i,originPath:[...(p?.originPath??[]),slot]};byId.set(f.id,next);fields.push(next);
  }
  const index=indexFields(fields,doc.length,b);isomorphic(index,b,doc);
  for(const occurrences of index.groups.values()){const empty=new Set<number>();for(const f of occurrences){b.step();if(f.from!==f.to)continue;if(empty.has(f.from))throw new Refused();empty.add(f.from);}}
  return fields;
 }catch(error){if(error instanceof Refused)return null;throw error;}
}
function copyGroup(fields:NestedField[],doc:Text,group:string,editedId:number,b:Budget){
 const index=indexFields(fields,doc.length,b),occurrences=index.groups.get(group);
 if(!occurrences?.length)return {fields,changes:ChangeSet.empty(doc.length)};
 const edited=index.byId.get(editedId);if(!edited)throw new Refused();
 const source=occurrences.find(f=>f.id===edited.id||descendant(edited,f,b))??occurrences[0],value=b.slice(doc,source.from,source.to),layout=subtree(source,index,b);
 const edits=occurrences.filter(f=>f.id!==source.id).map(root=>({root,from:root.from,to:root.to,insert:value,outputFrom:0})).sort((a,z)=>a.from-z.from||a.to-z.to||a.root.sourceOrder-z.root.sourceOrder);
 for(let i=0;i<edits.length;i++){
  b.step();if(edits[i].root.id===edited.id||descendant(edited,edits[i].root,b))throw new Refused();
  b.copy(value.length);if(!i)continue;const a=edits[i-1],z=edits[i];
  if(z.from<a.to||z.from===z.to&&a.from===a.to&&z.from===a.from)throw new Refused();
 }
 const changes=ChangeSet.of(edits.map(({from,to,insert})=>({from,to,insert})),doc.length);let delta=0;
 for(const e of edits){e.outputFrom=e.from+delta;delta+=value.length-(e.to-e.from);}
 const replacements=new Map<number,NestedField>(),removed=new Set<number>();
 for(const e of edits){
  const descendants=subtree(e.root,index,b),paths=new Map(descendants.map(f=>[relative(f,e.root,b),f])),retained=new Set<number>();
  replacements.set(e.root.id,{...e.root,from:e.outputFrom,to:e.outputFrom+value.length});
  for(const child of layout){
   b.step();const dest=paths.get(relative(child,source,b));
   if(!dest||dest.group!==child.group||dest.final!==child.final||!choices(dest,child,b))throw new Refused();
   retained.add(dest.id);replacements.set(dest.id,{...dest,from:e.outputFrom+child.from-source.from,to:e.outputFrom+child.to-source.from});
  }
  for(const child of descendants){b.step();if(!retained.has(child.id))removed.add(child.id);}
 }
 const output:NestedField[]=[];
 for(const f of fields){
  b.step();if(removed.has(f.id))continue;const replaced=replacements.get(f.id);if(replaced){output.push(replaced);continue;}
  // Resolve coincident insertions by occurrence ownership, not global
  // inclusive association: external empty mirrors must stay outside parents.
  let from=changes.mapPos(f.from,-1),to=changes.mapPos(f.to,-1);
  for(const e of edits){
   b.step();if(e.from!==e.to)continue;
   const preceding=e.root.sourceOrder<f.sourceOrder;
   if(e.from===f.from&&preceding)from+=e.insert.length;
   if(e.from===f.to&&(preceding||descendant(e.root,f,b)))to+=e.insert.length;
  }
  output.push({...f,from,to});
 }
 return {fields:output,changes};
}
/** Speculate over persistent Text; commit only the complete bounded plan. */
export function planNestedEdit(original:NestedField[],activeId:number,tr:Transaction,limits:Partial<Limits>={}):NestedPlan|null{
 try{
  const b=new Budget(limits);if(!tr.docChanged||tr.startState.selection.ranges.length!==1||tr.newSelection.ranges.length!==1)throw new Refused();
  const initial=indexFields(original,tr.startState.doc.length,b),active=initial.byId.get(activeId),before=tr.startState.selection.main;
  if(!active||active.final||before.from<active.from||before.to>active.to)throw new Refused();
  const ranges:{from:number;to:number}[]=[];
  tr.changes.iterChangedRanges((from,to)=>{b.step();if(ranges.length>=32||from<active.from||to>active.to)throw new Refused();ranges.push({from,to});},true);
  const whole=ranges.length===1&&ranges[0].from===active.from&&ranges[0].to===active.to;
  if(!whole)for(const change of ranges)for(const child of initial.children.get(active.id)??[]){
   b.step();
   if(change.from===change.to?change.from>=child.from&&change.from<=child.to:child.from===child.to?change.from<=child.from&&change.to>=child.to:change.from<child.to&&change.to>child.from)throw new Refused();
  }
  const affected=new Set([active.group]),queue=[active.group];
  for(let i=0;i<queue.length;i++)for(const p of initial.parents.get(queue[i])??[]){b.step();if(!affected.has(p)){affected.add(p);queue.push(p);}}
  let fields:NestedField[]=[];
  for(const f of original){
   b.step();if(whole&&descendant(f,active,b))continue;
   if(f.id===active.id||descendant(active,f,b))fields.push({...f,from:tr.changes.mapPos(f.from,-1),to:tr.changes.mapPos(f.to,1)});
   else if(f.from===f.to){const pos=tr.changes.mapPos(f.from,f.sourceOrder<active.sourceOrder?-1:1);fields.push({...f,from:pos,to:pos});}
   else fields.push({...f,from:tr.changes.mapPos(f.from,1),to:tr.changes.mapPos(f.to,-1)});
  }
  const source=fields.find(f=>f.id===activeId)!;
  if(tr.newSelection.main.from<source.from||tr.newSelection.main.to>source.to)throw new Refused();
  const anchor=tr.newSelection.main.anchor-source.from,head=tr.newSelection.main.head-source.from;
  let doc=tr.newDoc,combined=ChangeSet.empty(doc.length);
  for(const group of initial.order.filter(g=>affected.has(g))){
   b.step();const stage=copyGroup(fields,doc,group,activeId,b);fields=stage.fields;doc=stage.changes.apply(doc);combined=combined.compose(stage.changes);
  }
  const final=indexFields(fields,doc.length,b);isomorphic(final,b);
  const current=final.byId.get(activeId);if(!current||Math.max(anchor,head)>current.to-current.from)throw new Refused();
  return {changes:combined,fields,selection:EditorSelection.single(current.from+anchor,current.from+head)};
 }catch(error){if(error instanceof Refused)return null;throw error;}
}
