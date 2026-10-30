//! Immutable local-run provenance and named batch planning. No process starts here.
use crate::local_run::Snapshot;
use inkleet_managed_env::harness;
use serde::{Deserialize,Serialize};
use std::collections::HashSet;

#[derive(Clone,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Request{
    #[serde(flatten)] pub snapshot:Snapshot,
    #[serde(default)] pub mode:Option<String>,
    #[serde(default)] pub document_key:Option<String>,
    #[serde(default)] pub client_request_id:Option<String>,
    #[serde(default)] pub cases:Option<Vec<Case>>,
}
#[derive(Clone,Deserialize,Serialize,PartialEq)]
#[serde(rename_all="camelCase")]
pub struct Case{pub id:String,pub name:String,pub input:String,#[serde(default)]pub expectation:Option<Expectation>}
#[derive(Clone,Deserialize,Serialize,PartialEq)]
#[serde(rename_all="camelCase")]
pub struct Expectation{pub mode:String,pub target:Target,pub value:String,
    #[serde(default,skip_serializing_if="Option::is_none")]pub absolute_tolerance:Option<String>,
    #[serde(default,skip_serializing_if="Option::is_none")]pub relative_tolerance:Option<String>}
fn valid_tolerance(value:&Option<String>)->bool{
    let Some(text)=value else{return false;};
    if text.len()>64{return false;}
    let Ok(value)=serde_json::from_str::<serde_json::Value>(text) else{return false;};
    let token=value.to_string();
    let negative=token.starts_with('-')&&token.split(['e','E']).next().is_some_and(|s|s.bytes().any(|b|matches!(b,b'1'..=b'9')));
    !negative&&value.as_f64().is_some_and(|n|n.is_finite()&&n>=0.0)
}
#[derive(Clone,Copy,Deserialize,Serialize,PartialEq)]
#[serde(tag="kind",rename_all="camelCase")]
pub enum Target{Return,Argument{index:usize}}
#[derive(Clone,Serialize,PartialEq)]
#[serde(rename_all="camelCase")]
pub struct Invocation{pub case_index:usize,pub group_index:usize,pub case_number:usize}
#[derive(Clone,Serialize,PartialEq)]
#[serde(rename_all="camelCase")]
pub struct Record{
    pub mode:String,pub document_key:Option<String>,pub client_request_id:Option<String>,
    pub snapshot:Snapshot,pub cases:Vec<Case>,pub invocations:Vec<Invocation>,
}
impl Request{
    pub fn prepare(self)->Result<Record,String>{
        let mode=self.mode.unwrap_or_else(||"selected".into());
        if !matches!(mode.as_str(),"selected"|"all"|"failed"){return Err("运行模式无效".into());}
        if self.snapshot.code.len()>2*1024*1024||self.snapshot.title.len()>512{return Err("运行快照超过大小限制".into());}
        if self.document_key.as_ref().is_some_and(|s|s.is_empty()||s.len()>4096)||
           self.client_request_id.as_ref().is_some_and(|s|s.is_empty()||s.len()>80)||
           (self.client_request_id.is_some()&&self.document_key.is_none()){
            return Err("运行身份无效".into());
        }
        let cases=match self.cases{
            Some(cases)=>cases,
            None=>vec![Case{id:"selected".into(),name:"用例".into(),input:self.snapshot.input.clone(),expectation:None}],
        };
        if cases.is_empty()||cases.len()>64{return Err("请选择 1–64 个测试用例".into());}
        let mut ids=HashSet::new();let mut combined=String::new();let mut invocations=Vec::new();let mut total=0usize;
        for (case_index,case) in cases.iter().enumerate(){
            if case.id.is_empty()||case.id.chars().count()>80||!ids.insert(&case.id)||case.name.trim().is_empty()||case.name.chars().count()>80{
                return Err("测试用例标识或名称无效".into());
            }
            total=total.saturating_add(case.input.len()).saturating_add(case.expectation.as_ref().map_or(0,|e|e.value.len()));
            if total>2*1024*1024{return Err("测试用例超过总大小限制".into());}
            if let Some(expected)=&case.expectation{
                if !matches!(expected.mode.as_str(),"exact-json"|"float-json"|"unordered-array")||expected.value.len()>65536||(expected.mode=="float-json"&&(!valid_tolerance(&expected.absolute_tolerance)||!valid_tolerance(&expected.relative_tolerance))){return Err("预期结果配置无效".into());}
                // The renderer owns the bounded, precision-safe comparison. The backend
                // retains the exact expected text; it never converts it through f64.
                if let Target::Argument{index}=expected.target{if index>=32{return Err("预期参数索引无效".into());}}
            }
            let config=harness::configuration(&self.snapshot.metadata,&case.input).map_err(|e|format!("{}：{e}",case.name))?;
            if let Some(Expectation{target:Target::Argument{index},..})=&case.expectation{if *index>=config["metadata"]["params"].as_array().map_or(0,Vec::len){return Err("预期参数不属于当前函数".into());}}
            let groups=config["cases"].as_array().ok_or("用例分组无效")?.len();
            if invocations.len()+groups>100{return Err("一批运行最多 100 组函数调用".into());}
            for group_index in 0..groups{invocations.push(Invocation{case_index,group_index,case_number:invocations.len()+1});}
            if !combined.is_empty(){combined.push('\n');}
            combined.push_str(&case.input);
            if combined.len()>1024*1024{return Err("合并用例超过 1 MiB".into());}
        }
        let mut snapshot=self.snapshot;snapshot.input=combined;
        // Also validates token boundaries across adjacent named cases.
        let combined_config=harness::configuration(&snapshot.metadata,&snapshot.input)?;
        if combined_config["cases"].as_array().map(Vec::len)!=Some(invocations.len()){return Err("合并用例分组不一致".into());}
        Ok(Record{mode,document_key:self.document_key,client_request_id:self.client_request_id,snapshot,cases,invocations})
    }
}
#[cfg(test)]
mod tests{
    use super::*;
    const META:&str=r#"{"name":"solve","params":[{"name":"values","type":"long[]"}],"return":{"type":"long"}}"#;
    fn request(cases:Option<Vec<Case>>)->Request{
        Request{mode:None,snapshot:Snapshot{code:"authored".into(),input:"[1]".into(),metadata:META.into(),title:"fixture".into(),language:"python3".into()},document_key:Some("local/problem/python3/default".into()),client_request_id:Some("request-1".into()),cases}
    }
    fn case(id:&str,input:&str)->Case{Case{id:id.into(),name:id.into(),input:input.into(),expectation:None}}
    #[test]fn preserves_exact_inputs_and_maps_named_groups(){
        let record=request(Some(vec![case("a","[900719925474099312345]"),case("b","[2]\n[3]")])).prepare().unwrap();
        assert_eq!(record.snapshot.input,"[900719925474099312345]\n[2]\n[3]");
        assert_eq!(record.invocations.len(),3);
        assert_eq!(record.invocations[2].case_index,1);assert_eq!(record.invocations[2].group_index,1);assert_eq!(record.invocations[2].case_number,3);
        assert_eq!(record.client_request_id.as_deref(),Some("request-1"));
    }
    #[test]fn rejects_invalid_entire_batch_before_admission(){
        assert!(request(Some(vec![])).prepare().is_err());
        assert!(request(Some(vec![case("a","[1]"),case("a","[2]")])).prepare().is_err());
        assert!(request(Some(vec![case("a","[1]"),case("b","invalid")])).prepare().is_err());
        assert!(request(Some(vec![case("a",&"[1]\n".repeat(60)),case("b",&"[2]\n".repeat(41))])).prepare().is_err());
    }
    #[test]fn legacy_request_and_exact_expected_text_are_retained(){
        let record=request(None).prepare().unwrap();assert_eq!(record.invocations.len(),1);
        let mut c=case("a","[1]");c.expectation=Some(Expectation{mode:"exact-json".into(),target:Target::Return,value:"900719925474099312345".into(),absolute_tolerance:None,relative_tolerance:None});
        assert_eq!(request(Some(vec![c])).prepare().unwrap().cases[0].expectation.as_ref().unwrap().value,"900719925474099312345");
        let parsed:Request=serde_json::from_value(serde_json::json!({"code":"x","input":"[1]","metadata":META,"title":"x","language":"python3"})).unwrap();
        assert!(parsed.prepare().unwrap().document_key.is_none());
    }
    #[test]fn explicit_policy_settings_are_retained_and_unknown_policies_rejected(){
        let mut c=case("a","[1]");
        c.expectation=Some(Expectation{mode:"float-json".into(),target:Target::Return,value:"1.0000001".into(),absolute_tolerance:Some("1e-6".into()),relative_tolerance:Some("0".into())});
        let record=request(Some(vec![c.clone()])).prepare().unwrap();
        assert!(record.cases[0].expectation==c.expectation);
        for (mode,absolute) in [("automatic","1"),("float-json","-1"),("float-json","NaN"),("float-json","1e99999")]{
            let mut invalid=c.clone();let expected=invalid.expectation.as_mut().unwrap();expected.mode=mode.into();expected.absolute_tolerance=Some(absolute.into());
            assert!(request(Some(vec![invalid])).prepare().is_err());
        }
    }
    #[test]fn design_batch_maps_sequences_and_never_offers_post_call_argument_targets(){
        let mut r=request(Some(vec![case("a",r#"["Counter","get"] [[],[]]"#),case("b",r#"["Counter","get"] [[],[]]"#)]));
        r.snapshot.metadata=serde_json::json!({"systemdesign":true,"classname":"Counter","constructor":{"params":[]},"methods":[{"name":"get","params":[],"return":{"type":"integer"}}]}).to_string();
        let record=r.clone().prepare().unwrap();assert_eq!(record.invocations.len(),2);assert_eq!(record.invocations[1].case_index,1);
        r.cases.as_mut().unwrap()[0].expectation=Some(Expectation{mode:"exact-json".into(),target:Target::Argument{index:0},value:"[]".into(),absolute_tolerance:None,relative_tolerance:None});
        assert!(r.prepare().is_err());
    }

}
