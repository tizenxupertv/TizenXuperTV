/**
 * Time stamp for the Pi's log lines: the Pi's local time (America/Bogota), "2026-11-21 00:35:12".
 * Built by hand rather than with toLocaleString, whose format depends on the ICU data Node ships with.
 * The shell scripts write the same format with: date '+%Y-%m-%d %H:%M:%S'
 */
export function logTime(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
