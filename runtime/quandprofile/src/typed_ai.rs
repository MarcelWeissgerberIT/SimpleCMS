//! Typed selectors only restrict a host task. No tag, shadow or source can grant an effect.
use serde::{Deserialize,Serialize};
use crate::digest;
#[derive(Debug,Clone,Serialize,Deserialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
pub struct Tag {pub kind:String,pub value:String,#[serde(default,skip_serializing_if="Option::is_none")]pub version:Option<String>}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Shadow {pub protocol:String,pub id:String,pub version:u32,pub r#match:Vec<Tag>,pub input:String,pub output:String,pub read_only:bool,pub requires_sources:bool,pub format:String,pub required_terms:Vec<String>,pub required_keys:Vec<String>,pub guidance:String}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Source {pub kind:String,pub server:String,pub origin:String,pub tenant:String,pub project:String,pub r#ref:u64,#[serde(rename="stateHash")] pub state_hash:String,pub hash:String,pub quote:String,pub binding:String}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TypedAI {pub protocol:String,pub tags:Vec<Tag>,pub shadows:Vec<Shadow>,pub sources:Vec<Source>}
fn text(s:&str,max:usize)->bool{!s.trim().is_empty()&&s.chars().count()<=max}
fn hex(s:&str)->bool{s.len()==64&&s.bytes().all(|b|b.is_ascii_hexdigit()&&!b.is_ascii_uppercase())}
impl Tag {
 pub fn key(&self)->String{format!("{}:{}{}",self.kind,self.value,self.version.as_ref().map(|v|format!("@{}",v)).unwrap_or_default())}
 fn valid(&self)->bool{["domain","operation","rule","input","output"].contains(&self.kind.as_str())&&text(&self.value,120)&&self.value.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b"._+/-".contains(&b))&&(self.kind!="rule"||self.version.is_some())&&self.version.as_ref().is_none_or(|v|text(v,40)&&v.bytes().all(|b|b.is_ascii_alphanumeric()||b"._-".contains(&b)))}
}
fn tags_valid(tags:&[Tag])->bool{tags.len()<=16&&tags.iter().all(Tag::valid)&&tags.iter().enumerate().all(|(i,t)|!tags[..i].contains(t))&&["domain","operation","input","output"].iter().all(|k|tags.iter().filter(|t|t.kind==*k).count()<=1)}
impl TypedAI {
 pub fn valid(&self)->bool{
  self.protocol=="one.typed-ai.v1"&&tags_valid(&self.tags)&&self.shadows.len()<=12&&self.sources.len()<=12&&
  self.shadows.iter().all(|s|s.protocol=="one.typed-shadow.v1"&&text(&s.id,120)&&s.version>0&&s.version<=10000&&tags_valid(&s.r#match)&&s.r#match.iter().any(|t|t.kind=="operation")&&text(&s.input,120)&&text(&s.output,120)&&["inherit","json"].contains(&s.format.as_str())&&s.required_terms.len()<=16&&s.required_terms.iter().all(|t|text(t,160))&&s.required_keys.len()<=16&&s.required_keys.iter().all(|t|text(t,80))&&(s.required_keys.is_empty()||s.format=="json")&&text(&s.guidance,2400))&&
  self.shadows.iter().enumerate().all(|(i,s)|!self.shadows[..i].iter().any(|p|p.id==s.id&&p.version==s.version))&&
  self.sources.iter().all(|s|["rule","shadow"].contains(&s.kind.as_str())&&text(&s.server,120)&&s.origin.starts_with("https://")&&text(&s.tenant,120)&&text(&s.project,120)&&s.r#ref>0&&s.r#ref<=9007199254740991&&hex(&s.hash)&&hex(&s.state_hash)&&s.quote.chars().count()>=12&&text(&s.quote,1200)&&text(&s.binding,180))
 }
 pub fn resolve(&self)->Option<&Shadow>{
  if !["domain","operation","input","output"].iter().all(|k|self.tags.iter().any(|t|t.kind==*k)){return None}
  let matched:Vec<_>=self.shadows.iter().filter(|s|s.r#match.iter().all(|t|self.tags.contains(t))).collect();
  if matched.len()!=1{return None}let s=matched[0];
  if !self.tags.iter().any(|t|t.kind=="input"&&t.value==s.input)||!self.tags.iter().any(|t|t.kind=="output"&&t.value==s.output){return None}
  if self.tags.iter().filter(|t|t.kind=="rule").any(|t|self.sources.iter().filter(|s|s.kind=="rule"&&s.binding==t.key()).count()!=1){return None}
  if self.sources.iter().any(|source|if source.kind=="rule"{!self.tags.iter().any(|t|t.kind=="rule"&&t.key()==source.binding)}else{!self.shadows.iter().any(|s|format!("{}@{}",s.id,s.version)==source.binding)}){return None}
  Some(s)
 }
 pub fn sources_observed(&self,seen:&[String])->bool{self.sources.iter().all(|s|seen.contains(&digest(&serde_json::json!([s.kind,s.server,s.origin,s.tenant,s.project,s.r#ref,s.hash,s.state_hash,s.binding,s.quote]))))}
}
