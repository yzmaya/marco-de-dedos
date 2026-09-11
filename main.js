// main.js — orquestación de las tres capas y loop de render.
//
//   1. Tracking    (local, cada cuadro)  → tracking.js
//   2. Efecto      (local, GPU)          → efectos.js + fx.js
//   3. Compositing (local, cada cuadro)  → composite.js
//
// Todo corre en el navegador, en un único requestAnimationFrame. No hay
// servidor, ni clave, ni modelo remoto: la cámara nunca sale de esta pestaña.
//
// El marco de director abre la ventana con el efecto. La cámara se cambia
// con el botón de la esquina (o la tecla C): frontal ↔ trasera.
//
// Con la trasera la pantalla se parte en dos mitades iguales, una por ojo,
// para meter el teléfono en un visor tipo cardboard. Todo se compone en una
// escena aparte y al final se presenta una vez (normal) o dos (VR).

import {
  computeQuad,
  FrameTracker,
  TRACKING_DEFAULTS,
  handInfo,
  centroid,
} from "./tracking.js";
import {
  drawMirrored,
  clipToQuad,
  drawOutline,
  resizeCanvasToVideo,
  drawVR,
  withAlpha,
} from "./composite.js";
import { EFECTOS, EFECTO_INICIAL, buscarEfecto, ajustesDe } from "./efectos.js";
import { MotorFX } from "./fx.js";
import { createHandLandmarker, cameraConstraints } from "./hands.js";
import { DEMO, makeDemoStream, makeFakeHands } from "./demo.js";
import { createUI, loadSettings } from "./ui.js";

const video = document.getElementById("video");
/** Lo que se ve. */
const canvas = document.getElementById("canvas");
const salida = canvas.getContext("2d");
/** Donde se compone todo (cámara, efecto, marco); se presenta al final. */
const escena = document.createElement("canvas");
const ctx = escena.getContext("2d");

const settings = loadSettings();
let efectoId = EFECTOS.some((e) => e.id === settings.efectoId)
  ? settings.efectoId
  : EFECTO_INICIAL;

const tracker = new FrameTracker();
let landmarker = null;
let lastVideoTime = -1;
let lastHands = null;
/** Motor WebGL; null si el navegador no tiene WebGL2 (se cae al filtro CSS). */
let motor = null;

/** Qué cámara está puesta y si se dibuja en espejo (solo la frontal). */
let facing = "user";
let espejo = true;
let cambiandoCamara = false;
/** VR forzado con la tecla V (null = automático: con la trasera). */
let vrForzado = null;
function enVR() {
  return vrForzado ?? facing === "environment";
}
/**
 * Escala de la vista de visor. 1 = la cámara principal a un tamaño parecido
 * al real a través de las lentes de un cardboard. Cada visor es distinto, así
 * que se afina con + y − y se guarda.
 */
const VR_ZOOM_STORAGE = "ff-vr-zoom";
let vrZoom = Math.min(1.6, Math.max(0.7, Number(localStorage.getItem(VR_ZOOM_STORAGE)) || 1));

function efectoActual() {
  return buscarEfecto(efectoId);
}

