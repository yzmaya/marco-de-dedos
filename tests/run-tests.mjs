// tests/run-tests.mjs — pruebas de la lógica pura, en Node, sin dependencias.
//
//   node tests/run-tests.mjs
//
// Sin cámara ni pantalla, esto es lo que se puede verificar de verdad: el
// ordenamiento de esquinas, la histéresis, el rechazo de teletransporte, el
// suavizado, el sostenimiento de dropout, el fundido de presencia, la
// geometría de los cubos y la coherencia de la lista de efectos. El resultado
// visual se prueba en el navegador (tests/qa-navegador.mjs).

import assert from "node:assert/strict";
import {
  computeQuad,
  FrameTracker,
  TRACKING_DEFAULTS,
  polygonArea,
  orderByAngle,
  dist,
  centroid,
  toPixel,
  INDEX_TIP,
  THUMB_TIP,
  WRIST,
  handInfo,
  prayerCenter,
  PalmsDetector,
  PALMS_DEFAULTS,
} from "../tracking.js";
import { withAlpha, FpsMeter, quadPoint, quadScale, encuadreVR } from "../composite.js";
import {
  VERTICES,
  CARAS,
  rotar,
  proyectar,
  normalDeCara,
  carasVisibles,
  makeRandom,
  Cubos,
} from "../cubos.js";
import { makeFakeHands } from "../demo.js";
import { EFECTOS, EFECTO_INICIAL, buscarEfecto, ajustesDe, PRELUDIO_GLSL } from "../efectos.js";

const CLAVES = ["intensidad", "tono", "detalle"];

const W = 1280;
const H = 720;

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}
function group(name) {
  console.log(`\n${name}`);
}

/** Acerca el pulgar al índice de las dos manos por un factor 0..1. */
function pinch(hands, factor) {
  return hands.map((lm) => {
    const copy = lm.map((p) => ({ ...p }));
    const i = copy[INDEX_TIP];
    const t = copy[THUMB_TIP];
    copy[THUMB_TIP] = { x: i.x + (t.x - i.x) * factor, y: i.y + (t.y - i.y) * factor, z: 0 };
    return copy;
  });
}

// ---------------------------------------------------------------- geometría
group("Geometría del cuadrilátero");

test("polygonArea calcula el área de un rectángulo", () => {
  const r = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
    { x: 0, y: 50 },
  ];
  assert.equal(polygonArea(r), 5000);
});

test("un cuadrilátero cruzado tiene área trazada menor que su envolvente", () => {
  const crossed = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 0, y: 50 },
    { x: 100, y: 50 },
  ];
  assert.ok(polygonArea(crossed) < polygonArea(orderByAngle(crossed)));
  assert.equal(polygonArea(orderByAngle(crossed)), 5000);
});

test("las esquinas salen en orden anatómico: índices arriba, pulgares abajo", () => {
  const quad = computeQuad(makeFakeHands(0), { width: W, height: H });
  assert.ok(quad, "debería detectar el marco");
  const [i0, i1, t1, t0] = quad;
  assert.ok(i0.y < t0.y && i1.y < t1.y, "los índices deben quedar arriba");
  assert.ok(i0.x < i1.x, "la primera esquina es la de la mano izquierda");
  assert.ok(Math.abs(i0.x - t0.x) < Math.abs(i0.x - t1.x), "esquinas emparejadas por mano");
});

test("el orden anatómico traza un polígono simple (no se cruza)", () => {
  const quad = computeQuad(makeFakeHands(0), { width: W, height: H });
  assert.ok(Math.abs(polygonArea(quad) - polygonArea(orderByAngle(quad))) < 1e-6);
});

test("voltear una mano cruza el marco en moño, y descruzarla lo recupera", () => {
  const crossed = computeQuad(makeFakeHands(0, true), { width: W, height: H, active: true });
  assert.ok(crossed, "el marco cruzado sigue siendo un cuadrilátero");
  assert.ok(polygonArea(crossed) < polygonArea(orderByAngle(crossed)) * 0.9);
  const back = computeQuad(makeFakeHands(0), { width: W, height: H, active: true });
  assert.ok(Math.abs(polygonArea(back) - polygonArea(orderByAngle(back))) < 1e-6);
});

