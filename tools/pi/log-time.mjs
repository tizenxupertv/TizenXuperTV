/**
 * Time stamp for the Pi's log lines, in the Pi's local time (America/Bogota): "Nov 21, 2026 12:58:27 am".
 * Built by hand rather than with toLocaleString, whose format depends on the ICU data Node ships with.
 * The shell scripts write the same format with their now() function.
 */
const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export function logTime(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const h = d.getHours() % 12 || 12;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${h}:${p(d.getMinutes())}:${p(d.getSeconds())} ${d.getHours() < 12 ? 'am' : 'pm'}`;
}
