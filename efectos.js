// efectos.js — los efectos que se ven dentro del marco de dedos.
//
// Todos corren en local, en la GPU, con un fragment shader por efecto. No hay
// modelos, ni claves, ni llamadas a nada: la cámara entra como textura y sale
// transformada en el mismo cuadro de pantalla, a la velocidad del monitor.
//
// Cada efecto trae:
//   id, label, tecla        identidad y atajo de teclado
//   acento                  color del contorno del marco con ese efecto
//   glsl                    cuerpo del fragment shader (va detrás del PRELUDIO)
//   feedback                true si lee su propio cuadro anterior (u_prev)
//   overlay(ctx, info)      dibujo 2D encima, dentro del recorte (opcional)
//   overlayLibre(ctx, info) dibujo 2D encima, sin recortar (opcional)
//   ajustes                 valor inicial de las tres barritas, de 0 a 1
//   etiquetas               qué controla cada barrita en este efecto
//   filtro                  respaldo CSS por si no hay WebGL2
//
// Las tres barritas son siempre las mismas (intensidad, tono, detalle) para
// que cambiar de efecto no cambie la interfaz, pero cada efecto decide qué
// significan: en la matriz LED "detalle" es el tamaño del LED, en el glitch
// es cuántas franjas se rompen, en los cubos es el tamaño del cubo.
//
// Este módulo no toca el DOM al importarse: la lista y los shaders se pueden
// verificar en Node.

import { centroid } from "./tracking.js";
import { quadPoint, quadScale } from "./composite.js";
import { Cubos } from "./cubos.js";

/**
 * Cabecera común de todos los shaders. cam() muestrea la cámara con el mismo
 * espejo que el canvas principal (frontal en espejo, trasera tal cual), y el
 * resultado se copia encima sin más cuentas.
 */
export const PRELUDIO_GLSL = `#version 300 es
precision highp float;
uniform sampler2D u_video;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_intensidad;
uniform float u_tono;
uniform float u_detalle;
uniform vec2 u_centro;
uniform float u_espejo;
out vec4 fragColor;

// La cámara frontal se ve en espejo (u_espejo = 1), la trasera tal cual.
vec3 cam(vec2 uv) { return texture(u_video, vec2(mix(uv.x, 1.0 - uv.x, u_espejo), uv.y)).rgb; }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float ruido(vec2 p) {
  return hash(p + vec2(mod(u_time, 97.0) * 61.0, mod(u_time, 89.0) * 37.0));
}
// Gira el tono alrededor del eje gris (rotación de Rodrigues sobre RGB).
vec3 tono(vec3 c, float h) {
  if (h < 0.001) return c;
  float a = h * 6.2831853;
  vec3 k = vec3(0.57735);
  float cs = cos(a);
  float sn = sin(a);
  return c * cs + cross(k, c) * sn + k * dot(k, c) * (1.0 - cs);
}
`;

// Paleta térmica "ironbow", de frío a caliente. Se usa en el shader y en la
// barra de referencia dibujada al lado del marco.
export const IRONBOW = ["#00000f", "#33007a", "#9e0db8", "#ed404d", "#ff9e0d", "#fff28c", "#ffffff"];

const cubos = new Cubos({ maximo: 9 });

