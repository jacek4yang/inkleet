//! A serialized credential transaction with cancellation visible during blocking I/O.
use std::sync::atomic::{AtomicU64, Ordering};
pub const RECOVERY_REQUIRED: &str = "STORAGE_RECOVERY_REQUIRED: saved credential state is uncertain; forget this device before logging in or restarting";
pub trait Store {
    fn read(&self) -> Result<Option<(String, String)>, String>;
    fn write(&self, cookie: &str, csrf: &str) -> Result<(), String>;
    fn remove(&self) -> Result<(), String>;
}
pub struct NativeStore;
impl Store for NativeStore {
    fn read(&self) -> Result<Option<(String, String)>, String> { crate::session_store::load().map(|v| v.map(|s| (s.cookie, s.csrf))) }
    fn write(&self, cookie: &str, csrf: &str) -> Result<(), String> { crate::session_store::save(cookie, csrf) }
    fn remove(&self) -> Result<(), String> { crate::session_store::delete() }
}
// Caller holds the Auth mutex: no newer commit/delete can race the rollback.
pub fn persist(store: &impl Store, epoch: &AtomicU64, expected: u64, cookie: &str, csrf: &str, remember: bool) -> Result<bool, String> {
    if epoch.load(Ordering::SeqCst) != expected { return Err("Login attempt canceled".into()); }
    let previous = store.read()?;
    if epoch.load(Ordering::SeqCst) != expected { return Err("Login attempt canceled".into()); }
    let saved = if remember { store.write(cookie, csrf).is_ok() } else { false };
    if !saved { store.remove().map_err(|_| RECOVERY_REQUIRED.to_owned())?; }
    if epoch.load(Ordering::SeqCst) != expected {
        let rollback = match previous { Some((cookie, csrf)) => store.write(&cookie, &csrf), None => store.remove() };
        if rollback.is_err() { return Err(RECOVERY_REQUIRED.into()); }
        return Err("Login attempt canceled".into());
    }
    Ok(saved)
}
#[cfg(test)] mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    struct Fake<'a> { epoch: &'a AtomicU64, value: RefCell<Option<(String,String)>>, cancel_on_write: Cell<bool>, cancel_on_delete: Cell<bool> }
    impl Store for Fake<'_> {
        fn read(&self)->Result<Option<(String,String)>,String>{Ok(self.value.borrow().clone())}
        fn write(&self,c:&str,s:&str)->Result<(),String>{*self.value.borrow_mut()=Some((c.into(),s.into()));if self.cancel_on_write.replace(false){self.epoch.fetch_add(1,Ordering::SeqCst);}Ok(())}
        fn remove(&self)->Result<(),String>{*self.value.borrow_mut()=None;if self.cancel_on_delete.replace(false){self.epoch.fetch_add(1,Ordering::SeqCst);}Ok(())}
    }
    #[test] fn cancellation_during_save_restores_previous_account() {
        let epoch=AtomicU64::new(1);let prior=Some(("old".into(),"old-csrf".into()));
        let store=Fake{epoch:&epoch,value:RefCell::new(prior.clone()),cancel_on_write:Cell::new(true),cancel_on_delete:Cell::new(false)};
        assert!(persist(&store,&epoch,1,"new","new-csrf",true).is_err());assert_eq!(*store.value.borrow(),prior);
    }
    #[test] fn cancellation_during_first_save_removes_new_account() {
        let epoch=AtomicU64::new(1);let store=Fake{epoch:&epoch,value:RefCell::new(None),cancel_on_write:Cell::new(true),cancel_on_delete:Cell::new(false)};
        assert!(persist(&store,&epoch,1,"new","new-csrf",true).is_err());assert_eq!(*store.value.borrow(),None);
    }
    #[test] fn cancellation_during_memory_only_switch_restores_previous_account() {
        let epoch=AtomicU64::new(1);let prior=Some(("old".into(),"old-csrf".into()));
        let store=Fake{epoch:&epoch,value:RefCell::new(prior.clone()),cancel_on_write:Cell::new(false),cancel_on_delete:Cell::new(true)};
        assert!(persist(&store,&epoch,1,"new","new-csrf",false).is_err());assert_eq!(*store.value.borrow(),prior);
    }
}

