# Identidad y revisión visual J-01

## Corrección móvil solicitada

El escenario adaptable llena el viewport disponible al comenzar, en vertical u horizontal, sin encoger el juego fijo de escritorio. Reserva solo controles y safe-area; no obliga a girar el teléfono. El botón Comenzar conserva su lugar/tamaño al convertirse en 3 → 2 → 1 → 0; esos segundos no son medición. Se distinguen la demo limpia de pantalla completa y el laboratorio técnico separado, con herramientas cerradas y explicaciones de cada fallo. Perfil 1.1 y límites metodológicos en `docs/contract-1.1.md`.

La corrección se inspeccionó de nuevo en la build productiva: **0 FAIL / 0 WARN** en el shell a 1440/768/390. Se abrieron además capturas nuevas de instrucciones, botón con «3» y escenario de borde a borde en teléfono de 390×844, junto con escritorio; la prueba geométrica cubre también 320×568 y horizontal. La cuenta conserva tamaño/posición y contraste, y el juego no tiene barras técnicas sobre los estímulos. Las observaciones de dirección siguientes conservan el contexto inicial, no se usan capturas antiguas del escenario fijo como prueba del ajuste nuevo.

## Dirección y decisiones

Skill `design-taste-frontend`, modo app, dirección **Editorial greeting**, seed **1958540030**. Consulta UI/UX infantil: estilo lúdico y controles amplios; se descartaron las recomendaciones de marketing (precios, logos, CTA comercial) porque no corresponden a una tarea medida.

Se conservó la composición de plano abierto y columna centrada de 1100px, paneles tonales, superficies planas y una acción principal. El sidebar y la fila de KPI sugeridos por el generador **no se trasladaron**: contradicen explícitamente el shell infantil sin panel docente/indicadores. No se fingieron datos para llenar una plantilla. Paleta/tipo se mantuvieron como decisiones propias del producto (`--keep palette,type`), no como marca docente definitiva.

**Idea:** las dos formas de TG-01 se convierten en la propia instrucción visual. Nada de mascotas o escenas de marketing. La actividad responde «¿qué debo tocar?»; el cierre responde por separado «¿terminó?» y «¿se guardó?».

Nunito local, texto oscuro sobre azul gris muy claro, acento verde petróleo en la acción; estrella dorada y luna blanca en el escenario oscuro. Estrella/luna se distinguen por forma, no solo color. La lámina de instrucciones usa las mismas siluetas del Canvas. No hay fotos, clips ni gráficos ajenos: no existe una necesidad honesta de esos activos en este ensayo.

## Ciclo de inspección

1. **Primera revisión:** composición legible en 1440/768/390. Detectados desalineación entre etiquetas de figuras, potencial tamaño visible inferior al box lógico y desborde de cabecera con texto 200%.
2. **Ajustes:** altura compartida en la lámina; paths llenan 100×100 (comprobado por bbox del navegador); cabecera flexible. E2E comprueba 320px/200% también en recuperación bloqueada. Se conservó el mínimo del ensayo, sin encoger objetivos.
3. **Revisión final:** inspector sobre build productiva con cabeceras: **0 FAIL / 0 WARN**. Se leyeron todos los folds y hojas de captura a 1440, 768 y 390. Se revisaron además ejemplo, ayuda, medición, envío pendiente y acuse confirmado. El único warning del linter de fuente es padding hexadecimal del hash, defendido porque no es ornamentación ni numeración de UI.

El ejemplo es repetible y no persiste métricas. Reduced motion elimina su animación; no altera la velocidad Canvas de la tarea. Durante medición no hay partículas, cuenta de aciertos, ranking, modal sobre estímulos ni avisos de red flotantes. La confirmación de salida ocupa el espacio reservado fuera del escenario; el tiempo sigue y no hay pausa oculta.

## Crítica de imágenes, última ronda

| Pregunta | Juicio |
| --- | --- |
| ¿La pregunta principal se lee primero? | Sí: título, dos consignas y formas; ejemplo antes de inicio |
| ¿Bordes/márgenes y composición cierran? | Sí: grid 5/7 con gutter compartido; móvil apila la lámina sin scroll horizontal |
| ¿Color tiene función? | Sí: acción y estímulos; no semántica cognitiva ni estados de rendimiento |
| ¿Números o estados dicen la verdad? | 2 minutos corresponde al perfil; «guardado» requiere acuse. No hay cifras inventadas |
| ¿Cero/ausencia se confunden? | No hay dashboard ni datos de desempeño; los pendientes mantienen estado real |
| ¿Leyendas corresponden a marcas? | Las mismas siluetas, etiquetas «Esta sí / Esta no» y texto explícito |
| ¿Móvil conserva su propósito? | Instrucciones/errores refluyen; medir se bloquea si no cabe .6 de escala. No se promete soporte universal de teléfonos |

**Autoevaluación visual, no jurado externo:** claridad 8.5/10, consistencia 8/10, identidad 8/10, experiencia por estados 8/10. No se aplican cuotas de imágenes, animaciones o Awwwards propias de una landing al ensayo. La principal limitación no es cosmética: falta observación con niños/acompañantes y hardware real antes de aceptar el lenguaje, la interacción y la metodología.

## Accesibilidad y límites

Botones DOM de al menos 48px (ejemplo 132px), summary 44px, foco visible, orden DOM, diálogo nativo y mensajes aria-live puntuales. Texto/forma además de color, fuentes locales, sin instrucción dependiente de sonido. Inspector verifica contraste y E2E teclado/reflujo; no se declara auditoría WCAG ni soporte completo de lectores de pantalla.

POINTER_V1 necesita apuntar. El perfil histórico exige escenario ≥576×360 CSS px; el adaptable permite ≥288×240 CSS px conservando blancos visibles de al menos 45px. Una variante por teclado/lector requiere configuración y validación propias. No se redujo silenciosamente la velocidad ni el tamaño por reduced motion, pantalla pequeña o desempeño.

**Contenido a confirmar:** nombre comercial/identidad «Kudlab Play», formulación final de mensajes con acompañantes y aprobación de metodología. No hay testimonios, estadísticas, nombres de estudiantes ni activos del demo pendientes de sustituir.
