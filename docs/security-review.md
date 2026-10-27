# Revisión de seguridad frontend — 2026-10-27

## Resultado

Revisión acotada de TypeScript/DOM/Canvas, cliente HTTP, IndexedDB, puente, artefacto y caché. No se identificó un bypass productivo ni un secreto hardcodeado en las superficies revisadas. **No equivale a certificación ni sustituye revisión del hosting/API/uso con menores.**

La corrección móvil añade un esquema explícito 1.1 con dimensiones efectivas acotadas al viewport y comprobación de escala/carriles; no degrada mensajes ni ingesta a formas no estrictas. Se conserva 1.0 y su asociación/hash. La cuenta empieza solo después de autorización confirmada y no genera evidencia medida; se prueba recarga durante ella. La demo limpia y el laboratorio siguen siendo herramientas de desarrollo excluidas del build. La integración/validación institucional del nuevo perfil está pendiente.

## Controles comprobables

- `src/delivery/api.ts:10–35`: origen API fijo y validado; HTTPS salvo loopback; Bearer limitado, credentials omit, redirect error, no-store y timeout. Sin cookies docentes ni base desde URL.
- `src/bridge/supervised.ts:3–20`: forma exacta, UUID, secreto Base64URL canónico, origen y source parent. El puente solo notifica IDs, nunca paquetes.
- `src/contract/schema.ts`: objetos estrictos, referencias y geometría coherentes, milisegundos fraccionarios, límites y clasificación. `canonical.ts` delega RFC 8785 al paquete fijado y Web Crypto calcula SHA-256.
- `src/evidence/journal.ts:86–100` y `src/delivery/outbox.ts`: acuse validado y persistido antes de limpieza por sesión; errores y emisor obsoleto no recrean otro sobre.
- `src/app/dom.ts`, `src/app/app.ts`: createElement/textContent; sin innerHTML, eval, analítica ni cargas de terceros. Excepciones no se convierten en mensajes libres de evidencia ni logs públicos.
- `scripts/build-sw.mjs`: CSP por cabecera generada, recursos estáticos propios; sin API/evidencia en Cache API, skipWaiting o borrado global de datos.
- `scripts/check-production.mjs` y E2E productivos: sin simulador/bypass/fixtures/CDN; rutas de fuente y laboratorio no publicadas en el servidor de verificación.
- `npm audit --omit=dev`: sin vulnerabilidades reportadas al ejecutarlo. Es una consulta de advisories, no prueba de ausencia de vulnerabilidades.

## Riesgos y condiciones pendientes

### SEC-01 · Alta condicional — cabeceras y API de despliegue no verificadas

**Evidencia:** `scripts/build-sw.mjs` genera `_headers`, pero no controla un hosting externo; la API J-02 no existe en esta implementación. **Impacto:** si se publica sin CSP/CORS/autorización correctos, pueden exponerse capacidades o aceptarse una asociación incorrecta. **Acción:** aplicar y verificar `docs/deployment.md` en los orígenes reales, con prueba de integración API/PostgreSQL/navegador. Localmente se probó CSP por HTTP, no un hosting institucional.

### SEC-02 · Alta residual — secretos accesibles al mismo origen/perfil

**Evidencia:** `src/runtime/session.ts` conserva capacidades de recuperación en credentials; `src/storage/database.ts` no ofrece aislamiento frente al dueño del perfil. **Impacto:** otra persona con acceso al navegador o un XSS del origen puede leerlos. **Controles:** capacidad limitada por sesión, no nombres, sin terceros y limpieza con acuse. **Acción:** definir operación de dispositivos compartidos, orígenes dedicados y política G-02. No inventar cifrado con una clave guardada junto al secreto ni una purga arbitraria.

### SEC-03 · Media operativa — soporte de navegadores y presión de caché

**Evidencia:** `build-sw.mjs` no elimina cachés antiguas; IndexedDB y persistencia dependen del navegador. **Impacto:** acumulación de recursos puede aumentar presión de cuota; almacenamiento particionado no se comparte necesariamente con nivel superior. **Acción:** pilotaje en navegadores institucionales, gestión coordinada de cachés estáticas antes de operación prolongada y pruebas táctiles físicas. No limpiar IndexedDB para actualizar.

### SEC-04 · Alta para habilitación, externa al frontend — gates y autenticidad física

El contrato protege integridad operativa, no prueba respuesta física. G-01/G-02/G-03/G-04 siguen sujetos a aprobación institucional/metodológica. Un navegador controlado puede fabricar eventos plausibles. No hay diagnósticos, rankings ni inferencias cognitivas nuevas en la UI. No habilitar menores reales ni declarar integración validada a partir del simulador.

Ver el [modelo de amenazas](threat-model.md) para activos, abuso, fronteras y mitigaciones con evidencia.
