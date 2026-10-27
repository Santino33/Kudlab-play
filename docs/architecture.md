# Arquitectura J-01

> **Actualización móvil:** las nuevas autorizaciones usan el perfil adaptable/contrato 1.1 descrito en [contract-1.1.md](contract-1.1.md), con cuenta atrás fuera del tiempo medido. Las referencias al escenario 960×600 de este documento describen el perfil histórico 1.0, que se conserva sin reinterpretación.

## Autoridades y estados

- **Servidor externo**: elegibilidad, asociación, autorización, intento, ventanas y commit. El cliente no recibe nombres, curso ni cookie docente.
- **Autorización**: ausencia de credencial → CLAIMING → READY → STARTING → START_CONFIRMED. Claim/secreto/startId se comprometen antes de HTTP. Denegaciones se bloquean; incertidumbre usa la misma operación, con backoff.
- **Ejecución**: NOT_STARTED → RUNNING → COMPLETED/INTERRUPTED. No hay reanudación de medición ni vuelta de un terminal a RUNNING.
- **Entrega**: diario → cierre transaccional → PENDING → SENDING → SAVED. Incertidumbre vuelve a PENDING; 401/403 a AUTH_REQUIRED; conflictos/validación a BLOCKED. Los tres estados no se confunden con «actividad terminada».

`src/runtime/session.ts`, `src/evidence/journal.ts` y `src/delivery/outbox.ts` conservan estas dimensiones separadas. El estado servidor previo al inicio no se enumera en el borrador: se conserva su cadena acotada y se usan capacidades explícitas; la confirmación de inicio sí exige literalmente RUNNING.

## Mecánica y puertos

`src/games/registry.ts` solo publica TG-01; declara build, contrato, recursos y creación/destrucción. Recibe una copia de configuración profundamente congelada. El motor recibe geometría/reloj/dispositivo/RNG y ofrece snapshots de evidencia; **no recibe credenciales, fetch ni el cliente HTTP**. Es un módulo propio confiable, no un sandbox para ejecutar código externo.

`Engine.frame(at)` avanza usando tiempo lógico, abre FULLY_VISIBLE en el ciclo que se dibuja, determina segmento por presentación y cierra naturalmente al primer frame no totalmente visible por abajo. Pointer primario resuelve la última hitbox dibujada, una sola respuesta. Corte/interrupción no inventan omisiones. El shell destruye listeners mediante AbortController y cancela RAF al cerrar.

Perfil histórico aprobado para desarrollo: 120000 ms, 960×600, seis carriles, 210 unidades/s, generaciones 1100–1800 ms, 70% de probabilidad de estrella, tamaño 75–105, distancia 180, 30 intentos. El perfil actual comparte esas reglas temporales/estímulos pero deriva dimensiones y carriles del dispositivo. Hueco >250 ms interrumpe; no se simulan segundos ausentes. Las siluetas ocupan su caja completa; escala .6 mantiene una caja visible mínima de 45px. No hay contadores de aciertos ni recompensas.

## Diario y recuperación

IndexedDB v2 agrega almacenes si faltan, sin borrarlos: executions, trials, incidents, outbox, credentials, leases y receipts. Snapshot de metadatos y eventos/incidencias se actualiza en una única transacción. Los eventos de presentación/respuesta/cierre/incidencia se encolan en orden; también hay checkpoints al menos cada segundo. No se espera a IndexedDB por frame. La cola está limitada a 32 escrituras pendientes y se interrumpe si no puede seguir registrando.

El checkpoint no retrocede aunque el timestamp RAF preceda levemente a un evento Pointer. No se acepta otro clockId/inicio en el mismo diario. Antes del cierre se validan forma, semántica y límites; SHA-256 usa RFC 8785. La transacción terminal fija execution/outbox; `submissionId` ya estaba fijado al crear la ejecución.

Una reapertura toma el lease solo si es posible y cierra el diario RUNNING en el último reloj/checkpoint duradero. Los estímulos abiertos quedan not_evaluated; recovered_after_reload no tiene tiempo local del documento nuevo. STARTING incierto se reconcilia con contexto y, si hace falta, el **mismo startId** solicitado; nunca vuelve a renderizar una medición después de esa recuperación.

Leases: ejecución inicial 15 s, renovación cada 3 s con vigencia 10 s; entrega 15 s, renovación cada 3 s, timeout HTTP 8 s. Son coordinación cooperativa, no autorización ni reemplazo del control de concurrencia servidor.

## Entrega

Se guardan cuerpo final, hash e identidad; los errores de transporte nunca cambian sus incidencias. Cada outbox obtiene exclusivamente su capacidad por sessionId. Backoff 2/5/15/30/60 s, después 60 s, jitter ±20%; Retry-After se respeta incluso al pedir reintento. Solo se envía automáticamente con la app visible y conectada. No hay Background Sync ni promesa de envío con navegador cerrado.

Un 2xx no basta: se valida receiptId/sessionId/submissionId/hash/forma. Se persiste primero el acuse verificable y después se limpia evidencia/secreto de esa sesión transaccionalmente. Fallo de limpieza mantiene el éxito remoto y se reconcilia sin otro POST. Un emisor obsoleto no puede resucitar un outbox ya confirmado ni desbloquear una denegación más reciente.

El acuse mínimo vence localmente después de 24 h; **esto no purga pendientes**. No hay descarga de evidencia, cambio de destinatario ni botón de borrado masivo. Recuperar capacidad vencida pertenece a la integración futura P-10/J-02/J-03.

## Límites

- IndexedDB confirma transacciones del navegador, no supervivencia ante borrado, evicción, avería o acceso al mismo perfil. La persistencia se solicita; una denegación se comunica sin afirmar garantía absoluta.
- Los tiempos son aproximaciones del navegador, no medición fotónica ni validación científica.
- La tabla de pruebas distingue simulación de fallos de comprobación física o integración externa.