test("el espejo invierte la x y respeta la y", () => {
  const p = toPixel({ x: 0.25, y: 0.5 }, W, H, true);
  assert.equal(p.x, 0.75 * W);
  assert.equal(p.y, 0.5 * H);
  assert.equal(toPixel({ x: 0.25, y: 0.5 }, W, H, false).x, 0.25 * W);
});

test("handInfo mide la apertura en tamaños de mano y el marco de demo pasa el gate", () => {
  for (const lm of makeFakeHands(0)) {
    const i = handInfo(lm, { width: W, height: H });
    assert.ok(i.spread > TRACKING_DEFAULTS.spreadEnter, `apertura ${i.spread.toFixed(2)}`);
    assert.ok(i.scale > 1);
  }
  const cerrada = pinch(makeFakeHands(0), 0.05)[0];
  assert.ok(handInfo(cerrada, { width: W, height: H }).spread < TRACKING_DEFAULTS.spreadExit);
});

test("computeQuad exige exactamente dos manos", () => {
  const hands = makeFakeHands(0);
  assert.equal(computeQuad(null, { width: W, height: H }), null);
  assert.equal(computeQuad([hands[0]], { width: W, height: H }), null);
  assert.equal(computeQuad([...hands, hands[0]], { width: W, height: H }), null);
});

test("quadPoint interpola bilinealmente dentro del marco", () => {
  const q = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 100 },
    { x: 0, y: 100 },
  ];
  assert.deepEqual(quadPoint(q, 0, 0), { x: 0, y: 0 });
  assert.deepEqual(quadPoint(q, 1, 1), { x: 200, y: 100 });
  assert.deepEqual(quadPoint(q, 0.5, 0.5), { x: 100, y: 50 });
  // Marco inclinado: el punto se inclina con él.
  const inclinado = [
    { x: 0, y: 0 },
    { x: 200, y: 40 },
    { x: 200, y: 140 },
    { x: 0, y: 100 },
  ];
  assert.deepEqual(quadPoint(inclinado, 1, 0), { x: 200, y: 40 });
});

test("quadScale es el lado corto del marco", () => {
  const q = [
    { x: 0, y: 0 },
    { x: 300, y: 0 },
    { x: 300, y: 120 },
    { x: 0, y: 120 },
  ];
  assert.equal(quadScale(q), 120);
});

// ---------------------------------------------------------------- histéresis
group("Histéresis de los gates");


test("cuesta más entrar que salir: hay una zona que solo pasa estando activo", () => {
  const partly = pinch(makeFakeHands(0), 0.15);
  assert.equal(computeQuad(partly, { width: W, height: H, active: false }), null);
  assert.ok(computeQuad(partly, { width: W, height: H, active: true }));
});

test("dedos totalmente juntos apagan el efecto aunque esté activo", () => {
  const closed = pinch(makeFakeHands(0), 0.02);
  assert.equal(computeQuad(closed, { width: W, height: H, active: true }), null);
});

test("el gate de área también tiene dos umbrales", () => {
  assert.ok(TRACKING_DEFAULTS.areaEnter > TRACKING_DEFAULTS.areaExit);
  const tiny = makeFakeHands(0).map((lm, handIdx) =>
    lm.map((p) => ({
      x: 0.5 + (p.x - 0.5) * 0.1 + (handIdx ? 0.012 : -0.012),
      y: 0.5 + (p.y - 0.5) * 0.1,
      z: 0,
    }))
  );
  assert.equal(computeQuad(tiny, { width: W, height: H, active: false }), null);
  assert.ok(computeQuad(tiny, { width: W, height: H, active: true }));
});

// ------------------------------------------------------------------ tracker
group("Pipeline de robustez (FrameTracker)");

const quadAt = (x, y, w = 300, h = 200) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

