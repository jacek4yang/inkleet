//! Download-only routing. Never mutates process/system proxy settings.
use serde::{Deserialize,Serialize};
use crate::Result;
#[derive(Clone,Debug,Default,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="lowercase")]
pub enum ProxyMode { #[default] System, Direct, Custom }
#[derive(Clone,Debug,Default,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DownloadProxy { pub mode:ProxyMode, pub url:String }
impl DownloadProxy {
    pub fn validated(&self)->Result<Self>{
        if self.mode!=ProxyMode::Custom { return Ok(Self{mode:self.mode.clone(),url:String::new()}); }
        let raw=self.url.trim();
        if raw.is_empty()||raw.len()>2048||raw.chars().any(char::is_control){return Err("请输入有效的下载代理地址".into());}
        let url=reqwest::Url::parse(raw).map_err(|_|"代理地址格式无效")?;
        if !matches!(url.scheme(),"http"|"https") {return Err("下载代理目前支持 HTTP 和 HTTPS，请使用代理软件的 HTTP 或混合端口".into());}
        if url.host_str().is_none()||!url.username().is_empty()||url.password().is_some()||url.query().is_some()||url.fragment().is_some()||!matches!(url.path(),""|"/")||url.port_or_known_default()==Some(0) {
            return Err("代理只接受协议、主机和端口；不接受账号密码、路径或参数".into());
        }
        reqwest::Proxy::all(url.as_str()).map_err(|_|"下载代理不可用")?;
        Ok(Self{mode:ProxyMode::Custom,url:url.to_string()})
    }
    pub(crate) fn apply(&self,builder:reqwest::ClientBuilder)->Result<reqwest::ClientBuilder>{
        let setting=self.validated()?;
        Ok(match setting.mode {
            ProxyMode::System=>builder,
            ProxyMode::Direct=>builder.no_proxy(),
            ProxyMode::Custom=>builder.no_proxy().proxy(reqwest::Proxy::all(&setting.url).map_err(|_|"下载代理不可用")?),
        })
    }
    pub(crate) fn apply_install_command(&self,command:&mut std::process::Command)->Result<()>{
        let setting=self.validated()?;
        // Only the isolated installer receives these variables. Runtime and LSP
        // commands are constructed elsewhere and never receive this setting.
        match setting.mode {
            ProxyMode::Custom=>{command.env("HTTPS_PROXY",&setting.url).env("HTTP_PROXY",&setting.url);}
            ProxyMode::System=>{
                for key in ["HTTPS_PROXY","HTTP_PROXY","ALL_PROXY","NO_PROXY","https_proxy","http_proxy","all_proxy","no_proxy"] {
                    if let Some(value)=std::env::var_os(key){command.env(key,value);}
                }
            }
            ProxyMode::Direct=>{}
        }
        Ok(())
    }
}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn validates_noncredential_endpoints_and_preserves_mode_scope(){
        for raw in ["http://127.0.0.1:7890","https://proxy.example:8443","http://[::1]:8080"] {
            assert!(DownloadProxy{mode:ProxyMode::Custom,url:raw.into()}.validated().is_ok());
        }
        for raw in ["","socks5://localhost:1080","file:///tmp/p","http://user:pass@localhost:9","http://localhost/a","http://localhost/?token=x","http://localhost/#x","http://localhost:0"]{
            assert!(DownloadProxy{mode:ProxyMode::Custom,url:raw.into()}.validated().is_err());
        }
        assert_eq!(DownloadProxy{mode:ProxyMode::Direct,url:"ignored".into()}.validated().unwrap().url,"");
    }
    #[test]fn custom_proxy_is_command_local_not_process_global(){
        let previous=std::env::var_os("HTTPS_PROXY");
        let config=DownloadProxy{mode:ProxyMode::Custom,url:"http://127.0.0.1:7890".into()};
        let mut command=std::process::Command::new("unused");command.env_clear();
        config.apply_install_command(&mut command).unwrap();
        assert!(command.get_envs().any(|(key,value)|key=="HTTPS_PROXY" && value==Some(std::ffi::OsStr::new("http://127.0.0.1:7890/"))));
        assert_eq!(std::env::var_os("HTTPS_PROXY"),previous);
        let mut direct=std::process::Command::new("unused");direct.env_clear();
        DownloadProxy{mode:ProxyMode::Direct,url:String::new()}.apply_install_command(&mut direct).unwrap();
        assert_eq!(direct.get_envs().count(),0);
    }
    #[tokio::test]async fn https_download_connect_uses_only_explicit_proxy(){
        use std::{io::{Read,Write},net::TcpListener,time::{Duration,Instant}};
        let listener=TcpListener::bind("127.0.0.1:0").unwrap();let address=listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let received=std::thread::spawn(move||{
            let deadline=Instant::now()+Duration::from_secs(5);
            loop {
                match listener.accept(){
                    Ok((mut socket,_))=>{
                        // Accepted sockets may inherit the listener's nonblocking
                        // flag on BSD/macOS. A timeout alone does not clear it.
                        socket.set_nonblocking(false).unwrap();
                        socket.set_read_timeout(Some(Duration::from_millis(100))).unwrap();
                        socket.set_write_timeout(Some(Duration::from_secs(1))).unwrap();
                        let read_deadline=Instant::now()+Duration::from_secs(5);
                        let mut captured=Vec::new();
                        loop {
                            assert!(Instant::now()<read_deadline,"incomplete proxy CONNECT header");
                            let mut bytes=[0u8;512];
                            match socket.read(&mut bytes) {
                                Ok(0)=>panic!("proxy peer closed before complete CONNECT header"),
                                Ok(n)=>{
                                    captured.extend_from_slice(&bytes[..n]);
                                    assert!(captured.len()<=4096,"proxy CONNECT header exceeded test bound");
                                    if captured.windows(4).any(|part|part==b"\r\n\r\n"){break;}
                                }
                                Err(error) if matches!(error.kind(),std::io::ErrorKind::WouldBlock|std::io::ErrorKind::TimedOut|std::io::ErrorKind::Interrupted)=>{},
                                Err(error)=>panic!("proxy capture failed: {error}"),
                            }
                        }
                        socket.write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
                        return String::from_utf8_lossy(&captured).to_string();
                    }
                    Err(error) if error.kind()==std::io::ErrorKind::WouldBlock=>{
                        assert!(Instant::now()<deadline,"proxy was not contacted");std::thread::sleep(Duration::from_millis(10));
                    }
                    Err(error)=>panic!("{error}"),
                }
            }
        });
        let config=DownloadProxy{mode:ProxyMode::Custom,url:format!("http://{address}")};
        let client=config.apply(reqwest::Client::builder().timeout(Duration::from_secs(10))).unwrap().build().unwrap();
        assert!(client.get("https://nodejs.org/").send().await.is_err());
        assert!(received.join().unwrap().starts_with("CONNECT nodejs.org:443 HTTP/1.1"));
    }
}
