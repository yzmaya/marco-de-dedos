// tracking.js — geometría del marco de dedos y pipeline de robustez.
//
// Este módulo es LÓGICA PURA: no toca el DOM, no importa nada por CDN y no
// sabe qué es MediaPipe. Recibe landmarks (arreglos de 21 puntos con x, y
// normalizados de 0 a 1) y devuelve el cuadrilátero en píxeles del canvas.
// Por eso se puede probar en Node, que es la única verificación real que
// tenemos en el sandbox (ver tests/run-tests.mjs).

// Índices de landmarks de MediaPipe Hand Landmarker.
export const WRIST = 0;
export const THUMB_TIP = 4;
export const INDEX_MCP = 5;
export const INDEX_PIP = 6;
export const INDEX_TIP = 8;
export const MIDDLE_MCP = 9;
export const MIDDLE_PIP = 10;
export const MIDDLE_TIP = 12;
export const RING_PIP = 14;
export const RING_TIP = 16;
export const PINKY_PIP = 18;
export const PINKY_TIP = 20;

export const TRACKING_DEFAULTS = {
  // Histéresis de separación pulgar-índice, en múltiplos del tamaño de la
  // mano. Cuesta entrar (0.6) y cuesta salir (0.2), así que girar o
  // escorzar los dedos no apaga el efecto. Era 0.75, pero con la mano de
  // perfil o vista por el dorso (cámara trasera) la L se acorta y no entraba.
  spreadEnter: 0.6,
  spreadExit: 0.2,
  // Histéresis de área mínima del cuadrilátero, como fracción del canvas.
  areaEnter: 0.005,
  areaExit: 0.0005,
  // Cuántos cuadros se sostiene el último marco cuando el tracking se cae.
  // Las manos cruzadas se ocultan entre sí y rompen la detección un rato.
  maxLostFrames: 25,
  // Un salto grande debe repetirse este número de cuadros seguidos para
  // aceptarse como reposicionamiento real y no como detección errónea.
  jumpConfirmFrames: 2,
  // Un salto es sospechoso a partir de este porcentaje del ancho de pantalla
  // en un solo cuadro: ninguna mano real se mueve tanto.
  jumpRatio: 0.3,
  // Velocidad del fundido de presencia (aparecer / desaparecer).
  presenceIn: 0.12,
  presenceOut: 0.05,
  // Suavizado adaptativo por velocidad: quieta suaviza mucho (0.35), rápida
  // sigue casi sin retraso (0.85). smoothSpan es la velocidad, en fracción
  // del ancho por cuadro, a la que se alcanza el máximo.
  smoothMin: 0.35,
  smoothMax: 0.85,
  smoothSpan: 0.05,
};

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function lerpPt(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function centroid(pts) {
  const n = pts.length;
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / n,
    y: pts.reduce((s, p) => s + p.y, 0) / n,
  };
}

/** Área con la fórmula del cordón (shoelace). Un polígono cruzado la cancela. */
export function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
}

/** Reordena por ángulo alrededor del centro: da siempre un polígono simple. */
export function orderByAngle(pts) {
  const c = centroid(pts);
  return [...pts].sort(
    (a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x)
  );
}

/**
 * Landmark normalizado a píxel de canvas. El canvas se dibuja en espejo
 * (como un espejo de verdad), así que la x se invierte para que las
 * coordenadas coincidan con lo que se ve en pantalla.
 */
export function toPixel(lm, width, height, mirror = true) {
  return { x: (mirror ? 1 - lm.x : lm.x) * width, y: lm.y * height };
}

/**
 * Lo que el marco necesita de una mano, en píxeles: punta del índice, punta
 * del pulgar, x de la muñeca y la apertura pulgar-índice en múltiplos del
 * tamaño de la mano. Lo usa computeQuad y también el dibujo de ayuda que
 * enseña si la L está lo bastante abierta.
 */