const ui = createUI({
  efectoId,
  onEfecto: (id) => {
    efectoId = id;
  },
  onVR: () => {
    vrForzado = !enVR();
    ui.toast(enVR() ? "Vista para visor VR · V para volver" : "Vista normal", 2000);
    // Con la trasera, la lente depende de la vista: principal en el visor,
    // gran angular fuera de él.
    if (facing === "environment") void cambiarLente(!enVR());
  },
  onCamara: () => void cambiarCamara(),
  onVRZoom: (delta) => {
    vrZoom = Math.round(Math.min(1.6, Math.max(0.7, vrZoom + delta)) * 100) / 100;
    localStorage.setItem(VR_ZOOM_STORAGE, String(vrZoom));
    ui.toast(
      `Escala del visor ${vrZoom.toFixed(2)}×${Math.abs(vrZoom - 1) < 0.001 ? " · tamaño real aprox." : ""}`,
      1600
    );
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
  ajustarTamano();

  try {
    motor = new MotorFX(escena.width, escena.height);
  } catch (err) {
    console.warn("Sin WebGL2, efectos en modo básico:", err);
    ui.toast("Este navegador no tiene WebGL2: los efectos van en modo básico", 4000);
  }

  ui.hideLoading();
  // Al irse de la página, se suelta la cámara.
  window.addEventListener("pagehide", () => pararStream(video.srcObject));
  requestAnimationFrame(loop);
}

/**
 * Engancha un stream al video y espera a que llegue el PRIMER CUADRO de
 * verdad, no solo los metadatos. Sin esa espera, en iOS el canvas se
 * redimensiona a la cámara nueva (y se limpia) antes de que haya nada que
 * pintar, y la pantalla se queda en negro.
 */
async function ponerStream(stream) {
  video.srcObject = null;
  video.srcObject = stream;
  await esperar((listo) => video.addEventListener("loadedmetadata", listo, { once: true }), () => video.readyState >= 1);
  try {
    await video.play();
  } catch (err) {
    // play() se interrumpe si llega otro load: no es un error de verdad.
    if (err?.name !== "AbortError") throw err;
  }
  await esperar(() => {}, () => video.readyState >= 2);
}

/** Espera a que se cumpla `cond`, avisada por `suscribir` o por sondeo, con tope de 4 s. */
function esperar(suscribir, cond) {
  return new Promise((resolve) => {
    if (cond()) return resolve();
    const t0 = performance.now();
    const sondeo = () => {
      if (cond() || performance.now() - t0 > 4000) resolve();
      else requestAnimationFrame(sondeo);
    };
    suscribir(() => resolve());
    sondeo();
  });
}

function pararStream(stream) {
  stream?.getTracks?.().forEach((t) => t.stop());
}

/**
 * Cambia entre la cámara frontal y la trasera.
 *
 * El orden importa: iOS solo deja UNA captura de cámara viva a la vez, y si
 * se pide la nueva con la vieja todavía abierta, Safari entrega un stream
 * sin cuadros (pantalla negra). Así que primero se suelta la actual y luego
 * se pide la otra. Se pide el lado contrario de forma exacta; si el aparato
 * no lo tiene (un portátil con una sola webcam), se busca cualquier otra
 * cámara distinta, y si tampoco hay, se vuelve a la de antes y se avisa.
 */
async function cambiarCamara() {
  if (cambiandoCamara || DEMO) return;
  cambiandoCamara = true;
  const origen = facing;
  const destino = facing === "user" ? "environment" : "user";
  ui.toast(destino === "environment" ? "Cámara trasera…" : "Cámara frontal…", 1400);
  const actual = video.srcObject;
  const idActual = actual?.getVideoTracks?.()[0]?.getSettings().deviceId;
  pararStream(actual);
  video.srcObject = null;

  const restaurar = async (motivo) => {
    ui.toast(motivo, 2400);
    await ponerStream(await navigator.mediaDevices.getUserMedia(cameraConstraints(origen)));
  };

  try {
    let nuevo = null;
    try {
      nuevo = await navigator.mediaDevices.getUserMedia(cameraConstraints(destino, true));
    } catch {
      const otras = (await navigator.mediaDevices.enumerateDevices())
        .filter((d) => d.kind === "videoinput" && d.deviceId && d.deviceId !== idActual);
      if (otras.length) {
        nuevo = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: otras[0].deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      }
    }
    if (!nuevo) {
      await restaurar("Este aparato solo tiene una cámara");
      return;
    }
    // Con la trasera se entra en la vista de visor, y ahí va la lente
    // principal (1x) sin zoom digital: es la que menos marea.
    if (destino === "environment") nuevo = await ajustarLenteTrasera(nuevo, { granAngular: false });
    await ponerStream(nuevo);
    const real = nuevo.getVideoTracks()[0]?.getSettings().facingMode;
    facing = real || destino;
    espejo = facing !== "environment";
    vrForzado = null;
    const lente = nombreLente(nuevo);
    ui.toast(
      espejo ? "Cámara frontal" : `Cámara trasera${lente ? ` · ${lente}` : ""} · vista para visor VR`,
      2400
    );
  } catch (err) {
    console.error(err);
    try {
      await restaurar(`No se pudo cambiar de cámara: ${err?.message || err}`);
    } catch (err2) {
      console.error(err2);
      ui.fatal("Se perdió la cámara al cambiar. Recarga la página.");
    }
  } finally {
    tracker.reset();
    lastVideoTime = -1;
    lastHands = null;
    cambiandoCamara = false;
  }
}

const ES_ULTRA = /ultra|gran angular|0[.,]5/i;
const ES_FRONTAL = /front|frontal|delantera/i;
// Cámaras "virtuales" de iOS que juntan varias lentes (Back Dual Wide, Back
// Triple) y cambian solas de lente para enfocar de cerca. Dentro del visor la
// lente de abajo queda tapada, así que ese cambio automático daría negro: en
// el visor se exige la lente principal a secas.
const ES_COMPUESTA = /dual|triple|doble|fusion/i;

/** Nombre corto de la lente que está en uso, para el aviso. */
function nombreLente(stream) {
  const etiqueta = stream?.getVideoTracks?.()[0]?.label || "";
  if (!etiqueta) return "";
  if (ES_ULTRA.test(etiqueta)) return "ultra gran angular";
  if (ES_COMPUESTA.test(etiqueta)) return "lente combinada";
  if (/tele|telephoto/i.test(etiqueta)) return "teleobjetivo";
  return "principal 1x";
}

/**
 * Elige la lente de la cámara trasera.
 *
 * - En el visor (`granAngular: false`) va la principal (1x) con el zoom
 *   digital en 1: su campo de visión, unos 70 grados, es el más parecido al
 *   que dejan ver las lentes de un cardboard, así que las cosas salen casi
 *   del tamaño real y es lo que menos marea. Es la lente de ARRIBA en los
 *   iPhone con dos cámaras en vertical; la de abajo (ultra gran angular) la
 *   tapa el cardboard y en el visor no se usa.
 * - Fuera del visor (`granAngular: true`) se busca la ultra gran angular (el
 *   iPhone la expone como cámara aparte) o se baja el zoom al mínimo si la
 *   cámara lo admite: con más campo visual las manos caben enteras y el
 *   marco se hace a una distancia cómoda.
 *
 * Devuelve el stream que toque (el mismo si no hubo que cambiar). iOS solo
 * deja una captura viva, así que antes de pedir otra lente se suelta esta.
 */
async function ajustarLenteTrasera(stream, { granAngular }) {
  let track = stream.getVideoTracks()[0];
  const idActual = track?.getSettings().deviceId;
  try {
    const camaras = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === "videoinput" && d.deviceId && !ES_FRONTAL.test(d.label)
    );
    const actual = camaras.find((d) => d.deviceId === idActual);
    const noEsPrincipal = (d) => ES_ULTRA.test(d.label) || ES_COMPUESTA.test(d.label);
    const otra = granAngular
      ? camaras.find((d) => d.deviceId !== idActual && ES_ULTRA.test(d.label))
      : actual && noEsPrincipal(actual)
        ? camaras.find((d) => d.deviceId !== idActual && !noEsPrincipal(d))
        : null;
    if (otra) {
      pararStream(stream);
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: otra.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia(cameraConstraints("environment", true));
      }
      track = stream.getVideoTracks()[0];
    }
    // Zoom digital: al mínimo para gran angular, a 1 para el visor.
    const caps = track?.getCapabilities?.() || {};
    if (caps.zoom) {
      const zoom = granAngular ? caps.zoom.min : Math.min(Math.max(1, caps.zoom.min), caps.zoom.max);
      if (Math.abs((track.getSettings().zoom ?? 1) - zoom) > 1e-3) {
        await track.applyConstraints({ advanced: [{ zoom }] });
      }
    }
  } catch (err) {
    console.warn("No se pudo ajustar la lente:", err);
  }
  return stream;
}

