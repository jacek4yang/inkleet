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
    /// Only fixed snippets are injected: metadata is never interpolated as code.
    pub fn fragments(&self,language:&str,source:&str)->(String,String){
        if !self.enabled{return (String::new(),String::new());}
        let tokens=tokens(source);
        let list=self.list&&!declares(&tokens,"ListNode");
        let tree=self.tree&&!declares(&tokens,"TreeNode");
        let mut before=String::new();let mut after=String::new();
        match language{
            "rust"=>{
                if self.solution&&!declares(&tokens,"Solution"){after.push_str("\npub struct Solution;\n");}
                if list{after.push('\n');after.push_str(crate::rust_harness::LIST_TYPES);}
                if tree{after.push('\n');after.push_str(crate::rust_harness::TREE_TYPES);}
            },
            "java"=>{
                // Explicit package programs retain their authored import section.
                if !tokens.iter().any(|t|t=="package"){before.push_str("import java.util.*;\nimport java.math.*;\n");}
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
        }else{if matches!(b[i],b'{'|b'}'){out.push((b[i] as char).to_string());}i+=1;}
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
