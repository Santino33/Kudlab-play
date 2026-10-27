# Origen y licencias

## Referencia de mecánica, no código reutilizado

Se inspeccionó `frontend/game.js` de [AlexanderNino97/TD-LLUVIA-DE-ESTRELLAS](https://github.com/AlexanderNino97/TD-LLUVIA-DE-ESTRELLAS), commit `52ac221eab59d8c897960474441c2b88c871e310`, además de las specs suministradas. La referencia no muestra una licencia de proyecto que autorice reutilización general.

**No se copiaron su código, sprites, fondo, audio, mascota, motor Kaboom ni backend.** Motor, dibujo de estrella/luna, favicon y shell son una implementación nueva para este proyecto. No se declara equivalencia metodológica con el demo ni con sus 20 s codificados.

## Dependencias distribuidas

| Recurso | Origen | Licencia | Uso |
| --- | --- | --- | --- |
| Nunito, 400/600/700/800 latino | `@fontsource/nunito`, autores del [proyecto Nunito](https://github.com/googlefonts/nunito) | SIL OFL 1.1 | Fuentes locales; el build incluye copyright/licencia íntegros en `dist/licenses/nunito.txt` |
| Zod | Paquete `zod` fijado en lockfile | MIT | Esquemas estrictos y tipos |
| canonicalize | Paquete `canonicalize` fijado en lockfile | Apache-2.0 | RFC 8785, sin red en ejecución |

El build copia también las licencias íntegras de Zod y canonicalize a `dist/licenses/`. Herramientas de desarrollo (Vite, TypeScript, Vitest, Playwright, ESLint, tsx y fake-indexeddb) no se importan en el frontend productivo. Véase `package-lock.json` para versiones/integridad.

No se buscaron ni usaron fotografías, videos, bibliotecas de ilustración, iconos remotos o fuentes CDN: el material visual son los propios estímulos y controles de esta tarea, no un sitio de marketing.

El responsable conserva la decisión de licencia general del proyecto; no se asignó una licencia de código abierto sin autorización. G-04 exige revisión de distribución institucional, aunque no se dependa de activos sin licencia del demo.
