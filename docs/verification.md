# Verificación J-01 — 2026-10-27

## Resultado de esta entrega

**Implementación y verificación aislada con datos sintéticos.** Tras la corrección móvil, **48 pruebas unitarias y 31 E2E Chromium** pasan, junto con tipos, lint, build y escaneo productivo. No es aceptación integrada J-02 ni habilitación con menores. Los puntos parciales/externos se detallan abajo, sin sustituirlos por un «todo terminado».

## Correcciones de pantalla y comienzo

- `tests/e2e/mobile.spec.ts`: escenario ocupa todo el ancho y todo el alto restante tras controles en **320×568, 390×844, 844×390 y 1440×900**. Verifica cuenta 3/2/1 y transición a juego; la prueba unitaria comprueba también 0 y el intervalo exacto de tres segundos.
- La cuenta no crea estímulos; una recarga durante ella recupera una interrupción sin reanudar. El motor sigue midiendo 120 s después de cero, con reloj separado de la espera de autorización/cuenta.
- La demo limpia no contiene selectores ni herramientas. `/laboratorio.html` mantiene el panel cerrado por defecto y explica los errores en español.
- `tests/unit/viewport.test.ts`: tamaños de objetivo, geometría real, carriles y validación de versión. El perfil adaptable **1.1** no se acepta como 1.0; el sobre histórico 1.0 sigue válido.
- Capturas revisadas de teléfono: `mobile-instructions.png`, `mobile-countdown.png`, `mobile-running.png`; además del escenario de escritorio. Son navegador con viewport emulado, **no teléfono físico**.

Entorno: Linux, Node 24.18.0, npm 11.16.0; versiones exactas en `package-lock.json`. Chromium de Playwright instalado con su build Linux de compatibilidad (el instalador advierte que la distribución del host no tiene soporte oficial). No se instalaron dependencias del sistema ni se usaron dispositivos físicos.

## Comandos ejecutados

| Comando | Resultado observado |
| --- | --- |
| `npm run typecheck` | Correcto, sin errores |
| `npm run lint` | Correcto, sin errores ni warnings ESLint |
| `npm test` | **48/48**, seis archivos |
| `npm run test:e2e` | **31/31**, un worker, aproximadamente 2.1 min |
| `npm run build` | Correcto; JS ≈142 kB / 42 kB gzip; SW con 15 recursos propios |
| `npm run check:production` | Correcto; sin simulador/bypass/fixtures/CDN ni IndexedDB en SW |
| `npm run contract:generate` | Artefactos separados JSON Schema/fixtures/manifiesto en `contract/v1/` y `contract/v1.1/` |
| `npm audit --omit=dev` | 0 vulnerabilidades reportadas; no certificación |
| Inspector visual de skill, build en 4174 | **0 FAIL, 0 WARN**, a 1440/768/390 px |
| Lint visual de skill sobre src | 0 FAIL; único WARN por `padStart(2,'0')` requerido por SHA-256 hexadecimal, no numeración de UI |

La CI de `.github/workflows/verify.yml` está preparada; **no se ejecutó una acción remota de GitHub** en esta sesión. Los comandos locales equivalentes sí se ejecutaron.

## Matriz J1-AC01…18

«Verificado aislado» significa código + pruebas locales del contrato simulado, no integración escolar ni precisión física.

