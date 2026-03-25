# Negocio - Google Apps Script

Sistema responsivo para móvil con Google Apps Script + Google Sheets + Google Drive.

## Incluye
- Login por cuenta Google del usuario (selector de cuenta con `AccountChooser`).
- Control de acceso por hoja `accesos` con roles `admin`, `vendedor`, `cliente`.
- Menú lateral dinámico según permisos.
- Módulos: inicio/publicidad, dashboard, ventas, inventario, libro diario, libro mayor, configuración, permisos.
- Inventario con imagen de producto + QR por producto guardados en Drive.
- Registro de ventas con actualización de stock, ticket, envío por correo al vendedor.

## Archivos
- `Code.gs`: backend (rutas, permisos, operaciones con Sheets/Drive/Mail).
- `Index.html`: layout principal.
- `Styles.html`: estilos responsive.
- `ClientJS.html`: SPA del frontend.

## Hojas esperadas
El sistema crea automáticamente si no existen:
- `configuracion`
- `accesos`
- `inventario`
- `ventas`
- `libro_diario`
- `libro_mayor`

## Configuración inicial
1. Cargar estos archivos en el proyecto de Apps Script.
2. Ajustar `SPREADSHEET_ID` y `ROOT_FOLDER_ID` en `Code.gs`.
3. Implementar como web app:
   - Ejecutar como: **Usuario que accede a la app**.
   - Acceso: según necesidad (dominio o cualquier usuario con Google).
4. Registrar al menos un usuario admin en la hoja `accesos`.
