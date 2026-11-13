# Plan de recuperación del catálogo dinámico

## Objetivo

Restaurar progresivamente el catálogo dinámico en TizenXuper tomando como referencia el flujo funcional de `XuperTV-XupAnd0001-backup`:

1. El TV genera y conserva un identificador local estable.
2. Solicita una sesión temporal de catálogo a un backend autorizado.
3. Recibe datos temporales de sesión.
4. Consulta el proveedor autorizado para categorías, títulos, búsqueda, ficha, TV en vivo y reproducción.

Este plan no contempla reutilizar credenciales, sesiones ni contenido de servicios de terceros sin autorización. Los secretos deben permanecer en el backend y nunca incluirse en la app de TV.

## Referencia funcional disponible

- Copia de referencia: `XuperTV-XupAnd0001-backup`.
- La copia se ha validado como funcional en un TV: carga catálogo y reproduce.
- La copia local en navegador confirma que los datos empaquetados permiten navegar fichas y recomendaciones; el navegador no sustituye la prueba de reproducción Tizen.

## Fase 1 — Inventario y mapa de compatibilidad

**Objetivo:** comparar el flujo de la copia funcional contra el cliente actual de TizenXuper.

**Tareas**

- Identificar dónde TizenXuper crea y guarda su ID de dispositivo.
- Identificar su gestor de sesión y el cliente de catálogo actual.
- Documentar el formato de datos que espera cada pantalla: categorías, listados, detalle, canales y reproducción.
- Crear una tabla de equivalencias entre los módulos de referencia y los módulos de TizenXuper.

**Entregable:** mapa de módulos y lista concreta de cambios, sin modificar aún el comportamiento de producción.

**Criterio de salida:** sabemos exactamente qué módulo alimenta cada pantalla de TizenXuper y qué contrato autorizado debe consumir.

### Resultado inicial de Fase 1

La revisión confirma que TizenXuper ya tiene los puntos de integración necesarios. No hace falta rediseñar la interfaz ni el reproductor para recuperar la navegación de catálogo.

| Responsabilidad | TizenXuper | Copia funcional | Estado |
| --- | --- | --- | --- |
| Identidad local por instalación | `src/services/accountService.ts` | `js/shared/session.js` | Existe; debe separarse de la sesión de cuenta si el proveedor exige su propia identidad de catálogo. |
| Sesión de cuenta de la app | `src/services/accountService.ts` | No aplica | Existe y es independiente del catálogo. |
| Adaptador de portal y sesión de catálogo | `public/js/magis-client.js` | `js/account/catalog-session.js`, `js/account/transport.js` | Existe; requiere revisar el contrato autorizado vigente antes de modificarlo. |
| Carga, caché y normalización de catálogo | `src/services/catalogService.ts` | `js/local-catalog.js` | Existe. Ya dispone de categorías, filas, paginación y caché. |
| Pantallas de catálogo | `src/app/useCatalog.ts`, `src/app/tabRows.ts`, `src/App.tsx` | Vistas del paquete de referencia | Existe. |
| TV en vivo | `src/app/useLiveTv.ts`, `src/views/LiveTvView.tsx` | Cliente de canales de la copia funcional | Existe. |
| Ficha y reproducción Tizen | `src/services/catalogService.ts`, `src/services/playerService.ts` | Cliente de detalle y reproductor de la copia funcional | Existe; se valida al final en TV. |

**Conclusión:** el primer cambio funcional debe concentrarse en el adaptador de sesión/catálogo y su contrato de datos. Las pantallas ya consumen datos normalizados y no deben ser el punto de partida.

**Siguiente comprobación local:** crear respuestas de prueba autorizadas para sesión, categorías y listados; conectarlas al adaptador actual y verificar Películas/Series en Chrome antes de instalar en el TV.

## Fase 2 — Identificador y sesión temporal

**Objetivo:** conseguir y renovar una sesión temporal desde un backend autorizado.

**Estado:** implementada. El televisor inicia primero su propia sesión con el portal, como en las versiones estables. Solo si eso falla pide una al servidor autorizado que ya usa el respaldo: `xuper-server-client.js` la solicita y `xuper-catalog-session.js` mantiene una identidad local estable y conserva esa sesión únicamente en memoria. Así la app no depende de ese servidor mientras el portal acepte al televisor (decisión del 13 de noviembre de 2026).

Las pruebas cubren la reutilización de una sesión vigente, la estabilidad del identificador local y el rechazo de respuestas incompletas. El siguiente control manual será confirmar en Chrome que el servidor devuelve un catálogo real y, después, repetirlo en el TV.

**Tareas**

- Generar un ID único por instalación y conservarlo de forma estable en el TV.
- Implementar la solicitud de sesión a través de un endpoint propio/autorizado.
- Mantener la sesión solo en memoria cuando sea posible y renovarla antes de su vencimiento.
- Manejar errores de red, sesión expirada y respuesta inválida.

**Prueba en TV:** iniciar la app dos veces; el ID debe mantenerse y la sesión debe renovarse sin pedir ninguna acción al usuario.

**Criterio de salida:** sesión válida, renovable y sin secretos embebidos en el paquete Tizen.

### Comprobación local inicial

Se añadió una prueba de contrato en `test/catalogFeatures.test.ts`. Simula un adaptador de portal autorizado y confirma que TizenXuper:

