// SPDX-License-Identifier: GPL-3.0-only
// Integrations' native listener (QGD-INT-0001): what the Integrations
// utility process opens a port with. It knows no program's protocol
// (QGD-INT-0002); it passes bytes and the sender's address on, and nothing
// more (QGD-INT-0008).
//
// Nothing here reads or writes a file, holds a credential, logs, or opens a
// connection of its own: the only send is `reply`, to a sender already heard.

// Our own code uses no `unsafe` (QGD-SEC-0022): napi-rs's generated bindings
// allow it for themselves, which is why this is deny and not forbid.
#![deny(unsafe_code)]

pub mod gate;
pub mod listener;

#[cfg(feature = "addon")]
mod addon {
    use crate::gate::Limits;
    use crate::listener::{Config, Datagram, Listener, OpenError};
    use napi::bindgen_prelude::{AsyncTask, Buffer};
    use napi::{Env, Error, Result, Status, Task};
    use napi_derive::napi;
    use std::net::{IpAddr, SocketAddr};
    use std::sync::Arc;
    use std::time::Duration;

    #[napi(object)]
    pub struct OpenOptions {
        pub port: u32,
        pub addresses: Vec<String>,
        pub allow: Vec<String>,
        pub max_bytes: u32,
        pub per_second: f64,
        pub burst: f64,
        pub queue: u32,
        pub replies_per_minute: u32,
    }

    #[napi(object)]
    pub struct NativeDatagram {
        pub from: String,
        pub bytes: Buffer,
    }

    #[napi(object)]
    pub struct NativeDrop {
        pub reason: String,
        pub count: f64,
    }

    #[napi(object)]
    pub struct NativeHeard {
        pub address: String,
        pub at: f64,
    }

    #[napi(object)]
    pub struct NativeStats {
        pub received: f64,
        pub dropped: Vec<NativeDrop>,
        pub heard: Vec<NativeHeard>,
    }

    // A refusal is a fixed word, which the service turns into words for the
    // operator; no OS error text crosses, since it can carry paths.
    fn refuse(word: &'static str) -> Error {
        Error::new(Status::InvalidArg, word)
    }

    fn address(text: &str) -> Result<IpAddr> {
        text.parse().map_err(|_| refuse("address"))
    }

    #[napi]
    pub struct NativeListener {
        inner: Arc<Listener>,
    }

    #[napi]
    pub fn open(options: OpenOptions) -> Result<NativeListener> {
        let port = u16::try_from(options.port).map_err(|_| refuse("port"))?;
        let finite = |value: f64| value.is_finite() && value > 0.0;
        if options.max_bytes == 0 || options.queue == 0 || !finite(options.per_second) || !finite(options.burst) {
            return Err(refuse("limits"));
        }
        let addresses = options.addresses.iter().map(|text| address(text)).collect::<Result<Vec<_>>>()?;
        let allow = options.allow.iter().map(|text| address(text)).collect::<Result<Vec<_>>>()?;
        let limits = Limits {
            max_bytes: options.max_bytes as usize,
            per_second: options.per_second,
            burst: options.burst,
            queue: options.queue as usize,
            replies_per_minute: options.replies_per_minute,
        };
        match Listener::open(Config { port, addresses, allow, limits }) {
            Ok(listener) => Ok(NativeListener { inner: Arc::new(listener) }),
            Err(OpenError::NoAddress) => Err(refuse("no-address")),
            Err(OpenError::NotBound) => Err(refuse("not-bound")),
        }
    }

    pub struct Next {
        listener: Arc<Listener>,
        max: usize,
        timeout: Duration,
    }

    impl Task for Next {
        type Output = Vec<Datagram>;
        type JsValue = Vec<NativeDatagram>;

        fn compute(&mut self) -> Result<Self::Output> {
            Ok(self.listener.next(self.max, self.timeout))
        }

        fn resolve(&mut self, _: Env, output: Self::Output) -> Result<Self::JsValue> {
            Ok(output.into_iter().map(|datagram| NativeDatagram { from: datagram.from.to_string(), bytes: datagram.bytes.into() }).collect())
        }
    }

    #[napi]
    impl NativeListener {
        // The addresses and port actually bound.
        #[napi(getter)]
        pub fn bound(&self) -> Vec<String> {
            self.inner.bound().iter().map(|address| address.to_string()).collect()
        }

        // Up to `max` datagrams, waiting at most `timeout_ms` for the first;
        // an empty list once closed. Runs off the main thread.
        #[napi]
        pub fn next(&self, max: u32, timeout_ms: u32) -> AsyncTask<Next> {
            AsyncTask::new(Next {
                listener: Arc::clone(&self.inner),
                max: max.clamp(1, 4096) as usize,
                timeout: Duration::from_millis(u64::from(timeout_ms.min(10_000))),
            })
        }

        #[napi]
        pub fn reply(&self, to: String, bytes: Buffer) -> Result<()> {
            let to: SocketAddr = to.parse().map_err(|_| refuse("address"))?;
            self.inner.reply(to, &bytes).map_err(|error| refuse(error.word()))
        }

        #[napi]
        pub fn stats(&self) -> NativeStats {
            let stats = self.inner.stats();
            NativeStats {
                received: stats.received as f64,
                dropped: stats.dropped.into_iter().map(|(reason, count)| NativeDrop { reason: reason.to_string(), count: count as f64 }).collect(),
                heard: stats.heard.into_iter().map(|(address, at)| NativeHeard { address, at: at as f64 }).collect(),
            }
        }

        #[napi]
        pub fn close(&self) {
            self.inner.close();
        }
    }
}
