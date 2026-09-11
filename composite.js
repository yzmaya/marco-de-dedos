// composite.js — canvas, recorte del marco, contorno y utilidades de geometría.
//
// Todo lo de aquí corre en local, a la velocidad de la pantalla. Por eso el
// marco sigue los dedos con latencia cero: el recorte no espera a nadie.
//
// El módulo no toca el DOM al importarse (recibe siempre el contexto 2D como
// argumento), así que las funciones de geometría se pueden probar en Node.

import { centroid } from "./tracking.js";

/** Color por defecto del contorno cuando el efecto no trae el suyo. */
export const ACENTO = "#7df3ff";

/** Dibuja una fuente en espejo llenando w x h. */
export function drawMirrored(ctx, w, h, src) {
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0, w, h);
  ctx.restore();
}

/** Traza el camino del cuadrilátero (sin pintar). */
export function quadPath(ctx, quad) {
  ctx.beginPath();
  ctx.moveTo(quad[0].x, quad[0].y);
  for (let i = 1; i < quad.length; i++) ctx.lineTo(quad[i].x, quad[i].y);
  ctx.closePath();
}

/**
 * Abre la ventana: recorta al cuadrilátero, aplica la opacidad de presencia y
 * llama a draw() para que pinte el efecto alineado a pantalla completa.
 */
export function clipToQuad(ctx, quad, presence, draw) {
  ctx.save();
  quadPath(ctx, quad);
  ctx.clip();
  ctx.globalAlpha = presence;
  draw(ctx);
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** Contorno punteado animado (hormigas marchando) y puntos pulsantes. */
export function drawOutline(ctx, quad, { presence = 1, timeSec = 0, accent = ACENTO } = {}) {
  ctx.save();
  ctx.globalAlpha = presence;

  quadPath(ctx, quad);
  ctx.setLineDash([10, 8]);
  ctx.lineDashOffset = -timeSec * 40;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 6;
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  ctx.shadowBlur = 0;

  quad.forEach((p, i) => {
    const r = 7 + Math.sin(timeSec * 3 + i * 1.5) * 1.5;
    // Halo del color del efecto que se expande y se desvanece, desfasado por esquina.
    const halo = (timeSec * 0.8 + i * 0.25) % 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + halo * 14, 0, Math.PI * 2);
    ctx.strokeStyle = withAlpha(accent, 0.55 * (1 - halo) * presence);
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = withAlpha(accent, 0.7);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  ctx.restore();
}

/** Mensaje centrado dentro del marco. */
export function drawQuadMessage(ctx, quad, text, width) {
  const c = centroid(quad);
  ctx.save();
  ctx.font = `600 ${Math.round(width / 55)}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.75)";
  ctx.shadowBlur = 10;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fillText(text, c.x, c.y);
  ctx.restore();
}

/** "#rrggbb" + alfa → rgba(). Deja pasar cualquier otra notación tal cual. */
export function withAlpha(color, alpha) {
  const a = Math.max(0, Math.min(1, alpha));
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    const n = parseInt(color.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a.toFixed(3)})`;
  }
  return color;
}

/**
 * Punto dentro del cuadrilátero en coordenadas locales (u, v) de 0 a 1.
 * Interpolación bilineal sobre las cuatro esquinas: lo que se coloque así se
 * inclina con el marco en vez de flotar recto sobre él.
 */
export function quadPoint(quad, u, v) {
  const [tl, tr, br, bl] = quad;
  const topX = tl.x + (tr.x - tl.x) * u;
  const topY = tl.y + (tr.y - tl.y) * u;
  const botX = bl.x + (br.x - bl.x) * u;
  const botY = bl.y + (br.y - bl.y) * u;
  return { x: topX + (botX - topX) * v, y: topY + (botY - topY) * v };
}

/** Lado corto del marco, para escalar lo que se dibuja dentro con la ventana. */
export function quadScale(quad) {
  const [tl, tr, br, bl] = quad;
  const ancho = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) / 2;
  const alto = (Math.hypot(bl.x - tl.x, bl.y - tl.y) + Math.hypot(br.x - tr.x, br.y - tr.y)) / 2;
  return Math.min(ancho, alto);
}

/**
 * Encuadre para un visor tipo cardboard: la misma escena dos veces, una por
 * ojo, cada una en su mitad de la pantalla. La escena se encaja al ancho de
 * la mitad. El `zoom` es la escala con la que se presenta: 1 deja la imagen
 * de la cámara principal a un tamaño parecido al que ven los ojos a través
 * de las lentes de un cardboard, que es lo que menos marea. Cada visor es
 * distinto, así que se puede afinar con las teclas + y −.
 *
 * @returns {Array<{clip:{x,y,w,h}, x,y,w,h}>} recorte de cada ojo y dónde va
 *   la escena dentro (puede sobresalir del recorte: ese es el zoom).
 */
export function encuadreVR(w, h, zoom = 1) {
  const ojoW = w / 2;
  const dw = ojoW * zoom;
  const dh = ((h * ojoW) / w) * zoom;
  const dx = (ojoW - dw) / 2;
  const dy = (h - dh) / 2;
  return [0, 1].map((i) => ({
    clip: { x: i * ojoW, y: 0, w: ojoW, h },
    x: i * ojoW + dx,
    y: dy,
    w: dw,
    h: dh,
  }));
}

/** Pinta la escena en estéreo lado a lado sobre `salida`. */
export function drawVR(salida, escena, w, h, zoom = 1) {
  salida.fillStyle = "#000";
  salida.fillRect(0, 0, w, h);
  for (const ojo of encuadreVR(w, h, zoom)) {
    salida.save();
    salida.beginPath();
    salida.rect(ojo.clip.x, ojo.clip.y, ojo.clip.w, ojo.clip.h);
    salida.clip();
    salida.drawImage(escena, ojo.x, ojo.y, ojo.w, ojo.h);
    salida.restore();
  }
  // Separador fino entre los dos ojos, para alinear el visor.
  salida.fillStyle = "rgba(255,255,255,0.18)";
  salida.fillRect(w / 2 - 1, 0, 2, h);
}

/** Ajusta el canvas al tamaño real del video. Devuelve true si cambió. */
export function resizeCanvasToVideo(canvas, video) {
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  return true;
}

/** Contador de fps por ventana deslizante de 2 segundos. */
export class FpsMeter {
  constructor(windowMs = 2000) {
    this.windowMs = windowMs;
    this.stamps = [];
  }
  tick(now) {
    this.stamps.push(now);
    while (this.stamps.length && now - this.stamps[0] > this.windowMs) {
      this.stamps.shift();
    }
    return this.fps;
  }
  get fps() {
    if (this.stamps.length < 2) return 0;
    const span = this.stamps[this.stamps.length - 1] - this.stamps[0];
    return span > 0 ? ((this.stamps.length - 1) / span) * 1000 : 0;
  }
  reset() {
    this.stamps = [];
  }
}
