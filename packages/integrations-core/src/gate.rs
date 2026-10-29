// SPDX-License-Identifier: GPL-3.0-only
// What may come in, decided before anything of a datagram is read
// (QGD-INT-0006, QGD-INT-0007). No socket here, and the clock is passed in,
// so every rule runs under unit tests with time the test controls.
//
// The order is the requirement's: who sent it first, so a datagram from a
// sender not on the list is dropped having been looked at for nothing but its
// address; then its size; then its sender's rate. The queue to the adapter is
// the listener's, and its own reason.
use std::collections::HashMap;
use std::net::IpAddr;
use std::time::Instant;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Limits {
    // The largest datagram passed on, in bytes.
    pub max_bytes: usize,
    // Each sender's sustained rate and the burst it may send at once, in
    // datagrams. A burst has to hold WSJT-X answering Replay, which is every
    // decode in its window at once.
    pub per_second: f64,
    pub burst: f64,
    // Datagrams waiting for the adapter, at most.
    pub queue: usize,
    // Replies to one sender, at most, per minute (QGD-INT-0009).
    pub replies_per_minute: u32,
}

// Why a datagram was dropped, as the counts and the page name it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Drop {
    NotAllowed,
    TooLarge,
    OverRate,
    QueueFull,
}

impl Drop {
    pub const ALL: [Drop; 4] = [Drop::NotAllowed, Drop::TooLarge, Drop::OverRate, Drop::QueueFull];

    pub fn word(self) -> &'static str {
        match self {
            Drop::NotAllowed => "not-allowed",
            Drop::TooLarge => "too-large",
            Drop::OverRate => "over-rate",
            Drop::QueueFull => "queue-full",
        }
    }
}

// An address as one sender, however it arrived: an IPv4 sender reaching an
// IPv6 socket arrives as ::ffff:a.b.c.d, and is the same sender.
pub fn canonical(address: IpAddr) -> IpAddr {
    address.to_canonical()
}

struct Bucket {
    tokens: f64,
    at: Instant,
}

pub struct Gate {
    limits: Limits,
    allow: Vec<IpAddr>,
    buckets: HashMap<IpAddr, Bucket>,
    counts: HashMap<Drop, u64>,
}

impl Gate {
    pub fn new(limits: Limits, allow: &[IpAddr]) -> Gate {
        let mut list: Vec<IpAddr> = allow.iter().map(|address| canonical(*address)).collect();
        list.sort();
        list.dedup();
        Gate { limits, allow: list, buckets: HashMap::new(), counts: HashMap::new() }
    }

    pub fn limits(&self) -> Limits {
        self.limits
    }

    pub fn allows(&self, sender: IpAddr) -> bool {
        self.allow.contains(&canonical(sender))
    }

    // Whether a datagram of `length` bytes from `sender` is passed on. A drop
    // is counted here, by its reason.
    pub fn admit(&mut self, sender: IpAddr, length: usize, now: Instant) -> Result<(), Drop> {
        let verdict = self.decide(canonical(sender), length, now);
        if let Err(reason) = verdict {
            self.count(reason);
        }
        verdict
    }

    fn decide(&mut self, sender: IpAddr, length: usize, now: Instant) -> Result<(), Drop> {
        if !self.allow.contains(&sender) {
            return Err(Drop::NotAllowed);
        }
        if length > self.limits.max_bytes {
            return Err(Drop::TooLarge);
        }
        // Only a sender on the list has a bucket, so the map is no longer
        // than the list, whatever arrives.
        let Limits { per_second, burst, .. } = self.limits;
        let bucket = self.buckets.entry(sender).or_insert(Bucket { tokens: burst, at: now });
        let elapsed = now.saturating_duration_since(bucket.at).as_secs_f64();
        bucket.tokens = (bucket.tokens + elapsed * per_second).min(burst);
        bucket.at = now;
        if bucket.tokens < 1.0 {
            return Err(Drop::OverRate);
        }
        bucket.tokens -= 1.0;
        Ok(())
    }

    pub fn count(&mut self, reason: Drop) {
        *self.counts.entry(reason).or_insert(0) += 1;
    }

