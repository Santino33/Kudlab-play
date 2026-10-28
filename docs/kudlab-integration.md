# Integración con Kudlab · J-02

## Registro → Play en la vista de pruebas

La composición backend `tests/game-preview.ts` permite crear registros activos desde el frontend docente y probar asignación/código/Play sin sembrar cada ID. Solo datos ficticios en `NODE_ENV=test` y BD aislada `kudlab_j02_*test`; no consentimiento real ni cambio del arranque normal. No requiere cambios del runtime Play ni del contrato 1.2.0. Fuente: backend `65d0ad6` más corrección local, `docs/pruebas-estudiantes-play.md` y `tests/integration/game-preview.test.ts`.

Regresión de navegador: `tests/integration/new-student.spec.ts`. Ejecutar con API/SPA/Play coherentes y runner recién preparado (curso A2 vacío):

```sh
KUDLAB_TEACHER_ORIGIN=http://localhost:5196 KUDLAB_API_ORIGIN=http://localhost:4326 KUDLAB_PLAY_ORIGIN=http://127.0.0.1:4196 npx playwright test --config=playwright.integration.config.ts tests/integration/new-student.spec.ts
```

Prueba registro activo, asignación/código, canje en otro perfil sin cookies docentes, inicio y cierre parcial con acuse, procesamiento y rechazo local tras inactivar. No acelera el juego ni inventa resultados. Sin trazas/capturas de códigos utilizables.

Ejecutada localmente el 2026-10-28 UTC: **1 prueba Chromium correcta**, más typecheck/lint/build y **61 pruebas unitarias correctas**. Capturas revisadas del aviso local a 320/1440px; no hay desbordamiento general. BD exclusiva de navegador `kudlab_j02_habilitados_browser_test`. La nueva regresión termina explícitamente la actividad y verifica datos parciales; no acredita partida completa/offline ni habilitación real.

## Contrato y puente existentes

J-03 conserva este puente y añade [entrada pública por código](access-code.md).
El artefacto actual fijado es 1.2.0; el 1.1.0 histórico se conserva sin sobrescribir.

Nuevas autorizaciones: perfil 1.1 existente. 1.0 sigue legible/entregable sin convertir
evidencia histórica. No se añaden mecánicas, cuentas, indicadores en cliente ni códigos.

`contract/kudlab-runtime-1.2.0` es el artefacto actual generado y mantenido por backend:
JSON Schema, tipos estructurales, fixture, vectores y manifiesto SHA-256. Envelope y
Receipt consumen sus tipos; `tests/unit/kudlab-contract.test.ts` verifica hashes y
compatibilidad. Validaciones cruzadas siguen en el adaptador local. No hay imports
al filesystem del backend ni dependencia de un cuarto repositorio.

Configurar `VITE_API_ORIGIN` y `VITE_TEACHER_ORIGIN` antes de build. El frontend
docente configura a su vez el origen público de Play. Solo publicar dist y aplicar
sus cabeceras. Orígenes exactos, sin comodines ni cookies docentes.

El puente existente conserva RUNTIME_READY/LAUNCH_AUTHORIZATION y avisos de entrega.
Para recuperar, el host abre `?bridgeId=<UUID>&recoverySessionId=<UUID>` (IDs públicos).
Play comunica solo `RECOVERY_REQUESTED {bridgeId,sessionId,submissionId}` si encuentra
su copia local, o `RECOVERY_UNAVAILABLE {bridgeId,sessionId}`. No envía evidencia.
El host comprueba origen/source/forma/generación y solicita el grant de recuperación.

El claim renovado no sobreescribe otra sesión ni crea una preparación jugable.
Exige copia local compatible; reemplaza credencial y desbloquea el mismo outbox sin
cambiar bytes, hash ni intento. Si no existe copia, detiene reconciliaciones
automáticas e informa. El acuse válido sigue siendo necesario para limpiar evidencia.

La suite `playwright.integration.config.ts` necesita tres builds/servidores locales
preparados con datos ficticios. Por defecto SPA localhost:5173, API localhost:4300
y runtime 127.0.0.1:4178. La preparación segura de BD/runner está en el backend,
`docs/integracion-play.md`. `scripts/serve-production.mjs` acepta PORT para esta
verificación; no es un backend de negocio ni un servidor productivo.

Gates institucionales/metodológicos no resueltos. No habilitar participantes reales.
