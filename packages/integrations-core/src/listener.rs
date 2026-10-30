// SPDX-License-Identifier: GPL-3.0-only
// One adapter's port: the sockets it listens on, and the queue to the adapter
// (QGD-INT-0004 to QGD-INT-0007, QGD-INT-0009).
//
// UDP received unicast is the one transport permitted (QGD-INT-0003). Each
// address the operator chose is a socket of its own, read by a thread of its
// own; every datagram passes the gate before it is queued, and the queue has
// a fixed length. Closing stops the threads and drops the sockets, so the
// port is closed when `close` returns.
use crate::gate::{Drop, Gate, Limits, canonical};
use std::collections::{HashMap, VecDeque};
use std::io::ErrorKind;
use std::net::{IpAddr, SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

// How long a socket's read waits before looking whether it has been closed.
const POLL: Duration = Duration::from_millis(100);
// Large enough for any UDP datagram, so none arrives cut short and passes
// the size check as a smaller one.
const BUFFER: usize = 65_536;
// A reply goes only to a sender heard from this recently (QGD-INT-0009).
const HEARD_FOR: Duration = Duration::from_secs(120);

pub struct Datagram {
    pub from: SocketAddr,
    pub bytes: Vec<u8>,
}

pub struct Config {
    pub port: u16,
    pub addresses: Vec<IpAddr>,
    pub allow: Vec<IpAddr>,
    pub limits: Limits,
}

// What the listener has seen, for Integrations' page (QGD-INT-0010).
pub struct Stats {
    pub received: u64,
    pub dropped: Vec<(&'static str, u64)>,
    // When each allowed sender was last heard, as milliseconds since the epoch.
    pub heard: Vec<(String, u64)>,
}

struct Heard {
    socket: usize,
    at: Instant,
}

struct Replies {
    count: u32,
    window: Instant,
}

struct Shared {
    stop: AtomicBool,
    gate: Mutex<Gate>,
    queue: Mutex<VecDeque<Datagram>>,
    ready: Condvar,
    received: AtomicU64,
    heard: Mutex<HashMap<SocketAddr, Heard>>,
    last: Mutex<HashMap<IpAddr, SystemTime>>,
    replies: Mutex<HashMap<SocketAddr, Replies>>,
}

pub struct Listener {
    shared: Arc<Shared>,
    // Emptied by `close`, so the port is free when it returns rather than
    // whenever the last reference to this listener is collected.
    sockets: Mutex<Vec<Arc<UdpSocket>>>,
    bound: Vec<SocketAddr>,
    threads: Mutex<Vec<JoinHandle<()>>>,
}

#[derive(Debug, PartialEq)]
pub enum OpenError {
    NoAddress,
    // Not one of the addresses could be bound: the port is taken, or the
    // address is not this computer's.
    NotBound,
}

#[derive(Debug, PartialEq)]
pub enum ReplyError {
    NotHeard,
    TooLarge,
    OverRate,
    Closed,
    Failed,
}

impl ReplyError {
    pub fn word(&self) -> &'static str {
        match self {
            ReplyError::NotHeard => "not-heard",
            ReplyError::TooLarge => "too-large",
            ReplyError::OverRate => "over-rate",
            ReplyError::Closed => "closed",
            ReplyError::Failed => "failed",
        }
    }
}

fn ms(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_millis() as u64).unwrap_or(0)
}

impl Listener {
    pub fn open(config: Config) -> Result<Listener, OpenError> {
        if config.addresses.is_empty() {
            return Err(OpenError::NoAddress);
        }
        let shared = Arc::new(Shared {
            stop: AtomicBool::new(false),
            gate: Mutex::new(Gate::new(config.limits, &config.allow)),
            queue: Mutex::new(VecDeque::new()),
            ready: Condvar::new(),
            received: AtomicU64::new(0),
            heard: Mutex::new(HashMap::new()),
            last: Mutex::new(HashMap::new()),
            replies: Mutex::new(HashMap::new()),
        });
        let mut sockets = Vec::new();
        let mut bound = Vec::new();
        // The port asked for, on each address; with port 0 (the tests), the
        // first address's port is used for the rest, so they share one.
        let mut port = config.port;
        for address in &config.addresses {
            // An address that will not bind (IPv6 turned off, for ::1) is
            // left out; the page says which were bound.
            let Ok(socket) = UdpSocket::bind(SocketAddr::new(*address, port)) else { continue };
            if socket.set_read_timeout(Some(POLL)).is_err() {
                continue;
            }
            let Ok(local) = socket.local_addr() else { continue };
            port = local.port();
            bound.push(local);
            sockets.push(Arc::new(socket));
        }
        if sockets.is_empty() {
            return Err(OpenError::NotBound);
        }
        let mut threads = Vec::new();
        for (index, socket) in sockets.iter().enumerate() {
            let socket = Arc::clone(socket);
            let shared = Arc::clone(&shared);
            threads.push(std::thread::spawn(move || read(index, &socket, &shared)));
        }
        Ok(Listener { shared, sockets: Mutex::new(sockets), bound, threads: Mutex::new(threads) })
    }

