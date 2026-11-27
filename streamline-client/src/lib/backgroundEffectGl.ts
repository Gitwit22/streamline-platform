/**
 * WebGL2 pipeline for the enhanced camera background effect.
 *
 * Replaces @livekit/track-processors' built-in setupWebGL (same method names,
 * so BackgroundTransformer's own calls keep working) with a higher quality
 * mask and blur:
 *
 *   raw confidence mask ─► temporal EMA ─► joint bilateral (guided by the
 *   frame's colours) ─► smoothstep at composite time
 *
 *   frame × (1 − mask) ─► dual-Kawase down/up ─► ÷ blurred weight
 *   (mask-aware blur: the person never bleeds into the blurred background,
 *   which is what produced the dark/bright halo around the silhouette)
 *
 * Runs in the WebGL context MediaPipe shares, so every pass binds the state
 * it needs (program, framebuffer, viewport, textures, vertex attribute) and
 * leaves the default framebuffer bound, like the library pipeline it replaces.
 *
 * Sizes come from the frames, never from canvas.width/height: MediaPipe
 * resizes the shared canvas to its own input size while segmenting.
 *
 * Texture orientation: every texture has the top image row at t = 0 (as
 * uploaded from a VideoFrame and as MediaPipe returns its masks). Offscreen
 * passes keep that orientation; only the final draw to the canvas flips.
 */
import {
  BILATERAL_COLOR_SIGMA,
  EMA_CURRENT_WEIGHT,
  EMA_MOTION_HIGH,
  EMA_MOTION_LOW,
  MASK_BUFFER_LONG_EDGE,
  MASK_EDGE_HIGH,
  MASK_EDGE_LOW,
  bilateralStep,
  fitLongEdge,
  kawasePlanFor,
} from "./backgroundEffectTuning";

const VERTEX_SHADER = `#version 300 es
in vec2 position;
uniform bool u_flipY;
out vec2 v_uv;
void main() {
  v_uv = (position + 1.0) * 0.5;
  if (u_flipY) v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

/** Motion-adaptive temporal smoothing of the raw confidence mask. */
const EMA_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_raw;
uniform sampler2D u_prev;
uniform bool u_hasPrev;
out vec4 outColor;
void main() {
  float cur = texture(u_raw, v_uv).r;
  if (!u_hasPrev) { outColor = vec4(cur, 0.0, 0.0, 1.0); return; }
  float prev = texture(u_prev, v_uv).r;
  float w = mix(${EMA_CURRENT_WEIGHT.toFixed(3)}, 1.0,
    smoothstep(${EMA_MOTION_LOW.toFixed(3)}, ${EMA_MOTION_HIGH.toFixed(3)}, abs(cur - prev)));
  outColor = vec4(mix(prev, cur, w), 0.0, 0.0, 1.0);
}`;

/** 5×5 joint bilateral filter: smooths the mask but not across colour edges. */
const REFINE_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_mask;
uniform sampler2D u_guide;
uniform vec2 u_texel;
uniform float u_step;
uniform float u_colorWeight; // 1 / (2·sigma²); 0 disables the colour term
out vec4 outColor;
void main() {
  vec3 c0 = texture(u_guide, v_uv).rgb;
  float sum = 0.0;
  float wsum = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 uv = v_uv + vec2(float(x), float(y)) * u_step * u_texel;
      vec3 d = texture(u_guide, uv).rgb - c0;
      float w = exp(-float(x * x + y * y) / 4.5 - dot(d, d) * u_colorWeight);
      sum += texture(u_mask, uv).r * w;
      wsum += w;
    }
  }
  outColor = vec4(sum / wsum, 0.0, 0.0, 1.0);
}`;

/** First Kawase downsample: weights every tap by "is background" (premultiplied). */
const KAWASE_DOWN_MASKED_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform sampler2D u_mask;
uniform vec2 u_halfPixel;
uniform float u_offset;
out vec4 outColor;
vec4 tap(vec2 uv) {
  float w = 1.0 - smoothstep(0.15, 0.5, texture(u_mask, uv).r);
  return vec4(texture(u_src, uv).rgb * w, w);
}
void main() {
  vec2 hp = u_halfPixel * u_offset;
  vec4 sum = tap(v_uv) * 4.0;
  sum += tap(v_uv - hp);
  sum += tap(v_uv + hp);
  sum += tap(v_uv + vec2(hp.x, -hp.y));
  sum += tap(v_uv - vec2(hp.x, -hp.y));
  outColor = sum / 8.0;
}`;

