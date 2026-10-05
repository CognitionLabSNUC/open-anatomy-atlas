// WebGL2 renderer for the packed atlas: one vertex/index buffer for the
// whole body, one draw call per structure, colour-ID picking, X-ray mode and
// a clipping plane for sectional views.
/* global mat4 */

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
uniform mat4 uVP;
out vec3 vN;
out vec3 vW;
void main() {
  vN = aNor;
  vW = aPos;
  gl_Position = uVP * vec4(aPos, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vN;
in vec3 vW;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uSel;
uniform vec3 uSelColor;
uniform vec3 uEye;
uniform vec4 uClip;
uniform bool uClipOn;
out vec4 o;
void main() {
  if (uClipOn && dot(vec4(vW, 1.0), uClip) > 0.0) discard;
  vec3 N = normalize(vN);
  vec3 V = normalize(uEye - vW);
  if (dot(N, V) < 0.0) N = -N;               // tolerate inconsistent winding
  vec3 L1 = normalize(V + vec3(0.35, 0.65, 0.15));
  vec3 L2 = normalize(vec3(-0.5, 0.35, -0.7));
  float d = max(dot(N, L1), 0.0) * 0.72 + max(dot(N, L2), 0.0) * 0.22;
  float hemi = 0.5 + 0.5 * N.y;
  vec3 amb = mix(vec3(0.15, 0.17, 0.20), vec3(0.30, 0.30, 0.29), hemi);
  vec3 H = normalize(L1 + V);
  float s = pow(max(dot(N, H), 0.0), 40.0) * 0.16;
  vec3 c = uColor * (amb + d) + s;
  if (uClipOn && !gl_FrontFacing) c *= 0.72;  // cut faces read darker
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.2);
  c = mix(c, uSelColor, uSel * 0.30) + uSel * rim * uSelColor * 0.85;
  o = vec4(c, uAlpha);
}`;

const PICK_FS = `#version 300 es
precision highp float;
in vec3 vN;
in vec3 vW;
uniform vec3 uColor;
uniform vec4 uClip;
uniform bool uClipOn;
out vec4 o;
void main() {
  if (uClipOn && dot(vec4(vW, 1.0), uClip) > 0.0) discard;
  o = vec4(uColor, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

class AtlasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('This computer’s graphics driver does not support WebGL2.');
    this.gl = gl;
    this.main = program(gl, VS, FS);
    this.pickProg = program(gl, VS, PICK_FS);
    this.camera = { yaw: 0, pitch: 0.05, dist: 3, target: [0, 0.9, 0], fov: 40 * Math.PI / 180 };
    this.clip = { on: false, plane: [0, -1, 0, 1] };
    this.xray = false;
    this.selColor = [0.56, 0.86, 0.80];
    this.background = [0.118, 0.145, 0.180];
    this.n = 0;
    this.dirty = true;
    this.anim = null;
    this.onFrame = null;
    this._fbo = null;
    new ResizeObserver(() => this.requestRender()).observe(canvas);
    const loop = (t) => {
      if (this.anim) this._stepAnim(t);
      if (this.dirty) { this.dirty = false; this._draw(); if (this.onFrame) this.onFrame(); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  requestRender() { this.dirty = true; }

  setAtlas(index, bin) {
    const gl = this.gl;
    if (this.vao) { gl.deleteVertexArray(this.vao); this.buffers.forEach(b => gl.deleteBuffer(b)); }
    const [po, pl] = index.buffers.positions, [no, nl] = index.buffers.normals, [io, il] = index.buffers.indices;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const pb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(bin, po, pl / 4), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const nb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nb);
    gl.bufferData(gl.ARRAY_BUFFER, new Int16Array(bin, no, nl / 2), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.SHORT, true, 0, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(bin, io, il / 4), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.buffers = [pb, nb, ib];

    this.elements = index.elements;
    this.n = index.elements.length;
    this.visible = new Uint8Array(this.n).fill(1);
    this.selected = new Uint8Array(this.n);
    this.colors = new Float32Array(this.n * 3);
    this.sceneBox = index.bbox;
    this.frame(index.bbox, false);
  }

  setColor(i, rgb) { this.colors.set(rgb, i * 3); }

  // ---- camera ----
  _eye(cam = this.camera) {
    const { yaw, pitch, dist, target } = cam;
    return [
      target[0] + dist * Math.cos(pitch) * Math.sin(yaw),
      target[1] + dist * Math.sin(pitch),
      target[2] + dist * Math.cos(pitch) * Math.cos(yaw),
    ];
  }
  _matrices() {
    const eye = this._eye();
    const aspect = Math.max(1e-3, this.canvas.width / Math.max(1, this.canvas.height));
    const d = this.camera.dist;
    const proj = mat4.perspective(mat4.create(), this.camera.fov, aspect, Math.max(0.001, d * 0.02), d * 20 + 10);
    const view = mat4.lookAt(mat4.create(), eye, this.camera.target, [0, 1, 0]);
    return { vp: mat4.multiply(mat4.create(), proj, view), eye };
  }
  orbit(dx, dy) {
    this.anim = null;
    this.camera.yaw -= dx * 0.006;
    this.camera.pitch = Math.max(-1.45, Math.min(1.45, this.camera.pitch + dy * 0.006));
    this.requestRender();
  }
  pan(dx, dy) {
    this.anim = null;
    const { yaw, dist, fov } = this.camera;
    const s = (2 * dist * Math.tan(fov / 2)) / Math.max(1, this.canvas.clientHeight);
    const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const t = this.camera.target;
    t[0] -= right[0] * dx * s; t[2] -= right[2] * dx * s;
    t[1] += dy * s;
    this.requestRender();
  }
  zoom(factor) {
    this.anim = null;
    const size = this.sceneBox ? Math.max(this.sceneBox[4] - this.sceneBox[1], 0.1) : 2;
    this.camera.dist = Math.max(size * 0.01, Math.min(size * 8, this.camera.dist * factor));
    this.requestRender();
  }
  view(name) {
    const yaw = { front: 0, back: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 }[name];
    if (yaw === undefined) return;
    this._animateTo({ yaw, pitch: 0.02, dist: this.camera.dist, target: this.camera.target.slice() });
  }
  frame(b, animate = true) {
    if (!b) return;
    const c = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
    const r = Math.max(0.01, Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2);
    const aspect = Math.max(0.3, this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight));
    const fit = Math.min(this.camera.fov, 2 * Math.atan(Math.tan(this.camera.fov / 2) * aspect));
    const dist = (r / Math.sin(fit / 2)) * 1.02;
    const goal = { yaw: this.camera.yaw, pitch: this.camera.pitch, dist, target: c };
    if (animate) this._animateTo(goal); else { Object.assign(this.camera, goal); this.requestRender(); }
  }
  _animateTo(goal) {
    if (reduceMotion()) { Object.assign(this.camera, goal); this.anim = null; this.requestRender(); return; }
    let dyaw = goal.yaw - this.camera.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.anim = { from: { ...this.camera, target: this.camera.target.slice() }, to: { ...goal, yaw: this.camera.yaw + dyaw }, t0: null, dur: 420 };
    this.requestRender();
  }
  _stepAnim(t) {
    const a = this.anim;
    if (a.t0 === null) a.t0 = t;
    const k = Math.min(1, (t - a.t0) / a.dur);
    const e = 1 - Math.pow(1 - k, 3);
    const L = (x, y) => x + (y - x) * e;
    this.camera.yaw = L(a.from.yaw, a.to.yaw);
    this.camera.pitch = L(a.from.pitch, a.to.pitch);
    this.camera.dist = L(a.from.dist, a.to.dist);
    this.camera.target = a.from.target.map((v, i) => L(v, a.to.target[i]));
    if (k >= 1) this.anim = null;
    this.dirty = true;
  }

  // ---- drawing ----
  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; this._fboSize = null; }
  }

  _setCommon(prog, vp, eye) {
    const gl = this.gl;
    gl.useProgram(prog.p);
    gl.uniformMatrix4fv(prog.u.uVP, false, vp);
    gl.uniform4fv(prog.u.uClip, this.clip.plane);
    gl.uniform1i(prog.u.uClipOn, this.clip.on ? 1 : 0);
    if (prog.u.uEye) gl.uniform3fv(prog.u.uEye, eye);
    if (prog.u.uSelColor) gl.uniform3fv(prog.u.uSelColor, this.selColor);
  }

  _draw() {
    const gl = this.gl;
    this._resize();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(...this.background, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.n) return;
    const { vp, eye } = this._matrices();
    const u = this.main.u;
    this._setCommon(this.main, vp, eye);
    gl.bindVertexArray(this.vao);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(true);

    const anySel = this.selected.some(Boolean);
    const ghostOthers = this.xray && anySel;
    const els = this.elements;
    gl.uniform1f(u.uAlpha, 1);
    for (let i = 0; i < this.n; i++) {
      if (!this.visible[i]) continue;
      if (this.xray && !(ghostOthers && this.selected[i])) continue;
      gl.uniform3fv(u.uColor, this.colors.subarray(i * 3, i * 3 + 3));
      gl.uniform1f(u.uSel, this.selected[i] ? 1 : 0);
      gl.drawElements(gl.TRIANGLES, els[i].n, gl.UNSIGNED_INT, els[i].o * 4);
    }
    if (anySel && !this.xray) {
      // Show the hidden parts of the selection faintly through whatever covers them.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.depthFunc(gl.GREATER);
      gl.uniform1f(u.uAlpha, 0.38);
      gl.uniform1f(u.uSel, 1);
      for (let i = 0; i < this.n; i++) {
        if (!this.visible[i] || !this.selected[i]) continue;
        gl.uniform3fv(u.uColor, this.selColor);
        gl.drawElements(gl.TRIANGLES, els[i].n, gl.UNSIGNED_INT, els[i].o * 4);
      }
      gl.depthFunc(gl.LESS);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    if (this.xray) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.enable(gl.CULL_FACE);
      gl.uniform1f(u.uAlpha, ghostOthers ? 0.10 : 0.22);
      gl.uniform1f(u.uSel, 0);
      for (let i = 0; i < this.n; i++) {
        if (!this.visible[i] || (ghostOthers && this.selected[i])) continue;
        gl.uniform3fv(u.uColor, this.colors.subarray(i * 3, i * 3 + 3));
        gl.drawElements(gl.TRIANGLES, els[i].n, gl.UNSIGNED_INT, els[i].o * 4);
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
    }
    gl.bindVertexArray(null);
  }

  // Returns the element index under the given client coordinates, or -1.
  pick(clientX, clientY) {
    const gl = this.gl;
    if (!this.n) return -1;
    this._resize();
    const W = this.canvas.width, H = this.canvas.height;
    if (!this._fbo || this._fboSize !== W + 'x' + H) {
      if (this._fbo) { gl.deleteFramebuffer(this._fbo); gl.deleteRenderbuffer(this._rbC); gl.deleteRenderbuffer(this._rbD); }
      this._fbo = gl.createFramebuffer();
      this._rbC = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this._rbC);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, W, H);
      this._rbD = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this._rbD);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, H);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this._rbC);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this._rbD);
      this._fboSize = W + 'x' + H;
    }
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left) * (W / rect.width));
    const y = Math.floor((rect.bottom - clientY) * (H / rect.height));
    if (x < 0 || y < 0 || x >= W || y >= H) return -1;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
    gl.viewport(0, 0, W, H);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, y, 1, 1);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    const { vp, eye } = this._matrices();
    this._setCommon(this.pickProg, vp, eye);
    gl.bindVertexArray(this.vao);
    const anySel = this.selected.some(Boolean);
    const id = new Float32Array(3);
    for (let i = 0; i < this.n; i++) {
      if (!this.visible[i]) continue;
      if (this.xray && anySel && !this.selected[i]) continue; // in X-ray, only solid structures are clickable
      const k = i + 1;
      id[0] = (k & 255) / 255; id[1] = ((k >> 8) & 255) / 255; id[2] = ((k >> 16) & 255) / 255;
      gl.uniform3fv(this.pickProg.u.uColor, id);
      gl.drawElements(gl.TRIANGLES, this.elements[i].n, gl.UNSIGNED_INT, this.elements[i].o * 4);
    }
    const px = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const k = px[0] | (px[1] << 8) | (px[2] << 16);
    return k ? k - 1 : -1;
  }

  // World point -> CSS pixel position inside the canvas.
  project(p) {
    const { vp } = this._matrices();
    const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12];
    const y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
    const w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
    if (w <= 0) return null;
    return [(x / w * 0.5 + 0.5) * this.canvas.clientWidth, (1 - (y / w * 0.5 + 0.5)) * this.canvas.clientHeight];
  }

  snapshot() {
    this._draw();
    return this.canvas.toDataURL('image/png');
  }
}
