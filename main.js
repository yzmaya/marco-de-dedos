// main.js — orquestación de las tres capas y loop de render.
//
//   1. Tracking    (local, cada cuadro)  → tracking.js
//   2. Efecto      (local, GPU)          → efectos.js + fx.js
//   3. Compositing (local, cada cuadro)  → composite.js
//
// Todo corre en el navegador, en un único requestAnimationFrame. No hay
// servidor, ni clave, ni modelo remoto: la cámara nunca sale de esta pestaña.
//
// Gestos: el marco de director abre la ventana con el efecto; un puño cerrado
// y sostenido cambia entre la cámara frontal y la trasera.

import { computeQuad, FrameTracker, FistDetector, centroid, toPixel } from "./tracking.js";
import {
  drawMirrored,
  clipToQuad,
  drawOutline,
  resizeCanvasToVideo,
  withAlpha,
} from "./composite.js";
import { EFECTOS, EFECTO_INICIAL, buscarEfecto, ajustesDe } from "./efectos.js";
import { MotorFX } from "./fx.js";
import { createHandLandmarker, cameraConstraints } from "./hands.js";
import { DEMO, makeDemoStream, makeFakeHands } from "./demo.js";
import { createUI, loadSettings } from "./ui.js";

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const settings = loadSettings();
let efectoId = EFECTOS.some((e) => e.id === settings.efectoId)
  ? settings.efectoId
  : EFECTO_INICIAL;

const tracker = new FrameTracker();
const puno = new FistDetector();
let landmarker = null;
let lastVideoTime = -1;
let lastHands = null;
/** Motor WebGL; null si el navegador no tiene WebGL2 (se cae al filtro CSS). */
let motor = null;

/** Qué cámara está puesta y si se dibuja en espejo (solo la frontal). */
let facing = "user";
let espejo = true;
let cambiandoCamara = false;

function efectoActual() {
  return buscarEfecto(efectoId);
}

const ui = createUI({
  efectoId,
  onEfecto: (id) => {
    efectoId = id;
  },
});

async function init() {
  let stream;
  if (DEMO) {
    stream = makeDemoStream();
  } else {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "Este navegador no da acceso a la cámara aquí. Hace falta https o " +
          "localhost: abre la página desde un servidor local en vez del archivo."
      );
    }
    ui.setLoading("Cargando el detector de manos…");
    landmarker = await createHandLandmarker();
    ui.setLoading("Pidiendo acceso a la cámara…");
    stream = await navigator.mediaDevices.getUserMedia(cameraConstraints("user"));
  }

  await ponerStream(stream);
  resizeCanvasToVideo(canvas, video);

  try {
    motor = new MotorFX(canvas.width, canvas.height);
  } catch (err) {
    console.warn("Sin WebGL2, efectos en modo básico:", err);
    ui.toast("Este navegador no tiene WebGL2: los efectos van en modo básico", 4000);
  }

  ui.hideLoading();
  // Al irse de la página, se suelta la cámara.
  window.addEventListener("pagehide", () => pararStream(video.srcObject));
  requestAnimationFrame(loop);
}

async function ponerStream(stream) {
  video.srcObject = stream;
  await new Promise((resolve) => {
    if (video.readyState >= 1) resolve();
    else video.onloadedmetadata = resolve;
  });
  await video.play();
}

function pararStream(stream) {
  stream?.getTracks?.().forEach((t) => t.stop());
}

/**
 * Cambia entre la cámara frontal y la trasera. Primero se pide el lado
 * contrario de forma exacta; si el aparato no lo tiene (un portátil con una
 * sola webcam), se busca cualquier otra cámara distinta a la actual, y si
 * tampoco hay, se avisa y no pasa nada.
 */
async function cambiarCamara() {
  if (cambiandoCamara || DEMO) return;
  cambiandoCamara = true;
  const destino = facing === "user" ? "environment" : "user";
  ui.toast(destino === "environment" ? "Cámara trasera…" : "Cámara frontal…", 1400);
  const actual = video.srcObject;
  const idActual = actual?.getVideoTracks?.()[0]?.getSettings().deviceId;
  try {
    let nuevo;
    try {
      nuevo = await navigator.mediaDevices.getUserMedia(cameraConstraints(destino, true));
    } catch {
      const otras = (await navigator.mediaDevices.enumerateDevices())
        .filter((d) => d.kind === "videoinput" && d.deviceId && d.deviceId !== idActual);
      if (!otras.length) {
        ui.toast("Este aparato solo tiene una cámara", 2200);
        return;
      }
      nuevo = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: otras[0].deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    }
    pararStream(actual);
    await ponerStream(nuevo);
    const real = nuevo.getVideoTracks()[0]?.getSettings().facingMode;
    facing = real || destino;
    espejo = facing !== "environment";
    tracker.reset();
    puno.reset();
    lastVideoTime = -1;
    lastHands = null;
    ui.toast(espejo ? "Cámara frontal" : "Cámara trasera", 1400);
  } catch (err) {
    console.error(err);
    ui.toast(`No se pudo cambiar de cámara: ${err?.message || err}`, 3000);
  } finally {
    cambiandoCamara = false;
  }
}

