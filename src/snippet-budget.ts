export class SnippetLimitError extends Error {
 constructor(message:string){super(message);this.name="SnippetLimitError";}
}
export const snippetLimits=Object.freeze({source:65536,nodes:8192,depth:64,work:1048576,copies:1048576,output:65536,occurrences:512,groups:128,choices:128,pattern:4096,transforms:64});
export class SnippetBudget {
 private nodes=0;private depth=0;private work=0;private copies=0;private choices=0;private transforms=0;
 step(amount=1){this.work+=amount;if(this.work>snippetLimits.work)throw new SnippetLimitError("Snippet work limit");}
 node(){this.step();if(++this.nodes>snippetLimits.nodes)throw new SnippetLimitError("Snippet node limit");}
 copy(length:number){this.copies+=length;this.step();if(this.copies>snippetLimits.copies)throw new SnippetLimitError("Snippet copy limit");}
 nested<T>(fn:()=>T):T{if(++this.depth>snippetLimits.depth){--this.depth;throw new SnippetLimitError("Snippet depth limit");}try{return fn();}finally{--this.depth;}}
 depthAt(depth:number){if(depth>snippetLimits.depth)throw new SnippetLimitError("Expanded snippet depth limit");}
 choice(){if(++this.choices>snippetLimits.choices)throw new SnippetLimitError("Snippet choice limit");}
 transform(){if(++this.transforms>snippetLimits.transforms)throw new SnippetLimitError("Snippet transform limit");}
 index(index:number){if(!Number.isSafeInteger(index)||index<0)throw new SnippetLimitError("Unsafe snippet index");}
 source(value:string){if(typeof value!=="string"||value.length>snippetLimits.source)throw new SnippetLimitError("Snippet source limit");this.copy(value.length);}
}
export const snippetParserIdentity="vscode:c2c46e750ab7afe355bad8bea20a248520adfdb0/inkleet-bounded-v1";
