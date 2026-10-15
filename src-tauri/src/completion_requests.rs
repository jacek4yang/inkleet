//! Session-scoped issuer ordering and constant-space cancellation tombstones.
use inkleet_managed_env::rpc::RequestCanceller;
pub trait Cancel { fn cancel(&self); }
impl Cancel for RequestCanceller { fn cancel(&self) { RequestCanceller::cancel(self); } }
pub struct CompletionRequests<C: Cancel> {
    latest: u64, canceled_through: u64, active: Option<(u64,C)>,
}
impl<C: Cancel> Default for CompletionRequests<C> {
    fn default()->Self { Self { latest:0,canceled_through:0,active:None } }
}
fn sequence(value:Option<u64>)->Result<u64,String>{
    value.filter(|n|*n>0&&*n<=9_007_199_254_740_991).ok_or_else(||"补全请求序号无效".into())
}
impl<C: Cancel> CompletionRequests<C> {
    /// Caller holds the session mutex across validation, admission and handle
    /// registration. make() must be bounded/nonblocking, never wait for a reply.
    pub fn begin<T>(&mut self,value:Option<u64>,make:impl FnOnce()->Result<(T,C),String>)->Result<(u64,T),String>{
        let id=sequence(value)?;
        if id<=self.latest || id<=self.canceled_through { return Err("补全请求已经过期".into()); }
        self.latest=id;
        if let Some((_,old))=self.active.take(){old.cancel();}
        let (request,cancel)=make()?;
        self.active=Some((id,cancel));
        Ok((id,request))
    }
    pub fn cancel_through(&mut self,value:u64)->Result<(),String>{
        let id=sequence(Some(value))?;
        self.canceled_through=self.canceled_through.max(id);
        if self.active.as_ref().is_some_and(|(active,_)|*active<=id){
            if let Some((_,cancel))=self.active.take(){cancel.cancel();}
        }
        Ok(())
    }
    pub fn is_current(&self,id:u64)->bool { self.latest==id && self.canceled_through<id }
    pub fn finish(&mut self,id:u64){
        if self.active.as_ref().is_some_and(|(active,_)|*active==id){self.active.take();}
    }
}
#[cfg(test)]mod tests{
    use super::*;use std::sync::{Arc,atomic::{AtomicUsize,Ordering}};
    #[derive(Clone)]struct Fake(Arc<AtomicUsize>);
    impl Cancel for Fake{fn cancel(&self){self.0.fetch_add(1,Ordering::Relaxed);}}
    fn fake()->Fake{Fake(Arc::new(AtomicUsize::new(0)))}
    fn begin(b:&mut CompletionRequests<Fake>,id:u64,c:Fake)->Result<(u64,()),String>{b.begin(Some(id),||Ok(((),c)))}
    #[test]fn cancellation_before_admission_never_starts_rpc(){
        let mut b=CompletionRequests::<Fake>::default();b.cancel_through(1).unwrap();
        assert!(b.begin(Some(1),||->Result<((),Fake),String>{panic!("canceled request must not start")}).is_err());
        let c=fake();begin(&mut b,2,c.clone()).unwrap();b.cancel_through(1).unwrap();
        assert!(b.is_current(2));assert_eq!(c.0.load(Ordering::Relaxed),0);
    }
    #[test]fn reverse_admission_and_late_cleanup_cannot_cancel_replacement(){
        let mut b=CompletionRequests::default();let a=fake();let c=fake();
        begin(&mut b,1,a.clone()).unwrap();begin(&mut b,2,c.clone()).unwrap();
        assert_eq!(a.0.load(Ordering::Relaxed),1);
        b.finish(1);b.cancel_through(1).unwrap();
        assert!(begin(&mut b,1,fake()).is_err());assert_eq!(c.0.load(Ordering::Relaxed),0);
        b.cancel_through(2).unwrap();b.cancel_through(2).unwrap();
        assert_eq!(c.0.load(Ordering::Relaxed),1);assert!(!b.is_current(2));
    }
    #[test]fn invalid_sequence_cannot_supersede_valid_work(){
        let mut b=CompletionRequests::default();let c=fake();begin(&mut b,1,c.clone()).unwrap();
        for value in [None,Some(0),Some(9_007_199_254_740_992),Some(u64::MAX)]{
            assert!(b.begin(value,||Ok(((),fake()))).is_err());
        }
        assert!(b.cancel_through(0).is_err());assert!(b.cancel_through(u64::MAX).is_err());
        assert!(b.is_current(1));assert_eq!(c.0.load(Ordering::Relaxed),0);
    }
    #[test]fn failed_transport_admission_has_no_active_handle_or_retry(){
        let mut b=CompletionRequests::default();let c=fake();begin(&mut b,1,c.clone()).unwrap();
        assert!(b.begin(Some(2),||Err::<((),Fake),_>("full".into())).is_err());
        assert_eq!(c.0.load(Ordering::Relaxed),1);assert!(b.active.is_none());
        assert!(begin(&mut b,2,fake()).is_err());begin(&mut b,3,fake()).unwrap();
    }
    #[test]fn cancellation_and_handle_registration_are_atomic(){
        let state=Arc::new(std::sync::Mutex::new(CompletionRequests::default()));
        let c=fake();let (entered,ready)=std::sync::mpsc::sync_channel(1);
        let (release,gate)=std::sync::mpsc::sync_channel(1);
        std::thread::scope(|scope|{
            let b=state.clone();let handle=c.clone();
            let admission=scope.spawn(move||b.lock().unwrap().begin(Some(1),||{
                entered.send(()).unwrap();gate.recv_timeout(std::time::Duration::from_secs(5)).unwrap();Ok(((),handle))
            }));
            ready.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
            let b=state.clone();let cancel=scope.spawn(move||b.lock().unwrap().cancel_through(1));
            release.send(()).unwrap();admission.join().unwrap().unwrap();cancel.join().unwrap().unwrap();
        });
        assert_eq!(c.0.load(Ordering::Relaxed),1);assert!(!state.lock().unwrap().is_current(1));
    }
}
