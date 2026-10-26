export type StatementLanguage = "zh" | "en";
export type ReadingPreferences = { fontSize:number; ratio:number; hidden:boolean; language:StatementLanguage };
export const readingDefaults:ReadingPreferences = {fontSize:14,ratio:44,hidden:false,language:"zh"};
export const readingStorageKey="inkleet.reading.v1";
export function bounded(value:unknown,fallback:number,min:number,max:number):number {
 return Math.max(min,Math.min(max,typeof value==="number"&&Number.isFinite(value)?value:fallback));
}
export function parseReadingPreferences(raw:string|null):ReadingPreferences {
 try {const value=JSON.parse(raw??"null");return {
  fontSize:Math.round(bounded(value?.fontSize,14,10,32)),ratio:bounded(value?.ratio,44,25,65),
  hidden:value?.hidden===true,language:value?.language==="en"?"en":"zh",
 };} catch {return {...readingDefaults};}
}
export function splitBounds(width:number) {
 if(!Number.isFinite(width)||width<550)return {min:44,max:44};
 return {min:Math.max(25,240/width*100),max:Math.min(65,(width-310)/width*100)};
}
export function statementVersion(question:{content:string|null;translatedContent:string|null;title:string;translatedTitle:string|null},language:StatementLanguage) {
 const requested=language==="zh"?question.translatedContent:question.content;
 const actual=requested?.trim()?language:language==="zh"?"en":"zh";
 return {language:actual, fallback:actual!==language,content:(actual==="zh"?question.translatedContent:question.content)??"",title:actual==="zh"?(question.translatedTitle||question.title):question.title};
}
/** Adjacent means the actual filtered list, never numeric IDs or pagination. */
export function adjacentQuestion<T extends {titleSlug:string;paidOnly:boolean}>(questions:readonly T[],slug:string|undefined,direction:-1|1):T|null {
 const index=questions.findIndex(q=>q.titleSlug===slug);
 if(index<0)return null;
 const next=questions[index+direction];return next&&!next.paidOnly?next:null;
}