test("engancha el primer cuadrilátero sin suavizar", () => {
  const t = new FrameTracker();
  const q = quadAt(100, 100);
  t.update(q, W);
  assert.deepEqual(t.corners, q);
  assert.ok(t.active);
  assert.ok(t.presence > 0);
});

test("la presencia sube y baja con fundido, nunca de golpe", () => {
  const t = new FrameTracker();
  const q = quadAt(100, 100);
  t.update(q, W);
  assert.ok(t.presence < 1);
  for (let i = 0; i < 20; i++) t.update(q, W);
  assert.equal(t.presence, 1);
  for (let i = 0; i < TRACKING_DEFAULTS.maxLostFrames; i++) t.update(null, W);
  assert.equal(t.presence, 1, "los dropouts cortos sostienen el marco");
  assert.ok(t.corners);
  t.update(null, W);
  assert.ok(t.presence < 1 && t.presence > 0);
  for (let i = 0; i < 40; i++) t.update(null, W);
  assert.equal(t.presence, 0);
  assert.equal(t.corners, null);
  assert.equal(t.active, false);
});

test("suavizado adaptativo: quieta suaviza mucho, rápida sigue de cerca", () => {
  const slow = new FrameTracker();
  slow.update(quadAt(100, 100), W);
  slow.update(quadAt(103, 100), W);
  const slowGain = (slow.corners[0].x - 100) / 3;
  const fast = new FrameTracker();
  fast.update(quadAt(100, 100), W);
  fast.update(quadAt(300, 100), W);
  const fastGain = (fast.corners[0].x - 100) / 200;
  assert.ok(Math.abs(slowGain - TRACKING_DEFAULTS.smoothMin) < 1e-9);
  assert.ok(Math.abs(fastGain - TRACKING_DEFAULTS.smoothMax) < 1e-9);
  assert.ok(slowGain < fastGain);
});

test("el suavizado nunca sobrepasa el objetivo ni se queda clavado", () => {
  const t = new FrameTracker();
  t.update(quadAt(0, 0), W);
  const target = quadAt(500, 300);
  for (let i = 0; i < 60; i++) t.update(target, W);
  assert.ok(dist(t.corners[0], target[0]) < 0.5);
});

test("rechaza un teletransporte aislado y acepta el reposicionamiento sostenido", () => {
  const t = new FrameTracker();
  t.update(quadAt(100, 100), W);
  const before = { ...t.corners[0] };
  const far = quadAt(100 + W * 0.6, 100);
  t.update(far, W);
  assert.deepEqual(t.corners[0], before);
  t.update(far, W);
  assert.ok(t.corners[0].x > before.x + 100);
});

test("el rechazo de saltos no apaga el efecto por sí solo", () => {
  const t = new FrameTracker();
  t.update(quadAt(100, 100), W);
  for (let i = 0; i < 10; i++) t.update(quadAt(100, 100), W);
  const p = t.presence;
  for (let i = 0; i < 10; i++) {
    t.update(quadAt(100 + W * 0.5, 100), W);
    t.update(quadAt(100, 100), W);
  }
  assert.ok(t.presence >= p * 0.9);
  assert.ok(t.active);
});

test("reset deja el tracker como recién creado", () => {
  const t = new FrameTracker();
  t.update(quadAt(10, 10), W);
  t.reset();
  assert.equal(t.corners, null);
  assert.equal(t.presence, 0);
  assert.equal(t.active, false);
  assert.equal(t.visible, false);
});

test("el tracker sigue el marco de demostración cuadro a cuadro", () => {
  const t = new FrameTracker();
  let seen = 0;
  for (let f = 0; f < 120; f++) {
    const hands = makeFakeHands(f / 30);
    t.update(computeQuad(hands, { width: W, height: H, active: t.active }), W);
    if (t.visible) seen++;
  }
  assert.ok(seen > 100, `el marco debe estar visible casi siempre (fue ${seen}/120)`);
  assert.equal(t.presence, 1);
  const c = centroid(t.corners);
  assert.ok(c.x > W * 0.3 && c.x < W * 0.7);
  assert.ok(polygonArea(t.corners) > W * H * 0.05);
});

