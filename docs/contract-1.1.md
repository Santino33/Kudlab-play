# Corrección solicitada — pantalla disponible y cuenta atrás

## Decisión y alcance

El responsable corrigió el objetivo inicial: el juego está pensado para teléfono y debe adaptarse a **pantalla completa según el dispositivo**, no imponer una resolución fija ni pedir orientación horizontal por defecto. También pidió que Comenzar se convierta en una cuenta de 3 a 0 antes de la actividad. Esto sustituye la elección de escenario fijo para nuevas autorizaciones adaptables; no modifica en secreto los resultados del perfil anterior.

Se incorpora `VIEWPORT_FIT_V2`, build `tg01-viewport-rebuild-2`, **contrato 1.1**. El contrato 1.0/build anterior sigue admitido para ejecución autorizada histórica y entrega de pendientes. No se convirtieron paquetes antiguos ni se modificaron Kudlab backend/frontend. Esta extensión del frontend y sus fixtures debe incorporarse explícitamente en J-02 antes de integración real.

## Perfil adaptable

Se mantienen 120000 ms, segmentos 40/80 s, velocidad de 210 unidades lógicas/s, generaciones 1100–1800 ms, probabilidad .7, tamaños 75–105, separación 180, 30 intentos, FULLY_VISIBLE y POINTER_V1. La configuración 1.1 reemplaza los campos fijos logicalWidth/logicalHeight/lanes por:

```json
{
  "layoutRule": "VIEWPORT_FIT_V2",
  "referenceWidthUnits": 480,
  "minimumLaneWidthUnits": 120,
  "maximumLanes": 6
}
```

Son reglas de cálculo, **no un escenario fijo de 480 píxeles**. Dados el ancho W y alto H efectivos del escenario en CSS:

- escala `s = min(1, W / 480)`;
- dimensiones lógicas `W/s`, `H/s`;
- carriles `min(6, floor((W/s)/120))` (mínimo interno 1; los tamaños soportados producen 4–6);
- centros `(lane - .5) * logicalWidth / lanes`;
- no estirar: ambos ejes usan la misma escala;
- mínimo soportado de escenario 288×240 CSS px, escala ≥.6 y tamaño visible mínimo 45px.

Así un teléfono de 320px, uno de 390px, un teléfono horizontal y una pantalla grande usan su ancho y alto reales sin bandas laterales. El espacio superior de controles (72px más safe-area si aplica) no tapa estímulos. «Pantalla completa» significa toda el área disponible del navegador/iframe; no exige la API Fullscreen, que no es uniforme en iOS.

La duración de exposición depende ahora del alto efectivo. **No se afirma equivalencia metodológica entre tamaños/orientaciones ni con 1.0.** G-03/pilotaje sigue pendiente. El tamaño se fija antes de medir; cambiar la orientación/escenario durante medición interrumpe en vez de alterar la física silenciosamente.

## Evidencia 1.1 y validación

Se conserva la forma del sobre, los IDs, el acuse, la canonicalización y los endpoints. El contexto y sobre indican contractVersion `1.1` y el nuevo gameBuildId. El dispositivo incorpora obligatoriamente:

```json
{
  "stageWidthCss": 390,
  "stageHeightCss": 772
}
```

Se guardan junto a viewportWidth/viewportHeight/stageScale/touchCapable existentes. La escala, los carriles y las dimensiones lógicas se derivan con la regla publicada, y se valida la geometría efectiva de cada evento. No se admite config adaptable con contrato 1.0, ni se aceptan campos desconocidos. Las capacidades siguen siendo por sesión y la API debe autorizar el perfil nuevo; el runtime no transforma un grant 1.0 en 1.1.

`contract/v1.1/` contiene esquemas estrictos, fixtures y hashes; `contract/v1/` mantiene el artefacto histórico. Los refinamientos cruzados adicionales están en `src/contract/schema.ts`.

## Cuenta atrás

1. Se comprueban almacenamiento/recursos y se solicita el mismo startId persistido.
2. Solo después de la confirmación servidor, el botón se deshabilita y muestra 3, 2, 1, 0, con pasos de un segundo y sin animación decorativa necesaria.
3. La medición y su diario comienzan después de 0. No se generan estímulos ni métricas de demostración durante la cuenta.
4. START_CONFIRMED y su snapshot preparado ya son duraderos: ocultar/cerrar/recargar durante la cuenta cierra como interrumpida, sin reanudar ni consumir otro intento. Un cierre previo a medir contiene cero estímulos y duración de medición cero.
5. El lease se renueva durante la cuenta y los otros controles no permiten comenzar otra vez.

## Demo y herramientas

- `/demo.html`: solo iframe de la aplicación, al 100% del área disponible; autorización sintética exclusivamente del servidor de desarrollo.
- `/laboratorio.html`: creación de sesiones y fallos de prueba. Herramientas cerradas por defecto, con explicación de 401/403/409/429/503, pérdida de respuestas, retraso y red.
- Ninguna de esas rutas ni su simulador forma parte de `dist/`. La vista productiva sigue requiriendo autorización real.

Las condiciones institucionales, hardware físico y carga real permanecen pendientes. No se instalaron dependencias nuevas para esta corrección.