export const EFECTOS = [
  {
    id: "termica",
    label: "Cámara térmica",
    tecla: "1",
    acento: "#ffb300",
    ajustes: { intensidad: 0.55, tono: 0, detalle: 0.4 },
    etiquetas: { intensidad: "Contraste", tono: "Paleta", detalle: "Desenfoque" },
    filtro: "saturate(3) hue-rotate(250deg) contrast(1.4)",
    glsl: `
vec3 ironbow(float t) {
  const vec3 c0 = vec3(0.00, 0.00, 0.06);
  const vec3 c1 = vec3(0.20, 0.00, 0.48);
  const vec3 c2 = vec3(0.62, 0.05, 0.72);
  const vec3 c3 = vec3(0.93, 0.25, 0.30);
  const vec3 c4 = vec3(1.00, 0.62, 0.05);
  const vec3 c5 = vec3(1.00, 0.95, 0.55);
  const vec3 c6 = vec3(1.00, 1.00, 1.00);
  float s = clamp(t, 0.0, 1.0) * 6.0;
  if (s < 1.0) return mix(c0, c1, s);
  if (s < 2.0) return mix(c1, c2, s - 1.0);
  if (s < 3.0) return mix(c2, c3, s - 2.0);
  if (s < 4.0) return mix(c3, c4, s - 3.0);
  if (s < 5.0) return mix(c4, c5, s - 4.0);
  return mix(c5, c6, s - 5.0);
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  // Un sensor térmico ve borroso: se promedian vecinos para quitar nitidez de cámara.
  float r = mix(1.0, 5.0, u_detalle) / u_res.y;
  vec3 c = (cam(uv) + cam(uv + vec2(r, 0.0)) + cam(uv - vec2(r, 0.0))
          + cam(uv + vec2(0.0, r)) + cam(uv - vec2(0.0, r))) / 5.0;
  float calor = luma(c);
  // La piel tira a cálido: el rojo por encima del azul suma temperatura.
  calor += (c.r - c.b) * 0.35;
  calor = smoothstep(0.05, 0.95, calor);
  calor = pow(calor, mix(1.6, 0.6, u_intensidad));
  vec3 col = ironbow(calor);
  col += (ruido(gl_FragCoord.xy) - 0.5) * 0.04;
  fragColor = vec4(tono(col, u_tono), 1.0);
}`,
    overlay(ctx, { quad, w, t }) {
      const c = centroid(quad);
      const s = quadScale(quad);
      const r = Math.max(8, s * 0.075);
      ctx.save();
      ctx.lineWidth = Math.max(1.2, w / 1000);
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 4;
      ctx.strokeRect(c.x - r, c.y - r, r * 2, r * 2);
      ctx.beginPath();
      ctx.moveTo(c.x - r * 0.35, c.y);
      ctx.lineTo(c.x + r * 0.35, c.y);
      ctx.moveTo(c.x, c.y - r * 0.35);
      ctx.lineTo(c.x, c.y + r * 0.35);
      ctx.stroke();
      // Lectura de temperatura que respira un poco, como un sensor de verdad.
      const temp = 36.4 + Math.sin(t * 0.9) * 0.25 + Math.sin(t * 4.1) * 0.05;
      ctx.font = `600 ${Math.round(Math.max(11, s * 0.05))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.textBaseline = "bottom";
      ctx.fillText(`${temp.toFixed(1)}°C`, c.x + r + 6, c.y - r - 2);
      // Barra de paleta en el lado derecho del marco, caliente arriba.
      const arriba = quadPoint(quad, 0.96, 0.12);
      const abajo = quadPoint(quad, 0.96, 0.88);
      const g = ctx.createLinearGradient(arriba.x, arriba.y, abajo.x, abajo.y);
      const paleta = [...IRONBOW].reverse();
      paleta.forEach((col, i) => g.addColorStop(i / (paleta.length - 1), col));
      ctx.shadowBlur = 0;
      ctx.strokeStyle = g;
      ctx.lineWidth = Math.max(4, s * 0.025);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(arriba.x, arriba.y);
      ctx.lineTo(abajo.x, abajo.y);
      ctx.stroke();
      ctx.restore();
    },
  },
  {
    id: "rayosx",
    label: "Rayos X",
    tecla: "2",
    acento: "#dfe9ff",
    ajustes: { intensidad: 0.5, tono: 0, detalle: 0.45 },
    etiquetas: { intensidad: "Exposición", tono: "Tinte", detalle: "Grano" },
    filtro: "invert(1) grayscale(1) contrast(1.15)",
    glsl: `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec3 c = cam(uv);
  float l = 1.0 - luma(c);
  l = pow(l, mix(1.1, 0.6, u_intensidad));
  float grano = (ruido(gl_FragCoord.xy) - 0.5) * mix(0.04, 0.22, u_detalle);
  // Partículas que suben despacio, como polvo sobre una placa.
  float aspecto = u_res.x / u_res.y;
  vec2 p = uv * vec2(aspecto, 1.0);
  float manchas = 0.0;
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    vec2 m = vec2(hash(vec2(fi, 1.0)) * aspecto,
                  fract(hash(vec2(fi, 2.0)) + u_time * (0.015 + fi * 0.004)));
    m.x += sin(u_time * 0.4 + fi) * 0.03;
    float radio = 0.006 + hash(vec2(fi, 3.0)) * 0.014;
    manchas += smoothstep(radio, radio * 0.6, distance(p, m));
  }
  vec3 col = vec3(l) + grano;
  col = mix(col, col * 0.12, clamp(manchas, 0.0, 1.0));
  col *= vec3(0.94, 0.97, 1.04);
  float v = 1.0 - smoothstep(0.5, 1.1, distance(uv, vec2(0.5)) * 1.4);
  col *= mix(0.75, 1.0, v);
  fragColor = vec4(tono(col, u_tono), 1.0);
}`,
  },
  {
    id: "led",
    label: "Matriz LED",
    tecla: "3",
    acento: "#39ff6a",
    ajustes: { intensidad: 0.65, tono: 0, detalle: 0.45 },
    etiquetas: { intensidad: "Brillo", tono: "Color del LED", detalle: "Tamaño del LED" },
    filtro: "grayscale(1) sepia(1) hue-rotate(70deg) saturate(4) contrast(1.3)",
    glsl: `
void main() {
  float celda = mix(6.0, 26.0, u_detalle);
  vec2 g = floor(gl_FragCoord.xy / celda);
  vec2 cuv = (g + 0.5) * celda / u_res;
  float l = pow(luma(cam(cuv)), 1.3);
  vec2 f = fract(gl_FragCoord.xy / celda) - 0.5;
  float d = max(abs(f.x), abs(f.y));
  float led = 1.0 - smoothstep(0.30, 0.40, d);
  vec3 on = tono(vec3(0.25, 1.0, 0.4), u_tono);
  float brillo = mix(0.6, 1.6, u_intensidad);
  vec3 col = on * l * led * brillo;
  col += on * 0.05 * led;   // LED apagado, apenas visible
  col += on * l * 0.12;     // sangrado de luz entre celdas
  fragColor = vec4(col, 1.0);
}`,
  },
  {
    id: "glitch",
    label: "Glitch",
    tecla: "4",
    acento: "#4df3ff",
    ajustes: { intensidad: 0.6, tono: 0, detalle: 0.5 },
    etiquetas: { intensidad: "Rotura", tono: "Tinte", detalle: "Franjas" },
    filtro: "hue-rotate(160deg) saturate(1.6) contrast(1.2)",
    glsl: `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float t = u_time;
  float bandas = mix(10.0, 48.0, u_detalle);
  float banda = floor(uv.y * bandas + t * 2.0);
  float r = hash(vec2(banda, floor(t * 9.0)));
  float salto = (r - 0.5) * 0.3 * u_intensidad * step(0.6, r);
  float rafaga = step(0.94, hash(vec2(floor(t * 3.0), 3.0)));
  salto += rafaga * (hash(vec2(banda, 7.0)) - 0.5) * 0.5 * u_intensidad;
  vec2 duv = vec2(uv.x + salto, uv.y);
  float ca = 0.004 + 0.02 * u_intensidad * rafaga;
  vec3 col;
  col.r = cam(duv + vec2(ca, 0.0)).r;
  col.g = cam(duv).g;
  col.b = cam(duv - vec2(ca, 0.0)).b;
  col *= 0.8 + 0.2 * sin(gl_FragCoord.y * 2.2 + t * 25.0);
  float rayas = step(0.985, hash(vec2(floor(gl_FragCoord.y / 2.0), floor(t * 30.0))));
  col = mix(col, vec3(0.75, 1.0, 1.0), rayas * 0.7);
  col = mix(col, col * vec3(0.55, 1.0, 1.15) + vec3(0.0, 0.06, 0.12), 0.7);
  fragColor = vec4(tono(col, u_tono), 1.0);
}`,
  },
  {
    id: "cubos",
    label: "Cubos 3D",
    tecla: "5",
    acento: "#d0d0d0",
    ajustes: { intensidad: 0.5, tono: 0, detalle: 0.5 },
    etiquetas: { intensidad: "Cuántos cubos", tono: "Color del cubo", detalle: "Tamaño" },
    filtro: "contrast(1.05)",
    glsl: `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec3 c = cam(uv);
  // Un pelín de contraste y menos saturación: la cámara se ve "de estudio".
  c = mix(vec3(luma(c)), c, 0.85);
  c = (c - 0.5) * 1.08 + 0.5;
  fragColor = vec4(c, 1.0);
}`,
    // Los cubos van SIN recortar: salen por delante del marco, como si
    // asomaran de la ventana.
    overlayLibre(ctx, { quad, t, presence, ajustes }) {
      cubos.draw(ctx, quad, {
        t,
        presence,
        cantidad: 1 + Math.round(ajustes.intensidad * 8),
        tamano: ajustes.detalle,
        tono: ajustes.tono,
      });
    },
  },
  {
    id: "neon",
    label: "Contorno neón",
    tecla: "6",
    acento: "#ff3cbf",
    ajustes: { intensidad: 0.55, tono: 0, detalle: 0.35 },
    etiquetas: { intensidad: "Brillo", tono: "Color", detalle: "Grosor" },
    filtro: "grayscale(1) contrast(3) invert(1)",
    glsl: `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 px = mix(1.0, 3.0, u_detalle) / u_res;
  float tl = luma(cam(uv + px * vec2(-1.0,  1.0)));
  float tc = luma(cam(uv + px * vec2( 0.0,  1.0)));
  float tr = luma(cam(uv + px * vec2( 1.0,  1.0)));
  float ml = luma(cam(uv + px * vec2(-1.0,  0.0)));
  float mr = luma(cam(uv + px * vec2( 1.0,  0.0)));
  float bl = luma(cam(uv + px * vec2(-1.0, -1.0)));
  float bc = luma(cam(uv + px * vec2( 0.0, -1.0)));
  float br = luma(cam(uv + px * vec2( 1.0, -1.0)));
  float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
  float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
  float borde = clamp(length(vec2(gx, gy)) * mix(1.5, 5.0, u_intensidad), 0.0, 1.0);
  float ang = atan(gy, gx);
  vec3 rosa = vec3(1.0, 0.2, 0.8);
  vec3 cian = vec3(0.2, 0.9, 1.0);
  vec3 neon = mix(rosa, cian, 0.5 + 0.5 * sin(ang * 2.0 + u_time));
  vec3 col = neon * borde + cam(uv) * 0.06;
  fragColor = vec4(tono(col, u_tono), 1.0);
}`,
  },
  {
    id: "semitono",
    label: "Semitono",
    tecla: "7",
    acento: "#ffd166",
    ajustes: { intensidad: 0.5, tono: 0, detalle: 0.4 },
    etiquetas: { intensidad: "Tinta", tono: "Color de tinta", detalle: "Trama" },
    filtro: "grayscale(1) contrast(1.6)",
    glsl: `