#[cfg(test)] mod rollback_failure_tests {
    use super::*;
    use std::cell::Cell;
    struct Broken<'a> { epoch: &'a AtomicU64, writes: Cell<u8>, existing: bool }
    impl Store for Broken<'_> {
        fn read(&self)->Result<Option<(String,String)>,String>{Ok(if self.existing {Some(("old".into(),"csrf".into()))}else{None})}
        fn write(&self,_:&str,_:&str)->Result<(),String>{let n=self.writes.get();self.writes.set(n+1);if n==0{self.epoch.fetch_add(1,Ordering::SeqCst);Ok(())}else{Err("fixture failure".into())}}
        fn remove(&self)->Result<(),String>{Err("fixture failure".into())}
    }
    #[test] fn rollback_failure_is_recovery_required_for_old_and_new_accounts(){
        for existing in [false,true] {let epoch=AtomicU64::new(1);let store=Broken{epoch:&epoch,writes:Cell::new(0),existing};assert_eq!(persist(&store,&epoch,1,"new","csrf",true).unwrap_err(),RECOVERY_REQUIRED);}
    }
}

#[cfg(test)]
mod failure_fixture_tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    struct Fake<'a> {
        epoch: &'a AtomicU64,
        value: RefCell<Option<(String, String)>>,
        fail_read: bool,
        fail_write: bool,
        fail_delete: bool,
        cancel_read: bool,
        writes: Cell<usize>,
        deletes: Cell<usize>,
    }
    impl Store for Fake<'_> {
        fn read(&self) -> Result<Option<(String, String)>, String> {
            if self.cancel_read { self.epoch.fetch_add(1, Ordering::SeqCst); }
            if self.fail_read { Err("synthetic locked store".into()) } else { Ok(self.value.borrow().clone()) }
        }
        fn write(&self, cookie: &str, csrf: &str) -> Result<(), String> {
            self.writes.set(self.writes.get() + 1);
            // A failed native write may already have changed the store; cleanup must not assume otherwise.
            *self.value.borrow_mut() = Some((cookie.into(), csrf.into()));
            if self.fail_write { Err("synthetic partial write".into()) } else { Ok(()) }
        }
        fn remove(&self) -> Result<(), String> {
            self.deletes.set(self.deletes.get() + 1);
            if self.fail_delete { Err("synthetic delete denied".into()) } else { *self.value.borrow_mut() = None; Ok(()) }
        }
    }
    fn fake(epoch: &AtomicU64) -> Fake<'_> {
        Fake { epoch, value: RefCell::new(Some(("old-fixture".into(), "old-csrf".into()))), fail_read: false, fail_write: false, fail_delete: false, cancel_read: false, writes: Cell::new(0), deletes: Cell::new(0) }
    }
    #[test]
    fn stale_generation_canceled_read_and_unreadable_store_never_mutate_credentials() {
        for mode in 0..3 {
            let epoch = AtomicU64::new(1);
            let mut store = fake(&epoch);
            if mode == 0 { epoch.store(2, Ordering::SeqCst); }
            if mode == 1 { store.cancel_read = true; }
            if mode == 2 { store.fail_read = true; }
            assert!(persist(&store, &epoch, 1, "new-fixture", "csrf", true).is_err());
            assert_eq!(store.writes.get(), 0);
            assert_eq!(store.deletes.get(), 0);
            assert_eq!(store.value.borrow().as_ref().unwrap().0, "old-fixture");
        }
    }
    #[test]
    fn failed_save_with_successful_cleanup_is_explicitly_memory_only() {
        let epoch = AtomicU64::new(1);
        let mut store = fake(&epoch);
        store.fail_write = true;
        assert!(!persist(&store, &epoch, 1, "new-fixture", "csrf", true).unwrap());
        assert_eq!(store.writes.get(), 1);
        assert_eq!(store.deletes.get(), 1);
        assert!(store.value.borrow().is_none());
    }
    #[test]
    fn failed_cleanup_cannot_report_saved_or_memory_only_success() {
        for remember in [false, true] {
            let epoch = AtomicU64::new(1);
            let mut store = fake(&epoch);
            store.fail_write = true;
            store.fail_delete = true;
            assert_eq!(persist(&store, &epoch, 1, "new-fixture", "csrf", remember).unwrap_err(), RECOVERY_REQUIRED);
        }
    }
}
