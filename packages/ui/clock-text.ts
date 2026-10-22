// SPDX-License-Identifier: GPL-3.0-only
// What the header clock says for one instant. Every part is read from the same
// Date, so the UTC date and the UTC time change together: at 00:00:00 UTC the
// date is already the new day (KI7MT asked, 2026-10-22). Pure, so it is tested
// at the edges rather than watched at midnight.
export interface ClockText {
  utcDate: string;
  utcTime: string;
  localTime: string;
}

const two = (value: number) => String(value).padStart(2, '0');

export function clockText(at: Date): ClockText {
  return {
    utcDate: `${at.getUTCFullYear()}-${two(at.getUTCMonth() + 1)}-${two(at.getUTCDate())}`,
    utcTime: `${two(at.getUTCHours())}:${two(at.getUTCMinutes())}:${two(at.getUTCSeconds())}`,
    localTime: `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`
  };
}

// Sunrise and sunset at the active location, for the header (QGD-FRM-0014).
// Read on the operator's own clock, as Local is (KI7MT, 2026-10-22: at home,
// portable or at a park the computer is where the operator is; operating
// remote, the events are still the station's, read on the clock in front of
// them). To the minute: the event is smeared by refraction and the horizon,
// so seconds would be false precision beside a clock that ticks them.
//
// Always sunrise then sunset, so nothing moves; whichever comes next is
// marked instead. After today's sunset the sunrise shown is tomorrow's, the
// next one the operator will see.
export interface SunText {
  sunrise?: string;
  sunset?: string;
  next?: 'sunrise' | 'sunset';
  // Where the sun neither rises nor sets today: "Sun up all day".
  allDay?: string;
}

export function sunText(now: Date, day: (at: Date) => { sunrise?: Date; sunset?: Date; allDay?: 'up' | 'down' }): SunText {
  const today = day(now);
  if (today.allDay) return { allDay: today.allDay === 'up' ? 'Sun up all day' : 'Sun down all day' };
  const local = (time: Date) => `${two(time.getHours())}:${two(time.getMinutes())}`;
  let sunrise = today.sunrise;
  if (today.sunset && now >= today.sunset) sunrise = day(new Date(now.getTime() + 86_400_000)).sunrise ?? sunrise;
  const upcoming = [
    ...(sunrise && sunrise > now ? [{ event: 'sunrise' as const, at: sunrise }] : []),
    ...(today.sunset && today.sunset > now ? [{ event: 'sunset' as const, at: today.sunset }] : [])
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  return {
    ...(sunrise ? { sunrise: local(sunrise) } : {}),
    ...(today.sunset ? { sunset: local(today.sunset) } : {}),
    ...(upcoming[0] ? { next: upcoming[0].event } : {})
  };
}
