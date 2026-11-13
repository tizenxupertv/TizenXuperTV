# Publicación y reversión de TizenXuper TV

Cómo sale una versión de la app a los televisores y qué hacer cuando una versión publicada sale mal.

Este documento se reconstruyó a partir del código y del historial del repositorio (noviembre de 2026). Los pasos de
publicación reflejan lo que muestran los commits y las publicaciones anteriores; si en la práctica haces algo distinto,
corrige el documento.

## Reglas que no cambian

- Las versiones las publica Julio. Ningún agente crea etiquetas ni publicaciones en GitHub.
- `dev` es la rama de las betas; `main` es producción. A `main` solo se llega fusionando `dev` cuando una beta se
  promueve a estable.
- La clave privada de la actualización automática vive fuera del repositorio (`~/.tizenxuper-update-key.pem`). No se
  copia, no se imprime y no se sube. Perderla obliga a que todos los televisores reinstalen; filtrarla permite a
  cualquiera enviar código a todos los televisores.
- Instalar o actualizar en un televisor nunca debe borrar los datos de la app. No se desinstala sin permiso expreso.
- Las notas de una beta describen los cambios como «para probar», nunca como «arreglado».
- Los textos públicos presentan la app como una interfaz; no dicen que ofrece canales, listas, películas ni series.

## Cómo llega una versión a un televisor

Hay dos caminos, y saber cuál aplica decide cómo se revierte.

**Actualización automática.** Es el camino normal.

1. La publicación de GitHub lleva dos archivos: `update-manifest.json` (firmado) y `update-bundle-<versión>.json`.
2. El bot (`/tv/update`) los reenvía a los televisores. Guarda en caché la última publicación 30 minutos; el aviso de
   GitHub al publicar, editar o borrar una publicación vacía esa caché antes.
3. Cada televisor pregunta un minuto después de arrancar, luego cada 6 horas y al volver al frente tras más de una
   hora. Descarga el paquete, comprueba la firma y lo guarda.
4. El código nuevo se usa **en el siguiente arranque** de la app, nunca mientras está en uso.

**Reinstalación del paquete.** Hace falta cuando cambia la «base» de la app: `index.html` aparte de la versión,
`config.xml`, `boot.js`, las librerías grandes, las imágenes o el servicio de proxy. En ese caso se sube `SHELL` en
`public/js/boot.js`, los televisores con la base anterior no reciben esa versión por sí solos y la app les avisa de
que deben reinstalar con el instalador.

**Canales.** Un televisor normal solo recibe la última versión estable. Uno con «Versiones beta: Sí» (Ajustes ›
Sobre nosotros) recibe la publicación más reciente, incluidas las preliminares.

**Dos protecciones que ya existen en `boot.js`:**

- Un televisor solo acepta una versión **mayor** que la que tiene. No existe la actualización hacia atrás.
- Si una versión descargada no llega a la primera pantalla en dos arranques seguidos, el televisor la marca como
  defectuosa y vuelve a ejecutar el paquete instalado. Esto cubre una versión que no arranca; no cubre una que
  arranca pero funciona mal.

## Publicar una beta

1. Rama `chore/release-x.y.z` desde `dev`. Sube la versión en `package.json` y en `public/config.xml`.
2. Valida: `npx tsc --noEmit` y `npm test`.
3. Compila: `npm run build`.
4. Registra la base y genera los archivos de actualización:
   - `node tools/update-release.mjs --init-shell` actualiza `update/shell.json` (el `index.html` cambia en cada
     versión porque lleva el número).
   - `node tools/update-release.mjs` escribe `build/update/update-bundle-x.y.z.json` y `update-manifest.json`. Si se
     niega, explica el motivo; el más habitual es que cambió un archivo de la base y hay que subir `SHELL`.
5. Paquete firmado para instalaciones nuevas: `bash tools/build-and-sign.sh` deja
   `build/TizenXuperTV_x.y.z_signed.wgt`.
6. Commit `chore(release): x.y.z beta`, fusión en `dev` con `--no-ff` y `git push origin dev`.
7. Prueba en un televisor antes de publicar: instala actualizando, sin desinstalar.
8. Publicación en GitHub **marcada como preliminar** y con `dev` como destino, etiqueta `vx.y.z`. Archivos: los dos de
   actualización, el `.wgt` firmado y la copia `TizenXuperTV.wgt`, como en las publicaciones anteriores.
