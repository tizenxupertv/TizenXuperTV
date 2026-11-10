/**
 * Portal errors as the viewer should read them. The portal answers in Chinese with codes such as
 * "v8/active -> portal100024 所在区域为黑名单，栏目不可见" ("your area is blacklisted, the section is not visible").
 * No relative imports, so tests can load this file in Node.
 */

export const REGION_BLOCKED_TITLE = 'No disponible en tu región';
export const REGION_BLOCKED_TEXT =
  'Este contenido tiene restricción geográfica en tu región o con tu proveedor de internet. ' +
  'Es un bloqueo del portal, no de tu TV: cambiar el DNS no lo resuelve. Puedes probar con otra conexión a internet.';

function errorText(err: unknown): { code: string; message: string } {
  if (!err) return { code: '', message: '' };
  if (typeof err === 'string') return { code: '', message: err };
  const e = err as { portalCode?: unknown; message?: unknown };
  return { code: String(e.portalCode || ''), message: String(e.message || '') };
}

/** The portal refuses the title or channel for the viewer's region or internet provider */
export function isRegionBlocked(err: unknown): boolean {
  const { code, message } = errorText(err);
  return /100024$/.test(code) || /\b(portal)?100024\b/.test(message) || /黑名单/.test(message);
}

/** Text for the viewer: region blocks explained in Spanish; other portal errors without the Chinese text */
export function friendlyPortalError(err: unknown, fallback = 'No se pudo obtener el video del portal.'): string {
  if (isRegionBlocked(err)) return REGION_BLOCKED_TEXT;
  const { code, message } = errorText(err);
  if (!message) return fallback;
  // "path -> portal100031 <Chinese text>": keep only the code
  if (/[㐀-鿿]/.test(message)) {
    const found = code || (message.match(/\b[a-z]+\d{6}\b/i) || [''])[0];
    return found ? `El portal rechazó la solicitud (código ${found}).` : fallback;
  }
  return message;
}