// ------------------------------------------------------- palmas juntas
group("Palmas juntas 🙏 (cambio de cámara)");

/**
 * Una mano con la muñeca en `wrist`, dedos hacia arriba, de tamaño `size`
 * (muñeca a nudillo medio). `curl` de 0 a 1: 0 abierta, 1 puño.
 */
function makeHandAt(wrist, size = 0.18, curl = 0) {
  const lm = Array.from({ length: 21 }, () => ({ ...wrist, z: 0 }));
  const dedos = [
    [5, 6, 7, 8],
    [9, 10, 11, 12],
    [13, 14, 15, 16],
    [17, 18, 19, 20],
  ];
  dedos.forEach((idx, k) => {
    const x = wrist.x + (k - 1.5) * size * 0.22;
    lm[idx[0]] = { x, y: wrist.y - size, z: 0 };            // nudillo base
    lm[idx[1]] = { x, y: wrist.y - size * 1.4, z: 0 };      // nudillo medio (PIP)
    lm[idx[2]] = { x, y: wrist.y - size * (1.4 + 0.3 * (1 - curl)), z: 0 };
    // Punta: estirada a 2.1 tamaños; plegada vuelve casi a la palma.
    lm[idx[3]] = { x, y: wrist.y - size * (2.1 - 1.6 * curl), z: 0 };
  });
  lm[1] = { x: wrist.x - size * 0.4, y: wrist.y - size * 0.3, z: 0 };
  lm[4] = { x: wrist.x - size * 0.7, y: wrist.y - size * 1.0, z: 0 };
  return lm;
}

/** Dos manos abiertas, una junto a la otra, separadas `gap` tamaños de mano. */
function makePrayer(gap = 0.4, curl = 0) {
  const size = 0.18;
  return [
    makeHandAt({ x: 0.5 - (gap * size) / 2, y: 0.8 }, size, curl),
    makeHandAt({ x: 0.5 + (gap * size) / 2, y: 0.8 }, size, curl),
  ];
}

test("las palmas juntas dan un centro; separadas, no", () => {
  const c = prayerCenter(makePrayer(0.4));
  assert.ok(c, "juntas");
  assert.ok(Math.abs(c.x - 0.5) < 0.18 * 0.5, "el centro queda entre las dos manos");
  assert.equal(prayerCenter(makePrayer(2.0)), null, "a dos manos de distancia no es el gesto");
  assert.equal(prayerCenter(makePrayer(1.05)), null, "justo por fuera del umbral tampoco");
});

test("dos puños juntos no son palmas juntas", () => {
  assert.equal(prayerCenter(makePrayer(0.4, 1)), null);
});

test("hace falta ver exactamente dos manos", () => {
  const [a, b] = makePrayer(0.4);
  assert.equal(prayerCenter(null), null);
  assert.equal(prayerCenter([a]), null);
  assert.equal(prayerCenter([a, b, a]), null);
});

test("dos detecciones de la misma mano (encimadas) no cuentan", () => {
  const [a] = makePrayer(0.4);
  const copia = a.map((p) => ({ ...p }));
  assert.equal(prayerCenter([a, copia]), null);
});

test("el gesto no depende de la orientación", () => {
  const manos = makePrayer(0.4).map((lm) =>
    lm.map((p) => ({ x: 0.5 + (p.y - 0.8), y: 0.5 - (p.x - 0.5), z: 0 }))
  );
  assert.ok(prayerCenter(manos), "girado 90 grados sigue siendo el gesto");
});

test("el marco de dedos nunca se lee como palmas juntas", () => {
  for (let f = 0; f < 60; f++) assert.equal(prayerCenter(makeFakeHands(f / 30)), null);
});

