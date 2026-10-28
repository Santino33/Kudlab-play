# Integración con Kudlab · J-02

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