/** Cambia de lente sin cambiar de lado (al entrar o salir del visor con V). */
async function cambiarLente(granAngular) {
  if (cambiandoCamara || DEMO || facing !== "environment") return;
  cambiandoCamara = true;
  try {
    const nuevo = await ajustarLenteTrasera(video.srcObject, { granAngular });
    if (nuevo !== video.srcObject) await ponerStream(nuevo);
    const lente = nombreLente(nuevo);
    if (lente) ui.toast(`Lente ${lente}`, 1600);
  } catch (err) {
    console.error(err);
    ui.toast(`No se pudo cambiar de lente: ${err?.message || err}`, 3000);
  } finally {
    tracker.reset();
    lastVideoTime = -1;
    lastHands = null;
    cambiandoCamara = false;
  }
}

/** La escena y la salida siguen al video. Devuelve true si cambió el tamaño. */
function ajustarTamano() {
  if (!resizeCanvasToVideo(escena, video)) return false;
  canvas.width = escena.width;
  canvas.height = escena.height;
  return true;
}

/** Lleva la escena a la pantalla: tal cual, o partida en dos para el visor. */
function presentar() {
  const vr = enVR();
  if (document.body.classList.toggle("vr", vr) !== vrAnterior) {
    vrAnterior = vr;
    if (vr) avisarPantallaCompleta();
  }
  if (vr) drawVR(salida, escena, canvas.width, canvas.height, vrZoom);
  else salida.drawImage(escena, 0, 0);
}
let vrAnterior = false;