    pub fn bound(&self) -> &[SocketAddr] {
        &self.bound
    }

    // Up to `max` datagrams, waiting at most `timeout` for the first. None
    // once closed.
    pub fn next(&self, max: usize, timeout: Duration) -> Vec<Datagram> {
        let deadline = Instant::now() + timeout;
        let mut queue = self.shared.queue.lock().unwrap();
        while queue.is_empty() && !self.shared.stop.load(Ordering::SeqCst) {
            let now = Instant::now();
            if now >= deadline {
                break;
            }
            queue = self.shared.ready.wait_timeout(queue, deadline - now).unwrap().0;
        }
        let take = queue.len().min(max);
        queue.drain(..take).collect()
    }

    // The one reply permitted: to a sender heard from, from the socket it was
    // heard on, no larger than a datagram may be, and no more often than the
    // limit allows (QGD-INT-0003, QGD-INT-0009).
    pub fn reply(&self, to: SocketAddr, bytes: &[u8]) -> Result<(), ReplyError> {
        if self.shared.stop.load(Ordering::SeqCst) {
            return Err(ReplyError::Closed);
        }
        let limits = self.shared.gate.lock().unwrap().limits();
        if bytes.len() > limits.max_bytes {
            return Err(ReplyError::TooLarge);
        }
        let to = SocketAddr::new(canonical(to.ip()), to.port());
        let socket = {
            let heard = self.shared.heard.lock().unwrap();
            match heard.get(&to) {
                Some(entry) if entry.at.elapsed() <= HEARD_FOR => entry.socket,
                _ => return Err(ReplyError::NotHeard),
            }
        };
        {
            let mut replies = self.shared.replies.lock().unwrap();
            let now = Instant::now();
            let entry = replies.entry(to).or_insert(Replies { count: 0, window: now });
            if now.duration_since(entry.window) >= Duration::from_secs(60) {
                *entry = Replies { count: 0, window: now };
            }
            if entry.count >= limits.replies_per_minute {
                return Err(ReplyError::OverRate);
            }
            entry.count += 1;
        }
        // An IPv4 sender heard on an IPv6 socket is answered at the address
        // that socket knows it by.
        let local = self.bound[socket];
        let sockets = self.sockets.lock().unwrap();
        let Some(socket) = sockets.get(socket) else { return Err(ReplyError::Closed) };
        let destination = match to.ip() {
            IpAddr::V4(v4) if local.is_ipv6() => SocketAddr::new(IpAddr::V6(v4.to_ipv6_mapped()), to.port()),
            _ => to,
        };
        socket.send_to(bytes, destination).map(|_| ()).map_err(|_| ReplyError::Failed)
    }

    pub fn stats(&self) -> Stats {
        let gate = self.shared.gate.lock().unwrap();
        let dropped = Drop::ALL.iter().map(|reason| (reason.word(), gate.dropped(*reason))).collect();
        let mut heard: Vec<(String, u64)> =
            self.shared.last.lock().unwrap().iter().map(|(address, at)| (address.to_string(), ms(*at))).collect();
        heard.sort();
        Stats { received: self.shared.received.load(Ordering::SeqCst), dropped, heard }
    }

    // Stops reading and closes every socket. Waiting `next` calls return.
    pub fn close(&self) {
        self.shared.stop.store(true, Ordering::SeqCst);
        self.shared.ready.notify_all();
        let threads: Vec<JoinHandle<()>> = self.threads.lock().unwrap().drain(..).collect();
        for thread in threads {
            let _ = thread.join();
        }
        // The threads held the only other references; with them gone, this
        // closes the sockets.
        self.sockets.lock().unwrap().clear();
    }
}

impl std::ops::Drop for Listener {
    fn drop(&mut self) {
        self.close();
    }
}