export function handInfo(lm, { width, height, mirror = true }) {
  const wrist = toPixel(lm[WRIST], width, height, mirror);
  const index = toPixel(lm[INDEX_TIP], width, height, mirror);
  const thumb = toPixel(lm[THUMB_TIP], width, height, mirror);
  // Tamaño de la mano medido de muñeca a nudillo medio: estable apunten
  // donde apunten los dedos, a diferencia de medir sobre los dedos, que
  // se acortan por escorzo al girar la mano.
  const scale = dist(wrist, toPixel(lm[MIDDLE_MCP], width, height, mirror)) + 1;
  return { index, thumb, wristX: wrist.x, scale, spread: dist(thumb, index) / scale };
}

/**
 * Dadas exactamente dos manos, devuelve las 4 esquinas del marco en ORDEN
 * ANATÓMICO: [índice izq, índice der, pulgar der, pulgar izq] ("izq" y "der"
 * según la posición en pantalla de la muñeca).
 *
 * Cada esquina pertenece a un dedo concreto, así que el ciclo de aristas es
 * geometría honesta: dos "L" derechas trazan un rectángulo, y si volteas una
 * mano las aristas se cruzan en un moño de dos triángulos. Como el orden no
 * guarda estado, al descruzar los dedos se recupera solo.
 *
 * Devuelve null si el gesto no está (dedos juntos o área degenerada).
 */
export function computeQuad(hands, {
  width,
  height,
  active = false,
  mirror = true,
  opts = TRACKING_DEFAULTS,
} = {}) {
  if (!hands || hands.length !== 2) return null;

  const info = hands.map((lm) => handInfo(lm, { width, height, mirror }));

  // Gate de separación con histéresis: pulgar e índice bien abiertos en "L".
  const needed = active ? opts.spreadExit : opts.spreadEnter;
  for (const hand of info) {
    if (hand.spread < needed) return null;
  }

  info.sort((a, b) => a.wristX - b.wristX);
  const [A, B] = info;
  const quad = [A.index, B.index, B.thumb, A.thumb];

  // Gate de área degenerada, medido sobre la envolvente ordenada por ángulo:
  // así se mide la extensión ocupada aunque el cuadrilátero esté cruzado, y
  // solo se rechaza cuando el marco de verdad es minúsculo.
  const minArea = active ? opts.areaExit : opts.areaEnter;
  if (polygonArea(orderByAngle(quad)) < width * height * minArea) return null;

  return quad;
}

/**
 * Pipeline de robustez temporal del cuadrilátero. Estado explícito y update()
 * determinista (no depende del reloj), para poder simularlo cuadro a cuadro
 * en las pruebas.
 */
export class FrameTracker {
  constructor(opts = {}) {
    this.opts = { ...TRACKING_DEFAULTS, ...opts };
    this.reset();
  }

  reset() {
    /** Esquinas suavizadas que se dibujan, o null. */
    this.corners = null;
    /** Fundido de presencia, de 0 a 1. */
    this.presence = 0;
    /** true mientras hay marco: relaja los gates (histéresis). */
    this.active = false;
    this.lostFrames = 0;
    this.jumpFrames = 0;
  }

  /**
   * @param {Array|null} target cuadrilátero crudo de este cuadro, o null
   * @param {number} width ancho del canvas, escala de referencia
   */
  update(target, width) {
    const o = this.opts;

    if (target && !this.corners) {
      // Primera aparición: engancha directo, sin suavizar.
      this.corners = target;
      this.lostFrames = 0;
      this.jumpFrames = 0;
      this.active = true;
      this.presence = Math.min(1, this.presence + o.presenceIn);
      return this;
    }

    if (target) {
      const moved =
        target.reduce((s, p, i) => s + dist(p, this.corners[i]), 0) / 4;

      // Rechazo de teletransporte: un salto enorme aislado suele ser una
      // detección errónea mientras las manos se solapan.
      if (moved > width * o.jumpRatio && ++this.jumpFrames < o.jumpConfirmFrames) {
        if (++this.lostFrames > o.maxLostFrames) {
          this.presence = Math.max(0, this.presence - o.presenceOut);
        }
        return this;
      }

      this.lostFrames = 0;
      this.jumpFrames = 0;
      this.active = true;
      // Suavizado adaptativo por velocidad.
      const alpha = Math.min(
        o.smoothMax,
        Math.max(o.smoothMin, moved / (width * o.smoothSpan))
      );
      this.corners = this.corners.map((c, i) => lerpPt(c, target[i], alpha));
      this.presence = Math.min(1, this.presence + o.presenceIn);
      return this;
    }

    // Sin cuadrilátero este cuadro.
    if (this.corners && ++this.lostFrames <= o.maxLostFrames) {
      // Hueco breve de tracking: sostener el último marco en vez de apagarlo.
      this.presence = Math.min(1, this.presence + o.presenceIn);
      return this;
    }

    this.presence = Math.max(0, this.presence - o.presenceOut);
    if (this.presence === 0) {
      this.corners = null;
      this.active = false;
      this.jumpFrames = 0;
      this.lostFrames = 0;
    }
    return this;
  }