const KAWASE_DOWN_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_halfPixel;
uniform float u_offset;
out vec4 outColor;
void main() {
  vec2 hp = u_halfPixel * u_offset;
  vec4 sum = texture(u_src, v_uv) * 4.0;
  sum += texture(u_src, v_uv - hp);
  sum += texture(u_src, v_uv + hp);
  sum += texture(u_src, v_uv + vec2(hp.x, -hp.y));
  sum += texture(u_src, v_uv - vec2(hp.x, -hp.y));
  outColor = sum / 8.0;
}`;

const KAWASE_UP_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_halfPixel;
uniform float u_offset;
out vec4 outColor;
void main() {
  vec2 hp = u_halfPixel * u_offset;
  vec4 sum = texture(u_src, v_uv + vec2(-hp.x * 2.0, 0.0));
  sum += texture(u_src, v_uv + vec2(-hp.x, hp.y)) * 2.0;
  sum += texture(u_src, v_uv + vec2(0.0, hp.y * 2.0));
  sum += texture(u_src, v_uv + vec2(hp.x, hp.y)) * 2.0;
  sum += texture(u_src, v_uv + vec2(hp.x * 2.0, 0.0));
  sum += texture(u_src, v_uv + vec2(hp.x, -hp.y)) * 2.0;
  sum += texture(u_src, v_uv + vec2(0.0, -hp.y * 2.0));
  sum += texture(u_src, v_uv + vec2(-hp.x, -hp.y)) * 2.0;
  outColor = sum / 12.0;
}`;

/** u_mode: 0 = pass the frame through, 1 = mask-aware blur, 2 = image. */
const COMPOSITE_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_frame;
uniform sampler2D u_mask;
uniform sampler2D u_background;
uniform int u_mode;
out vec4 outColor;
void main() {
  vec3 frame = texture(u_frame, v_uv).rgb;
  if (u_mode == 0) { outColor = vec4(frame, 1.0); return; }
  float person = smoothstep(${MASK_EDGE_LOW.toFixed(3)}, ${MASK_EDGE_HIGH.toFixed(3)}, texture(u_mask, v_uv).r);
  vec3 bg;
  if (u_mode == 1) {
    vec4 b = texture(u_background, v_uv);
    // Un-premultiply. Where almost no background was nearby (deep inside the
    // person) the result is hidden by the person anyway; fade to the frame
    // there instead of dividing by ~0.
    bg = mix(frame, b.rgb / max(b.a, 1e-4), smoothstep(0.0, 0.05, b.a));
  } else {
    bg = texture(u_background, v_uv).rgb;
  }
  outColor = vec4(mix(bg, frame, person), 1.0);
}`;

type Program = { program: WebGLProgram; uniforms: Record<string, WebGLUniformLocation | null> };
type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number };

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("createShader failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${info}`);
  }
  return shader;
}

const POSITION_ATTRIB = 0;

function link(gl: WebGL2RenderingContext, vs: WebGLShader, fsSource: string, uniformNames: string[]): Program {
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  if (!program) throw new Error("createProgram failed");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, POSITION_ATTRIB, "position");
  gl.linkProgram(program);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`program link failed: ${info}`);
  }
  const uniforms: Program["uniforms"] = {};
  for (const name of ["u_flipY", ...uniformNames]) uniforms[name] = gl.getUniformLocation(program, name);
  return { program, uniforms };
}

function newTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error("createTexture failed");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return texture;
}

type Storage = { internalFormat: number; type: number };

function allocate(gl: WebGL2RenderingContext, texture: WebGLTexture, w: number, h: number, storage: Storage) {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, storage.internalFormat, w, h, 0, gl.RGBA, storage.type, null);
}

function newTarget(gl: WebGL2RenderingContext, w: number, h: number, storage: Storage): Target {
  const texture = newTexture(gl);
  allocate(gl, texture, w, h, storage);
  const framebuffer = gl.createFramebuffer();
  if (!framebuffer) throw new Error("createFramebuffer failed");
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  return { texture, framebuffer, width: w, height: h };
}

function deleteTarget(gl: WebGL2RenderingContext, t: Target | null | undefined) {
  if (!t) return;
  gl.deleteTexture(t.texture);
  gl.deleteFramebuffer(t.framebuffer);
}

