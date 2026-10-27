# Despliegue e integración supervisada

> La corrección de pantalla completa añade contrato **1.1**, además del histórico 1.0. El host/API debe autorizar la configuración 1.1 explícitamente para nuevas partidas adaptables; no se modificó J-02 ni se adaptan grants antiguos en cliente. Véase [contract-1.1.md](contract-1.1.md).

## Artefacto

Solo `dist/`, con HTTPS fuera de loopback. No desplegar `vite.demo.config.ts`, `tests/`, los servidores de verificación ni archivos vecinos del workspace. El frontend no necesita un servidor Express ni BD propia.

Configurar en `.env.local` antes de build:

```dotenv
VITE_API_ORIGIN=https://api.institucion.example
VITE_TEACHER_ORIGIN=https://docente.institucion.example
```

Son **orígenes públicos exactos** sin path, slash final, comodín ni credenciales. El origen del runtime es el del hosting. La API se construye sobre `/api/v1/game-runtime`; no se toma de la URL. El build genera `dist/_headers` (formato compatible con hosting que soporte ese archivo). En otros servidores, trasladar sus directivas a configuración HTTP y verificar la respuesta real.

CSP: default-src none; script/style/img/font/worker propios; connect-src propio y API exacta; frame-ancestors solo docente; base/object/form denegados. Referrer-Policy no-referrer, nosniff y permisos cámara/micrófono/geolocalización denegados. No usar X-Frame-Options DENY sobre el runtime porque impediría su iframe autorizado. El host docente debe fijar frame-src al runtime.

En API externa: HTTPS, CORS limitado al origen runtime, sin cookies, no-store incluso en errores; no registrar Authorization/cuerpos. No basta que el cliente pida cache no-store. Backend y host docente son J-02 y no se implementaron aquí.

```bash
curl -I https://runtime.institucion.example/
curl -I https://runtime.institucion.example/sw.js
```

Comprobar CSP real, MIME, HTTPS, orígenes, Cache-Control y políticas del navegador institucional. `npm run preview` no aplica por sí mismo las cabeceras del archivo. `scripts/serve-production.mjs` es exclusivamente el servidor local de pruebas con cabeceras, no un backend productivo.

## Puente

1. Host crea un UUID v4 `bridgeId` y un iframe `https://runtime.../?bridgeId=<UUID>`. Es correlación **pública**, no un grant.
2. Runtime comprueba recursos/IndexedDB antes de RUNTIME_READY al origen docente configurado.
3. Host comprueba origen, `source===iframe.contentWindow`, esquema, bridgeId y generación docente; obtiene su grant desde su API.
4. Host envía `{type:"LAUNCH_AUTHORIZATION", bridgeId, launchGrant}` al origen runtime exacto.
5. Runtime exige origen docente, `source===parent`, forma estricta e ID; persiste claim/secreto y canjea.
6. EXECUTION_FINISHED/DELIVERY_PENDING/RESULTS_SAVED incluyen solo bridgeId/sessionId/submissionId. **El host consulta su API para confirmar**, nunca trata postMessage como acuse.

No poner tokens en URL, usar targetOrigin `*`, pasar cookies docentes al frame ni implementar un fallback de memoria si IndexedDB falla. Un nuevo bridge no selecciona una preparación de otro niño; el bridgeId se guarda solo como correlación local de su preparación. Pendientes anteriores se envían exclusivamente con su propia capacidad.

El nivel superior puede mostrar instrucciones/ejemplo y recuperar evidencia. Para probar una preparación autorizada allí, la suite prepara mediante el mismo endpoint de claim, no un bypass. El producto aún no implementa nuevos accesos por código J-03 ni un emisor de grants.

## SW, actualización y almacenamiento

El build precachea HTML/CSS/JS/fuentes/favicon/licencia propios con un nombre derivado del contenido. Allowlist exacta para GET del mismo origen; no intercepta API ni POST. La caché no contiene configuración autorizada, paquetes ni credenciales. No hay skipWaiting, recarga forzada ni borrado de diarios. Una actualización se avisa fuera de medición y se aplica al liberar clientes antiguos.

Se conservan cachés estáticas antiguas de forma conservadora; no se implementó recolección automática coordinada. Esto evita romper clientes pero requiere vigilar ocupación antes de un despliegue prolongado. No recomendar «limpiar datos del sitio» para actualizar: eso borraría IndexedDB y pendientes.

En iframe cross-site, almacenamiento y cachés pueden estar particionados por sitio superior. Volver desde **el mismo sitio docente, navegador y perfil**; abrir el runtime directamente puede no encontrar sus pendientes. Chromium local verificó rutas separadas con localhost/127.0.0.1, no todos los navegadores ni políticas institucionales. Si el preflight falla dentro del frame, no se inicia. La solicitud de persistencia puede denegarse y la UI explica la limitación.

## Antes de menores reales

G-01 consentimiento/activación integrados; G-02 conservación/revocación/purga aprobadas; G-03 metodología/perfil/pilotaje aprobados; G-04 revisión de distribución y licencias. Probar API y PostgreSQL reales en J-02, dispositivos táctiles físicos y la carga de 30 ejecuciones. Ninguna build o fixture sintético sustituye estas condiciones.
