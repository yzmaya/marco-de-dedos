// hands.js — carga de MediaPipe Hand Landmarker.
//
// Se importa de forma dinámica para que el modo demo no dependa de que el
// CDN de MediaPipe responda.

const TASKS_VISION_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/" +
  "hand_landmarker/float16/1/hand_landmarker.task";

/**
 * Crea el detector de manos configurado para video en vivo.
 * Los umbrales van bajos a propósito: en el gesto del marco las manos se
 * solapan y se ocultan entre sí, así que conviene un detector generoso y
 * poner la severidad después, en el pipeline de tracking.js.
 */
export async function createHandLandmarker() {
  const { HandLandmarker, FilesetResolver } = await import(
    /* @vite-ignore */ TASKS_VISION_URL
  );
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  return HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.3,
    minHandPresenceConfidence: 0.3,
    minTrackingConfidence: 0.3,
  });
}

/**
 * Cámara de 1280x720 a 30 fps: buen equilibrio entre detalle y velocidad.
 * @param {"user"|"environment"} facing  frontal o trasera
 * @param {boolean} exact  si true, falla en vez de devolver otra cámara
 */
export function cameraConstraints(facing = "user", exact = false) {
  return {
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
      facingMode: exact ? { exact: facing } : facing,
    },
    audio: false,
  };
}

export const CAMERA_CONSTRAINTS = cameraConstraints("user");