fn read(index: usize, socket: &UdpSocket, shared: &Shared) {
    let mut buffer = vec![0u8; BUFFER];
    while !shared.stop.load(Ordering::SeqCst) {
        let (length, from) = match socket.recv_from(&mut buffer) {
            Ok(received) => received,
            Err(error) => {
                match error.kind() {
                    // The poll interval passing; and on Windows, the ICMP
                    // port-unreachable left by a reply to a program that has
                    // gone, which a read reports and which is not this
                    // socket's failure.
                    ErrorKind::WouldBlock | ErrorKind::TimedOut | ErrorKind::ConnectionReset | ErrorKind::Interrupted => {}
                    _ => std::thread::sleep(POLL),
                }
                continue;
            }
        };
        let now = Instant::now();
        // The gate decides before anything of the datagram is looked at but
        // its sender and its length (QGD-INT-0006).
        if shared.gate.lock().unwrap().admit(from.ip(), length, now).is_err() {
            continue;
        }
        let from = SocketAddr::new(canonical(from.ip()), from.port());
        let limit = shared.gate.lock().unwrap().limits().queue;
        {
            let mut queue = shared.queue.lock().unwrap();
            if queue.len() >= limit {
                drop(queue);
                shared.gate.lock().unwrap().count(Drop::QueueFull);
                continue;
            }
            queue.push_back(Datagram { from, bytes: buffer[..length].to_vec() });
        }
        shared.received.fetch_add(1, Ordering::SeqCst);
        shared.heard.lock().unwrap().insert(from, Heard { socket: index, at: now });
        shared.last.lock().unwrap().insert(from.ip(), SystemTime::now());
        shared.ready.notify_one();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIMITS: Limits = Limits { max_bytes: 64, per_second: 1000.0, burst: 1000.0, queue: 4, replies_per_minute: 2 };

    fn loopback(allow: &[&str]) -> Listener {
        Listener::open(Config {
            port: 0,
            addresses: vec!["127.0.0.1".parse().unwrap()],
            allow: allow.iter().map(|text| text.parse().unwrap()).collect(),
            limits: LIMITS,
        })
        .unwrap()
    }

    fn sender() -> UdpSocket {
        UdpSocket::bind("127.0.0.1:0").unwrap()
    }

    fn wait_for(listener: &Listener, count: usize) -> Vec<Datagram> {
        let mut got = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(5);
        while got.len() < count && Instant::now() < deadline {
            got.extend(listener.next(count - got.len(), Duration::from_millis(200)));
        }
        got
    }

    #[test]
    fn an_allowed_sender_is_passed_on_with_its_address() {
        let listener = loopback(&["127.0.0.1"]);
        let out = sender();
        out.send_to(b"hello", listener.bound()[0]).unwrap();
        let got = wait_for(&listener, 1);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].bytes, b"hello");
        assert_eq!(got[0].from, out.local_addr().unwrap());
        assert_eq!(listener.stats().received, 1);
    }

    #[test]
    fn a_sender_not_on_the_list_reaches_nothing_and_is_counted() {
        let listener = loopback(&["127.0.0.2"]);
        sender().send_to(b"hello", listener.bound()[0]).unwrap();
        std::thread::sleep(Duration::from_millis(300));
        assert!(listener.next(10, Duration::from_millis(100)).is_empty());
        let stats = listener.stats();
        assert_eq!(stats.received, 0);
        assert!(stats.dropped.contains(&("not-allowed", 1)));
        assert!(stats.heard.is_empty());
    }

    #[test]
    fn an_oversized_datagram_is_dropped() {
        let listener = loopback(&["127.0.0.1"]);
        let out = sender();
        out.send_to(&[0u8; 65], listener.bound()[0]).unwrap();
        out.send_to(&[0u8; 64], listener.bound()[0]).unwrap();
        let got = wait_for(&listener, 1);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].bytes.len(), 64);
        assert!(listener.stats().dropped.contains(&("too-large", 1)));
    }

    #[test]
    fn the_queue_has_a_fixed_length() {
        let listener = loopback(&["127.0.0.1"]);
        let out = sender();
        for n in 0..10u8 {
            out.send_to(&[n], listener.bound()[0]).unwrap();
        }
        std::thread::sleep(Duration::from_millis(400));
        let got = listener.next(100, Duration::from_millis(100));
        assert_eq!(got.len(), 4);
        assert!(listener.stats().dropped.contains(&("queue-full", 6)));
    }

    #[test]
    fn a_reply_goes_only_to_a_sender_heard_from_and_no_more_than_the_limit() {
        let listener = loopback(&["127.0.0.1"]);
        let out = sender();
        out.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        let stranger = sender();
        assert_eq!(listener.reply(stranger.local_addr().unwrap(), b"x"), Err(ReplyError::NotHeard));
        out.send_to(b"hello", listener.bound()[0]).unwrap();
        wait_for(&listener, 1);
        let to = out.local_addr().unwrap();
        assert_eq!(listener.reply(to, &[0u8; 65]), Err(ReplyError::TooLarge));
        assert_eq!(listener.reply(to, b"replay"), Ok(()));
        let mut buffer = [0u8; 16];
        let (length, from) = out.recv_from(&mut buffer).unwrap();
        assert_eq!(&buffer[..length], b"replay");
        assert_eq!(from, listener.bound()[0]);
        assert_eq!(listener.reply(to, b"replay"), Ok(()));
        assert_eq!(listener.reply(to, b"replay"), Err(ReplyError::OverRate));
    }

    #[test]
    fn closing_closes_the_port() {
        let listener = loopback(&["127.0.0.1"]);
        let address = listener.bound()[0];
        listener.close();
        assert_eq!(listener.reply(address, b"x"), Err(ReplyError::Closed));
        assert!(listener.next(1, Duration::from_millis(10)).is_empty());
        // The port can be bound again while the listener itself still
        // exists: closing closed it, not dropping (as JavaScript may hold
        // the object long after).
        UdpSocket::bind(address).unwrap();
    }

    #[test]
    fn a_taken_port_is_said_rather_than_shared() {
        let holder = UdpSocket::bind("127.0.0.1:0").unwrap();
        let result = Listener::open(Config {
            port: holder.local_addr().unwrap().port(),
            addresses: vec!["127.0.0.1".parse().unwrap()],
            allow: vec![],
            limits: LIMITS,
        });
        assert_eq!(result.err(), Some(OpenError::NotBound));
    }
}
