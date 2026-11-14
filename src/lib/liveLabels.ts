/**
 * Texts of TV en vivo as the app shows them. Names of portal live categories: some come with an internal name. Only the shown name
 * changes; the category id (what the portal is asked for) stays the same.
 * No imports, so tests can load this file in Node.
 */
const RENAMES: Record<string, string> = {
  channellist: 'Todos los canales'
};

export function liveCategoryName(raw: string | undefined): string {
  const name = String(raw || '').trim();
  return RENAMES[name.toLowerCase().replace(/[\s_-]+/g, '')] || name;
}

/**
 * The line under a channel's name: its programme when it has one. "En vivo" (what most channels carry when there
 * is no guide) says nothing every channel does not already say, so it shows as no line.
 */
export function liveProgramLine(now: string | undefined): string {
  const text = String(now || '').trim();
  return /^en vivo$/i.test(text) ? '' : text;
}
