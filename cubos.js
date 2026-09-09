// cubos.js — cubos 3D flotando en el marco, dibujados a mano en canvas 2D.
//
// Geometría pura, sin librerías: ocho vértices, seis caras, rotación,
// proyección en perspectiva, descarte de caras traseras y orden de pintor.
// Todo lo que no toca el contexto 2D se prueba en Node.
//
// Convención de la vista: x a la derecha, y hacia abajo (como el canvas) y z
// alejándose del espectador. La cámara está en z negativo mirando hacia +z.

import { quadPoint, quadScale } from "./composite.js";

export const VERTICES = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
export const CARAS = [
  [0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4],
  [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4],
];

/** Pseudoaleatorio con semilla: las pruebas necesitan repetibilidad. */
export function makeRandom(seed = 1) {
  let s = seed >>> 0 || 1;
  return function random() {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function rotar([x, y, z], ax, ay, az) {
  const cx = Math.cos(ax), sx = Math.sin(ax);
  const y1 = y * cx - z * sx;
  const z1 = y * sx + z * cx;
  const cy = Math.cos(ay), sy = Math.sin(ay);
  const x2 = x * cy + z1 * sy;
  const z2 = -x * sy + z1 * cy;
  const cz = Math.cos(az), sz = Math.sin(az);
  const x3 = x2 * cz - y1 * sz;
  const y3 = x2 * sz + y1 * cz;
  return [x3, y3, z2];
}

/** Perspectiva simple: lo que está más cerca (z negativo) sale más grande. */
export function proyectar([x, y, z], foco = 4) {
  const k = foco / (foco + z);
  return { x: x * k, y: y * k, k };
}

function normalizar(v) {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** Normal unitaria de una cara, apuntando hacia fuera del cubo. */
export function normalDeCara(verts, cara) {
  const [a, b, c] = cara.map((i) => verts[i]);
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  // El cubo está centrado en el origen: el centro de la cara apunta hacia fuera.
  const centro = cara.reduce(
    (s, i) => [s[0] + verts[i][0], s[1] + verts[i][1], s[2] + verts[i][2]],
    [0, 0, 0]
  );
  if (n[0] * centro[0] + n[1] * centro[1] + n[2] * centro[2] < 0) n = n.map((c) => -c);
  return normalizar(n);
}

/** Caras que miran a la cámara, ordenadas de lejos a cerca (orden de pintor). */
export function carasVisibles(verts) {
  return CARAS.map((cara) => ({
    cara,
    n: normalDeCara(verts, cara),
    z: cara.reduce((s, i) => s + verts[i][2], 0) / 4,
  }))
    .filter((f) => f.n[2] < 0)
    .sort((a, b) => b.z - a.z);
}

function trazar(ctx, cara, puntos) {
  ctx.beginPath();
  ctx.moveTo(puntos[cara[0]].x, puntos[cara[0]].y);
  for (let i = 1; i < cara.length; i++) ctx.lineTo(puntos[cara[i]].x, puntos[cara[i]].y);
  ctx.closePath();
}

// Luz desde arriba a la izquierda y por delante del espectador.
const LUZ = normalizar([-0.45, -0.6, -0.65]);

export class Cubos {
  constructor({ maximo = 9, seed = 3 } = {}) {
    const random = makeRandom(seed);
    this.cubos = Array.from({ length: maximo }, () => ({
      u: 0.1 + random() * 0.8,
      v: 0.12 + random() * 0.76,
      fase: random() * Math.PI * 2,
      amp: 0.015 + random() * 0.035,
      vel: [0.5 + random() * 0.7, 0.4 + random() * 0.8, 0.2 + random() * 0.5]
        .map((s) => (random() < 0.5 ? -s : s)),
      escala: 0.65 + random() * 0.7,
    }));
  }

  /** Posición y semitamaño de cada cubo activo (lógica pura, para probar). */
  colocar(quad, { t = 0, cantidad = 5, tamano = 0.5 } = {}) {
    const base = quadScale(quad) * (0.09 + 0.16 * tamano);
    const n = Math.max(1, Math.min(this.cubos.length, Math.round(cantidad)));
    return this.cubos.slice(0, n).map((c) => ({
      pos: quadPoint(
        quad,
        c.u + Math.sin(t * 0.7 + c.fase) * c.amp,
        c.v + Math.cos(t * 0.9 + c.fase) * c.amp
      ),
      semi: base * c.escala * 0.5,
      angulos: [t * c.vel[0] + c.fase, t * c.vel[1], t * c.vel[2]],
    }));
  }

  draw(ctx, quad, { t = 0, presence = 1, cantidad = 5, tamano = 0.5, tono = 0 } = {}) {
    ctx.save();
    ctx.globalAlpha *= presence;
    ctx.lineJoin = "round";
    for (const { pos, semi, angulos } of this.colocar(quad, { t, cantidad, tamano })) {
      const verts = VERTICES.map((v) => rotar(v, ...angulos));
      const caras = carasVisibles(verts);
      const puntos = verts.map((v) => {
        const p = proyectar(v);
        return { x: pos.x + p.x * semi, y: pos.y + p.y * semi };
      });

      // Sombra suave: se pinta la silueta muy lejos, fuera de pantalla, con
      // la sombra desplazada de vuelta. Solo se ve la sombra.
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.38)";
      ctx.shadowBlur = semi * 0.9;
      ctx.shadowOffsetX = 10000;
      ctx.shadowOffsetY = 10000 + semi * 0.5;
      ctx.translate(-10000, -10000);
      ctx.fillStyle = "#000";
      for (const f of caras) {
        trazar(ctx, f.cara, puntos);
        ctx.fill();
      }
      ctx.restore();

      for (const f of caras) {
        const lam = Math.max(0, f.n[0] * LUZ[0] + f.n[1] * LUZ[1] + f.n[2] * LUZ[2]);
        const luz = 35 + 45 * lam;
        ctx.fillStyle = tono > 0.001
          ? `hsl(${Math.round(tono * 360)}, 55%, ${luz.toFixed(0)}%)`
          : `hsl(0, 0%, ${luz.toFixed(0)}%)`;
        trazar(ctx, f.cara, puntos);
        ctx.fill();
        ctx.lineWidth = Math.max(1, semi * 0.03);
        ctx.strokeStyle = "rgba(0,0,0,0.18)";
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
