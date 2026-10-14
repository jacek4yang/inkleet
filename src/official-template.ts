export type OfficialSnippet = Readonly<{langSlug:string;code:string}>;
/** Preserve the official source exactly; absence/ambiguity must not invent a template. */
export function officialTemplate(snippets:readonly OfficialSnippet[]|null|undefined,language:string):string|null{
 const matches=snippets?.filter(snippet=>snippet.langSlug===language)??[];
 return matches.length===1&&typeof matches[0].code==="string"&&matches[0].code.trim()?matches[0].code:null;
}
