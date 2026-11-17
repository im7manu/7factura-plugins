# Temas

Cambia el aspecto de toda la aplicación. Lo elige el administrador y se aplica a todos los usuarios y a la pantalla de inicio de sesión.

Incluye: **Metro** (por defecto), **Gestor DeCA**, **Frutiger Aero**, **Windows clásico**, **Alto contraste** y **Nórdico** (con el menú arriba).

## Formato de un tema

```json
{
  "id": "mi-tema",
  "nombre": "Mi tema",
  "descripcion": "Para qué sirve o cómo es",
  "autor": "Tu nombre",
  "modo": "auto",
  "claro": { "canvas": "#F7F8FB", "surface": "#FFFFFF", "subtle": "#F0F2F7", "stroke": "#E2E5EB", "fg": "#202533", "muted": "#6D7483",
    "brand": "#4F79D8", "brand-hover": "#4267BA", "brand-fg": "#3155AA", "brand-soft": "#EEF3FF", "suite": "#FFFFFF", "suite-fg": "#202533",
    "danger": "#BD3F46", "success": "#2E8B66", "warning": "#B78120" },
  "oscuro": { "...": "los mismos colores para el modo oscuro (opcional)" },
  "fuente": "system-ui, sans-serif",
  "radio": 8,
  "sombra": "suave",
  "cristal": false,
  "relieve": false,
  "menu": "lateral",
  "iconos": { "trazo": 1.8 },
  "densidad": "normal",
  "fondo_app": "linear-gradient(180deg, #e0f0ff, #ffffff)",
  "mosaicos": { "blue": "#4F79D8", "teal": "#2E8B8B", "purple": "#7A63C9", "orange": "#D07A2C", "green": "#2E8B66", "magenta": "#B4508E", "slate": "#5A6275" }
}
```

| Campo | Qué cambia |
|---|---|
| `claro` / `oscuro` | Colores (`#RRGGBB`). `canvas` fondo de la página, `surface` tarjetas, `subtle` zonas suaves, `stroke` bordes, `fg` texto, `muted` texto secundario, `brand*` color de la marca (`brand-on`: texto sobre ese color), `suite` y `suite-fg` barra superior |
| `modo` | `auto` (cada usuario elige claro u oscuro), `claro` u `oscuro` (fijo). Sin `oscuro`, el tema es siempre claro |
| `fuente` | Familia tipográfica CSS (fuentes instaladas en el sistema) |
| `radio` | Redondeo de las esquinas en px (0 a 28) |
| `sombra` | `ninguna`, `suave` o `marcada` |
| `cristal` | Tarjetas y menús translúcidos con desenfoque |
| `relieve` | Bordes en 3D estilo escritorio clásico |
| `bordes` | Borde visible en todas las tarjetas (útil en alto contraste) |
| `menu` | `lateral` o `superior` |
| `iconos.trazo` | Grosor de los iconos (0.75 a 3) |
| `densidad` | `normal` o `compacta` |
| `fondo_app` | Degradados CSS de fondo (no se admiten imágenes externas) |
| `mosaicos` | Colores de los mosaicos del inicio |

Importa el JSON desde la pantalla del plugin. Si quieres que tu tema venga incluido para todos, añádelo a `temas/temas/` en el repositorio con un pull request.