/**
 * Half-float targets keep the premultiplied blur accurate where little
 * background weight remains (8-bit would band there). MediaPipe already
 * requires a float/half-float colour buffer extension on this context, so
 * this nearly always succeeds; otherwise 8-bit is used.
 */
function pickBlurStorage(gl: WebGL2RenderingContext): Storage {
  const rgba8: Storage = { internalFormat: gl.RGBA8, type: gl.UNSIGNED_BYTE };
  if (!gl.getExtension("EXT_color_buffer_float") && !gl.getExtension("EXT_color_buffer_half_float")) return rgba8;
  const half: Storage = { internalFormat: gl.RGBA16F, type: gl.HALF_FLOAT };
  let probe: Target | null = null;
  try {
    probe = newTarget(gl, 4, 4, half);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    return ok ? half : rgba8;
  } catch {
    return rgba8;
  } finally {
    deleteTarget(gl, probe);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}

export type EnhancedBackgroundGl = ReturnType<typeof setupEnhancedBackgroundGl>;

/** Throws if the context or any shader can't be set up (callers fall back). */
export function setupEnhancedBackgroundGl(canvas: OffscreenCanvas | HTMLCanvasElement) {
  const ctx = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: true });
  if (!ctx) throw new Error("WebGL2 unavailable");
  const gl = ctx as WebGL2RenderingContext;

  const created: { programs: WebGLProgram[]; textures: WebGLTexture[]; buffers: WebGLBuffer[] } = {
    programs: [],
    textures: [],
    buffers: [],
  };
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  let ema: Program, refine: Program, downMasked: Program, down: Program, up: Program, composite: Program;
  try {
    ema = link(gl, vs, EMA_SHADER, ["u_raw", "u_prev", "u_hasPrev"]);
    created.programs.push(ema.program);
    refine = link(gl, vs, REFINE_SHADER, ["u_mask", "u_guide", "u_texel", "u_step", "u_colorWeight"]);
    created.programs.push(refine.program);
    downMasked = link(gl, vs, KAWASE_DOWN_MASKED_SHADER, ["u_src", "u_mask", "u_halfPixel", "u_offset"]);
    created.programs.push(downMasked.program);
    down = link(gl, vs, KAWASE_DOWN_SHADER, ["u_src", "u_halfPixel", "u_offset"]);
    created.programs.push(down.program);
    up = link(gl, vs, KAWASE_UP_SHADER, ["u_src", "u_halfPixel", "u_offset"]);
    created.programs.push(up.program);
    composite = link(gl, vs, COMPOSITE_SHADER, ["u_frame", "u_mask", "u_background", "u_mode"]);
    created.programs.push(composite.program);
  } catch (err) {
    created.programs.forEach((p) => gl.deleteProgram(p));
    throw err;
  } finally {
    gl.deleteShader(vs);
  }

  const quad = gl.createBuffer();
  if (!quad) throw new Error("createBuffer failed");
  created.buffers.push(quad);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, -1, -1, 1, 1, 1, -1]), gl.STATIC_DRAW);

  const maskStorage: Storage = { internalFormat: gl.RGBA8, type: gl.UNSIGNED_BYTE };
  const blurStorage = pickBlurStorage(gl);

  const frameTexture = newTexture(gl);
  const bgTexture = newTexture(gl);
  created.textures.push(frameTexture, bgTexture);

  // Size-dependent targets, (re)built by ensureSize().
  let width = 0;
  let height = 0;
  let emaTargets: Target[] = [];
  let emaRead = 0;
  let hasHistory = false;
  let refined: Target | null = null;
  let blurDown: Target[] = [];
  let blurUp: Target[] = [];

  let blurRadius: number | null = null;
  let backgroundDisabled = false;
  let hasBackgroundImage = false;
  let backgroundSource: ImageBitmap | null = null;
  let lastUploaded: VideoFrame | null = null;
  let hasFrame = false;
  let hasMask = false;
  let destroyed = false;

  function releaseSized() {
    emaTargets.forEach((t) => deleteTarget(gl, t));
    deleteTarget(gl, refined);
    blurDown.forEach((t) => deleteTarget(gl, t));
    blurUp.forEach((t) => deleteTarget(gl, t));
    emaTargets = [];
    refined = null;
    blurDown = [];
    blurUp = [];
  }

  function buildBlurChain() {
    blurDown.forEach((t) => deleteTarget(gl, t));
    blurUp.forEach((t) => deleteTarget(gl, t));
    blurDown = [];
    blurUp = [];
    if (!blurRadius || width === 0) return;
    const { levels } = kawasePlanFor(blurRadius, width, height);
    for (let i = 1; i <= levels; i++) {
      blurDown.push(newTarget(gl, Math.max(1, width >> i), Math.max(1, height >> i), blurStorage));
    }
    // Up targets match down levels 0..levels-2 (the last down level is the bottom).
    for (let i = 0; i < levels - 1; i++) {
      blurUp.push(newTarget(gl, blurDown[i].width, blurDown[i].height, blurStorage));
    }
  }

  /** (Re)allocates the size-dependent targets when the frame size changes. */
  function ensureSize(w: number, h: number) {
    if (w <= 0 || h <= 0) return;
    if (w === width && h === height && refined) return;
    width = w;
    height = h;
    releaseSized();
    const m = fitLongEdge(w, h, MASK_BUFFER_LONG_EDGE);
    emaTargets = [newTarget(gl, m.width, m.height, maskStorage), newTarget(gl, m.width, m.height, maskStorage)];
    refined = newTarget(gl, m.width, m.height, maskStorage);
    hasHistory = false;
    hasMask = false;
    buildBlurChain();
    if (backgroundSource) void setBackgroundImage(backgroundSource);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function bindTexture(unit: number, texture: WebGLTexture) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  }

  function draw(p: Program, target: Target | null, flipY: boolean) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null);
    gl.viewport(0, 0, target ? target.width : width, target ? target.height : height);
    gl.uniform1i(p.uniforms.u_flipY, flipY ? 1 : 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.vertexAttribPointer(POSITION_ATTRIB, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(POSITION_ATTRIB);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Uploads the frame so mask refinement can use its colours. Idempotent per frame. */
  function uploadFrame(frame: VideoFrame) {
    if (destroyed || frame === lastUploaded) return;
    ensureSize(frame.displayWidth, frame.displayHeight);
    bindTexture(0, frameTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    lastUploaded = frame;
    hasFrame = true;
  }

  /**
   * Takes this frame's raw confidence mask (person = 1). Must be called while
   * MediaPipe's texture is still valid, i.e. inside the segmentation callback.
   */
  function updateMask(mask: WebGLTexture, rawMaskWidth?: number) {
    if (destroyed || !refined || emaTargets.length < 2) return;
    gl.disable(gl.BLEND);
    const write = 1 - emaRead;

    gl.useProgram(ema.program);
    bindTexture(0, mask);
    bindTexture(1, emaTargets[emaRead].texture);
    gl.uniform1i(ema.uniforms.u_raw, 0);
    gl.uniform1i(ema.uniforms.u_prev, 1);
    gl.uniform1i(ema.uniforms.u_hasPrev, hasHistory ? 1 : 0);
    draw(ema, emaTargets[write], false);
    emaRead = write;
    hasHistory = true;

    gl.useProgram(refine.program);
    bindTexture(0, emaTargets[emaRead].texture);
    bindTexture(1, frameTexture);
    gl.uniform1i(refine.uniforms.u_mask, 0);
    gl.uniform1i(refine.uniforms.u_guide, 1);
    gl.uniform2f(refine.uniforms.u_texel, 1 / refined.width, 1 / refined.height);
    gl.uniform1f(refine.uniforms.u_step, bilateralStep(rawMaskWidth ?? refined.width, refined.width));
    const sigma = BILATERAL_COLOR_SIGMA;
    gl.uniform1f(refine.uniforms.u_colorWeight, hasFrame ? 1 / (2 * sigma * sigma) : 0);
    draw(refine, refined, false);

    hasMask = true;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function runBlur(): WebGLTexture | null {
    if (!blurRadius || blurDown.length === 0 || !refined) return null;
    const { offset } = kawasePlanFor(blurRadius, width, height);

    gl.useProgram(downMasked.program);
    bindTexture(0, frameTexture);
    bindTexture(1, refined.texture);
    gl.uniform1i(downMasked.uniforms.u_src, 0);
    gl.uniform1i(downMasked.uniforms.u_mask, 1);
    gl.uniform2f(downMasked.uniforms.u_halfPixel, 0.5 / blurDown[0].width, 0.5 / blurDown[0].height);
    gl.uniform1f(downMasked.uniforms.u_offset, offset);
    draw(downMasked, blurDown[0], false);

    gl.useProgram(down.program);
    gl.uniform1i(down.uniforms.u_src, 0);
    gl.uniform1f(down.uniforms.u_offset, offset);
    for (let i = 1; i < blurDown.length; i++) {
      bindTexture(0, blurDown[i - 1].texture);
      gl.uniform2f(down.uniforms.u_halfPixel, 0.5 / blurDown[i].width, 0.5 / blurDown[i].height);
      draw(down, blurDown[i], false);
    }

    let src = blurDown[blurDown.length - 1];
    gl.useProgram(up.program);
    gl.uniform1i(up.uniforms.u_src, 0);
    gl.uniform1f(up.uniforms.u_offset, offset);
    for (let i = blurUp.length - 1; i >= 0; i--) {
      bindTexture(0, src.texture);
      gl.uniform2f(up.uniforms.u_halfPixel, 0.5 / blurUp[i].width, 0.5 / blurUp[i].height);
      draw(up, blurUp[i], false);
      src = blurUp[i];
    }
    return src.texture;
  }

  function renderFrame(frame: VideoFrame) {
    if (destroyed || frame.codedWidth === 0) return;
    uploadFrame(frame);
    gl.disable(gl.BLEND);

    let mode = 0;
    let background: WebGLTexture = frameTexture;
    if (!backgroundDisabled && hasMask && refined) {
      const blurred = blurRadius ? runBlur() : null;
      if (blurred) {
        mode = 1;
        background = blurred;
      } else if (hasBackgroundImage) {
        mode = 2;
        background = bgTexture;
      }
    }

    gl.useProgram(composite.program);
    bindTexture(0, frameTexture);
    bindTexture(1, refined ? refined.texture : frameTexture);
    bindTexture(2, background);
    gl.uniform1i(composite.uniforms.u_frame, 0);
    gl.uniform1i(composite.uniforms.u_mask, 1);
    gl.uniform1i(composite.uniforms.u_background, 2);
    gl.uniform1i(composite.uniforms.u_mode, mode);
    draw(composite, null, true);
    // The frame is closed by the caller after this; never compare against a closed frame later.
    lastUploaded = null;
  }

  /** Crops the image to cover the canvas and uploads it. Latest call wins. */
  async function setBackgroundImage(image: ImageBitmap | null) {
    backgroundSource = image;
    if (!image) {
      hasBackgroundImage = false;
      return;
    }
    const w = width || canvas.width || image.width;
    const h = height || canvas.height || image.height;
    const scale = Math.max(w / image.width, h / image.height);
    const sw = Math.max(1, Math.round(w / scale));
    const sh = Math.max(1, Math.round(h / scale));
    const sx = Math.max(0, Math.round((image.width - sw) / 2));
    const sy = Math.max(0, Math.round((image.height - sh) / 2));
    let cropped: ImageBitmap;
    try {
      cropped = await createImageBitmap(image, sx, sy, sw, sh, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
    } catch {
      cropped = image;
    }
    if (destroyed || image !== backgroundSource) {
      if (cropped !== image) cropped.close();
      return;
    }
    bindTexture(0, bgTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cropped);
    if (cropped !== image) cropped.close();
    hasBackgroundImage = true;
  }

  function setBlurRadius(radius: number | null) {
    const next = radius && radius > 0 ? radius : null;
    if (next === blurRadius) return;
    blurRadius = next;
    if (width > 0) {
      buildBlurChain();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  function setBackgroundDisabled(disabled: boolean) {
    backgroundDisabled = disabled;
  }

  /** Forget the mask history (e.g. after the camera restarts) so old masks don't linger. */
  function resetHistory() {
    hasHistory = false;
    hasMask = false;
  }

  function cleanup() {
    destroyed = true;
    releaseSized();
    created.programs.forEach((p) => gl.deleteProgram(p));
    created.textures.forEach((t) => gl.deleteTexture(t));
    created.buffers.forEach((b) => gl.deleteBuffer(b));
    backgroundSource = null;
    lastUploaded = null;
  }

  /** Same contract as the library's: only for a canvas that won't be reused. */
  function releaseContext() {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  return {
    uploadFrame,
    updateMask,
    renderFrame,
    setBackgroundImage,
    setBlurRadius,
    setBackgroundDisabled,
    resetHistory,
    cleanup,
    releaseContext,
    /** For diagnostics/tests: whether the blur chain runs in half float. */
    blurIsHalfFloat: blurStorage.internalFormat === gl.RGBA16F,
  };
}
