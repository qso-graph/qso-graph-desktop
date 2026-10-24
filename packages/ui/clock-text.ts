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