- recibe categorías;
- solicita una página de títulos con paginación;
- normaliza el título, año y metadatos para la UI.

La prueba no realiza ninguna conexión externa ni prueba reproducción. Es la base local para sustituir el simulador por el backend autorizado cuando se disponga de su contrato vigente.

### Vista local en navegador

El modo de desarrollo incluye un proveedor local de catálogo. Se activa únicamente con el parámetro `localCatalogMock=1` y no se incorpora al comportamiento normal de la app.

```text
http://127.0.0.1:5174/?localCatalogMock=1
```

En ese modo se omite el inicio de sesión y se usan títulos locales de prueba para Películas, Series, Infantil y Anime. Sirve para validar navegación y normalización antes de una prueba con el backend autorizado o en un TV.

### Adaptador de catálogo

`src/services/catalogProvider.ts` define el límite entre TizenXuper y una fuente de catálogo. La carga de inicio, categorías y páginas ya consume este adaptador. El cliente instalado y el simulador local son implementaciones intercambiables del mismo contrato.

El siguiente proveedor que se añada deberá implementar este contrato usando un backend autorizado, sin requerir cambios en las pantallas de Películas, Series o sus fichas.

## Fase 3 — Categorías y listados

**Objetivo:** devolver navegación de Películas y Series.

**Operaciones equivalentes:** categorías (`getNextColumns`) y listados (`v3/getShelveData`).

**Tareas**

- Conectar la pantalla de categorías al adaptador de catálogo.
- Cargar paginación, estados de carga y estado vacío.
- Normalizar los datos para no acoplar la UI al proveedor.
- Mostrar un error recuperable si el servicio no responde.

**Prueba en TV:** abrir Películas y Series, moverse entre filas y cargar más de una página.

**Criterio de salida:** ambas secciones muestran títulos, portadas y navegación fluida.

## Fase 4 — Búsqueda y ficha de contenido

**Objetivo:** completar la exploración de contenido.

**Operaciones equivalentes:** búsqueda (`v3/searchByName`) y detalle (`v4/getItemData`).

**Tareas**

- Integrar búsqueda con espera breve para no saturar el servicio.
- Presentar título, año, sinopsis, géneros, temporadas y episodios cuando existan.
- Validar estados sin resultados y elementos incompletos.

**Prueba en TV:** buscar varios títulos, abrir una ficha y recorrer temporadas/episodios.

**Criterio de salida:** búsqueda y ficha no rompen la navegación aunque falte algún metadato.

## Fase 5 — TV en vivo

**Objetivo:** restaurar lista y navegación de canales.

**Operación equivalente:** canales (`v6/getLiveData`).

**Tareas**

- Cargar grupos, canales y logos desde el adaptador.
- Conservar la selección y favoritos locales del usuario.
- Diferenciar claramente canal no disponible de error de catálogo.

**Prueba en TV:** navegar grupos, seleccionar varios canales y comprobar el mensaje de error cuando aplique.

**Criterio de salida:** la lista de TV es usable y los fallos no bloquean el resto de la app.

## Fase 6 — Reproducción autorizada

**Objetivo:** conectar reproducción de VOD y TV en vivo usando fuentes propias o autorizadas.

**Operaciones equivalentes:** inicio VOD, inicio live y selección de servidor/balanceo (`v10/startPlayVOD`, `v4/startPlayLive`, `v14/getSlbInfo`).

**Tareas**

- Adaptar la respuesta de reproducción al reproductor nativo de Tizen.
- Aplicar timeout, reintento limitado y cambio de servidor únicamente cuando el backend lo autorice.
- No registrar ni mostrar URLs firmadas, tokens ni cabeceras sensibles.

**Prueba en TV:** reproducir VOD y un canal en vivo durante varios minutos; probar reanudación y recuperación tras un corte breve de red.

**Criterio de salida:** reproducción estable en modelos Tizen soportados.

## Fase 7 — Operación y resiliencia

**Objetivo:** evitar que una caída de proveedor deje la app sin explicación.

**Tareas**

- Configurar aviso remoto de mantenimiento con título, mensaje, vigencia y secciones afectadas.
- Registrar métricas técnicas anonimizadas: disponibilidad, errores por operación y latencia.
- Definir reintentos con límite y pantalla de estado comprensible.
- Documentar un procedimiento de despliegue y reversión.

**Prueba en TV:** simular indisponibilidad controlada y verificar que el aviso se muestra sin bloquear el menú.

**Criterio de salida:** el usuario recibe un estado claro y el equipo puede diagnosticar el incidente.

## Orden de ejecución

| Bloque | Resultado visible |
| --- | --- |
| Fases 1–2 | Sesión controlada y lista para consumir catálogo. |
| Fase 3 | Películas y Series vuelven a navegarse. |
| Fase 4 | Búsqueda y fichas completas. |
| Fase 5 | TV en vivo vuelve a listar canales. |
| Fase 6 | Reproducción autorizada en TV. |
| Fase 7 | Mantenimiento y recuperación ante incidencias. |

## Próximo paso

Ejecutar la **Fase 1**: inventariar los módulos equivalentes de la copia funcional y del código actual de TizenXuper. No se modificará la app durante esa revisión.
