# VentaBox · Panel web de consulta (celular)

Web **estática** de consulta remota (solo lectura) para ver inventario, ventas y movimientos
desde el celular. No necesita build: se sube tal cual a cualquier hosting estático.

## Cómo funciona

1. La app de escritorio sincroniza los datos a **Supabase** (solo la PC escribe).
2. El panel llama a la **Edge Function** `consulta` con el PIN del negocio.
3. La función valida el PIN (con límite de intentos y sesiones de 12 h) y responde
   los datos; el panel los muestra. La clave `service_role` **nunca** viaja a esta web.

La Edge Function expone dos acciones (ver `supabase/functions/consulta/index.ts`):

| Acción | Cuerpo | Respuesta |
|---|---|---|
| `login` | `{ "action": "login", "pin": "1234" }` | `{ token, exp }` |
| `query` | `{ "action": "query", "token, "table", "qs" }` | filas de la tabla consultada |

## Configuración (`config.js`)

```
SUPABASE_URL   → Project URL, ej: "https://abcd1234.supabase.co"
FUNCTION_URL   → Se calcula: SUPABASE_URL + "/functions/v1/consulta"
ANON_KEY       → Clave "anon public" (Settings → API, NO es secreta)
```

Edita esos valores antes de desplegar. El `ANON_KEY` se manda en el header
`Authorization` porque Supabase lo exige, aunque la validación real la hace la
función con el PIN.

## Desplegar

### GitHub Pages (recomendado, gratis)
1. Haz push de este repo (el workflow [`.github/workflows/deploy-panel.yml`](../.github/workflows/deploy-panel.yml) despliega `panel/` solo).
2. En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Haz push a `main` que toque `panel/` o ejecuta manual: **Actions → Deploy Panel to GitHub Pages → Run workflow**.
4. Copia la URL (ej: `https://jrprogramsofficial.github.io/VENTABOX_INVENTORY/`) y pégala en la app de escritorio:
   **Configuración → Supabase · Acceso Online → Panel web → Guardar**
   (la app genera un QR para el celular).

### Netlify (gratis, alternativo)
1. Edita [`config.js`](config.js) con tu Project URL (el resto se calcula solo).
2. [netlify.com](https://netlify.com) → **Add new site → Deploy manually**.
3. Arrastra esta carpeta `panel/` (los 4 archivos: `index.html`, `style.css`, `app.js`, `config.js`).
4. Copia la URL (ej: `https://tu-panel.netlify.app`) y pégala en la app de escritorio:
   **Configuración → Supabase · Acceso Online → Panel web → Guardar**
   (la app genera un QR para el celular).

### Vercel (gratis)
`vercel deploy` desde esta carpeta, o importa el repo y usa `panel/` como root.

## Probar en local

Abre `panel/index.html` directamente en el navegador (o `python3 -m http.server`
dentro de la carpeta). La Edge Function acepta peticiones desde cualquier origen (CORS abierto).

## Requisitos previos

- Tener la base en la nube: tablas creadas con `supabase/migration.sql` y la
  Edge Function desplegada (`supabase/functions/consulta`). Guía completa en
  [`../supabase/README.md`](../supabase/README.md).
- Haber sincronizado la app al menos una vez (**Sincronizar ahora**) y haber definido
  el **PIN de consulta**.

## Notas de seguridad

- El PIN lo valida la Edge Function con rate-limit de intentos; las sesiones expiran a las 12 h.
- Los datos mostrados son el espejo de la última sincronización de la PC (nube de solo lectura).
- `anon` no puede leer las tablas: el RLS de Supabase bloquea todo acceso directo a la API de Postgres.