// ---- pantalla completa ----
//
// En Android y en la computadora un toque pide pantalla completa (y de paso
// bloquea la orientación en horizontal si se deja). En iPhone Safari no
// existe pantalla completa para páginas: la única forma es abrir la web
// desde la pantalla de inicio, y eso solo se puede explicar, no forzar.

const esIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const esApp = window.matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches ||
  navigator.standalone === true;
const hayPantallaCompleta = !!(document.documentElement.requestFullscreen && document.fullscreenEnabled);

function avisarPantallaCompleta() {
  if (esApp || document.fullscreenElement) return;
  if (hayPantallaCompleta) ui.toast("Toca la pantalla para ponerla completa", 3000);
  else if (esIOS) ui.toast("Pantalla completa en iPhone: Compartir → Añadir a pantalla de inicio, y abre desde ahí", 6000);
}

async function pedirPantallaCompleta() {
  if (!hayPantallaCompleta || document.fullscreenElement) return;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    await screen.orientation?.lock?.("landscape").catch(() => {});
  } catch (err) {
    console.warn("Sin pantalla completa:", err);
  }
}

canvas.addEventListener("click", () => {
  if (enVR()) void pedirPantallaCompleta();
});

function loop() {
  // Mientras la cámara cambia no hay cuadros: se deja el último pintado en
  // vez de limpiar el canvas (que es lo que lo pone en negro).
  if (cambiandoCamara || video.readyState < 2) {
    requestAnimationFrame(loop);
    return;
  }
  if (ajustarTamano()) motor?.resize(escena.width, escena.height);
  const w = escena.width;
  const h = escena.height;
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

  if (tracker.visible) {
    drawWindow(tracker.corners, w, h);
    drawOutline(ctx, tracker.corners, {
      presence: tracker.presence,
      timeSec: now / 1000,
      accent: efectoActual().acento,
    });
  }

  // Sin marco: enseñar qué ve el detector y decir qué falta. Sin esto, cuando
  // el gesto no entra no hay forma de saber si es que no ve las manos o si es
  // que la L está poco abierta.
  const sinMarco = tracker.presence <= 0.5;
  if (sinMarco) {
    const manos = lastHands ?? [];
    const infos = manos.map((lm) => handInfo(lm, { width: w, height: h, mirror: espejo }));
    drawManos(ctx, infos, w);
    ui.setHint(pistaPara(infos));
  }
  ui.showHint(sinMarco);
  presentar();
  requestAnimationFrame(loop);
}

/** Texto de ayuda según cuántas manos se ven y cómo están. */
function pistaPara(infos) {
  if (DEMO) return "Modo demo: las manos son falsas y se mueven solas.";
  if (infos.length === 0) {
    return "No veo tus manos. Mételas enteras en el cuadro, con las palmas a la vista.";
  }
  if (infos.length === 1) {
    return "Veo una mano. Mete la otra entera en el cuadro, no la dejes cortada por el borde.";
  }
  const cerradas = infos.filter((i) => i.spread < TRACKING_DEFAULTS.spreadEnter).length;
  if (cerradas) {
    return cerradas === 2
      ? "Veo las dos manos. Abre bien el pulgar y el índice en L, hasta que los puntos se pongan verdes."
      : "Casi: abre más el pulgar y el índice de la mano con los puntos rojos.";
  }
  return "Ya está: junta las dos L en un rectángulo, un poco más grande.";
}

/**
 * Puntas de pulgar e índice de cada mano, unidas por una línea: verde si la
 * apertura basta para el marco, roja si no. Es la única forma de ver, en el
 * teléfono, por qué el marco no entra.
 */
function drawManos(ctx, infos, w) {
  if (!infos.length) return;
  const r = Math.max(5, w * 0.007);
  ctx.save();
  ctx.lineWidth = Math.max(2, w / 500);
  for (const i of infos) {
    const ok = i.spread >= TRACKING_DEFAULTS.spreadEnter;
    const color = ok ? "#4ade80" : "#ff6b5e";
    ctx.strokeStyle = withAlpha(color, 0.7);
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(i.thumb.x, i.thumb.y);
    ctx.lineTo(i.index.x, i.index.y);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const p of [i.thumb, i.index]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.stroke();
    }
  }
  ctx.restore();
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
