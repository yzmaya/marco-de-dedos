// fx.js — motor WebGL2 de los efectos.
//
// Un triángulo que cubre la pantalla, la cámara subida como textura cada
// cuadro y un programa por efecto (compilado la primera vez que se usa). Pinta
// en un canvas propio del tamaño del video, que main.js copia dentro del
// recorte del marco: el shader nunca sabe que existen los dedos.
//
// Para los efectos con `feedback`, al terminar de pintar se copia el resultado
// a una textura que el cuadro siguiente recibe como u_prev. Así la estela de
// luz recuerda lo que pintó antes sin necesitar framebuffers de ida y vuelta.

import { PRELUDIO_GLSL } from "./efectos.js";

const VERTEX = `#version 300 es
layout(location = 0) in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

function compilar(gl, tipo, fuente) {
  const sh = gl.createShader(tipo);
  gl.shaderSource(sh, fuente);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader: ${log}`);
  }
  return sh;
}

function textura(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}

export class MotorFX {
  constructor(width, height) {
    this.canvas = document.createElement("canvas");
    const gl = this.canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("Este navegador no tiene WebGL2.");
    this.gl = gl;
    this.vertex = compilar(gl, gl.VERTEX_SHADER, VERTEX);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.videoTex = textura(gl);
    this.prevTex = textura(gl);
    this.programas = new Map();
    this.ultimoEfecto = null;
    this.canvas.width = 0;
    this.resize(width, height);
  }

  resize(width, height) {
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    const gl = this.gl;
    gl.viewport(0, 0, width, height);
    this.limpiarMemoria();
  }

  /** Vacía la textura del cuadro anterior (la estela empieza de cero). */
  limpiarMemoria() {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.prevTex);
    // RGB y no RGBA: el framebuffer se creó sin alfa, y copiar de un
    // framebuffer RGB a una textura RGBA es una operación inválida en WebGL.
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGB, this.canvas.width, this.canvas.height, 0,
      gl.RGB, gl.UNSIGNED_BYTE, null
    );
  }

  programa(efecto) {
    let p = this.programas.get(efecto.id);
    if (p) return p;
    const gl = this.gl;
    const frag = compilar(gl, gl.FRAGMENT_SHADER, PRELUDIO_GLSL + efecto.glsl);
    const prog = gl.createProgram();
    gl.attachShader(prog, this.vertex);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`Programa ${efecto.id}: ${gl.getProgramInfoLog(prog)}`);
    }
    const u = (nombre) => gl.getUniformLocation(prog, nombre);
    p = {
      prog,
      u_video: u("u_video"),
      u_prev: u("u_prev"),
      u_res: u("u_res"),
      u_time: u("u_time"),
      u_intensidad: u("u_intensidad"),
      u_tono: u("u_tono"),
      u_detalle: u("u_detalle"),
      u_centro: u("u_centro"),
      u_espejo: u("u_espejo"),
    };
    this.programas.set(efecto.id, p);
    return p;
  }

  /**
   * Pinta un cuadro del efecto y devuelve el canvas listo para copiar.
   * @param {object} efecto  entrada de EFECTOS
   * @param {HTMLVideoElement} fuente  la cámara (o el feed de demo)
   */
  render(efecto, fuente, {
    time = 0, intensidad = 0.5, tono = 0, detalle = 0.5, centro = [0.5, 0.5], espejo = true,
  } = {}) {
    const gl = this.gl;
    const p = this.programa(efecto);
    const w = this.canvas.width;
    const h = this.canvas.height;

    if (efecto !== this.ultimoEfecto) {
      this.limpiarMemoria();
      this.ultimoEfecto = efecto;
    }

    gl.useProgram(p.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    // Con FLIP_Y el (0,0) de la textura es la esquina inferior de la imagen,
    // igual que gl_FragCoord: el shader lee la cámara derecha sin más cuentas.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, fuente);
    gl.uniform1i(p.u_video, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.prevTex);
    gl.uniform1i(p.u_prev, 1);

    gl.uniform2f(p.u_res, w, h);
    gl.uniform1f(p.u_time, time);
    gl.uniform1f(p.u_intensidad, intensidad);
    gl.uniform1f(p.u_tono, tono);
    gl.uniform1f(p.u_detalle, detalle);
    gl.uniform2f(p.u_centro, centro[0], centro[1]);
    gl.uniform1f(p.u_espejo, espejo ? 1 : 0);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (efecto.feedback) {
      // prevTex sigue enlazada en la unidad 1: se copia el framebuffer encima.
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, w, h);
    }
    return this.canvas;
  }
}