test("el detector dispara una vez tras sostener, perdona parpadeos y exige separar las manos", () => {
  const d = new PalmsDetector();
  const juntas = makePrayer(0.4);
  const o = PALMS_DEFAULTS;
  let disparos = 0;
  let t = 0;
  for (let i = 0; i < o.holdFrames - 3; i++) if (d.update(juntas, (t += 33))) disparos++;
  assert.equal(disparos, 0, "antes de holdFrames no dispara");
  assert.ok(d.progress > 0.5 && d.progress < 1, "el anillo va llenándose");
  // Un parpadeo del detector (menos de graceFrames) no reinicia la cuenta.
  for (let i = 0; i < o.graceFrames; i++) d.update(null, (t += 33));
  assert.ok(d.progress > 0.5, "el parpadeo se perdona");
  for (let i = 0; i < 3; i++) if (d.update(juntas, (t += 33))) disparos++;
  assert.equal(disparos, 1, "dispara al completar");
  for (let i = 0; i < 60; i++) if (d.update(juntas, (t += 33))) disparos++;
  assert.equal(disparos, 1, "sostener el gesto no vuelve a disparar");
  assert.equal(d.progress, 0, "y el anillo se apaga");
  // Separar poco tiempo no basta: hace falta releaseFrames.
  for (let i = 0; i < o.releaseFrames - 1; i++) d.update(null, (t += 33));
  t += o.cooldownMs;
  for (let i = 0; i < o.holdFrames + 2; i++) if (d.update(juntas, (t += 33))) disparos++;
  assert.equal(disparos, 1, "sin separar lo suficiente no rearma");
  for (let i = 0; i < o.releaseFrames; i++) d.update(null, (t += 33));
  for (let i = 0; i < o.holdFrames; i++) if (d.update(juntas, (t += 33))) disparos++;
  assert.equal(disparos, 2, "separar y volver a juntar dispara otra vez");
});

test("el detector respeta el tiempo de espera entre cambios", () => {
  const d = new PalmsDetector({ holdFrames: 3, graceFrames: 0, releaseFrames: 2, cooldownMs: 1000 });
  const juntas = makePrayer(0.4);
  let t = 0;
  for (let i = 0; i < 3; i++) d.update(juntas, (t += 33));
  assert.equal(d.lastFireAt, t);
  for (let i = 0; i < 2; i++) d.update(null, (t += 33));
  let disparos = 0;
  for (let i = 0; i < 3; i++) if (d.update(juntas, (t += 33))) disparos++;
  assert.equal(disparos, 0, "dentro del cooldown no dispara");
  t += 1000;
  assert.equal(d.update(juntas, t), true, "pasado el cooldown, sí");
});

// -------------------------------------------------------------------- cubos
group("Cubos 3D");

test("la rotación conserva la distancia al centro", () => {
  for (const v of VERTICES) {
    const r = rotar(v, 0.7, -1.3, 2.1);
    assert.ok(Math.abs(Math.hypot(...r) - Math.hypot(...v)) < 1e-9);
  }
  assert.deepEqual(rotar([1, 2, 3], 0, 0, 0), [1, 2, 3]);
});

test("la perspectiva agranda lo cercano y encoge lo lejano", () => {
  assert.ok(proyectar([1, 0, -1]).x > 1);
  assert.ok(proyectar([1, 0, 1]).x < 1);
  assert.equal(proyectar([1, 0, 0]).x, 1);
});

test("las normales apuntan hacia fuera del cubo", () => {
  for (const cara of CARAS) {
    const n = normalDeCara(VERTICES, cara);
    const centro = cara.reduce(
      (s, i) => [s[0] + VERTICES[i][0], s[1] + VERTICES[i][1], s[2] + VERTICES[i][2]],
      [0, 0, 0]
    );
    assert.ok(n[0] * centro[0] + n[1] * centro[1] + n[2] * centro[2] > 0, `cara ${cara}`);
    assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-9, "unitaria");
  }
});