| Criterio | Prueba / evidencia regenerable | Estado y límite |
| --- | --- | --- |
| J1-AC01 | `tests/unit/engine.test.ts`: cuatro resultados clásicos; `failures.spec.ts`: Pointer durable | Verificado aislado. Interacción táctil sintética, no hardware táctil |
| J1-AC02 | Motor: corte, no presentado, ventana natural ligada al frame, cierre; contrato semántico | Verificado aislado. No inventa segmento/TR ni convierte cortes en omisiones |
| J1-AC03 | Motor con reloj inyectado: 120000 ms, 40000/80000 exactos por presentación; perfil estricto | Verificado lógico. No se cronometró físicamente una sesión de 120 s en dispositivo de pilotaje |
| J1-AC04 | Perfil fijo histórico conservado; layout adaptable y geometría en cuatro viewports; siluetas 100×100; cambio de escenario | Verificado aislado para las nuevas condiciones 1.1. Teléfonos físicos y equivalencia entre tamaños no verificados |
| J1-AC05 | Milisegundos fraccionarios, checkpoint RAF/Pointer monotónico, respuesta primaria única; E2E Pointer + click | Verificado aislado, sin promesa de precisión fotónica |
| J1-AC06 | `runtime.spec.ts`: checkpoint confirmado antes de cortar red, cierre pendiente y reconexión con acuse | Verificado con red de Chromium y servidor contractual sintético; no Kudlab real |
| J1-AC07 | Unitario y E2E: commit del simulador, respuesta truncada perdida, reenvío idéntico y un acuse | Verificado aislado. Se envían mismos bytes/submission/hash |
| J1-AC08 | `failures.spec.ts`: navegación sin callbacks de cierre, lease vencido, reloj original y no Canvas reanudado | Verificado con IndexedDB real. Pérdida del documento simulada, no corte eléctrico del SO |
| J1-AC09 | Journal: cierre/outbox transaccional; transporte: acuse persistido + limpieza fallida, sin nuevo POST ni resurrección | Verificado por fallos unitarios inyectados y recuperación E2E; no durabilidad de disco ante avería |
| J1-AC10 | Iframe con IndexedDB bloqueado; DOMException QuotaExceeded durante escrituras; mensaje sin respaldo falso | Verificado por inyección controlada del error, no llenando físicamente el disco |
| J1-AC11 | Lease exclusivo/vencido en unidad; dos páginas reales y recuperación tras vencimiento | Verificado aislado. Control servidor real de intentos/concurrencia sigue en J-02 |
| J1-AC12 | 401/403/409 conservan hash y bloquean; nuevo bridge B con pendiente A intacto; claim denegado sin bucle | Verificado aislado. Renovación de capacidad P-10 no implementada sin integración |
| J1-AC13 | `production.spec.ts`: schema v1→v2, outbox inmutable, worker antiguo de fixture → nuevo, caché sin API | **Parcial**: worker/esquema previos sintéticos, no una release histórica externa. No hay recolección automática de cachés antiguas |
| J1-AC14 | `transport.test.ts`: origen/source/bridgeId/campos incorrectos; acuse HTTP separado del puente | Verificado aislado. El host real debe comprobar generación docente y consultar API en J-02 |
| J1-AC15 | Iframe cross-site loopback, bloqueo de almacenamiento, nivel superior con preparación vía claim del contrato | **Parcial**: Chromium local solamente. Navegadores institucionales, particionado y reapertura físicos pendientes; nuevo acceso J-03 fuera |
| J1-AC16 | Teclado/foco visible/dialog Escape, ejemplo repetible, 320px/200% instrucciones y error, reduced motion; inspector contraste/reflujo | **Parcial**: revisión visual y automatizada, no evaluación con lectores/usuarios/dispositivos físicos ni accesibilidad universal del ensayo |
| J1-AC17 | Escaneo dist, HTTP con CSP real local, fuentes locales/licencias, caches allowlist y ausencia de capacidad en URLs/console | Verificado en artefacto/servidor local. Cabeceras/CORS del hosting y API reales pendientes |
| J1-AC18 | Shell SW offline; autorización preparada offline con cero requests start; claim offline rechazado; claim/start perdidos reconciliados | Verificado aislado. Nunca se inventa confirmación offline ni otro startId por reintento |

## Artefacto contractual

Los manifiestos de `contract/v1/` y `contract/v1.1/` fijan versión, algoritmo y SHA-256 de cada archivo. Los JSON Schema se generan desde Zod; las reglas temporales/de clasificación/geometría cruzada adicionales están en `src/contract/schema.ts` y se prueban en Vitest. **JSON Schema por sí solo no expresa todos esos refinamientos**. El consumidor J-02 debe incorporar esas reglas y los mismos vectores de canonicalización antes de publicar OpenAPI. No se publicó un paquete externo ni se modificó el backend. Extensión nueva: [contract-1.1.md](contract-1.1.md).

El perfil productivo no se acelera para E2E. Los 120 s completos se recorren con reloj inyectado en unidad. Los E2E terminan explícitamente o provocan una interrupción técnica y no los presentan como partidas completas.

## Evidencia visual

Con laboratorio 4173 y build con cabeceras 4174 activos:

```bash
npm run capture
```

Produce `.taste-skill/states/{example,help,running,pending,saved,mobile-instructions,mobile-countdown,mobile-running}.png`. Inspector de la skill, si está disponible:

```bash
CHROME_PATH=/ruta/a/chrome TASTE_SKILL_TMP=/tmp/opencode node /ruta/a/design-taste-frontend/scripts/inspect.mjs --app http://127.0.0.1:4174/ --out .taste-skill/inspect
```

Se abrieron las capturas completas/folds de los tres anchos y las capturas por estado, incluyendo teléfono y cuenta atrás; crítica en `docs/design-review.md`. Son artefactos locales regenerables, ignorados por Git. Playwright conserva screenshot/trace si falla, sin necesidad de herramientas de inspección externas.

## No ejecutado / bloqueado externo

- Integración Kudlab con host, API, PostgreSQL y procesamiento reales; J-02 no fue autorizado en este proyecto.
- Piloto metodológico, aprobación del perfil y uso con menores: G-01…G-04 no resueltos por esta implementación.
- Carga de **30 ejecuciones concurrentes**, métricas en infraestructura real y de cola en dispositivo físico.
- Tableta/ratón/lápiz táctil **físicos** representativos; emulación no equivale a prueba física.
- Safari/Firefox y almacenamiento cross-site bajo políticas institucionales; CSP/CORS/HTTPS en hosting final.
- Conservación/revocación/descarte autorizado de pendientes; no se agregó purga automática.
- Recolección coordinada de cachés antiguas: se retienen por seguridad de clientes abiertos, con presión de cuota como límite conocido.

Las pruebas no demuestran autenticidad física de respuestas ni interpretación clínica/pedagógica. No se borraron archivos ajenos ni se cambiaron proyectos Kudlab vecinos.
