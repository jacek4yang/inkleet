//! Bounded LSP semantic-token normalization for the editable document only.
use serde_json::{json,Value};
pub const TYPES:&[&str]=&["namespace","type","class","enum","interface","struct","typeParameter","parameter","variable","property","enumMember","event","function","method","macro","keyword","modifier","comment","string","number","regexp","operator","decorator"];
pub const MODIFIERS:&[&str]=&["declaration","definition","readonly","static","deprecated","abstract","async","modification","documentation","defaultLibrary"];
pub fn provider(capabilities:&Value)->Option<Value>{
    let p=&capabilities["semanticTokensProvider"];
    if !(p["full"]==true||p["full"].is_object()){return None}
    let types=p["legend"]["tokenTypes"].as_array()?;
    let modifiers=p["legend"]["tokenModifiers"].as_array()?;
    if types.len()>256||modifiers.len()>31||types.iter().chain(modifiers).any(|v|v.as_str().is_none_or(|s|s.len()>128)){return None}
    Some(p["legend"].clone())
}
pub fn normalize(text:&str,prefix:u32,legend:&Value,response:&Value)->Result<Value,String>{
    if response.is_null(){return Ok(json!([]))}
    let data=response["data"].as_array().ok_or("语义标记格式无效")?;
    if data.len()%5!=0||data.len()>100_000{return Err("语义标记超过限制或格式无效".into())}
    let types=legend["tokenTypes"].as_array().ok_or("语义标记图例无效")?;
    let modifiers=legend["tokenModifiers"].as_array().ok_or("语义修饰符图例无效")?;
    let lines=text.split('\n').map(|l|l.strip_suffix('\r').unwrap_or(l)).collect::<Vec<_>>();
    // Construct each line's UTF-16 boundary bitmap once, never rescan per token.
    let bounds=lines.iter().map(|s|{
        let mut b=vec![true];
        for c in s.chars(){if c.len_utf16()==2{b.push(false)}b.push(true);}
        b
    }).collect::<Vec<_>>();
    let mut line=0u32;let mut start=0u32;let mut previous:Option<(u32,u32)>=None;let mut output=Vec::new();
    for tuple in data.chunks_exact(5){
        let mut n=[0u32;5];
        for (i,value) in tuple.iter().enumerate(){n[i]=value.as_u64().filter(|n|*n<=i32::MAX as u64).ok_or("语义标记整数无效")? as u32;}
        line=line.checked_add(n[0]).ok_or("语义行号溢出")?;
        start=if n[0]==0{start.checked_add(n[1]).ok_or("语义列号溢出")?}else{n[1]};
        let end=start.checked_add(n[2]).ok_or("语义长度溢出")?;
        if n[2]==0{return Err("语义标记长度为零".into())}
        let kind=types.get(n[3] as usize).and_then(Value::as_str).ok_or("语义类型索引无效")?;
        if modifiers.len()<31&&n[4]>>modifiers.len()!=0{return Err("语义修饰符索引无效".into())}
        if previous.is_some_and(|(l,e)|line<l||(line==l&&start<e)){return Err("语义标记重叠".into())}
        previous=Some((line,end));
        let Some(local)=line.checked_sub(prefix)else{continue};
        let Some(boundaries)=bounds.get(local as usize)else{continue};
        let length=boundaries.len()-1;
        if start as usize>=length{continue}
        let end=(end as usize).min(length);
        if !boundaries[start as usize]||!boundaries[end]{return Err("语义标记拆分 Unicode 字符".into())}
        if !TYPES.contains(&kind){continue}
        let flags=modifiers.iter().enumerate().filter_map(|(i,m)|if n[4]&(1<<i)!=0{m.as_str().filter(|m|MODIFIERS.contains(m))}else{None}).collect::<Vec<_>>();
        output.push(json!({"line":local,"start":start,"end":end,"kind":kind,"modifiers":flags}));
    }
    Ok(json!(output))
}
#[cfg(test)]mod tests{
    use super::*;
    fn legend()->Value{json!({"tokenTypes":["function","variable","custom"],"tokenModifiers":["readonly"]})}
    #[test]fn relative_prefix_suffix_and_custom(){
        let r=json!({"data":[0,0,3,1,0, 1,0,1,0,0, 0,2,1,1,1, 0,2,1,2,0, 1,0,3,0,0]});
        let tokens=normalize("f x y",1,&legend(),&r).unwrap();
        assert_eq!(tokens.as_array().unwrap().len(),2);
        assert_eq!(tokens[0]["kind"],"function");assert_eq!(tokens[1]["start"],2);assert_eq!(tokens[1]["modifiers"][0],"readonly");
    }
    #[test]fn unicode_crlf_and_clamping(){
        assert!(normalize("😀foo\r\n",0,&legend(),&json!({"data":[0,1,2,0,0]})).is_err());
        assert!(normalize("😀foo",0,&legend(),&json!({"data":[0,0,1,0,0]})).is_err());
        let t=normalize("😀foo\r\n",0,&legend(),&json!({"data":[0,2,99,0,0]})).unwrap();assert_eq!(t[0]["end"],5);
    }
    #[test]fn many_tokens_on_one_long_line(){
        let text="x ".repeat(20_000);let mut data=Vec::new();
        for i in 0..20_000{data.extend([0,if i==0{0}else{2},1,0,0]);}
        assert_eq!(normalize(&text,0,&legend(),&json!({"data":data})).unwrap().as_array().unwrap().len(),20_000);
    }
    #[test]fn malformed_and_overlap(){
        for data in [json!([0]),json!([0,0,0,0,0]),json!([-1,0,1,0,0]),json!([0,0,1,9,0]),json!([0,0,1,0,2]),json!([0,0,2,0,0,0,1,1,0,0])]{
            assert!(normalize("abc",0,&legend(),&json!({"data":data})).is_err());
        }
        assert_eq!(normalize("",0,&legend(),&Value::Null).unwrap(),json!([]));
    }
    #[test]fn capability_gate(){
        assert!(provider(&json!({})).is_none());
        assert!(provider(&json!({"semanticTokensProvider":{"range":true,"legend":legend()}})).is_none());
        assert!(provider(&json!({"semanticTokensProvider":{"full":true,"legend":legend()}})).is_some());
    }
}