test("de frente se ve una cara; girado, hasta tres, y de lejos a cerca", () => {
  assert.equal(carasVisibles(VERTICES).length, 1);
  const girado = VERTICES.map((v) => rotar(v, 0.5, 0.6, 0.1));
  const vis = carasVisibles(girado);
  assert.equal(vis.length, 3);
  for (let i = 1; i < vis.length; i++) assert.ok(vis[i - 1].z >= vis[i].z, "orden de pintor");
  for (const f of vis) assert.ok(f.n[2] < 0, "todas miran a la cámara");
});

test("makeRandom es repetible y queda en [0, 1)", () => {
  const a = makeRandom(9);
  const b = makeRandom(9);
  for (let i = 0; i < 50; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
});

test("los cubos caen dentro del marco y escalan con él", () => {
  const cubos = new Cubos({ maximo: 9 });
  const q = quadAt(100, 100, 600, 300);
  const puestos = cubos.colocar(q, { t: 1.5, cantidad: 9, tamano: 0.5 });
  assert.equal(puestos.length, 9);
  for (const { pos, semi } of puestos) {
    assert.ok(pos.x > 100 && pos.x < 700 && pos.y > 100 && pos.y < 400, "dentro del marco");
    assert.ok(semi > 0);
  }
  const grandes = cubos.colocar(q, { t: 1.5, cantidad: 9, tamano: 1 });
  assert.ok(grandes[0].semi > puestos[0].semi, "más detalle, cubos más grandes");
  assert.equal(cubos.colocar(q, { cantidad: 3 }).length, 3);
  assert.equal(cubos.colocar(q, { cantidad: 0 }).length, 1, "nunca menos de uno");
});

// ------------------------------------------------------------------ efectos
group("Efectos");

test("hay una lista coherente: ids y teclas únicas, inicial válido", () => {
  assert.ok(EFECTOS.length >= 10);
  assert.equal(new Set(EFECTOS.map((e) => e.id)).size, EFECTOS.length, "ids repetidos");
  assert.equal(new Set(EFECTOS.map((e) => e.tecla)).size, EFECTOS.length, "teclas repetidas");
  assert.ok(EFECTOS.some((e) => e.id === EFECTO_INICIAL));
  assert.equal(buscarEfecto("no-existe"), EFECTOS[0], "lo desconocido cae al primero");
});

test("cada efecto trae shader con main, acento y respaldo CSS", () => {
  for (const e of EFECTOS) {
    assert.ok(/void\s+main\s*\(/.test(e.glsl), `${e.id} sin main()`);
    assert.ok(/fragColor\s*=/.test(e.glsl), `${e.id} no escribe fragColor`);
    assert.ok(/^#[0-9a-f]{6}$/i.test(e.acento), `${e.id} acento inválido`);
    assert.ok(e.filtro, `${e.id} sin filtro de respaldo`);
    assert.equal(e.tecla, e.tecla.toLowerCase(), `${e.id} tecla en minúscula`);
  }
});

test("el preludio es GLSL ES 3.00 y declara todo lo que usan los shaders", () => {
  assert.ok(PRELUDIO_GLSL.startsWith("#version 300 es\n"));
  for (const u of ["u_video", "u_prev", "u_pre", "u_res", "u_time", "u_intensidad", "u_tono", "u_detalle", "u_centro", "u_espejo"]) {
    assert.ok(PRELUDIO_GLSL.includes(`uniform`) && PRELUDIO_GLSL.includes(u), `falta ${u}`);
  }
  for (const e of EFECTOS) {
    // Ningún shader redeclara lo que ya trae el preludio.
    assert.ok(!/uniform\s/.test(e.glsl), `${e.id} redeclara uniforms`);
    assert.ok(!/#version/.test(e.glsl), `${e.id} redeclara la versión`);
  }
});

test("solo los efectos con pasada previa leen u_pre, y la pasada previa es un shader completo", () => {
  for (const e of EFECTOS) {
    const lee = /u_pre\b|sobelPre|lumaPre/.test(e.glsl);
    assert.equal(!!e.pre, lee, `${e.id}: pre=${!!e.pre} pero ${lee ? "lee" : "no lee"} u_pre`);
    if (e.pre) {
      assert.ok(/void\s+main\s*\(/.test(e.pre), `${e.id}.pre sin main()`);
      assert.ok(/fragColor\s*=/.test(e.pre), `${e.id}.pre no escribe fragColor`);
      assert.ok(!/uniform\s|#version/.test(e.pre), `${e.id}.pre redeclara cosas del preludio`);
    }
  }
});

test("solo los efectos con feedback leen el cuadro anterior", () => {
  for (const e of EFECTOS) {
    const lee = /u_prev/.test(e.glsl);
    assert.equal(!!e.feedback, lee, `${e.id}: feedback=${!!e.feedback} pero ${lee ? "lee" : "no lee"} u_prev`);
  }
});

test("los ajustes de fábrica van de 0 a 1 y cubren las tres barritas", () => {
  for (const e of EFECTOS) {
    for (const clave of CLAVES) {
      const v = e.ajustes[clave];
      assert.ok(typeof v === "number" && v >= 0 && v <= 1, `${e.id}.${clave}`);
      assert.ok(e.etiquetas[clave], `${e.id} sin etiqueta para ${clave}`);
    }
  }
});

test("ajustesDe pisa los de fábrica solo con lo guardado", () => {
  const e = buscarEfecto("led");
  assert.deepEqual(ajustesDe(e), e.ajustes);
  const mezcla = ajustesDe(e, { led: { tono: 0.33 } });
  assert.equal(mezcla.tono, 0.33);
  assert.equal(mezcla.intensidad, e.ajustes.intensidad);
  assert.deepEqual(ajustesDe(e, { glitch: { tono: 1 } }), e.ajustes, "lo de otro efecto no cuenta");
});

// --------------------------------------------------------------------- VR
group("Vista para visor VR");

test("cada ojo ocupa exactamente su mitad y las dos son iguales", () => {
  const [izq, der] = encuadreVR(1280, 720);
  assert.deepEqual(izq.clip, { x: 0, y: 0, w: 640, h: 720 });
  assert.deepEqual(der.clip, { x: 640, y: 0, w: 640, h: 720 });
  assert.equal(izq.w, der.w);
  assert.equal(izq.h, der.h);
  assert.equal(der.x - izq.x, 640, "la escena del ojo derecho va desplazada media pantalla");
});

test("la escena conserva su proporción y queda centrada en cada ojo", () => {
  const [izq] = encuadreVR(1280, 720, 1);
  assert.ok(Math.abs(izq.w / izq.h - 1280 / 720) < 1e-9, "16:9 intacto");
  assert.equal(izq.w, 640, "sin zoom, encaja al ancho del ojo");
  assert.equal(izq.x, 0);
  assert.equal(izq.y + izq.h / 2, 360, "centrada en vertical");
  const [conZoom] = encuadreVR(1280, 720, 1.2);
  assert.ok(conZoom.w > 640 && conZoom.x < 0, "con zoom sobresale por los lados, simétrico");
  assert.ok(Math.abs(conZoom.x + conZoom.w / 2 - 320) < 1e-9, "sigue centrada");
});

// -------------------------------------------------------------- utilidades
group("Utilidades");

test("withAlpha convierte hex a rgba y respeta otras notaciones", () => {
  assert.equal(withAlpha("#ff0080", 0.5), "rgba(255, 0, 128, 0.500)");
  assert.equal(withAlpha("#ff0080", 2), "rgba(255, 0, 128, 1.000)");
  assert.equal(withAlpha("red", 0.5), "red");
});

test("FpsMeter mide por ventana deslizante", () => {
  const m = new FpsMeter(1000);
  assert.equal(m.tick(0), 0);
  for (let i = 1; i <= 60; i++) m.tick(i * (1000 / 60));
  assert.ok(Math.abs(m.fps - 60) < 1);
  m.reset();
  assert.equal(m.fps, 0);
});

// ------------------------------------------------------------------ resumen
console.log(`\n${passed} pruebas pasaron, ${failures.length} fallaron.`);
if (failures.length) process.exit(1);
