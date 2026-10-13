//! Bounded Content-Length framing shared by LSP and DAP transports.
use std::io::{self, BufRead, Read, Write};
pub const MAX_MESSAGE: usize = 4 * 1024 * 1024;
pub fn read_message(reader: &mut impl BufRead) -> io::Result<serde_json::Value> {
    let invalid = || io::Error::new(io::ErrorKind::InvalidData, "invalid protocol frame");
    let mut length = None; let mut header_bytes = 0usize;
    loop {
        let mut line = Vec::new();
        let n = (&mut *reader).take(8193).read_until(b'\n', &mut line)?;
        if n == 0 { return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "protocol closed")); }
        header_bytes += n;
        if header_bytes > 8192 || !line.ends_with(b"\r\n") { return Err(invalid()); }
        if line == b"\r\n" { break; }
        let line = std::str::from_utf8(&line[..line.len()-2]).map_err(|_| invalid())?;
        let (key,value) = line.split_once(':').ok_or_else(invalid)?;
        if key.eq_ignore_ascii_case("Content-Length") {
            if length.is_some() { return Err(invalid()); }
            let value = value.trim();
            if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) { return Err(invalid()); }
            let size: usize = value.parse().map_err(|_| invalid())?;
            if size == 0 || size > MAX_MESSAGE { return Err(invalid()); }
            length = Some(size);
        }
    }
    let mut body = vec![0; length.ok_or_else(invalid)?];
    reader.read_exact(&mut body)?;
    serde_json::from_slice(&body).map_err(|_| invalid())
}
pub fn write_message(writer: &mut impl Write, value: &serde_json::Value) -> io::Result<()> {
    let body = serde_json::to_vec(value)?;
    if body.len() > MAX_MESSAGE { return Err(io::Error::new(io::ErrorKind::InvalidInput, "protocol message too large")); }
    write!(writer, "Content-Length: {}\r\n\r\n", body.len())?;
    writer.write_all(&body)?; writer.flush()
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn round_trip_utf8_and_concatenated_messages() {
        let mut bytes=Vec::new(); let v=serde_json::json!({"jsonrpc":"2.0","id":1,"result":"悬停文档"});
        write_message(&mut bytes,&v).unwrap(); write_message(&mut bytes,&v).unwrap();
        let mut reader=std::io::Cursor::new(bytes);
        assert_eq!(read_message(&mut reader).unwrap(),v); assert_eq!(read_message(&mut reader).unwrap(),v);
    }
    #[test] fn malformed_frames_are_bounded() {
        for s in ["Content-Length: 999999999\r\n\r\n", "Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}", "Content-Length: -1\r\n\r\n", "Content-Length: 2\n\n{}", "Content-Length: 3\r\n\r\n{}"] {
            assert!(read_message(&mut std::io::Cursor::new(s.as_bytes())).is_err());
        }
        assert!(read_message(&mut std::io::Cursor::new(vec![b'x';10000])).is_err());
    }
}
