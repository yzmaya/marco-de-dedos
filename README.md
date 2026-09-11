# Marco de dedos · Efectos en vivo

Haz el gesto de marco de director con las dos manos frente a la cámara y el
área que queda dentro de tus dedos se transforma con un efecto visual en
tiempo real. Las manos y el fondo son reales; solo lo que se ve dentro del
marco cambia. El botón de la esquina cambia entre la cámara frontal y la
trasera.

**En vivo:** <https://yzmaya.github.io/marco-de-dedos/>
**Modo demo, sin cámara:** <https://yzmaya.github.io/marco-de-dedos/?demo>

Todo corre en el navegador desde una página estática: sin build, sin backend,
sin frameworks, sin claves y sin llamadas a ningún servicio. La cámara nunca
sale de la pestaña.

## Cómo correrlo

Cualquier servidor estático sirve, no hay nada que compilar:

```bash
python3 -m http.server 8130
```

Y abre <http://localhost:8130>. La cámara necesita HTTPS o localhost, así que
abrir el archivo directamente no funciona.

Para probar sin cámara, <http://localhost:8130/?demo>: un feed sintético con
unas manos falsas que se mueven solas.

El detector de manos (MediaPipe Hand Landmarker) se carga desde un CDN, así
que la primera vez hace falta conexión.

## Efectos

| Tecla | Efecto | Qué hace |
|---|---|---|
| 1 | Cámara térmica | Paleta de calor con retícula y lectura de temperatura |
| 2 | Rayos X | Negativo en blanco y negro con grano y partículas |
| 3 | Matriz LED | Rejilla de LEDs verdes que enciende según la luz |
| 4 | Glitch | Franjas rotas, aberración cromática y barrido cian |
| 5 | Cubos 3D | Cubos sombreados flotando por delante de la ventana |
| R | Ilustrado | Colores planos, luz en escalones y tinta en los bordes |
| T | Muñeco 3D | Piel lisa, brillo plástico, luz de borde y color de render |
| 6 | Contorno neón | Bordes detectados (Sobel) en neón rosa y cian |
| 7 | Semitono | Trama de puntos de imprenta |
| 8 | Pixel art | Píxeles gordos y paleta reducida |
| 9 | Duotono | Mapa de dos colores con grano |
| 0 | VHS | Sangrado de color, ruido y banda de tracking |
| Q | Caleidoscopio | Espejos radiales alrededor del centro del marco |
| W | Estela de luz | Lo que brilla deja rastro y cambia de color |
| E | Agua | Ondulación líquida con reflejos |

Todos los efectos son shaders WebGL2 que se aplican al cuadro completo de la
cámara; el recorte al marco es local y va aparte, así que el efecto sigue los
dedos con latencia cero.

Ilustrado y Muñeco 3D son lo más lejos que llega un shader: aplanan, entintan
e iluminan, pero la persona conserva su geometría. Redibujar la cara como un
personaje (ojos grandes, proporciones de dibujo) solo lo hace un modelo
generativo; ver «Ir más allá» abajo.

### Gestos y botones

- **Marco de director** (pulgar e índice abiertos en L con las dos manos):
  abre la ventana con el efecto. Dentro del marco se ve el efecto; fuera, la
  cámara tal cual.
- **Botón de cámara** (arriba a la derecha, o la tecla C): cambia a la
  cámara trasera; otro toque vuelve a la frontal. Es lo único que no se
  esconde nunca, ni dentro del visor ni con la interfaz oculta, porque es la
  forma de volver. La frontal se muestra en espejo y la trasera tal cual,
  como una cámara normal. Si el aparato solo tiene una cámara, avisa y no
  pasa nada.

  Con la trasera se usa la **cámara principal (1x)**, sin zoom digital. Es la
  que menos marea dentro del visor: su campo de visión (unos 70 grados) es el
  más parecido al que dejan ver las lentes de un cardboard, así que las cosas
  salen casi del tamaño real. La ultra gran angular (0,5x) mete todo más
  lejos y curva los bordes, y eso desincroniza lo que ves con lo que siente
  el cuerpo. Si sales de la vista de visor con la tecla V, la app pasa a la
  ultra gran angular (o baja el zoom al mínimo), que ahí sí ayuda a que las
  manos quepan enteras.

  El detector de manos necesita ver la **palma** para dar puntos: si solo
  entran los dedos en el cuadro, no hay marco. Por eso importa el campo
  visual, y por eso la pista de abajo avisa cuando ve una sola mano o ninguna. Nada más cuenta mientras el marco
  está hecho, así una mano medio escondida detrás de la otra no cambia nada.

Los tres parámetros de cada efecto (intensidad, tono, detalle) están fijados
en `efectos.js`, en el campo `ajustes` de cada uno.

### Teclas

| Tecla | Acción |
|---|---|
| 1–9, 0, Q, W, E, R, T | Elegir efecto |
| [ ] o flechas | Efecto anterior / siguiente |
| C | Cambiar de cámara (lo mismo que el botón de la esquina) |
| O | Ocultar o mostrar la interfaz (deja solo el video y el marco) |
| + − | Afinar la escala de la vista de visor (se guarda) |
| V | Forzar o quitar la vista para visor VR (para probarla en la computadora) |

### Con un visor VR (cardboard)

Al pasar a la cámara trasera la pantalla se parte en dos mitades iguales, una
por ojo, y la interfaz desaparece. Se mete el teléfono apaisado en el visor y
listo. Elige el efecto antes de cambiar de cámara; el botón de la esquina
sigue a la vista dentro del visor para volver a la frontal (y a la vista
normal).

