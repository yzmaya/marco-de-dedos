// tests/qa-navegador.mjs — QA de la app entera en un navegador de verdad.
//
//   python3 -m http.server 8130 &
//   node tests/qa-navegador.mjs
//
// Las pruebas de run-tests.mjs cubren la lógica; esto cubre lo que solo se ve
// ejecutando: que la página arranque limpia en modo demo, que los trece
// shaders compilen y pinten sin errores de GL, que cada tecla elija su efecto,
// que el efecto sobreviva a recargar y que en móvil el video llene la
// pantalla sin franjas. Deja capturas de algunos efectos en la carpeta que
// indique CAPTURAS (por defecto ./capturas-qa).
//
// Necesita Playwright (npm i playwright) y Google Chrome instalado.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const URL = process.env.QA_URL || "http://localhost:8130/?demo";
const CAPTURAS = process.env.CAPTURAS || "./capturas-qa";
mkdirSync(CAPTURAS, { recursive: true });

const b = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
const fallos = [];
p.on("pageerror", (e) => errs.push("pageerror: " + e));
p.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
const ok = (nombre, cond, extra = "") => {
  console.log((cond ? "  ✓ " : "  ✗ ") + nombre + (extra ? ` (${extra})` : ""));
  if (!cond) fallos.push(nombre);
};

await p.goto(URL, { waitUntil: "load" });
await p.waitForTimeout(3000);

console.log("\nArranque");
ok("carga sin errores de consola", errs.length === 0, errs.join(" | "));
ok("la pantalla de carga se fue", await p.evaluate(() => document.getElementById("status").classList.contains("hidden")));
ok("el canvas tiene el tamaño del video", await p.evaluate(() => canvas.width === 1280 && canvas.height === 720));
ok("no queda rastro de marca ni de claves", await p.evaluate(() => !/pollito|miss yera|fal\.ai|clave/i.test(document.body.innerText + document.title)));
ok("no hay riel derecho ni barritas", await p.evaluate(() => !document.getElementById("riel-der") && !document.querySelector('input[type="range"]')));
ok("hay botón de cámara a la vista", await p.evaluate(() => {
  const b = document.getElementById("camara-btn");
  const r = b?.getBoundingClientRect();
  return !!b && r.width > 30 && getComputedStyle(b).opacity === "1";
}));
await p.keyboard.press("v");
await p.waitForTimeout(300);
ok("el botón sigue a la vista dentro de la vista de visor", await p.evaluate(() =>
  document.body.classList.contains("vr") && getComputedStyle(document.getElementById("camara-btn")).opacity === "1"));
await p.keyboard.press("v");
await p.waitForTimeout(300);
ok("pinta bajo el notch y se puede instalar como app", await p.evaluate(async () => {
  const vp = document.querySelector('meta[name="viewport"]')?.content || "";
  const manifest = document.querySelector('link[rel="manifest"]')?.href;
  const r = manifest && (await fetch(manifest));
  const m = r && r.ok && (await r.json());
  const icono = m && (await fetch(new URL(m.icons[0].src, manifest)));
  return vp.includes("viewport-fit=cover") && !!m && m.display === "fullscreen" && icono.ok;
}));

console.log("\nShaders");
const shaders = await p.evaluate(async () => {
  const { EFECTOS } = await import("./efectos.js");
  const { MotorFX } = await import("./fx.js");
  const motor = new MotorFX(1280, 720);
  const v = document.getElementById("video");
  const res = [];
  for (const e of EFECTOS) {
    try {
      motor.render(e, v, { time: 1.5, intensidad: 0.6, tono: 0.2, detalle: 0.5, centro: [0.5, 0.5], espejo: true });
      motor.render(e, v, { time: 1.6, intensidad: 0.6, tono: 0.2, detalle: 0.5, centro: [0.5, 0.5], espejo: false });
      const err = motor.gl.getError();
      res.push({ id: e.id, ok: err === 0, detalle: err ? `gl error ${err}` : "" });
    } catch (err) {
      res.push({ id: e.id, ok: false, detalle: String(err.message).slice(0, 160) });
    }
  }
  return res;
});
for (const s of shaders) ok(`compila y pinta: ${s.id}`, s.ok, s.detalle);

