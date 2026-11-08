# Guía de Instalación de TizenXuper TV con Apps2Samsung

Esta guía detalla paso a paso cómo instalar **TizenXuper TV** en cualquier Smart TV Samsung (modelos 2018 en adelante, con Tizen OS 4.0 hasta 9.0+) utilizando la herramienta oficial **Apps2Samsung** (disponible para teléfonos Android y computadoras Windows, macOS o Linux).

La instalación se realiza mediante la **descarga directa del archivo de la app (`TizenXuperTV.wgt`)** y su carga en Apps2Samsung, lo que garantiza tener siempre la versión más reciente y estable.

---

## 📋 Requisitos Previos

1. **Smart TV Samsung** encendido y conectado a tu red Wi-Fi o por cable de red.
2. **Teléfono Android o Computadora (Windows, Mac o Linux)** conectada a la **misma red Wi-Fi/local** que el televisor (no sirve red de invitados).
3. **Descarga del paquete oficial:**
   - 📦 **[Descargar TizenXuperTV.wgt (Enlace directo último release)](https://github.com/tizenxupertv/TizenXuperTV/releases/latest/download/TizenXuperTV.wgt)**
   - O solicítalo directamente al bot de Telegram: [@TizenXuperSupportBot](https://t.me/TizenXuperSupportBot) en la opción **🆕 Última versión**.
4. **Herramienta Apps2Samsung instalada:**
   - Descarga gratuita para Android, Windows, Mac o Linux desde: [apps2samsung.com](https://apps2samsung.com/).

---

## 📺 PASO 1: Activar el Modo Desarrollador en el Televisor

Este paso se realiza una sola vez para permitir que el televisor acepte aplicaciones enviadas desde tu teléfono o computadora:

1. **Anota la IP de tu teléfono o computadora:**
   - En Android: **Ajustes > Wi-Fi > rueda de ajustes ⚙️ junto a tu red > Dirección IP**.
   - En Windows: **Configuración > Red e Internet > Wi-Fi > Propiedades > Dirección IPv4**.
   - En Mac: **Ajustes del Sistema > Wi-Fi > Detalles... > TCP/IP > Dirección IP**.
2. En tu televisor Samsung, abre el menú de **Apps** (la tienda de aplicaciones de Smart Hub).
3. Con el control remoto, marca la siguiente secuencia numérica, uno tras otro:
   ```text
   1  2  3  4  5
   ```
   *(Si tu control remoto no tiene teclado numérico físico, presiona el botón `123` para ver el teclado en pantalla).*
4. Aparecerá la ventana **Developer Mode Configuration** (Modo desarrollador):
   - Cambia el interruptor a **ON**.
   - En el campo **Host PC IP**, escribe la dirección IP de tu **teléfono o computadora** (la que anotaste en el punto 1).
   - Presiona **OK** / **Aceptar**.
5. **Reinicia completamente la TV (Obligatorio):**
   - Mantén presionado el botón de **Encendido/Power** del control remoto durante **5 segundos** hasta que la pantalla se apague y vuelva a encenderse con el logo de Samsung.
   - O bien, desconecta el cable de corriente del televisor 10 segundos y vuelve a conectarlo.

---

## 🔍 PASO 2: Conectar Apps2Samsung a la TV

1. Abre **Apps2Samsung** en tu teléfono Android o computadora.
2. En la pestaña principal **Install**, la herramienta buscará tu televisor automáticamente.
3. Cuando aparezca tu modelo con el estado **Ready for use** / **Ready to install**, ya estará conectada.
   - *Si no aparece automáticamente:* Pulsa en **Add TV by IP…**, consulta la IP de tu TV en **Configuración de la TV > General > Red > Estado de la red > Configuración de IP** e introdúcela manualmente.
4. Si la pantalla del televisor muestra una advertencia preguntando si deseas permitir la conexión, pulsa **Permitir** con el control remoto.

> 💡 **Nota sobre la cuenta Samsung (solo la primera vez):** Apps2Samsung te pedirá iniciar sesión con tu cuenta Samsung gratuita para crear y almacenar el certificado de seguridad de tu televisor. Una vez creado, se guarda para siempre.

---

## 💻 PASO 3: Cargar e Instalar el archivo TizenXuperTV.wgt

Dado que la app se instala mediante descarga directa, selecciona el archivo descargado en el Paso Previo según tu dispositivo:

### Opción A: Desde computadora (Windows, Mac o Linux)
1. En la parte superior derecha de Apps2Samsung, haz clic en el botón:
   - **`Install a file…`** (o **`Browse WGT / TPK`**).
2. Selecciona el archivo **`TizenXuperTV.wgt`** que descargaste.
3. Haz clic en **Install on [Nombre de tu TV]**.

### Opción B: Desde teléfono Android
1. En la pestaña **Install**, desplázate hacia abajo por debajo de los resultados de búsqueda.
2. Toca en la opción **`Your own package › WGT / TPK`**.
3. Selecciona el archivo **`TizenXuperTV.wgt`** guardado en las descargas de tu teléfono.
4. Toca en **Install on [Nombre de tu TV]**.

---

### Proceso de instalación automática:
Apps2Samsung realizará automáticamente en 10 a 25 segundos:
- Firma digital del paquete con el certificado exclusivo de tu televisor.
- Envío e instalación del archivo en el sistema Tizen.
- Verás el mensaje de confirmación **"Installation Successful"** o **"App Installed"**.

---

## 🚀 PASO 4: Abrir la App e Iniciar Sesión

1. En el televisor, presiona el botón **Home** (Inicio / Casa) del control remoto.
2. Abre **Apps > Apps descargadas** y encontrarás el icono de **TizenXuper TV**.
   - *Consejo:* Mantén presionado el botón OK sobre el icono y selecciona **"Agregar a Inicio"** para que quede fijada en tu barra principal.
3. Abre la app:
   - Verás en pantalla el código QR temporal de inicio de sesión.
   - Abre la cámara de tu celular, apunta al QR y confirma en Telegram con un solo toque: **"📺 Sí, iniciar sesión en la TV"**.
   - ¡Listo! La app se abrirá automáticamente en tu televisor.

---

## 🔄 ¿Cómo se actualiza la app en el futuro?

**¡No necesitas volver a usar la computadora ni Apps2Samsung para actualizar!**  
TizenXuper TV cuenta con un motor de actualización automática por internet (OTA). Cada vez que publiquemos una nueva versión, tu televisor la descargará silenciosamente en segundo plano y se actualizará sola al abrirla, conservando intactos todos tus favoritos, canales y ajustes.
