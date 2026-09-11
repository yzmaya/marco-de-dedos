// ui.js — interfaz: lista de efectos, pista, avisos.
//
// Lo único que se guarda en el navegador es el efecto elegido, para que al
// recargar siga el mismo.

import { EFECTOS, buscarEfecto } from "./efectos.js";

const EFECTO_STORAGE = "ff-efecto";

export function loadSettings() {
  return { efectoId: localStorage.getItem(EFECTO_STORAGE) || "" };
}

export function persistEfecto(id) {
  localStorage.setItem(EFECTO_STORAGE, id);
}

/** ¿El foco está en algo donde se escribe de verdad? */
function esCampoDeTexto(el) {
  if (el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return !["range", "checkbox", "radio", "button"].includes(el.type);
}

/**
 * Cablea toda la interfaz y devuelve los métodos que necesita el loop.
 *
 * @param {object} opts
 * @param {(id:string)=>void} opts.onEfecto  efecto elegido
 * @param {()=>void} opts.onCamara             cambiar entre cámara frontal y trasera
 * @param {()=>void} opts.onVR                 forzar o quitar la vista de visor
 * @param {(delta:number)=>void} opts.onVRZoom  afinar la escala del visor
 * @param {string} opts.efectoId             efecto inicial
 */
export function createUI({ onEfecto, onCamara = () => {}, onVR = () => {}, onVRZoom = () => {}, efectoId }) {
  const el = (id) => document.getElementById(id);
  const toolbar = el("toolbar");
  const hint = el("hint");
  const hintText = el("hint-text");
  const statusEl = el("status");
  const statusText = el("status-text");

  let current = efectoId;

  // ---- selector de efectos ----
  EFECTOS.forEach((efecto) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.id = efecto.id;
    btn.innerHTML =
      `<span class="key">${efecto.tecla.toUpperCase()}</span>` +
      `<span class="punto" style="background:${efecto.acento};color:${efecto.acento}"></span>` +
      efecto.label;
    if (efecto.id === current) btn.classList.add("active");
    btn.addEventListener("click", () => select(efecto.id));
    toolbar.appendChild(btn);
  });

  function ciclar(delta) {
    const i = EFECTOS.findIndex((e) => e.id === current);
    select(EFECTOS[(i + delta + EFECTOS.length) % EFECTOS.length].id);
  }

  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      ev.target?.blur?.();
      return;
    }
    if (esCampoDeTexto(ev.target)) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

    const key = ev.key.toLowerCase();
    const porTecla = EFECTOS.find((e) => e.tecla === key);
    if (porTecla) {
      ev.preventDefault();
      select(porTecla.id);
    } else if (key === "o") {
      ev.preventDefault();
      toggleClean();
    } else if (key === "c") {
      ev.preventDefault();
      onCamara();
    } else if (key === "v") {
      ev.preventDefault();
      onVR();
    } else if (ev.key === "]" || ev.key === "ArrowRight" || ev.key === "ArrowDown") {
      ev.preventDefault();
      ciclar(1);
    } else if (ev.key === "[" || ev.key === "ArrowLeft" || ev.key === "ArrowUp") {
      ev.preventDefault();
      ciclar(-1);
    } else if (ev.key === "+" || ev.key === "=") {
      ev.preventDefault();
      onVRZoom(0.05);
    } else if (ev.key === "-" || ev.key === "_") {
      ev.preventDefault();
      onVRZoom(-0.05);
    }
  });

  // El botón de cámara es lo único que no se esconde nunca: dentro del
  // visor y con la interfaz oculta sigue siendo la forma de volver.
  el("camara-btn").addEventListener("click", (ev) => {
    ev.currentTarget.blur();
    onCamara();
  });

  // Interfaz oculta: fuera todo menos el video y el marco. El aviso se
  // desvanece solo.
  function toggleClean() {
    const clean = document.body.classList.toggle("limpio");
    if (clean) toast("Interfaz oculta · pulsa O para recuperarla");
    else hideToast();
  }

  let toastTimer = null;
  const toastEl = el("toast");
  function toast(text, ms = 2600) {
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, ms);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    toastEl.classList.remove("show");
  }

  function select(id) {
    current = id;
    const efecto = buscarEfecto(id);
    toolbar.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", b.dataset.id === id);
    });
    // En la tira del móvil, que el elegido quede a la vista.
    toolbar.querySelector(`button[data-id="${id}"]`)?.scrollIntoView({ block: "nearest", inline: "center" });
    document.documentElement.style.setProperty("--acento", efecto.acento);
    persistEfecto(id);
    onEfecto(id);
    toast(efecto.label, 1200);
  }

  document.documentElement.style.setProperty("--acento", buscarEfecto(current).acento);

  return {
    get efectoId() {
      return current;
    },
    showHint(show) {
      hint.classList.toggle("hidden", !show);
    },
    /** Cambia el texto de la pista solo si es distinto (evita repintar cada cuadro). */
    setHint(text) {
      if (hintText.textContent !== text) hintText.textContent = text;
    },
    setLoading(text) {
      statusEl.classList.remove("hidden");
      statusText.textContent = text;
    },
    hideLoading() {
      statusEl.classList.add("hidden");
    },
    fatal(text) {
      statusEl.classList.remove("hidden");
      statusEl.querySelector(".spinner")?.remove();
      statusText.textContent = text;
    },
    toast,
    toggleClean,
  };
}
