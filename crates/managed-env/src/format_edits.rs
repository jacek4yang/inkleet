//! Validate formatter edits against the exact user region, never virtual scaffolding.
use serde_json::Value;
type Result<T>=std::result::Result<T,String>;
fn offset(text:&str,position:&Value,prefix:u32)->Result<usize>{
    let line=position.get("line").and_then(Value::as_u64).ok_or("格式化行号无效")?;
    let line=line.checked_sub(u64::from(prefix)).ok_or("格式化试图修改虚拟前导代码")?;
    let column=position.get("character").and_then(Value::as_u64).ok_or("格式化列号无效")?;
    let mut base=0;
    for (index,value) in text.split('\n').enumerate(){
        if index as u64==line{
            let mut units=0u64;
            for (byte,ch) in value.char_indices(){
                if units==column{return Ok(base+byte);}
                units+=ch.len_utf16() as u64;
                if units>column{return Err("格式化切分了 UTF-16 字符".into());}
            }
            return if units==column{Ok(base+value.len())}else{Err("格式化列号越界".into())};
        }
        base+=value.len()+1;
    }
    Err("格式化试图修改虚拟尾部代码".into())
}
pub fn apply(text:&str,prefix:u32,value:&Value)->Result<String>{
    if text.len()>1024*1024{return Err("格式化源码超过 1 MiB 限制".into());}
    if value.is_null(){return Ok(text.to_owned());}
    let values=value.as_array().ok_or("格式化响应不是编辑列表")?;
    if values.len()>4096{return Err("格式化编辑数量超过限制".into());}
    let mut edits=Vec::new();let mut size=text.len();
    for value in values{
        let range=value.get("range").ok_or("缺少格式化范围")?;
        let from=offset(text,&range["start"],prefix)?; let to=offset(text,&range["end"],prefix)?;
        if from>to{return Err("格式化范围倒置".into());}
        let new=value.get("newText").and_then(Value::as_str).ok_or("格式化正文无效")?;
        size=size.checked_add(new.len()).ok_or("格式化正文过大")?;
        if size>2*1024*1024{return Err("格式化输出超过限制".into());}
        edits.push((from,to,new));
    }
    edits.sort_by_key(|e|(e.0,e.1));
    for pair in edits.windows(2){if pair[1].0<pair[0].1||pair[1].0==pair[0].0{return Err("格式化编辑相互重叠".into());}}
    let mut output=text.to_owned();
    for (from,to,new) in edits.into_iter().rev(){output.replace_range(from..to,new);}
    if output.len()>1024*1024{return Err("格式化输出超过 1 MiB 限制".into());}
    if !text.trim().is_empty()&&output.trim().is_empty(){return Err("格式化返回空正文".into());}
    Ok(crate::formatter::preserve_newlines(text,&output))
}
#[cfg(test)]mod tests{
    use super::*;use serde_json::json;
    fn edit(a:u32,b:u32,c:u32,d:u32,text:&str)->Value{json!({"range":{"start":{"line":a,"character":b},"end":{"line":c,"character":d}},"newText":text})}
    #[test]fn user_region_and_utf16_are_exact(){
        let source="class Solution{\nString x=\"😀\";\n}";
        assert_eq!(apply(source,10,&json!([edit(11,0,11,0,"    ")])).unwrap(),"class Solution{\n    String x=\"😀\";\n}");
        for bad in [edit(9,0,10,0,""),edit(13,0,13,0,""),edit(11,11,11,12,"x"),edit(11,99,11,99,"x")]{
            assert!(apply(source,10,&json!([bad])).is_err());
        }
    }
    #[test]fn any_invalid_edit_rejects_whole_result(){
        assert!(apply("abc",0,&json!([edit(0,0,0,2,"a"),edit(0,1,0,3,"b")])).is_err());
        assert!(apply("abc",0,&json!([edit(0,0,0,0,"a"),edit(0,0,0,0,"b")])).is_err());
        assert!(apply("abc",0,&json!([edit(0,0,0,3,"")])).is_err());
        assert_eq!(apply("abc",0,&Value::Null).unwrap(),"abc");
    }
    #[test]fn adjacent_edits_are_atomic(){
        assert_eq!(apply("ab",2,&json!([edit(2,0,2,1,"A"),edit(2,1,2,2,"B")])).unwrap(),"AB");
    }
}