Es la misma imagen para los dos ojos: una cámara sola no da profundidad, y el
retraso de la cámara al ojo es de unos 100 a 200 ms. Sirve para probar la
sensación; para hacerlo bien hace falta un visor con cámaras propias.

**Pantalla completa.** En Android y en la computadora, un toque en la pantalla
con la vista de visor puesta pide pantalla completa. En iPhone Safari no
existe pantalla completa para páginas web: hay que **añadir la página a la
pantalla de inicio** (botón Compartir → «Añadir a pantalla de inicio») y
abrirla desde ahí; entonces se abre como app, sin barra de direcciones ni
pestañas. La página lleva el manifest y el icono para eso.

### En el móvil

El video llena la pantalla entera, sin franjas negras arriba ni abajo: se
recorta por los lados lo que no quepa. Los efectos van en una tira abajo que
se desliza con el dedo. El botón de la esquina cambia de cámara.

## Cómo está hecho

```
index.html      página única, interfaz mínima
manifest.webmanifest, iconos/   para abrirla como app desde la pantalla de inicio
main.js         loop de render y orquestación de las tres capas
tracking.js     geometría del marco y pipeline de robustez (lógica pura)
efectos.js      lista de efectos: shaders GLSL, ajustes y dibujos 2D
fx.js           motor WebGL2: textura de cámara, un programa por efecto
cubos.js        cubos 3D proyectados a mano sobre canvas 2D (lógica pura)
composite.js    canvas, recorte, contorno, utilidades de geometría
hands.js        carga de MediaPipe Hand Landmarker
demo.js         feed sintético y manos falsas del modo ?demo
ui.js           selector de efectos, pista y avisos
tests/          pruebas de la lógica pura en Node y QA en navegador
```

Tres capas independientes sincronizadas en un solo `requestAnimationFrame`:

1. **Tracking.** MediaPipe Hand Landmarker encuentra las dos manos por cuadro
   y el cuadrilátero pasa por un pipeline de robustez: orden anatómico de las
   esquinas, gates de separación y de área con histéresis, rechazo de
   teletransporte, suavizado adaptativo por velocidad, sostenimiento de
   dropout y fundido de presencia.
2. **Efecto.** El cuadro de la cámara sube como textura y un fragment shader
   lo pinta en un canvas WebGL del mismo tamaño. Los efectos con memoria (la
   estela) leen además su propio cuadro anterior.
3. **Compositing.** El resultado se dibuja alineado a pantalla y se revela
   solo a través del cuadrilátero con un `clip()` del canvas, con contorno
   punteado animado y puntos pulsantes del color del efecto. Algunos efectos
   añaden dibujo 2D encima (la retícula térmica, los cubos).

Si el navegador no tiene WebGL2, los efectos caen a un filtro CSS aproximado.

## Ir más allá: estilos con IA sin depender de un servicio

Si se quiere el resultado de un modelo generativo (anime que redibuja la cara,
personaje 3D), hay tres rutas que no pasan por fal:

1. **Modelo en el propio navegador** (gratis, sin servidor). AnimeGAN v2/v3
   en formato ONNX con ONNX Runtime Web sobre WebGPU da un anime que respeta la
   cara, a 10–20 fps en un Mac o PC con GPU decente y 2–5 fps en un teléfono.
   Licencia de uso no comercial: revisar antes de publicar.
2. **Malla facial + shader** (gratis, tiempo real, también en móvil). MediaPipe
   Face Landmarker da 478 puntos de la cara; con ellos se deforman los ojos
   (más grandes), la mandíbula y la nariz sobre el propio video, y encima va
   el shader Muñeco 3D. Da sensación de personaje sin IA generativa.
3. **Difusión en tu propia GPU** (el resultado de la referencia). StreamDiffusion
   o SD-Turbo en un PC con una RTX 3080 o mejor, sirviendo por WebRTC a esta
   página. Es lo que hacía fal, pero en tu máquina: sin costo por minuto, con
   el costo del hardware y de mantenerlo encendido.

## Añadir un efecto

Una entrada más en `EFECTOS`, en `efectos.js`: un `id`, un `label`, una
`tecla` libre, un color de `acento`, los `ajustes` (intensidad, tono y
detalle, de 0 a 1), sus `etiquetas` y el `glsl` con su `main()`. El preludio común ya declara la
cámara (`cam(uv)`, con el espejo que toque), el tiempo, los tres ajustes y utilidades como
`luma`, `hash` y `tono`. Las pruebas comprueban que la entrada sea coherente.

## Pruebas

La lógica pura (tracking, geometría de los cubos, coherencia de los
efectos) se prueba en Node, sin dependencias:

```bash
node tests/run-tests.mjs
```

Y una pasada de QA sobre la app entera en Chrome sin cabeza, que cubre lo que
solo se ve ejecutando: que arranque limpia en modo demo, que los trece shaders
compilen, que cada tecla elija su efecto y que en móvil el video llene la
pantalla:

```bash
python3 -m http.server 8130 &
npm i playwright   # solo la primera vez; usa el Google Chrome instalado
node tests/qa-navegador.mjs
```

## Publicar

La página se sirve tal cual desde GitHub Pages (rama `main`, carpeta raíz).
Al publicar un cambio hay que subir el número `?v=N` del mapa de importaciones
de `index.html`, porque el navegador cachea cada archivo por separado.

## Referencias

La idea del marco de dedos como ventana viene de la familia de
[sophiamyang/finger-frame-effect](https://github.com/sophiamyang/finger-frame-effect).
