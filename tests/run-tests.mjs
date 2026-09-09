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
  isFist,
  fistHand,
  FistDetector,
  FIST_DEFAULTS,
} from "../tracking.js";
import { withAlpha, FpsMeter, quadPoint, quadScale } from "../composite.js";
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

// --------------------------------------------------------------------- puño
group("Puño (cambio de cámara)");

/**
 * Mano con la muñeca en (0.5, 0.8) y los dedos hacia arriba. `curl` de 0 a 1:
 * 0 es la mano abierta (puntas lejos), 1 el puño (puntas plegadas a la palma).
 */
function makeHandCurl(curl) {
  const wrist = { x: 0.5, y: 0.8, z: 0 };
  const lm = Array.from({ length: 21 }, () => ({ ...wrist }));
  const dedos = [
    [5, 6, 7, 8],
    [9, 10, 11, 12],
    [13, 14, 15, 16],
    [17, 18, 19, 20],
  ];
  dedos.forEach((idx, k) => {
    const x = 0.44 + k * 0.04;
    lm[idx[0]] = { x, y: 0.62, z: 0 }; // nudillo base
    lm[idx[1]] = { x, y: 0.55, z: 0 }; // nudillo medio (PIP)
    lm[idx[2]] = { x, y: 0.55 - 0.06 * (1 - curl), z: 0 };
    // La punta: estirada queda a 0.42; plegada vuelve casi a la palma (0.7).
    lm[idx[3]] = { x, y: 0.42 + (0.7 - 0.42) * curl, z: 0 };
  });
  lm[1] = { x: 0.44, y: 0.74, z: 0 };
  lm[4] = { x: 0.38, y: 0.62, z: 0 };
  return lm;
}

test("una mano abierta no es puño; una cerrada sí, mire hacia donde mire", () => {
  assert.equal(isFist(makeHandCurl(0)), false);
  assert.equal(isFist(makeHandCurl(1)), true);
  // Girada 90 grados sigue siendo puño: la regla no depende de la orientación.
  const w = makeHandCurl(1)[WRIST];
  const girada = makeHandCurl(1).map((p) => ({ x: w.x + (p.y - w.y), y: w.y - (p.x - w.x), z: 0 }));
  assert.equal(isFist(girada), true);
  assert.equal(isFist(null), false);
});

test("un dedo estirado deshace el puño", () => {
  const casi = makeHandCurl(1);
  casi[INDEX_TIP] = { x: 0.44, y: 0.42, z: 0 };
  assert.equal(isFist(casi), false);
});

test("el marco de dedos nunca se lee como puño", () => {
  for (const lm of makeFakeHands(0)) assert.equal(isFist(lm), false);
  assert.equal(fistHand(makeFakeHands(0)), null);
});

test("fistHand encuentra la mano cerrada entre dos", () => {
  const cerrada = makeHandCurl(1);
  assert.equal(fistHand([makeHandCurl(0), cerrada]), cerrada);
});

test("el detector dispara una sola vez tras sostener el puño, y exige abrir la mano", () => {
  const d = new FistDetector();
  const puño = [makeHandCurl(1)];
  let disparos = 0;
  let t = 0;
  for (let i = 0; i < FIST_DEFAULTS.holdFrames - 1; i++) {
    if (d.update(puño, (t += 33))) disparos++;
  }
  assert.equal(disparos, 0, "antes de holdFrames no dispara");
  assert.ok(d.progress > 0.5 && d.progress < 1, "el anillo va llenándose");
  assert.equal(d.update(puño, (t += 33)), true, "dispara al llegar");
  for (let i = 0; i < 60; i++) if (d.update(puño, (t += 33))) disparos++;
  assert.equal(disparos, 0, "sostener el puño no vuelve a disparar");
  assert.equal(d.progress, 0, "y el anillo se apaga");
  // Abrir la mano brevemente no basta: hace falta releaseFrames.
  d.update(null, (t += 33));
  for (let i = 0; i < FIST_DEFAULTS.holdFrames + 2; i++) if (d.update(puño, (t += 33))) disparos++;
  assert.equal(disparos, 0, "un parpadeo sin puño no rearma");
  for (let i = 0; i < FIST_DEFAULTS.releaseFrames; i++) d.update(null, (t += 33));
  t += FIST_DEFAULTS.cooldownMs;
  for (let i = 0; i < FIST_DEFAULTS.holdFrames; i++) if (d.update(puño, (t += 33))) disparos++;
  assert.equal(disparos, 1, "abrir la mano y cerrarla de nuevo dispara otra vez");
});

test("el detector respeta el tiempo de espera entre cambios", () => {
  const d = new FistDetector({ holdFrames: 3, releaseFrames: 2, cooldownMs: 1000 });
  const puño = [makeHandCurl(1)];
  let t = 0;
  for (let i = 0; i < 3; i++) d.update(puño, (t += 33));
  assert.equal(d.lastFireAt, t);
  for (let i = 0; i < 2; i++) d.update(null, (t += 33));
  let disparos = 0;
  for (let i = 0; i < 3; i++) if (d.update(puño, (t += 33))) disparos++;
  assert.equal(disparos, 0, "dentro del cooldown no dispara");
  t += 1000;
  assert.equal(d.update(puño, t), true, "pasado el cooldown, sí");
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