function loop() {
  if (resizeCanvasToVideo(canvas, video)) motor?.resize(canvas.width, canvas.height);
  const w = canvas.width;
  const h = canvas.height;
  const now = performance.now();

  // Capa base: la cámara real, en espejo si es la frontal.
  if (espejo) drawMirrored(ctx, w, h, video);
  else ctx.drawImage(video, 0, 0, w, h);

  // Detección: una vez por cuadro nuevo de video, no una por cuadro de pantalla.
  if (DEMO) {
    lastHands = makeFakeHands(now / 1000);
  } else if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    lastHands = landmarker.detectForVideo(video, now)?.landmarks ?? null;
  }

  const target = computeQuad(lastHands, {
    width: w,
    height: h,
    active: tracker.active,
    mirror: espejo,
  });
  tracker.update(target, w);

  // El puño solo cuenta cuando NO hay marco: con el marco hecho, una mano
  // medio escondida detrás de la otra no debe cambiar de cámara.
  if (!DEMO && puno.update(tracker.active ? null : lastHands, now)) {
    void cambiarCamara();
  }

  if (tracker.visible) {
    drawWindow(tracker.corners, w, h);
    drawOutline(ctx, tracker.corners, {
      presence: tracker.presence,
      timeSec: now / 1000,
      accent: efectoActual().acento,
    });
  }

  if (puno.progress > 0 && puno.hand) {
    drawPuno(ctx, toPixel(centroid(puno.hand), w, h, espejo), puno.progress, w);
  }

  ui.showHint(tracker.presence <= 0.5);
  requestAnimationFrame(loop);
}

/** Pinta el efecto y lo revela solo a través del cuadrilátero. */
function drawWindow(quad, w, h) {
  const efecto = efectoActual();
  const ajustes = ajustesDe(efecto);
  const t = performance.now() / 1000;
  const c = centroid(quad);
  const info = { quad, w, h, t, presence: tracker.presence, ajustes, centro: c };

  clipToQuad(ctx, quad, tracker.presence, () => {
    if (motor) {
      const lienzo = motor.render(efecto, video, {
        time: t,
        intensidad: ajustes.intensidad,
        tono: ajustes.tono,
        detalle: ajustes.detalle,
        // El shader mide y desde abajo, el canvas desde arriba.
        centro: [c.x / w, 1 - c.y / h],
        espejo,
      });
      ctx.drawImage(lienzo, 0, 0, w, h);
    } else {
      ctx.filter = efecto.filtro || "none";
      if (espejo) drawMirrored(ctx, w, h, video);
      else ctx.drawImage(video, 0, 0, w, h);
      ctx.filter = "none";
    }
    efecto.overlay?.(ctx, info);
  });
  efecto.overlayLibre?.(ctx, info);
}

/** Anillo que se llena mientras se sostiene el puño: avisa de lo que va a pasar. */
function drawPuno(ctx, p, progress, w) {
  const r = Math.max(22, w * 0.03);
  const acento = efectoActual().acento;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(3, w / 300);
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = withAlpha(acento, 0.95);
  ctx.shadowColor = withAlpha(acento, 0.8);
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.font = `700 ${Math.round(r * 0.55)}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fillText("↺", p.x, p.y);
  ctx.restore();
}

init().catch((err) => {
  console.error(err);
  ui.fatal(explainStartupError(err));
});

/** Mensajes de arranque que dicen qué hacer, no solo qué falló. */
function explainStartupError(err) {
  const message = String(err?.message || err);
  if (err?.name === "NotAllowedError") {
    return "Se denegó el permiso de cámara. Permite el acceso en el candado de la barra de direcciones y recarga la página.";
  }
  if (err?.name === "NotFoundError" || err?.name === "OverconstrainedError") {
    return "No se encontró ninguna cámara conectada. Conecta una y recarga la página.";
  }
  if (err?.name === "NotReadableError") {
    return "La cámara está ocupada por otra aplicación. Ciérrala y recarga la página.";
  }
  if (/dynamically imported module|Failed to fetch|NetworkError/i.test(message)) {
    return "No se pudo cargar el detector de manos desde el CDN. Revisa tu conexión y recarga. Mientras tanto, añade ?demo a la URL: el modo demostración funciona sin CDN y sin cámara.";
  }
  return `No se pudo iniciar: ${message}`;
}
