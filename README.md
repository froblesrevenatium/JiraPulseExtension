# Jira My Tasks — Chrome Extension

Extensión de Chrome que muestra tus tareas abiertas de Jira en el badge de la barra de herramientas y en un popup.

## Funcionalidad

- Muestra el conteo de tareas abiertas (sin resolver) asignadas a ti en el badge del ícono — excluye las marcadas como **Por implementar**
- Lista las tareas agrupadas por estado, con su clave y resumen, en el popup
- Incluye al final una sección de tareas **Finalizadas (últimos N días)** —N se configura en Opciones, 7 por defecto—, ordenadas por fecha de resolución (más reciente primero) y con la fecha visible a la derecha — no se cuentan en el badge
- Las tareas que pasaste al estado **"Con Soporte"** (bugs/tickets simples reenviados a soporte tras solucionarlos) también aparecen como finalizadas, aunque Jira las reasigne y no tengan resolución formal — se ordenan por su fecha de última actualización
- Estatus local **Por implementar**: las tareas en curso (`En curso`, `En progreso`, `In progress`) muestran un check que las mueve a la sección **Por implementar**, ubicada antes de las finalizadas. Ahí conservan el check para regresarlas a **En curso** y muestran a la derecha la fecha y hora en que se enviaron a ese estatus (ordenadas de la más reciente a la más antigua). Es solo visual: no modifica nada en Jira
- Si una tarea marcada deja de estar en curso en Jira (se resuelve, pasa a "Con Soporte", etc.), se desmarca automáticamente y aparece en su sección normal
- El código de cada tarea (`.key`) se colorea según su estado: azul (en curso), gris (pendiente/otros), ámbar (por implementar), verde (finalizada)
- Cada tarea es un enlace directo a Jira
- Botón **MD** por tarea: copia al portapapeles el ticket completo en Markdown (metadatos, descripción y todos los comentarios con autor y fecha)
- Botón **⬇** por tarea: descarga el ticket en Markdown junto con sus adjuntos a `Descargas/jira/{KEY}/`, listo para entregarlo a un agente como Claude Code (ver [Exportar tickets para agentes](#exportar-tickets-para-agentes))
- Estatus ocultos: en Opciones → **Estatus visibles** se desmarcan los estatus cuyas tareas no quieres ver. Solo se listan los estatus de tus tareas actuales (con su conteo); los ya ocultos que hoy no tienen tareas aparecen como "sin tareas actualmente" para poder reactivarlos. Las tareas ocultas no se muestran en el popup ni cuentan en el badge, y el popup indica cuántas hay ocultas con un enlace a Opciones. Se guarda al instante, sin pedir credenciales
- Actualización automática cada 5 minutos
- Actualización contra Jira cada vez que se abre el popup, sin límite
- Si Jira falla (credenciales inválidas, sin conexión, dominio incorrecto, límite de solicitudes) el badge muestra **!** en rojo y el popup un aviso con la causa y la hora; la lista se queda con los últimos datos obtenidos

## Estructura de archivos

```
JiraExtension/
├── manifest.json       # Configuración de la extensión (Manifest V3)
├── shared.js           # Estados en curso, días de finalizadas, estatus ocultos y normalización de pendingImplementation (popup, background y opciones)
├── background.js       # Service worker: fetch de tareas, badge, alarmas
├── popup.html          # UI del popup
├── popup.js            # Lógica del popup (incluye botones MD y ⬇)
├── markdown.js         # Fetch de ticket + comentarios y conversión ADF → Markdown (popup y background)
├── exporter.js         # Exportación a carpeta con adjuntos vía chrome.downloads (background)
├── options.html        # Página de configuración
├── options.js          # Lógica de configuración y selector de estatus visibles
├── icon32.png
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Instalación

1. Abre Chrome y ve a `chrome://extensions/`
2. Activa **Modo desarrollador** (esquina superior derecha)
3. Haz clic en **Cargar extensión sin empaquetar**
4. Selecciona la carpeta `JiraExtension`

## Configuración

1. Haz clic derecho en el ícono de la extensión → **Opciones**
2. Completa los campos:
   - **Dominio**: tu instancia de Jira (ej. `tuempresa.atlassian.net`)
   - **Email**: tu correo de cuenta Atlassian
   - **API Token**: token generado en [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
   - **Días de tareas finalizadas**: rango de la sección Finalizadas, entero de 1 a 365 (por defecto 7)
3. Guarda — la extensión hace fetch inmediato y actualiza el badge

## Arquitectura

### Flujo de datos

```
options.js
  ├─ guarda { jiraDomain, jiraEmail, jiraToken, doneDays } en chrome.storage.local
  └─ lista los estatus de jiraTasks (+ los ocultos sin tareas) y guarda hiddenStatuses al marcar/desmarcar

background.js (service worker)
  ├─ escucha cambios en storage → refresca tareas
  ├─ alarma cada 5 min → refresca tareas (se crea solo si no existe)
  ├─ fetch: GET https://{domain}/rest/api/3/search/jql (pagina con nextPageToken hasta isLast)
  │    JQL: (assignee = currentUser() AND (resolution = Unresolved OR resolutiondate >= -{N}d))
  │         OR (status = "Con Soporte" AND assignee was currentUser() AND updated >= -{N}d)
  │    N = doneDays (Opciones, 1–365, por defecto 7)
  │    Auth: Basic base64(email:token)
  │    maxResults: 50 por página
  ├─ si falla: badge "!" rojo y guarda jiraError { message, at } (el popup lo muestra); al tener éxito lo borra
  ├─ marca cada tarea con done = (resolution != null) OR (status == "Con Soporte")
  │    resolutionDate = resolutiondate, o updated si es un traspaso a soporte sin resolución
  ├─ depura pendingImplementation: conserva solo claves (y su fecha) de tareas que siguen en curso
  ├─ guarda tareas en chrome.storage.local.jiraTasks (y pendingImplementation depurado)
  ├─ actualiza badge con el conteo de tareas SIN resolver (done = false), no marcadas como Por implementar y con estatus visible
  │    (azul = conteo, rojo "!" = sin configurar o error de Jira)
  ├─ escucha cambios en pendingImplementation o hiddenStatuses → recalcula el badge
  ├─ mensaje "refresh" del popup → fetch inmediato, sin límite
  └─ mensaje "exportIssue" del popup → exportIssue(key) (exporter.js), responde { ok, folder, downloaded, skipped }

popup.js
  ├─ lee jiraTasks desde storage → separa abiertas (done=false) de finalizadas (done=true)
  ├─ lee pendingImplementation (claves marcadas como Por implementar)
  ├─ descarta las tareas cuyo estatus está en hiddenStatuses (sin distinguir mayúsculas) y muestra cuántas se ocultaron
  ├─ renderiza abiertas agrupadas por estado (banner gris neutro, código coloreado por estado)
  │    las tareas en curso muestran un check; al marcarlo se guarda { clave: fecha ISO } en pendingImplementation
  ├─ renderiza la sección "Por implementar" con las tareas marcadas, su fecha de envío y el check activo para regresarlas
  ├─ muestra jiraError como aviso bajo el encabezado
  ├─ renderiza finalizadas al final, ordenadas por resolutionDate desc, con la fecha a la derecha
  ├─ botón MD → issueToMarkdown(key) (markdown.js) → navigator.clipboard.writeText
  ├─ botón ⬇ → mensaje "exportIssue" al background (la descarga sigue aunque se cierre el popup)
  ├─ solicita refresh al background worker
  └─ escucha cambios en storage → re-renderiza en tiempo real
```

### Conversión a Markdown (markdown.js)

```
fetchIssue(key)
  ├─ GET /rest/api/3/issue/{key}?fields=summary,status,issuetype,priority,assignee,reporter,created,updated,description,attachment
  └─ GET /rest/api/3/issue/{key}/comment?startAt=N&maxResults=100&orderBy=created  (pagina hasta total)

buildIssueMarkdown(data, mediaRenderer, extraSections)
  └─ # KEY: resumen → metadatos → ## Descripción → ## Comentarios (n) → ### Autor — fecha → extraSections
```

La descripción y los comentarios vienen en ADF (Atlassian Document Format). Nodos soportados: párrafos, encabezados, negrita/cursiva/tachado/código, enlaces, menciones, emojis, listas (anidadas, numeradas y checklists), bloques de código con lenguaje, citas, paneles, expand, tablas, separadores, fechas, status y smart links. Los nodos `media` se delegan a `mediaRenderer`: por defecto `_[Adjunto: nombre]_`; en la exportación, un enlace al archivo local.

### Exportación con adjuntos (exporter.js)

```
exportIssue(key)
  ├─ fetchIssue(key)
  ├─ planAttachments: nombre local saneado ([^\w.-] → _), con prefijo {id}- si se repite
  ├─ por cada adjunto ≤ 10 MB (MAX_ATTACHMENT_BYTES):
  │    GET /rest/api/3/attachment/content/{id}?redirect=false → base64 → data URL
  │    chrome.downloads.download → jira/{KEY}/attachments/{nombre}
  ├─ media en ADF se enlaza al adjunto por nombre (attrs.alt == attachment.filename):
  │    imagen → ![nombre](attachments/nombre), otro → [nombre](attachments/nombre)
  │    si varios adjuntos comparten nombre → aviso con enlaces a todos los candidatos
  │    > 10 MB o con error → enlace a Jira con aviso "no descargado"
  ├─ agrega sección ## Adjuntos (n) con todos los adjuntos
  └─ chrome.downloads.download → jira/{KEY}/{KEY}.md
```

Las descargas usan `conflictAction: "overwrite"` y `saveAs: false`: volver a exportar reemplaza los archivos y nunca se abre el diálogo de "Guardar como".

### Permisos (manifest.json)

| Permiso | Uso |
|---|---|
| `storage` | Guardar credenciales, caché de tareas, tareas marcadas como Por implementar, días de finalizadas y estatus ocultos |
| `alarms` | Programar actualización automática cada 5 min |
| `downloads` | Guardar el ticket exportado y sus adjuntos en `Descargas/jira/` |
| `https://*.atlassian.net/*` | Llamadas a la API de Jira |

## Stack tecnológico

- Vanilla JavaScript (sin dependencias externas)
- Chrome Extension APIs: `chrome.storage`, `chrome.alarms`, `chrome.action`, `chrome.runtime`, `chrome.downloads`
- Jira REST API v3
- Manifest V3

## Notas

- El estado "Con Soporte" que cuenta como finalizado está fijado en `background.js` (`SUPPORT_STATUS`, comparación insensible a mayúsculas). Si el nombre del estado cambia en Jira, hay que actualizarlo ahí.
- El operador `assignee was currentUser()` depende de que la instancia de Jira lo soporte para el historial de asignación; verificar tras cualquier cambio de permisos o plan de Jira.
- El estatus **Por implementar** vive solo en `chrome.storage.local.pendingImplementation` (objeto `{ clave: fecha ISO de envío }`). No se sincroniza entre navegadores ni equipos, y se pierde si se desinstala la extensión. Las tareas marcadas con la versión anterior (arreglo de claves) se conservan, pero sin fecha.
- Los adjuntos de más de 10 MB no se descargan (`MAX_ATTACHMENT_BYTES` en `exporter.js`); quedan como enlace a Jira, que requiere sesión iniciada.
- El enlace entre imágenes incrustadas y adjuntos se hace por nombre de archivo (`attrs.alt` del nodo `media`). Si Jira no incluye `alt`, la imagen queda como `_[Adjunto]_` en su posición, pero el archivo sigue descargado y listado en la sección **Adjuntos**.
- Los estados considerados "en curso" están definidos una sola vez en `shared.js` (`IN_PROGRESS_STATUSES`).

## Exportar tickets para agentes

El botón **⬇** genera:

```
~/Downloads/jira/PROJ-123/
├── PROJ-123.md
└── attachments/
    ├── captura-error.png
    └── log.txt
```

Las imágenes quedan referenciadas con rutas relativas en el punto exacto de la descripción o comentario donde aparecen, así el agente sabe a qué texto acompaña cada una. Claude Code puede leer el `.md` y abrir las imágenes directamente:

```
resuelve el ticket en ~/Downloads/jira/PROJ-123/PROJ-123.md
```

### Configuración de Claude Code (una sola vez)

`chrome.downloads` solo puede escribir dentro de la carpeta de descargas de Chrome, que queda fuera del proyecto del agente. Para que cualquier sesión de Claude Code lea los tickets sin pedir permiso, en `~/.claude/settings.json`:

```json
{
  "permissions": {
    "additionalDirectories": ["~/Downloads/jira"],
    "allow": ["Read(~/Downloads/jira/**)"]
  }
}
```

- Las sesiones abiertas deben reiniciarse para tomar el cambio.
- Si Chrome descarga en otra carpeta, ajustar la ruta.
- macOS pide una vez permiso a la terminal para acceder a Descargas.
- Alternativa por proyecto: `ln -s ~/Downloads/jira .jira` y agregar `.jira` a `.gitignore`.
- El contenido del ticket es texto de terceros: el agente debe tratarlo como datos, no como instrucciones (ver [Seguridad](#seguridad)).

## Seguridad

- Las credenciales se almacenan en `chrome.storage.local`, **sin cifrar**, dentro del perfil de Chrome: cualquier proceso con acceso a tu usuario puede leer el token. Usa un token dedicado a esta extensión y revócalo si el equipo se compromete
- Autenticación Basic Auth directamente a Atlassian — sin servidor intermediario
- Los tokens de API de Jira tienen permisos acotados y son revocables desde la cuenta de Atlassian
- Los tickets exportados y sus adjuntos quedan en disco sin cifrar en `Descargas/jira/`; borrarlos cuando ya no se necesiten si contienen información sensible
- El `.md` exportado incluye texto escrito por cualquier persona con acceso al ticket (descripción, comentarios, adjuntos). Al dárselo a un agente, ese texto puede contener instrucciones (prompt injection): revisa lo que el agente propone hacer antes de aprobarlo
