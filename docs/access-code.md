# J-03 · Código público y pendientes

Decisión del responsable 2026-10-27: **cinco caracteres alfanuméricos**, por ejemplo sintético `ERD34`, sin separador; alfabeto `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`. No cinco dígitos numéricos ni ocho caracteres. Vigencia/políticas aprobadas de J-03 no sustituyen los plazos de J-02. Uso real bloqueado por G-01…G-04.

`/` es entrada pública de Play: un input etiquetado, pegado permitido, canje online sin cookie docente. No solicita nombre, documento, curso ni cuenta. Antes del canje guarda claimId/secreto aleatorio, nunca el código. Respuesta perdida: repetir misma interacción; tras recargar reingresar mismo código y reconciliar los IDs conservados. No hace bucles automáticos con códigos. Errores de autorización neutrales, red/503 y espera 429 diferenciados.

Tras canjear se usa el mismo preflight/ejemplo/inicio TG-01 y entrega de J-02. El canje no consume; start confirmado sí. No reanuda medición tras recarga. El ejemplo no es un intento. El código solo autoriza posesión, no prueba quién juega físicamente.

`/pendientes` lista únicamente tarea/fecha local informativa/estado técnico del respaldo original. Cada envío conserva su propia capacidad, aunque después otra persona use otro código. Si necesita autorización, ingresar código vigente del destinatario o SUBMIT_ONLY de esa sesión. No muestra respuestas/nombres/indicadores ni busca IDs alternativos; sin copia local informa y no reconstruye resultados. Acuse validado antes de limpiar.

**Refinamiento aprobado:** el acuse perdido ya no requiere un código docente. Ante caducidad de entrega (401), Play consulta automáticamente el acuse con la capacidad original; el backend permite solo esa lectura aun expirada, nunca revocada. Se valida sesión/submission/hash antes de limpiar, sin renovar permisos ni iniciar otro intento. También comprueba pendientes AUTH_REQUIRED compatibles conservados por builds anteriores. Null/denegación/conflicto conservan la evidencia y detienen el bucle de autorización; red y 429 mantienen backoff/Retry-After. Los resultados que **nunca llegaron** siguen necesitando autorización válida para enviarse; eso no es un acuse perdido.

La recuperación exige **mismo origen, sitio, perfil y partición**. El iframe supervisado no garantiza compartir IndexedDB con la página pública. No transportar evidencia entre ambos ni pedir cookie docente. Se conserva el puente RECOVERY_REQUESTED/RECOVERY_UNAVAILABLE sin secretos en URL.

Hosting debe resolver directamente `/pendientes` al index. SW resuelve esa navegación al shell cacheado; solo cachea recursos estáticos propios, no API ni evidencia. Recursos J-01 de laboratorio/simulador no se incluyen en producción.

Artefacto canónico nuevo `contract/kudlab-runtime-1.2.0`, generado desde backend y fijado con hashes. No cambia sobre 1.1 ni lectura histórica 1.0; se conserva artefacto 1.1.0. Sin dependencias de filesystem entre repositorios ni fórmulas nuevas.

Guía canónica de despliegue/configuración/operación: backend `docs/acceso-codigo.md`. Demostración Play `tests/integration/access-code.spec.ts`: perfil público persistente distinto del docente, API/BD/builds reales, duración real, offline/reapertura, ACK perdido y recuperación con CLI sintética. No retener códigos en trazas/capturas ni publicar perfiles de prueba. Prueba supervisada anterior permanece en `kudlab.spec.ts`; las variables de orígenes permiten puertos separados de procesos ajenos.
