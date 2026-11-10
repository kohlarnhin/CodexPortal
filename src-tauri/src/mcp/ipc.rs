use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

const NOT_RUNNING: &str = "Codex Portal 未运行，请先打开 Codex Portal。";
const REQUEST_LIMIT: u64 = 4 * 1024;

pub(super) fn endpoint_path() -> Option<PathBuf> {
    Some(dirs::data_dir()?.join("com.codex.portal").join("mcp-endpoint.json"))
}

#[derive(Serialize, Deserialize)]
struct Endpoint {
    port: u16,
    token: String,
}

#[derive(Serialize, Deserialize)]
struct Request {
    token: String,
    command: String,
}

fn read_endpoint(path: &Path) -> io::Result<Endpoint> {
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

fn remove_endpoint(path: &Path, token: &str) {
    if read_endpoint(path).is_ok_and(|endpoint| endpoint.token == token) {
        let _ = fs::remove_file(path);
    }
}

pub(super) struct Server {
    path: PathBuf,
    token: String,
}

impl Server {
    pub(super) fn start<F>(path: &Path, handler: F) -> io::Result<Self>
    where F: Fn(&str) -> Result<Value, String> + Send + Sync + 'static {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let endpoint = Endpoint {
            port: listener.local_addr()?.port(),
            token: uuid::Uuid::new_v4().simple().to_string(),
        };
        if let Some(parent) = path.parent() { fs::create_dir_all(parent)?; }
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(path)?;
        serde_json::to_writer(&mut file, &endpoint)?;
        let token = endpoint.token.clone();
        let handler = Arc::new(handler);
        let worker = thread::Builder::new().name("portal-mcp".into()).spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { break };
                let token = token.clone();
                let handler = handler.clone();
                let _ = thread::Builder::new().name("portal-mcp-request".into()).spawn(move || {
                    let _ = serve_connection(stream, &token, handler.as_ref());
                });
            }
        });
        if let Err(error) = worker {
            remove_endpoint(path, &endpoint.token);
            return Err(error);
        }
        Ok(Self { path: path.to_path_buf(), token: endpoint.token })
    }

    pub(super) fn stop(&self) {
        remove_endpoint(&self.path, &self.token);
    }
}

fn serve_connection<F>(mut stream: TcpStream, token: &str, handler: &F) -> io::Result<()>
where F: Fn(&str) -> Result<Value, String> {
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    let mut line = String::new();
    BufReader::new(&mut stream).take(REQUEST_LIMIT + 1).read_line(&mut line)?;
    if line.len() as u64 > REQUEST_LIMIT || !line.ends_with('\n') {
        return Err(io::ErrorKind::InvalidData.into());
    }
    let request: Request = serde_json::from_str(&line)?;
    let result = if request.token == token { handler(&request.command) }
        else { Err("MCP 访问令牌无效。".into()) };
    serde_json::to_writer(&mut stream, &result)?;
    stream.write_all(b"\n")
}

pub(super) fn call(command: &str) -> Result<Value, String> {
    let path = endpoint_path().ok_or_else(|| NOT_RUNNING.to_string())?;
    call_at(&path, command)
}

fn call_at(path: &Path, command: &str) -> Result<Value, String> {
    let request = || -> io::Result<Result<Value, String>> {
        let endpoint = read_endpoint(path)?;
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, endpoint.port))?;
        serde_json::to_writer(&mut stream, &Request { token: endpoint.token, command: command.into() })?;
        stream.write_all(b"\n")?;
        let mut line = String::new();
        BufReader::new(stream).read_line(&mut line)?;
        Ok(serde_json::from_str(&line)?)
    };
    request().unwrap_or_else(|_| Err(NOT_RUNNING.into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_endpoint() -> PathBuf {
        std::env::temp_dir().join(format!("portal-mcp-{}.json", uuid::Uuid::new_v4()))
    }

    #[test]
    fn loopback_round_trip_returns_handler_value_and_errors() {
        let path = temp_endpoint();
        let server = Server::start(&path, |command| match command {
            "status" => Ok(json!({"current": null, "allExhausted": false})),
            _ => Err("当前账号额度查询失败，未执行切换。".into()),
        }).unwrap();
        assert_eq!(call_at(&path, "status").unwrap(), json!({"current": null, "allExhausted": false}));
        assert_eq!(call_at(&path, "switch").unwrap_err(), "当前账号额度查询失败，未执行切换。");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        server.stop();
        assert!(!path.exists());
    }

    #[test]
    fn wrong_token_is_rejected_and_stop_preserves_another_endpoint() {
        let path = temp_endpoint();
        let server = Server::start(&path, |_| panic!("wrong token must not reach handler")).unwrap();
        let mut endpoint = read_endpoint(&path).unwrap();
        endpoint.token = "another-token".into();
        fs::write(&path, serde_json::to_vec(&endpoint).unwrap()).unwrap();
        assert!(call_at(&path, "status").is_err());
        server.stop();
        assert!(path.exists());
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn missing_endpoint_reports_portal_not_running() {
        assert_eq!(call_at(&temp_endpoint(), "status").unwrap_err(), NOT_RUNNING);
    }
}
