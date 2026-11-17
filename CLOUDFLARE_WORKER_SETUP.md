# Configuración del Worker de Lusy

Este archivo acompaña a `cloudflare-worker.js`. El Worker responde con el mismo formato Gemini que ya consume `script.js`, así que no hace falta exponer claves en GitHub Pages.

## Qué hace

Orden de proveedores:

1. Google Gemini (principal).
2. Cloudflare Workers AI (respaldo).
3. OpenRouter usando `openrouter/free` (segundo respaldo).

El cambio de proveedor ocurre en el servidor. El navegador continúa enviando solicitudes a la URL del Worker configurada en `script.js`.

## Antes de cambiar el Worker activo

1. Abre Cloudflare Dashboard.
2. Entra en **Workers & Pages** y abre el Worker cuyo dominio actual es `empty-surf-94b6.micheljhaxon.workers.dev`.
3. Guarda una copia del código actual en un lugar privado antes de reemplazarlo.
4. Abre **Edit code** y reemplaza el código por el contenido completo de `cloudflare-worker.js`.

## Configuración necesaria

### 1. Workers AI binding

En la configuración del Worker, añade un binding de Workers AI con:

- Variable/binding name: `AI`

El código usa el modelo `@cf/zai-org/glm-4.7-flash`. Cloudflare lo incluye entre los modelos disponibles en Workers Free, sujeto a cuota/capacidad.

### 2. Secrets

En **Settings → Variables and Secrets**, añade estos secretos:

- `GEMINI_API_KEY`: tu clave actual de Gemini.
- `OPENROUTER_API_KEY`: crea una clave en https://openrouter.ai/keys.

No escribas estas claves en `script.js`, en GitHub ni en mensajes públicos. Pégalas únicamente en el panel de Secrets de Cloudflare.

Opcionalmente añade una variable de texto:

- `GEMINI_MODEL`: el nombre exacto del modelo Gemini que ya utiliza tu Worker. Si se omite, el código usa `gemini-3.8-flash`, el valor configurado actualmente en la aplicación.

**Importante:** si el nombre del modelo que realmente funciona en tu cuenta es diferente, configura aquí el identificador exacto. No inventes ni adivines ese nombre.

### 3. Guardar y desplegar

Pulsa **Deploy**. Mantén la misma URL del Worker; `script.js` ya apunta a ella.

## Prueba

1. Abre https://micheljhaxon-lgtm.github.io/Avatar-3d/
2. Envía un mensaje sencillo a Lusy.
3. Si Gemini está disponible, responderá Gemini.
4. Si Gemini devuelve un error temporal (por ejemplo 429 o 503), se intentará Cloudflare Workers AI y después OpenRouter.
5. Si todos fallan, el Worker devolverá un error resumido sin revelar claves.

## Cuotas gratuitas y límites

- Cloudflare Workers AI tiene una asignación gratuita de 10.000 Neurons al día; la disponibilidad depende del modelo y de la capacidad.
- OpenRouter ofrece modelos gratuitos, pero sus variantes gratuitas tienen límites de solicitudes y pueden variar por modelo/proveedor.

Consulta las cuotas vigentes en los paneles oficiales antes de publicar la aplicación para otras personas.
