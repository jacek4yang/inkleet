//! Compile official-style Java Solution classes with bounded typed test drivers.
use serde_json::Value;
use std::{fs,path::Path};
const SUPPORT:&str=include_str!("java_harness_support.java");
fn ty(kind:&str)->Result<String,String>{
    if let Some(inner)=kind.strip_suffix("[]"){return Ok(format!("{}[]",ty(inner)?));}
    if let Some(inner)=kind.strip_prefix("list<").and_then(|s|s.strip_suffix('>')){return Ok(format!("java.util.List<{}>",boxed(inner)?));}
    Ok(match kind{"integer"=>"int","long"=>"long","double"=>"double","boolean"=>"boolean","string"=>"String","character"=>"char","ListNode"=>"ListNode","TreeNode"=>"TreeNode","void"=>"void",_=>return Err("此 Java 类型尚未支持".into())}.into())
}
fn boxed(kind:&str)->Result<String,String>{Ok(match kind{"integer"=>"Integer".into(),"long"=>"Long".into(),"double"=>"Double".into(),"boolean"=>"Boolean".into(),"character"=>"Character".into(),_=>ty(kind)?})}
fn literal(value:&Value,kind:&str,budget:&mut usize)->Result<String,String>{
    *budget=budget.checked_sub(1).ok_or("Java 输入超过节点限制")?;
    if let Some(inner)=kind.strip_suffix("[]"){
        let values=value.as_array().ok_or("Java 数组必须为 JSON 数组")?;
        return Ok(format!("new {}{{{}}}",ty(kind)?,values.iter().map(|v|literal(v,inner,budget)).collect::<Result<Vec<_>,_>>()?.join(",")));
    }
    Ok(match kind{
        "integer"=>i32::try_from(value.as_i64().ok_or("Java int 必须为整数")?).map_err(|_|"Java int 超出范围")?.to_string(),
        "long"=>{let n=value.as_i64().ok_or("Java long 超出范围")?;if n==i64::MIN{"Long.MIN_VALUE".into()}else{format!("{n}L")}},
        "double"=>{let n=value.as_f64().filter(|v|v.is_finite()).ok_or("Java double 必须为有限数字")?;format!("{n:?}d")},
        "boolean"=>value.as_bool().ok_or("Java boolean 必须为布尔值")?.to_string(),
        "string"=>{let s=value.as_str().ok_or("Java string 必须为字符串")?;format!("new String(new char[]{{{}}})",s.encode_utf16().map(|c|format!("(char)0x{c:04x}")).collect::<Vec<_>>().join(","))},
        "character"=>{let s=value.as_str().ok_or("Java char 必须为字符")?;let mut units=s.encode_utf16();let c=units.next().ok_or("Java char 不能为空")?;if units.next().is_some(){return Err("Java char 只支持一个 UTF-16 单元".into());}format!("(char)0x{c:04x}")},
        "ListNode"|"TreeNode"=>{
            if value.is_null(){return Ok("null".into());}
            let nodes=value.as_array().ok_or("Java 节点必须为 JSON 数组")?;let mut values=Vec::new();let mut available=1usize;
            for node in nodes{
                if kind=="TreeNode"{if available==0{return Err("树存在无法连接的节点".into());}available-=1;if node.is_null(){values.push("null".into());continue;}available+=2;}
                values.push(literal(node,"integer",budget)?);
            }
            format!("InkLeetHarness.{}(new {}[]{{{}}})",if kind=="ListNode"{"list"}else{"tree"},if kind=="ListNode"{"int"}else{"Integer"},values.join(","))
        },
        _=>return Err("此 Java 参数类型尚未支持".into())
    })
}
pub fn prepare(root:&Path,source:&str,metadata:&str,input:&str)->Result<(),String>{
    if source.len()>2*1024*1024{return Err("Java 源码超过 2 MiB".into());}
    if crate::lsp_scaffold::java_package(source){return Err("本地 Java 暂不支持自定义 package；源码未改动，可使用在线运行".into());}
    let config=crate::harness::configuration(metadata,input)?;
    let name=config["metadata"]["name"].as_str().ok_or("Java 函数名缺失")?;
    let params=config["metadata"]["params"].as_array().ok_or("Java 参数缺失")?;
    let returned=config["metadata"]["return"]["type"].as_str().ok_or("Java 返回类型缺失")?;
    let _returned_type=ty(returned)?;
    let metadata_text=config["metadata"].to_string();let list=metadata_text.contains("ListNode");let tree=metadata_text.contains("TreeNode");
    let (_,nodes)=crate::lsp_scaffold::Context::parse(Some(metadata))?.fragments("java",source);
    let mut helpers=String::new();let mut writers=String::new();
    if list{
        helpers+="static ListNode list(int[] values){ListNode head=null;for(int i=values.length-1;i>=0;i--)head=new ListNode(values[i],head);return head;}\n";
        writers+=r#"if(value instanceof ListNode head){push("[");Set<ListNode> visited=Collections.newSetFromMap(new IdentityHashMap<>());int i=0;for(ListNode n=head;n!=null;n=n.next){if(!visited.add(n))throw new IllegalArgumentException("cyclic list");if(i++>0)push(",");write(n.val);}push("]");return true;}"#;
    }
    if tree{
        helpers+="static TreeNode tree(Integer[] values){if(values.length==0||values[0]==null)return null;TreeNode root=new TreeNode(values[0]);java.util.ArrayDeque<TreeNode> queue=new java.util.ArrayDeque<>();queue.add(root);int i=1;while(!queue.isEmpty()&&i<values.length){TreeNode node=queue.remove();if(values[i]!=null){node.left=new TreeNode(values[i]);queue.add(node.left);}i++;if(i<values.length){if(values[i]!=null){node.right=new TreeNode(values[i]);queue.add(node.right);}i++;}}return root;}\n";
        writers+=r#"if(value instanceof TreeNode root){java.util.LinkedList<TreeNode> queue=new java.util.LinkedList<>();queue.add(root);List<Integer> values=new ArrayList<>();Set<TreeNode> visited=Collections.newSetFromMap(new IdentityHashMap<>());while(!queue.isEmpty()){TreeNode n=queue.remove();if(n==null){values.add(null);continue;}if(!visited.add(n))throw new IllegalArgumentException("cyclic or shared tree");if(visited.size()>10000)throw new IllegalArgumentException("tree exceeds limit");values.add(n.val);queue.add(n.left);queue.add(n.right);}while(!values.isEmpty()&&values.get(values.size()-1)==null)values.remove(values.size()-1);write(values);return true;}"#;
    }
    let mut driver=format!("public final class InkLeetHarness{{\n{helpers}\npublic static void main(String[] args)throws Exception{{try(InkLeetJson.Sink sink=new InkLeetJson.Sink()){{\n");
    for (index,case) in config["cases"].as_array().ok_or("Java 用例缺失")?.iter().enumerate(){
        let values=case.as_array().ok_or("Java 用例无效")?;let mut budget=10000;let mut args=Vec::new();driver+="try{\n";
        for (i,param) in params.iter().enumerate(){let kind=param["type"].as_str().ok_or("Java 参数类型缺失")?;driver+=&format!("{} arg{i}={};\n",ty(kind)?,literal(&values[i],kind,&mut budget)?);args.push(format!("arg{i}"));}
        let call=format!("new Solution().{name}({})",args.join(","));
        if returned=="void"{driver+=&format!("{call};Object result=null;\n");}else{driver+=&format!("Object result={call};\n");}
        driver+=&format!("InkLeetJson w=new InkLeetJson();w.push(\"{{\\\"case\\\":{},\\\"ok\\\":true,\\\"value\\\":\");w.write(result);\n",index+1);
        if returned=="void"{driver+=&format!("w.push(\",\\\"argumentsAfterCall\\\":\");w.write(new Object[]{{{}}});\n",args.join(","));}
        driver+=&format!("w.push(\"}}\");sink.emit(w.text.toString());\n}}catch(Throwable error){{sink.failure({},error);}}\n",index+1);
        if driver.len()>8*1024*1024{return Err("生成 Java 驱动超过 8 MiB".into());}
    }
    driver+="}}}\n";
    fs::write(root.join("original-snapshot.java"),source).map_err(|_|"无法写入原始 Java 快照")?;
    // Imports precede the first source line without a newline. Original source
    // line numbers remain valid for JDWP breakpoints (first-line columns differ).
    fs::write(root.join("Solution.java"),format!("{}{source}",crate::lsp_scaffold::JAVA_IMPORTS.replace('\n'," "))).map_err(|_|"无法写入 Java 编译单元")?;
    fs::write(root.join("InkLeetNodes.java"),nodes).map_err(|_|"无法写入 Java 节点类型")?;
    fs::write(root.join("InkLeetJson.java"),SUPPORT.replace("__NODE_WRITERS__",&writers)).map_err(|_|"无法写入 Java 序列化器")?;
    fs::write(root.join("InkLeetHarness.java"),driver).map_err(|_|"无法写入 Java 驱动")?;
    Ok(())
}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn java_literals_do_not_use_preprocessed_unicode_escapes(){
        let literal=literal(&serde_json::json!("中文\n\"\\u000a🦀"),"string",&mut 100).unwrap();
        assert!(!literal.contains("\\u"));assert!(literal.contains("(char)0x000a"));
        assert!(super::literal(&serde_json::json!("🦀"),"character",&mut 100).is_err());
        assert_eq!(ty("list<list<integer>>").unwrap(),"java.util.List<java.util.List<Integer>>");
    }
    #[test]fn original_java_snapshot_preserves_lines(){
        let root=tempfile::tempdir().unwrap();let source="// comment\nclass Solution{int f(int n){return n;}}";
        prepare(root.path(),source,r#"{"name":"f","params":[{"name":"n","type":"integer"}],"return":{"type":"integer"}}"#,"1").unwrap();
        assert_eq!(fs::read_to_string(root.path().join("original-snapshot.java")).unwrap(),source);
        assert_eq!(fs::read_to_string(root.path().join("Solution.java")).unwrap().lines().count(),source.lines().count());
    }
}

#[cfg(test)]mod official_return_contract_tests{
 use super::*;
 #[test]fn collection_results_are_not_forced_into_array_metadata_types(){
  let root=tempfile::tempdir().unwrap();
  let source="import java.util.List;\nclass Solution{public List<List<Integer>> threeSum(int[] nums){return List.of(List.of(-1,0,1));}}";
  prepare(root.path(),source,r#"{"name":"threeSum","params":[{"name":"nums","type":"integer[]"}],"return":{"type":"integer[][]"}}"#,"[-1,0,1]").unwrap();
  let driver=fs::read_to_string(root.path().join("InkLeetHarness.java")).unwrap();
  assert!(driver.contains("Object result=new Solution().threeSum(arg0);"));
  assert!(!driver.contains("int[][] result="));
  assert_eq!(fs::read_to_string(root.path().join("original-snapshot.java")).unwrap(),source);
 }
 #[test]fn package_is_rejected_before_generating_an_invalid_compilation_unit(){
  let root=tempfile::tempdir().unwrap();
  assert!(prepare(root.path(),"package sample; class Solution{}",r#"{"name":"f","params":[],"return":{"type":"integer"}}"#,"").unwrap_err().contains("package"));
  assert!(!root.path().join("Solution.java").exists());
 }
}
