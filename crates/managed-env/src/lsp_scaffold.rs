//! Fixed virtual definitions for LeetCode's implicit judge types.
use serde_json::Value;
#[derive(Clone,Default)]
pub struct Context { enabled:bool, solution:bool, list:bool, tree:bool }
impl Context {
    pub fn parse(metadata:Option<&str>)->Result<Self,String>{
        let Some(raw)=metadata else{return Ok(Self::default());};
        if raw.len()>65536{return Err("题目类型信息超过 64 KiB 限制".into());}
        if raw.trim().is_empty(){return Ok(Self::default());}
        let value:Value=serde_json::from_str(raw).map_err(|_|"题目类型信息不是有效 JSON")?;
        if !value.is_object(){return Err("题目类型信息必须是对象".into());}
        let Some(params)=value.get("params").and_then(Value::as_array)else{return Ok(Self::default());};
        if params.len()>128{return Err("题目参数数量过多".into());}
        let mut result=Self{enabled:true,solution:value["inkleetFunctionStyle"]!="free",..Self::default()};
        for entry in params.iter().chain(value.get("return")){
            if let Some(kind)=entry.get("type").and_then(Value::as_str){
                for token in kind.split(|c:char|!c.is_ascii_alphanumeric()&&c!='_'){
                    if token=="ListNode"{result.list=true;}
                    if token=="TreeNode"{result.tree=true;}
                }
            }
        }
        Ok(result)
    }
    /// Python's future imports must remain before ordinary imports. Move only
    /// leading future statements into the virtual prefix, leaving blank source
    /// lines behind so diagnostics still map to the owner's original positions.
    pub fn python_source(&self,source:&str)->Option<(String,u32)>{
        if !self.enabled{return None;}
        let (future,body)=python_futures(source);
        let mut prefix=future;
        prefix.push_str(PYTHON_PUBLIC_PRELUDE);
        // Python allows user classes to shadow imported/default judge names.
        // These are isolated type-checker declarations, never saved or executed.
        if self.list{prefix.push_str("class ListNode:\n    def __init__(self, val: int = 0, next: Optional['ListNode'] = None):\n        self.val: int = val\n        self.next: Optional['ListNode'] = next\n");}
        if self.tree{prefix.push_str("class TreeNode:\n    def __init__(self, val: int = 0, left: Optional['TreeNode'] = None, right: Optional['TreeNode'] = None):\n        self.val: int = val\n        self.left: Optional['TreeNode'] = left\n        self.right: Optional['TreeNode'] = right\n");}
        let lines=prefix.lines().count() as u32;
        Some((prefix+&body,lines))
    }
    /// Only fixed snippets are injected: metadata is never interpolated as code.
    pub fn fragments(&self,language:&str,source:&str)->(String,String){
        if !self.enabled{return (String::new(),String::new());}
        let tokens=tokens(source);
        let list=self.list&&!declares_for(&tokens,"ListNode",language);
        let tree=self.tree&&!declares_for(&tokens,"TreeNode",language);
        let mut before=String::new();let mut after=String::new();
        match language{
            "rust"=>{
                if self.solution&&!declares(&tokens,"Solution"){after.push_str("\npub struct Solution;\n");}
                if list{after.push('\n');after.push_str(crate::rust_harness::LIST_TYPES);}
                if tree{after.push('\n');after.push_str(crate::rust_harness::TREE_TYPES);}
            },
            "java"=>{
                // Explicit package programs retain their authored import section.
                if !tokens.iter().any(|t|t=="package"){before.push_str(JAVA_IMPORTS);}
                if list{after.push_str("\nclass ListNode { int val; ListNode next; ListNode(){} ListNode(int val){this.val=val;} ListNode(int val,ListNode next){this.val=val;this.next=next;} }\n");}
                if tree{after.push_str("\nclass TreeNode { int val; TreeNode left,right; TreeNode(){} TreeNode(int val){this.val=val;} TreeNode(int val,TreeNode left,TreeNode right){this.val=val;this.left=left;this.right=right;} }\n");}
            },
            "golang"=>{
                if list{after.push_str("\ntype ListNode struct { Val int; Next *ListNode }\n");}
                if tree{after.push_str("\ntype TreeNode struct { Val int; Left, Right *TreeNode }\n");}
            },
            "cpp"=>{
                if list{before.push_str("struct ListNode { int val; ListNode* next; ListNode():val(0),next(nullptr){} ListNode(int x):val(x),next(nullptr){} ListNode(int x,ListNode* p):val(x),next(p){} };\n");}
                if tree{before.push_str("struct TreeNode { int val; TreeNode *left,*right; TreeNode():val(0),left(nullptr),right(nullptr){} TreeNode(int x):val(x),left(nullptr),right(nullptr){} TreeNode(int x,TreeNode* l,TreeNode* r):val(x),left(l),right(r){} };\n");}
            },
            "c"=>{
                if list{before.push_str("struct ListNode { int val; struct ListNode* next; };\n");}
                if tree{before.push_str("struct TreeNode { int val; struct TreeNode *left,*right; };\n");}
            },
            _=>{},
        }
        (before,after)
    }
}
pub(crate) const JAVA_IMPORTS:&str="import java.util.*;\nimport java.math.*;\nimport java.io.*;\n";
pub(crate) fn java_package(source:&str)->bool{tokens(source).iter().any(|token|token=="package")}
fn declares_for(tokens:&[String],name:&str,language:&str)->bool{
    if !matches!(language,"c"|"cpp"){return declares(tokens,name);}
    let mut depth=0usize;
    for (i,token) in tokens.iter().enumerate(){
        if depth==0 && matches!(token.as_str(),"struct"|"class"|"union"|"enum") && tokens.get(i+1).is_some_and(|t|t==name){
            // A tag reference in a function signature is not a definition.
            let mut next=i+2;
            if tokens.get(next).is_some_and(|t|t=="final"){next+=1;}
            if tokens.get(next).is_some_and(|t|t=="{"){return true;}
            if language=="cpp" && tokens.get(next).is_some_and(|t|t==":"){
                for value in &tokens[next+1..]{
                    if value=="{"{return true;}
                    if matches!(value.as_str(),";"|"("|")"|"*"){break;}
                }
            }
        }
        if token=="{"{depth+=1;}else if token=="}"{depth=depth.saturating_sub(1);}
    }false
}
fn declares(tokens:&[String],name:&str)->bool{
    let mut depth=0usize;
    for (i,token) in tokens.iter().enumerate(){
        if depth==0&&matches!(token.as_str(),"struct"|"enum"|"union"|"type"|"class"|"record")&&tokens.get(i+1).is_some_and(|v|v==name){return true;}
        if token=="{"{depth+=1;}else if token=="}"{depth=depth.saturating_sub(1);}
    }
    false
}
/// Lexical scan ignores comments, raw/escaped strings and nested declarations.
/// It is deliberately not a language parser; it only prevents duplicate helpers.
fn tokens(source:&str)->Vec<String>{
    let b=source.as_bytes();let mut i=0;let mut out=Vec::new();
    while i<b.len(){
        if b[i..].starts_with(b"//"){while i<b.len()&&b[i]!=b'\n'{i+=1;}continue;}
        if b[i..].starts_with(b"/*"){
            i+=2;let mut depth=1;
            while i<b.len()&&depth>0{
                if b[i..].starts_with(b"/*"){depth+=1;i+=2;}
                else if b[i..].starts_with(b"*/"){depth-=1;i+=2;}
                else{i+=1;}
            }continue;
        }
        let raw=if b[i]==b'r'{Some(i+1)}else if b[i..].starts_with(b"br"){Some(i+2)}else{None};
        if let Some(start)=raw{
            let mut quote=start;
            while quote<b.len()&&b[quote]==b'#'{quote+=1;}
            if quote<b.len()&&b[quote]==b'"'{
                let hashes=quote-start;i=quote+1;
                while i<b.len(){
                    if b[i]==b'"'&&i+1+hashes<=b.len()&&b[i+1..i+1+hashes].iter().all(|v|*v==b'#'){i+=1+hashes;break;}
                    i+=1;
                }continue;
            }
        }
        if b[i..].starts_with(b"\"\"\""){
            i+=3;
            while i<b.len(){if b[i]==b'\\'{i=(i+2).min(b.len());}else if b[i..].starts_with(b"\"\"\""){i+=3;break;}else{i+=1;}}
            continue;
        }
        let quote=b[i];
        let character=quote==b'\'' && {
            let mut end=i+1;
            if end<b.len()&&b[end]==b'\\'{end=(end+2).min(b.len());}
            else{while end<b.len()&&(end==i+1||b[end]&0xc0==0x80){end+=1;}}
            end<b.len()&&b[end]==b'\''
        };
        if quote==b'"'||quote==96||character{
            i+=1;while i<b.len(){if b[i]==quote{i+=1;break;}if b[i]==b'\\'&&quote!=96{i=(i+2).min(b.len());}else{i+=1;}}continue;
        }
        if b[i].is_ascii_alphabetic()||b[i]==b'_'{
            let start=i;i+=1;while i<b.len()&&(b[i].is_ascii_alphanumeric()||b[i]==b'_'){i+=1;}
            out.push(source[start..i].to_owned());
        }else{if matches!(b[i],b'{'|b'}'|b':'|b';'|b'('|b')'|b'*'){out.push((b[i] as char).to_string());}i+=1;}
    }
    out
}
#[cfg(test)]mod tests{
    use super::*;
    fn context()->Context{Context::parse(Some(r#"{"name":"f","params":[{"type":"ListNode[]"},{"type":"TreeNode"}],"return":{"type":"integer"}}"#)).unwrap()}
    #[test]fn only_fixed_snippets_come_from_bounded_metadata(){
        assert!(Context::parse(Some("[]")).is_err());assert!(Context::parse(Some(&" ".repeat(65537))).is_err());
        assert!(!Context::parse(Some(r#"{"params":[{"type":"ListNodeMalicious"}]}"#)).unwrap().list);
        let c=Context::parse(Some(r#"{"params":[{"type":"ListNode; panic!()"}]}"#)).unwrap();
        let (prefix,suffix)=c.fragments("rust","");assert!(!format!("{prefix}{suffix}").contains("panic!"));
    }
    #[test]fn comments_and_literals_are_not_user_definitions(){
        let c=context();
        let src=r####"// struct Solution;
/* nested /* struct ListNode {} */ class TreeNode {} */
const S:&str=r###"struct Solution; struct ListNode {}"###;
impl Solution { fn f<'a>(v:&'a str) {} }
"####;
        let (_,suffix)=c.fragments("rust",src);
        assert!(suffix.contains("struct Solution;"));assert!(suffix.contains("struct ListNode"));assert!(suffix.contains("struct TreeNode"));
        let java="class Solution { String fake=\"class ListNode {}\"; }";
        assert!(c.fragments("java",java).1.contains("class ListNode"));
    }
    #[test]fn real_top_level_definitions_are_not_duplicated(){
        let c=context();
        assert!(c.fragments("rust","pub struct Solution; pub struct ListNode{} pub struct TreeNode{}").1.is_empty());
        assert!(c.fragments("java","class ListNode {} class TreeNode {}").1.is_empty());
        assert!(c.fragments("golang","type ListNode struct{}; type TreeNode struct{}").1.is_empty());
        assert!(c.fragments("cpp","struct ListNode {}; struct TreeNode {};").0.is_empty());
        assert!(c.fragments("c","struct ListNode {}; struct TreeNode {};").0.is_empty());
        assert!(c.fragments("rust","fn f(){struct Solution;}").1.contains("struct Solution;"));
    }
    #[test]fn java_package_and_free_rust_are_preserved(){
        assert!(context().fragments("java","package foo; class Solution{}").0.is_empty());
        let c=Context::parse(Some(r#"{"inkleetFunctionStyle":"free","params":[]}"#)).unwrap();
        assert!(c.fragments("rust","fn solve(){}").1.is_empty());
    }
}

/// Return logical statement boundaries, respecting Python strings, brackets,
/// comments and line continuations. No Python interpreter or user code runs.
fn python_statement(bytes:&[u8],start:usize)->usize{
    let mut i=start;let mut depth=0usize;
    while i<bytes.len(){
        if bytes[i]==b'#'{while i<bytes.len()&&bytes[i]!=b'\n'{i+=1;}continue;}
        if bytes[i]==b'\''||bytes[i]==b'"'{
            let quote=bytes[i];let triple=bytes.get(i..i+3).is_some_and(|v|v==[quote,quote,quote]);i+=if triple{3}else{1};
            while i<bytes.len(){
                if bytes[i]==b'\\'{i=(i+2).min(bytes.len());}
                else if triple&&bytes.get(i..i+3).is_some_and(|v|v==[quote,quote,quote]){i+=3;break;}
                else if !triple&&bytes[i]==quote{i+=1;break;}
                else{i+=1;}
            }
            continue;
        }
        match bytes[i]{
            b'('|b'['|b'{'=>depth+=1,
            b')'|b']'|b'}'=>depth=depth.saturating_sub(1),
            b'\\' if bytes.get(i+1)==Some(&b'\n')=>{i+=2;continue;},
            b'\\' if bytes.get(i+1..i+3)==Some(b"\r\n")=>{i+=3;continue;},
            b'\n' if depth==0=>return i+1,
            _=>{},
        }i+=1;
    }
    i
}
fn python_futures(source:&str)->(String,String){
    let mut prefix=String::new();let mut body=source.to_owned();let mut ranges=Vec::new();
    let mut start=0;let mut may_docstring=true;
    while start<source.len(){
        let end=python_statement(source.as_bytes(),start);let statement=&source[start..end];
        let trimmed=statement.trim_start_matches('\u{feff}').trim();
        if trimmed.is_empty()||trimmed.starts_with('#'){start=end;continue;}
        let docstring=trimmed.starts_with('"')||trimmed.starts_with('\'')||["r\"","r'","u\"","u'","R\"","R'","U\"","U'"].iter().any(|s|trimmed.starts_with(s));
        if may_docstring&&docstring{may_docstring=false;start=end;continue;}
        may_docstring=false;
        let words=trimmed.split(|c:char|!c.is_ascii_alphanumeric()&&c!='_').filter(|v|!v.is_empty()).take(3).collect::<Vec<_>>();
        if words!=["from","__future__","import"]{break;}
        // Semicolon compound statements are kept intact and unsupported here;
        // moving other executable code would hide real errors.
        if statement.contains(';'){break;}
        prefix.push_str(statement);if !statement.ends_with('\n'){prefix.push('\n');}
        ranges.push((start,end));start=end;
    }
    for (start,end) in ranges.into_iter().rev(){
        let blank=source[start..end].chars().map(|c|if c=='\r'||c=='\n'{c}else{' '}).collect::<String>();
        body.replace_range(start..end,&blank);
    }
    if body.starts_with('\u{feff}'){body.replace_range(..3," ");}
    (prefix,body)
}
#[cfg(test)]mod python_tests{
    use super::*;
    fn context()->Context{Context::parse(Some(r#"{"params":[{"type":"ListNode"},{"type":"TreeNode"}]}"#)).unwrap()}
    #[test]fn python_future_imports_and_line_positions_are_preserved(){
        let src="# coding: utf-8\n\"\"\"module 文档\"\"\"\nfrom __future__ import (\n    annotations,\n)\nclass Solution:\n    def f(self, head: Optional[ListNode]) -> Optional[TreeNode]:\n        return None\n";
        let (wrapped,prefix)=context().python_source(src).unwrap();
        assert!(wrapped.starts_with("from __future__ import (\n"));
        let lines=wrapped.lines().skip(prefix as usize).collect::<Vec<_>>();
        assert_eq!(lines.len(),src.lines().count());assert_eq!(lines[5],"class Solution:");
        assert_eq!(lines[6],src.lines().nth(6).unwrap());assert!(lines[2].trim().is_empty());
        assert!(wrapped.contains("self.next: Optional['ListNode']"));
    }
    #[test]fn ordinary_programs_are_not_reordered(){
        let src="x=1\nfrom __future__ import annotations\n";
        let (future,body)=python_futures(src);assert!(future.is_empty());assert_eq!(body,src);
        let src="from __future__ import annotations; x=1\n";
        let (future,body)=python_futures(src);assert!(future.is_empty());assert_eq!(body,src);
        assert!(Context::default().python_source("x=1").is_none());
    }
}

#[cfg(test)]mod c_definition_contract_tests{
 use super::*;
 #[test]fn official_c_node_signature_is_not_a_type_definition(){
  let c=Context::parse(Some(r#"{"name":"reverseList","params":[{"type":"ListNode"}],"return":{"type":"ListNode"}}"#)).unwrap();
  for source in [
   "struct ListNode* reverseList(struct ListNode* head){return head->next;}",
   "struct ListNode; struct ListNode* reverseList(struct ListNode* head){return head;}",
   "/* struct ListNode { int val; }; */ struct ListNode* reverseList(struct ListNode* head){return head;}"
  ]{assert!(c.fragments("c",source).0.contains("struct ListNode {"));}
  assert!(c.fragments("c","struct ListNode {int val;struct ListNode* next;};").0.is_empty());
  assert!(c.fragments("cpp","struct ListNode final {int val;};").0.is_empty());
 }
}

// Supported public judge conveniences. Module bindings deliberately come last,
// matching runtime namespace precedence; incidental dir() exports are not an API.
pub const PYTHON_PUBLIC_PRELUDE:&str="from typing import *\nfrom collections import *\nfrom heapq import *\nfrom itertools import *\nfrom math import *\nfrom functools import *\nfrom bisect import *\nimport collections, heapq, itertools, math, functools, bisect, random, statistics, operator, re, string\n";

#[cfg(test)]mod python_import_contract_tests{
    use super::*;
    #[test]fn imports_are_virtual_and_counted_without_rewriting_source(){
        let source="items = deque([1])\ncount = Counter(items)\n";
        let c=Context::parse(Some(r#"{"params":[]}"#)).unwrap();
        let (wrapped,prefix)=c.python_source(source).unwrap();
        assert_eq!(wrapped,format!("{PYTHON_PUBLIC_PRELUDE}{source}"));
        assert_eq!(prefix,PYTHON_PUBLIC_PRELUDE.lines().count() as u32);
        assert!(PYTHON_PUBLIC_PRELUDE.find("from bisect import").unwrap()<PYTHON_PUBLIC_PRELUDE.find("import collections,").unwrap());
    }
}
