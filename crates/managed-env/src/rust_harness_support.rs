// Bounded JSON output for trusted local Rust solutions; not a sandbox.
use std::io::Write;
pub struct Writer{pub text:String,budget:usize}
impl Writer{
    pub fn new()->Self{Self{text:String::new(),budget:10000}}
    pub fn push(&mut self,value:&str)->Result<(),String>{if self.text.len()+value.len()>1024*1024{return Err("result exceeds 1 MiB".into());}self.text.push_str(value);Ok(())}
    pub fn node(&mut self)->Result<(),String>{self.budget=self.budget.checked_sub(1).ok_or("result exceeds node limit")?;Ok(())}
    pub fn quote(&mut self,value:&str)->Result<(),String>{
        if value.len()>1024*1024{return Err("string exceeds result limit".into());}self.push("\"")?;
        for ch in value.chars(){match ch{
            '"'=>self.push("\\\"")?,'\\'=>self.push("\\\\")?,'\n'=>self.push("\\n")?,'\r'=>self.push("\\r")?,'\t'=>self.push("\\t")?,
            ch if ch<' '=>self.push(&format!("\\u{:04x}",ch as u32))?,
            ch=>{let mut bytes=[0;4];self.push(ch.encode_utf8(&mut bytes))?;}
        }}self.push("\"")
    }
}
pub trait Json{fn json(&self,w:&mut Writer)->Result<(),String>;}
macro_rules! integers{($($ty:ty),*)=>{$(impl Json for $ty{fn json(&self,w:&mut Writer)->Result<(),String>{w.node()?;w.push(&self.to_string())}})*};}
integers!(i8,i16,i32,i64,i128,isize,u8,u16,u32,u64,u128,usize);
impl Json for bool{fn json(&self,w:&mut Writer)->Result<(),String>{w.node()?;w.push(if *self{"true"}else{"false"})}}
impl Json for f64{fn json(&self,w:&mut Writer)->Result<(),String>{w.node()?;if !self.is_finite(){return Err("non-finite result".into());}w.push(&self.to_string())}}
impl Json for f32{fn json(&self,w:&mut Writer)->Result<(),String>{w.node()?;if !self.is_finite(){return Err("non-finite result".into());}w.push(&self.to_string())}}
impl Json for str{fn json(&self,w:&mut Writer)->Result<(),String>{w.node()?;w.quote(self)}}
impl Json for String{fn json(&self,w:&mut Writer)->Result<(),String>{self.as_str().json(w)}}
impl Json for char{fn json(&self,w:&mut Writer)->Result<(),String>{w.node()?;w.quote(&self.to_string())}}
impl Json for (){fn json(&self,w:&mut Writer)->Result<(),String>{w.node()?;w.push("null")}}
impl<T:Json+?Sized> Json for &T{fn json(&self,w:&mut Writer)->Result<(),String>{(**self).json(w)}}
impl<T:Json+?Sized> Json for &mut T{fn json(&self,w:&mut Writer)->Result<(),String>{(**self).json(w)}}
impl<T:Json+?Sized> Json for Box<T>{fn json(&self,w:&mut Writer)->Result<(),String>{(**self).json(w)}}
impl<T:Json> Json for Option<T>{fn json(&self,w:&mut Writer)->Result<(),String>{match self{Some(value)=>value.json(w),None=>{w.node()?;w.push("null")}}}}
impl<T:Json> Json for [T]{fn json(&self,w:&mut Writer)->Result<(),String>{w.node()?;if self.len()>10000{return Err("array result exceeds limit".into());}w.push("[")?;for(i,v)in self.iter().enumerate(){if i>0{w.push(",")?;}v.json(w)?;}w.push("]")}}
impl<T:Json> Json for Vec<T>{fn json(&self,w:&mut Writer)->Result<(),String>{self.as_slice().json(w)}}
impl<T:Json,const N:usize> Json for [T;N]{fn json(&self,w:&mut Writer)->Result<(),String>{self.as_slice().json(w)}}
pub fn emit(index:usize,outcome:Result<Result<String,String>,Box<dyn std::any::Any+Send>>,output:&mut std::fs::File,total:&mut usize)->Result<(),String>{
    let text=match outcome{
        Ok(Ok(text))=>text,
        other=>{
            let message=match other{Ok(Err(e))=>e,Err(e)=>e.downcast_ref::<&str>().map(|s|s.to_string()).or_else(||e.downcast_ref::<String>().cloned()).unwrap_or_else(||"solution panic".into()),_=>unreachable!()};
            let mut w=Writer::new();w.push(&format!("{{\"case\":{index},\"ok\":false,\"error\":"))?;w.quote(&message.chars().take(1000).collect::<String>())?;w.push("}")?;w.text
        }
    };
    *total+=text.len()+1;if *total>1024*1024{return Err("results exceed 1 MiB".into());}
    writeln!(output,"{text}").map_err(|e|e.to_string())?;output.flush().map_err(|e|e.to_string())
}
