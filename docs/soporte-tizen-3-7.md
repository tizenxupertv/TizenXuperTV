# Soporte Tizen 3-4 y 5-7: auditoría y plan

Referencia: análisis de `XuperEclectic-2.0.36b.wgt` (solo técnicas generales de compatibilidad, sin copiar código ni fuentes).

## Estado actual (nuestro proyecto)
- Bundle IIFE clásico (sin `type=module`), fallbacks px para `min/max/clamp` (`vite-tv-compat.ts`).
- `isLowMemoryTv` (Tizen <= 4): back buffer de 10 s.
- `html.legacy-video` (Tizen <= 6.0): caja de preview plana.
- VOD: decide MSE o AVPlay con `mseUnsupportedReason` y registra el motivo.
- `tizen-bridge.js` (76 KB) con polyfills; hls.js (543 KB) y crypto-js (219 KB) siempre cargados.
- Arranque: `index-*.js` 663 KB + CSS 194 KB, React 18.

## Diferencias frente a la referencia
| Tema | Referencia | Nosotros |
|---|---|---|
| Perfiles de motor | 3 perfiles (legacy / mid / modern) con buffer adelante 14/20 s, tolerancia de sync, un solo SourceBuffer en legacy | Un solo criterio de memoria (<= 4) y un flag visual (<= 6.0) |
| Sondeo de capacidades | HEVC/AVC/AAC por `isTypeSupported` al arrancar | Solo al abrir cada VOD |
| Audio | Reloj WebAudio propio (ADTS) | `audioContinuity.ts` existe pero no está conectada al live de AVPlay |
| HEVC | Filtro RASL y recorte de audio al primer keyframe | No |
| Arranque | JS plano, sin framework | React + bundle grande |
| Catálogos | Incluidos en el paquete | Red al arrancar |

## Plan propuesto (de menor a mayor riesgo)
1. **Perfil por generación** (`src/lib/tvProfile.ts`): una función única `getTvProfile()` con tier legacy (<=4), mid (5-7), modern (>=8) y parámetros (buffer adelante/atrás, `maxBufferLength`, concurrencia). Reemplaza `isLowMemoryTv`/`isLegacyVideoTv` sin cambiar su comportamiento. Con tests.
2. **Parámetros hls.js por tier**: `maxBufferLength`, `maxMaxBufferLength`, `backBufferLength` según perfil (legacy 14/20 s).
3. **Sondeo de capacidades al arrancar** y mostrarlo en Perfil > Diagnóstico y en el reporte (tier, MSE HEVC/AVC/AAC).
4. **Cargar hls.js y crypto-js bajo demanda** en tier legacy (menos parseo al arrancar).
5. **Conectar `audioContinuity` al live** solo en tier legacy y detrás de un interruptor, para probar con testers.
6. **Medir arranque** en Tizen 3/4 (tiempo hasta el primer frame de UI) antes y después.

## Datos que faltan
Reportes con el log de reproducción (v1.13.2+) de TVs Tizen 3, 4, 5 y 6/7: modelo, qué falla y en qué motor (HLS.js / AVPlay / MSE).
</parameter>
</invoke>