9. El bot anuncia la preliminar en el grupo Beta, y la página de novedades (`tizenxuper-tv.pages.dev/novedades`)
   se actualiza sola con las notas de la publicación. No hay que ejecutar `npm run guide` para esto: ese comando
   republica las guías de telegra.ph y deja `src/guidePages.ts` del bot apuntando otra vez a la página antigua de
   novedades (comprobado el 13 de noviembre de 2026 con la 1.17.0).

## Promover una beta a estable

1. Comprueba que `main` local es igual a `origin/main`.
2. Fusiona `dev` en `main` (commit «Merge dev into main: x.y.z stable») y sube `main`.
3. Publicación en GitHub **sin** la marca de preliminar. Es la que pasa a ser «Latest» y la que reciben todos los
   televisores.

Si la estable lleva el mismo código que una beta ya publicada, necesita igualmente un número de versión mayor que el
de esa beta para que los televisores del canal beta no se queden en la preliminar.

## Cuando una versión publicada sale mal

Primero identifica el caso: de eso depende el arreglo.

### 1. Frenar el daño (minutos)

- **Avisa a los usuarios** desde el chat de soporte: `/avisotv on <mensaje>` muestra un aviso que se puede cerrar;
  `/mantenimiento on <mensaje>` sustituye la app por una pantalla. Se quitan con `/avisotv off`. Los televisores lo
  leen cada 15 minutos.
- **Corta la distribución**: borra la publicación defectuosa en GitHub, o márcala como preliminar si era una
  estable. Así deja de ser la «última» y los televisores que aún no la descargaron ya no la reciben. El bot conserva
  el paquete de cada versión hasta un día, pero solo lo entrega para la versión que figure como última.

Cortar la distribución **no arregla** los televisores que ya la descargaron: seguirán con ella, porque no existe la
actualización hacia atrás.

### 2. Arreglar los televisores afectados

**La versión arranca pero funciona mal.** Se corrige hacia adelante:

1. En `dev`, revierte los commits que causan el fallo (`git revert`, sin reescribir el historial) o corrige el
   problema.
2. Publica una versión con un número **mayor** que la defectuosa, siguiendo los pasos normales. Los televisores la
   toman en su siguiente comprobación y la usan en el siguiente arranque.

Plazo realista: hasta 6 horas para que un televisor encendido lo detecte, más el siguiente arranque de la app. Quien
abra la app después lo recibe al minuto de arrancar.

**La versión no arranca.** El propio televisor vuelve al paquete instalado tras dos arranques fallidos. Aun así,
publica la corrección con un número mayor: mientras la defectuosa siga siendo la última, no hay nada mejor que
ofrecerles.

**La versión cambió la base (`SHELL`) y es la base la que falla.** La actualización automática no puede arreglarlo.
Hay que publicar un paquete corregido e indicar a los usuarios que reinstalen con el instalador. Es el caso más caro:
antes de subir `SHELL`, prueba la versión en televisores de distintas generaciones.

### 3. Si solo era una beta

Solo afecta a los televisores con «Versiones beta: Sí». Borra la preliminar y publica la siguiente beta con la
corrección. Si hay prisa, el usuario puede poner «Versiones beta: No»: deja de recibir preliminares, pero conserva la
que ya tiene hasta que salga una estable con número mayor.

## El bot y la página

El bot se despliega directo a producción desde `main` de su propio repositorio; su procedimiento está en
`TizenXuper Bot/README.md`. Antes de cualquier despliegue del bot o de la página, comprueba que `main` local es igual
a `origin/main`: desplegar desde una copia atrasada elimina lo que otro haya desplegado.

Cloudflare conserva las versiones anteriores del Worker, así que un despliegue defectuoso del bot se puede deshacer
desde el panel de Cloudflare o con `npx wrangler rollback`. Este paso no se ha ensayado en este proyecto.

## Lista rápida antes de publicar

- [ ] `tsc` y pruebas en verde.
- [ ] `update-release.mjs` no se negó, o `SHELL` se subió a propósito.
- [ ] Probada en un televisor, instalada como actualización.
- [ ] Número de versión mayor que cualquier publicación anterior, betas incluidas.
- [ ] Preliminar marcada como tal y con `dev` como destino; estable desde `main`.
- [ ] Notas revisadas: «para probar» en las betas y sin prometer contenido.