void main() {
  float celda = mix(5.0, 18.0, u_detalle);
  float a = 0.7853982;
  mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
  vec2 p = R * gl_FragCoord.xy;
  vec2 c = (floor(p / celda) + 0.5) * celda;
  vec2 cuv = (transpose(R) * c) / u_res;
  float l = luma(cam(clamp(cuv, 0.0, 1.0)));
  float radio = (1.0 - l) * celda * mix(0.55, 0.8, u_intensidad);
  float punto = 1.0 - smoothstep(radio - 0.9, radio + 0.9, distance(p, c));
  vec3 papel = vec3(0.97, 0.95, 0.90);
  vec3 tinta = tono(vec3(0.10, 0.10, 0.32), u_tono);
  fragColor = vec4(mix(papel, tinta, punto), 1.0);
}`,
  },
  {
    id: "pixel",
    label: "Pixel art",
    tecla: "8",
    acento: "#ff7a45",
    ajustes: { intensidad: 0.5, tono: 0, detalle: 0.35 },
    etiquetas: { intensidad: "Menos colores", tono: "Tinte", detalle: "Tamaño de píxel" },
    filtro: "saturate(1.5) contrast(1.2)",
    glsl: `
void main() {
  float celda = mix(4.0, 28.0, u_detalle);
  vec2 cuv = (floor(gl_FragCoord.xy / celda) + 0.5) * celda / u_res;
  vec3 c = cam(cuv);
  float niveles = floor(mix(10.0, 3.0, u_intensidad));
  c = floor(c * niveles + 0.5) / niveles;
  fragColor = vec4(tono(c, u_tono), 1.0);
}`,
  },
  {
    id: "duotono",
    label: "Duotono",
    tecla: "9",
    acento: "#ff5fb0",
    ajustes: { intensidad: 0.5, tono: 0, detalle: 0.3 },
    etiquetas: { intensidad: "Contraste", tono: "Paleta", detalle: "Grano" },
    filtro: "grayscale(1) sepia(1) hue-rotate(280deg) saturate(3)",
    glsl: `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float l = luma(cam(uv));
  l = clamp((l - 0.5) * mix(1.0, 2.2, u_intensidad) + 0.5, 0.0, 1.0);
  vec3 sombra = vec3(0.05, 0.00, 0.20);
  vec3 medio  = vec3(1.00, 0.30, 0.65);
  vec3 luz    = vec3(0.35, 0.95, 1.00);
  vec3 col = l < 0.5 ? mix(sombra, medio, l * 2.0) : mix(medio, luz, (l - 0.5) * 2.0);
  col += (ruido(gl_FragCoord.xy) - 0.5) * 0.08 * u_detalle;
  fragColor = vec4(tono(col, u_tono), 1.0);
}`,
  },
  {
    id: "vhs",
    label: "VHS",
    tecla: "0",
    acento: "#ffcf5a",
    ajustes: { intensidad: 0.55, tono: 0, detalle: 0.4 },
    etiquetas: { intensidad: "Desgaste", tono: "Tinte", detalle: "Sangrado de color" },
    filtro: "saturate(1.4) contrast(1.1) sepia(0.2)",
    glsl: `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float t = u_time;
  float ondula = sin(uv.y * 40.0 + t * 3.0) * 0.0025 * u_intensidad;
  // Banda de tracking que sube por la imagen y arrastra las líneas.
  float banda = fract(uv.y + t * 0.1);
  float arrastre = smoothstep(0.0, 0.05, banda) * (1.0 - smoothstep(0.05, 0.1, banda));
  float tiron = arrastre * (hash(vec2(floor(gl_FragCoord.y / 3.0), floor(t * 20.0))) - 0.5) * 0.08 * u_intensidad;
  vec2 duv = vec2(uv.x + ondula + tiron, uv.y);
  float sangrado = mix(0.002, 0.008, u_detalle);
  vec3 col;
  col.r = cam(duv + vec2(sangrado, 0.0)).r;
  col.g = cam(duv).g;
  col.b = cam(duv - vec2(sangrado, 0.0)).b;
  vec3 borroso = (cam(duv + vec2(sangrado * 3.0, 0.0)) + cam(duv - vec2(sangrado * 3.0, 0.0)) + col) / 3.0;
  col = mix(col, borroso, 0.45);
  col += (ruido(gl_FragCoord.xy) - 0.5) * 0.18 * u_intensidad;
  col *= 0.9 + 0.1 * sin(gl_FragCoord.y * 3.14159);
  col = mix(vec3(luma(col)), col, 1.35) * vec3(1.06, 0.98, 0.94);
  col = mix(col, vec3(0.9), arrastre * 0.25);
  fragColor = vec4(tono(col, u_tono), 1.0);
}`,
  },
  {
    id: "caleidoscopio",
    label: "Caleidoscopio",
    tecla: "q",
    acento: "#a97dff",
    ajustes: { intensidad: 0.4, tono: 0, detalle: 0.4 },
    etiquetas: { intensidad: "Giro", tono: "Tinte", detalle: "Segmentos" },
    filtro: "saturate(1.6) hue-rotate(40deg)",
    glsl: `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspecto = u_res.x / u_res.y;
  vec2 c = u_centro;
  vec2 p = (uv - c) * vec2(aspecto, 1.0);
  float segmentos = floor(mix(2.0, 8.0, u_detalle)) * 2.0;
  float s = 6.2831853 / segmentos;
  float ang = atan(p.y, p.x) + u_time * 0.25 * u_intensidad;
  float r = length(p);
  ang = mod(ang, s);
  ang = abs(ang - s * 0.5);
  vec2 q = vec2(cos(ang), sin(ang)) * r / vec2(aspecto, 1.0) + c;
  // Reflejar en los bordes en vez de cortar.
  q = abs(fract(q * 0.5) * 2.0 - 1.0);
  fragColor = vec4(tono(cam(q), u_tono), 1.0);
}`,
  },
  {
    id: "estela",
    label: "Estela de luz",
    tecla: "w",
    acento: "#7dffea",
    feedback: true,
    ajustes: { intensidad: 0.7, tono: 0, detalle: 0.3 },
    etiquetas: { intensidad: "Duración", tono: "Tinte", detalle: "Expansión" },
    filtro: "saturate(1.4) brightness(1.1)",
    glsl: `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec3 c = tono(cam(uv), u_tono);
  // El cuadro anterior se acerca un poco y gira de tono: la estela crece
  // hacia fuera y cambia de color mientras se apaga.
  float zoom = 1.0 - mix(0.002, 0.02, u_detalle);
  vec2 puv = (uv - 0.5) * zoom + 0.5;
  vec3 p = texture(u_prev, puv).rgb;
  p = tono(p, 0.015) * mix(0.82, 0.97, u_intensidad);
  fragColor = vec4(max(c, p), 1.0);
}`,
  },
  {
    id: "ondas",
    label: "Agua",
    tecla: "e",
    acento: "#5db4ff",
    ajustes: { intensidad: 0.5, tono: 0, detalle: 0.4 },
    etiquetas: { intensidad: "Oleaje", tono: "Tinte", detalle: "Frecuencia" },
    filtro: "saturate(1.2) hue-rotate(15deg)",
    glsl: `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float f = mix(6.0, 30.0, u_detalle);
  float amp = 0.03 * u_intensidad;
  vec2 d = uv;
  d.x += sin(uv.y * f + u_time * 2.0) * amp;
  d.y += cos(uv.x * f * 0.8 + u_time * 1.6) * amp;
  vec3 col = cam(d);
  // Brillo iridiscente en las crestas.
  float cresta = sin(uv.y * f + u_time * 2.0) * cos(uv.x * f * 0.8 + u_time * 1.6);
  col += vec3(0.1, 0.3, 0.5) * cresta * 0.25 * u_intensidad;
  fragColor = vec4(tono(col, u_tono), 1.0);
}`,
  },
];

export const EFECTO_INICIAL = "termica";

export function buscarEfecto(id) {
  return EFECTOS.find((e) => e.id === id) || EFECTOS[0];
}

/** Ajustes efectivos de un efecto: los de fábrica pisados por los guardados. */
export function ajustesDe(efecto, guardados = {}) {
  return { ...efecto.ajustes, ...(guardados[efecto.id] || {}) };
}
