# Kudlab-play

**Integración J-02:** cliente conectado al contrato canónico versionado de Kudlab,
recuperación supervisada de entrega con capacidad renovada (sin volver a jugar) y
suite opcional `npx playwright test --config=playwright.integration.config.ts`
contra backend/frontend/PostgreSQL reales aislados. No usa el simulador de J-01.
Configuración y protocolo: [integración Kudlab](docs/kudlab-integration.md).

Aplicación web estática de tareas digitales **J-01**. Incluye únicamente **TG-01 · Lluvia de estrellas**, reconstruida con TypeScript, DOM y Canvas 2D propios. Sin React, backend de negocio, cuentas estudiantiles ni métricas cognitivas nuevas.

> Desarrollo con **datos sintéticos**. No habilitada para menores reales. El simulador no acredita integración con Kudlab ni consentimiento, conservación o validación metodológica.

## Probar la aplicación

Node **24** recomendado (mínimo 22.12).

```bash
npm ci
npm run dev:demo
```

Abrir **http://localhost:4173/demo.html**. Es una **vista limpia**, sin barra técnica: prepara automáticamente una autorización sintética mediante el mismo cliente contractual. Pulsar **Comenzar**: el botón muestra **3 → 2 → 1 → 0** y después comienza la actividad.

Las opciones de fallos están separadas en **http://localhost:4173/laboratorio.html**, dentro de **Herramientas de desarrollo** (cerradas por defecto). Allí cada opción explica qué simula. No cambian la dificultad ni forman parte de la aplicación infantil. No usar datos reales ni exponer estas herramientas a Internet.

- `npm run dev`: shell y ejemplo en el puerto habitual de Vite; **no autoriza sesiones** por sí solo.
- La partida dura **120 s reales**, además de los tres segundos de cuenta atrás. No hay query params de dificultad ni duración acelerada oculta.
- El perfil actual adapta la zona de juego a **toda la pantalla disponible del navegador**, tanto en teléfono vertical/horizontal como en escritorio. Reserva solo la franja de controles y no estira las formas. Dimensiones, escala y carriles efectivos quedan registrados por sesión.
- «Terminar actividad» pide confirmación fuera del escenario, sin pausar o tapar los estímulos.
- Una partida ya autorizada continúa sin red; un inicio nuevo requiere confirmación online.
- Cerrar/recargar **no reanuda la medición**: recupera el último checkpoint comprometido como evidencia parcial. Tras un cierre abrupto puede esperar al vencimiento del lease (hasta 15 s).
- No borrar los datos del sitio si quedan pendientes. Reabrir por la **misma ruta de acceso, sitio y perfil del navegador**, especialmente dentro de un iframe.

## Verificar

```bash
npx playwright install chromium
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm run check:production
npm run contract:generate
```

Playwright levanta el laboratorio en 4173 y una build productiva con CSP en 4174. Usa Chromium e IndexedDB reales; las unitarias de almacenamiento usan `fake-indexeddb`. Los tests no dependen de J-02, PostgreSQL ni otros proyectos de este directorio. Evidencia y límites: [matriz J1-AC01…18](docs/verification.md).

## Build y despliegue

```bash
# Copiar .env.example a .env.local y configurar únicamente orígenes públicos.
npm run build
npm run preview
```

Publicar **solo `dist/`**, no el repositorio ni el servidor del simulador. `dist/` contiene recursos locales, el SW versionado, la licencia de la fuente y `_headers`. El hosting debe aplicar esas cabeceras o su equivalente: `vite preview` no es un servidor productivo ni aplica automáticamente `_headers`. Sin configuración, los orígenes `.invalid` bloquean de forma segura cualquier integración.

La autorización nueva de J-01 procede del puente supervisado de Kudlab. La página de nivel superior permite ejemplo, recuperación y preparación ya vinculada; el acceso nuevo por código pertenece a **J-03** y no está implementado. No se incluye un botón productivo de «sesión ficticia».

Detalles: [despliegue y puente](docs/deployment.md), [arquitectura](docs/architecture.md), [seguridad](docs/security-review.md), [amenazas](docs/threat-model.md), [revisión visual](docs/design-review.md), [origen y licencias](docs/third-party.md).

La corrección móvil solicitada se identifica como **VIEWPORT_FIT_V2 / contrato 1.1**; el perfil fijo anterior y sus pendientes 1.0 siguen soportados, sin reinterpretar evidencia histórica. [Extensión y condiciones](docs/contract-1.1.md). Su integración en Kudlab y la validación metodológica siguen pendientes; no se modificó J-02.

## Estructura

```text
src/app/          Pantallas y controles infantiles
src/contract/     Validación estricta, tipos y RFC 8785 / SHA-256
src/runtime/      Autorización y reconciliación de claim/start
src/games/        Registro de módulos y TG-01 determinista
src/evidence/     Diario, checkpoint, cierre y acuse
src/storage/      IndexedDB versionada y leases
src/delivery/     HTTP, bandeja persistente y backoff
src/bridge/       postMessage validado
contract/v1/      Contrato 1.0 histórico, fixtures y manifiesto con hashes
contract/v1.1/    Perfil adaptable, geometría efectiva y fixtures nuevos
tests/           Unitarias, simulador y recorridos de navegador
scripts/         Build de SW/cabeceras, escaneo, contrato y capturas
```

Las specs fuente se encuentran en `especificaciones-juegos/`. Backend/frontend Kudlab y otros archivos ajenos del workspace **no fueron modificados**. No se crearon repositorios ni commits automáticamente.