console.log("\nTeclas");
const efectos = await p.evaluate(async () => (await import("./efectos.js")).EFECTOS.map((e) => ({ id: e.id, tecla: e.tecla })));
for (const e of efectos) {
  await p.keyboard.press(e.tecla);
  await p.waitForTimeout(80);
  const a = await p.evaluate(() => document.querySelector("#toolbar button.active")?.dataset.id);
  ok(`tecla ${e.tecla.toUpperCase()} → ${e.id}`, a === e.id, a);
}
await p.keyboard.press("]");
await p.waitForTimeout(80);
ok("] pasa al siguiente (y da la vuelta)", (await p.evaluate(() => document.querySelector("#toolbar button.active")?.dataset.id)) === efectos[0].id);
await p.keyboard.press("[");
await p.waitForTimeout(80);
ok("[ vuelve al anterior", (await p.evaluate(() => document.querySelector("#toolbar button.active")?.dataset.id)) === efectos[efectos.length - 1].id);

console.log("\nPersistencia");
await p.keyboard.press("3");
await p.waitForTimeout(80);
await p.reload({ waitUntil: "load" });
await p.waitForTimeout(2500);
ok("el efecto sobrevive a recargar", (await p.evaluate(() => document.querySelector("#toolbar button.active")?.dataset.id)) === "led");

console.log("\nMóvil");
const movil = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await movil.goto(URL, { waitUntil: "load" });
await movil.waitForTimeout(2500);
const caja = await movil.locator("#canvas").boundingBox();
ok("el video llena la pantalla entera, sin franjas", caja && Math.round(caja.width) === 390 && Math.round(caja.height) === 844, JSON.stringify(caja));
const tira = await movil.locator("#toolbar").boundingBox();
ok("los efectos van en una tira abajo", tira && tira.width >= 389 && tira.y > 700, JSON.stringify(tira));
await movil.screenshot({ path: join(CAPTURAS, "movil.png") });
await movil.close();

console.log("\nVisor VR");
await p.keyboard.press("v");
await p.waitForTimeout(300);
ok("V parte la pantalla en dos y esconde la interfaz", await p.evaluate(() => document.body.classList.contains("vr")));
const mitades = await p.evaluate(() => {
  const c = document.getElementById("canvas");
  const g = c.getContext("2d");
  // Mismo píxel en cada mitad (centro de cada ojo): deben coincidir.
  const a = g.getImageData(c.width / 4, c.height / 2, 1, 1).data;
  const b = g.getImageData((3 * c.width) / 4, c.height / 2, 1, 1).data;
  return [...a].slice(0, 3).join() === [...b].slice(0, 3).join();
});
ok("las dos mitades muestran lo mismo", mitades);
await p.keyboard.press("v");
await p.waitForTimeout(200);
ok("V otra vez vuelve a la vista normal", await p.evaluate(() => !document.body.classList.contains("vr")));

console.log("\nInterfaz oculta");
await p.keyboard.press("o");
await p.waitForTimeout(80);
ok("O oculta la interfaz", await p.evaluate(() => document.body.classList.contains("limpio")));
await p.keyboard.press("o");

console.log("\nCapturas");
for (const id of ["termica", "rayosx", "led", "glitch", "cubos", "neon", "estela"]) {
  const tecla = efectos.find((e) => e.id === id).tecla;
  await p.keyboard.press(tecla);
  await p.waitForTimeout(700);
  const ruta = join(CAPTURAS, `${id}.png`);
  await p.locator("#canvas").screenshot({ path: ruta });
  console.log("  ·", ruta);
}

console.log(`\nerrores de consola: ${errs.length ? errs.join(" | ") : "ninguno"}`);
console.log(fallos.length ? `\n${fallos.length} comprobaciones fallaron` : "\nTodo en orden");
await b.close();
process.exit(fallos.length ? 1 : 0);