  /** ¿Hay algo que valga la pena dibujar este cuadro? */
  get visible() {
    return !!this.corners && this.presence > 0.01;
  }
}

// ---------------------------------------------------------------- puño
//
// Un puño cerrado cambia de cámara (frontal ↔ trasera). Es lógica pura, como
// el resto del módulo, y se prueba en Node.

const DEDOS = [
  [INDEX_TIP, INDEX_PIP],
  [MIDDLE_TIP, MIDDLE_PIP],
  [RING_TIP, RING_PIP],
  [PINKY_TIP, PINKY_PIP],
];

/**
 * ¿Está la mano cerrada en puño? Un dedo estirado tiene la punta más lejos
 * de la muñeca que su nudillo medio; doblado, la punta se acerca a la palma
 * y queda más cerca que el nudillo. Se piden los cuatro dedos (el pulgar se
 * ignora: en un puño puede quedar por fuera o por dentro). Es independiente
 * de la orientación de la mano, no hace falta que esté derecha.
 */
export function isFist(lm) {
  if (!lm || lm.length < 21) return false;
  const w = lm[WRIST];
  return DEDOS.every(([tip, pip]) => dist(lm[tip], w) < dist(lm[pip], w));
}

/** La primera mano en puño, o null. */
export function fistHand(hands) {
  if (!hands) return null;
  return hands.find(isFist) ?? null;
}

export const FIST_DEFAULTS = {
  // Cuadros seguidos de puño para disparar: evita que un cierre fugaz de la
  // mano al hacer el marco cambie de cámara.
  holdFrames: 12,
  // Cuadros sin puño para volver a armar: hay que abrir la mano y volver a
  // cerrarla para disparar otra vez.
  releaseFrames: 6,
  // Tiempo mínimo entre cambios: cambiar de cámara tarda y no hay que
  // encadenar dos cambios por un puño largo.
  cooldownMs: 2000,
};

/**
 * Detector de puño sostenido. update() devuelve true UNA vez por puño, y solo
 * cuando se ha mantenido holdFrames cuadros; después hay que abrir la mano.
 */
export class FistDetector {
  constructor(opts = {}) {
    this.opts = { ...FIST_DEFAULTS, ...opts };
    this.reset();
  }

  reset() {
    this.held = 0;
    this.released = 0;
    this.armed = true;
    this.lastFireAt = -Infinity;
    this.hand = null;
  }

  /**
   * @param {Array|null} hands landmarks de este cuadro (null si no hay)
   * @param {number} nowMs reloj en milisegundos
   * @returns {boolean} true si hay que cambiar de cámara ahora
   */
  update(hands, nowMs) {
    this.hand = fistHand(hands);
    if (this.hand) {
      this.held++;
      this.released = 0;
    } else {
      this.held = 0;
      if (++this.released >= this.opts.releaseFrames) this.armed = true;
    }
    if (
      this.hand &&
      this.armed &&
      this.held >= this.opts.holdFrames &&
      nowMs - this.lastFireAt >= this.opts.cooldownMs
    ) {
      this.armed = false;
      this.lastFireAt = nowMs;
      return true;
    }
    return false;
  }

  /** Cuánto falta para disparar, de 0 a 1, para dibujar el anillo de espera. */
  get progress() {
    if (!this.hand || !this.armed) return 0;
    return Math.min(1, this.held / this.opts.holdFrames);
  }
}
