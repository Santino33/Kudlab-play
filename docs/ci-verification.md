# Corrección de CI tras J-03

El responsable reportó fallos en `Verify J-01 / verify` para push y pull_request del commit `c6ed861`.
Logs comprobados: runs [40614154790](https://github.com/Santino33/Kudlab-play/actions/runs/40614154790) y [40614213902](https://github.com/Santino33/Kudlab-play/actions/runs/40614213902).

Ambos fallan en las mismas cinco pruebas de `npm run test:e2e` (26 correctas): esperaban instrucciones/ejemplo o adopción de una preparación supervisada desde la antigua portada pública. J-03 reemplazó esa portada por entrada de código y separó las vías. Los avisos de Vite no causaron estos fallos. La verificación J-03 anterior cubrió las tres E2E con backend real, pero omitió repetir esta suite independiente de 31 pruebas: no era equivalente a verificar todo CI.

Se actualizan las expectativas, sin skips, reintentos de test ni eliminar controles:
- Portada pública sin autorización ni canvas; ejemplo/teclado/movimiento reducido mediante autorización supervisada de laboratorio.
- Una preparación supervisada no es tomada por nivel superior.
- Shell y /pendientes offline disponibles, pero canje nuevo bloqueado sin conexión.
- Geometría exige dos siluetas antes de medir; no puede pasar con cero elementos.

Los puertos de laboratorio/producción son parametrizables con `KUDLAB_DEMO_PORT` y `KUDLAB_PRODUCTION_PORT` (defaults 4173/4174, CI sin cambios) para no reutilizar procesos ajenos locales.

Verificación local aislada: `npm run typecheck`, `npm run lint` y `KUDLAB_DEMO_PORT=4193 KUDLAB_PRODUCTION_PORT=4194 CI=true npm run test:e2e`: **31 correctas, 2,4 min**, con servidores levantados desde este checkout y sin reutilizar otros. El resultado remoto de CI se informa por separado después del push.