    pub fn dropped(&self, reason: Drop) -> u64 {
        self.counts.get(&reason).copied().unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    const LIMITS: Limits = Limits { max_bytes: 100, per_second: 2.0, burst: 3.0, queue: 8, replies_per_minute: 6 };

    fn ip(text: &str) -> IpAddr {
        text.parse().unwrap()
    }

    #[test]
    fn a_sender_not_on_the_list_is_dropped_whatever_it_sends() {
        let mut gate = Gate::new(LIMITS, &[ip("127.0.0.1")]);
        let now = Instant::now();
        assert_eq!(gate.admit(ip("192.168.1.9"), 10, now), Err(Drop::NotAllowed));
        // Not-allowed is decided first: an oversized datagram from a stranger
        // is a stranger's, and is not looked at for its size.
        assert_eq!(gate.admit(ip("192.168.1.9"), 10_000, now), Err(Drop::NotAllowed));
        assert_eq!(gate.dropped(Drop::NotAllowed), 2);
        assert_eq!(gate.dropped(Drop::TooLarge), 0);
    }

    #[test]
    fn an_ipv4_sender_on_an_ipv6_socket_is_the_same_sender() {
        let mut gate = Gate::new(LIMITS, &[ip("127.0.0.1")]);
        assert!(gate.admit(ip("::ffff:127.0.0.1"), 10, Instant::now()).is_ok());
        let mapped = Gate::new(LIMITS, &[ip("::ffff:10.0.0.5")]);
        assert!(mapped.allows(ip("10.0.0.5")));
    }

    #[test]
    fn there_is_no_anyone_entry() {
        // An unspecified address on the list is an address, not a wildcard.
        let mut gate = Gate::new(LIMITS, &[ip("0.0.0.0"), ip("::")]);
        assert_eq!(gate.admit(ip("10.0.0.5"), 10, Instant::now()), Err(Drop::NotAllowed));
        assert_eq!(gate.admit(ip("127.0.0.1"), 10, Instant::now()), Err(Drop::NotAllowed));
    }

    #[test]
    fn a_datagram_over_the_size_is_dropped() {
        let mut gate = Gate::new(LIMITS, &[ip("127.0.0.1")]);
        let now = Instant::now();
        assert!(gate.admit(ip("127.0.0.1"), 100, now).is_ok());
        assert_eq!(gate.admit(ip("127.0.0.1"), 101, now), Err(Drop::TooLarge));
        assert_eq!(gate.dropped(Drop::TooLarge), 1);
    }

    #[test]
    fn a_sender_over_its_rate_is_dropped_until_it_slows() {
        let mut gate = Gate::new(LIMITS, &[ip("127.0.0.1")]);
        let start = Instant::now();
        for _ in 0..3 {
            assert!(gate.admit(ip("127.0.0.1"), 10, start).is_ok());
        }
        assert_eq!(gate.admit(ip("127.0.0.1"), 10, start), Err(Drop::OverRate));
        // Half a second at two a second is one more.
        let later = start + Duration::from_millis(500);
        assert!(gate.admit(ip("127.0.0.1"), 10, later).is_ok());
        assert_eq!(gate.admit(ip("127.0.0.1"), 10, later), Err(Drop::OverRate));
        // Quiet for long enough, the whole burst is back and no more.
        let rested = later + Duration::from_secs(60);
        for _ in 0..3 {
            assert!(gate.admit(ip("127.0.0.1"), 10, rested).is_ok());
        }
        assert_eq!(gate.admit(ip("127.0.0.1"), 10, rested), Err(Drop::OverRate));
        assert_eq!(gate.dropped(Drop::OverRate), 3);
    }

    #[test]
    fn each_sender_has_its_own_rate() {
        let mut gate = Gate::new(LIMITS, &[ip("10.0.0.1"), ip("10.0.0.2")]);
        let now = Instant::now();
        for _ in 0..3 {
            assert!(gate.admit(ip("10.0.0.1"), 10, now).is_ok());
        }
        assert_eq!(gate.admit(ip("10.0.0.1"), 10, now), Err(Drop::OverRate));
        assert!(gate.admit(ip("10.0.0.2"), 10, now).is_ok());
    }
}
