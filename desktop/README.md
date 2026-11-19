# TizenXuper TV Desktop (Windows & macOS)

Empaquetado ligero en Electron que reutiliza el mismo `dist/` de React con un puente HTTP local (`127.0.0.1`) sin CORS (**0 consumo de Cloudflare Workers**).

## Probar en local
```bash
npm --prefix desktop install
npm --prefix desktop start
```

## Generar instaladores
- **macOS (`.dmg`, sin certificado Apple):** `npm --prefix desktop run dist:mac`
- **Windows (`.exe` instalador + portable):** `npm --prefix desktop run dist:win`

> **Nota macOS (sin certificado Apple):** la primera vez que un usuario abra la app descargada, debe hacer clic derecho → **Abrir** (o ejecutar `xattr -cr "/Applications/TizenXuper TV.app"`).
