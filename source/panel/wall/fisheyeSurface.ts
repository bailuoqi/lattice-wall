import type { Camera, Tile, WallVisualOptions } from '../types.ts';
import { FISHEYE_BOUNDS_SCALE } from './fisheye.ts';
import { fallbackGradient, type PosterElement } from './poster.ts';
import { coverEase, sampleCoverMotion } from './coverMotion.ts';
import { HUD_ART_PARALLAX, HUD_ART_OVERSCAN, type DepthPose } from './depthScene.ts';

export type SurfaceCard = { el: PosterElement; tile: Tile | undefined; current: boolean };

const VERTEX = `
attribute vec2 aPosition;
attribute vec2 aUv;
varying vec2 vUv;
void main() { vUv = aUv; gl_Position = vec4(aPosition, 0.0, 1.0); }
`;
const COVER = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uImage;
uniform float uHasImage;
uniform vec2 uCrop;
uniform vec3 uFirst;
uniform vec3 uSecond;
uniform vec3 uShadeColor;
uniform vec4 uPaint;
uniform float uOpacity;
uniform float uBlackOpacity;
uniform float uGradient;
uniform vec3 uMotion;
uniform vec3 uBackground;
uniform vec3 uDepth;
uniform vec3 uAlbumBackground;
uniform float uAlbumScrim;
void main() {
  vec2 bodyUv = (vUv - vec2(0.0, uMotion.x) - 0.5) / uMotion.yz + 0.5;
  vec2 artUv = (bodyUv - 0.5) / uDepth.z + 0.5 + uDepth.xy;
  vec3 color = mix(uFirst, uSecond, (artUv.x + artUv.y) * 0.5);
  if (uHasImage > 0.5) {
    vec4 image = texture2D(uImage, (artUv - 0.5) * uCrop + 0.5);
    color = mix(color, image.rgb, image.a);
  }
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luminance), color, 1.0 + (uPaint.w - 1.0) * 0.7) * uPaint.w;
  float vertical = clamp((bodyUv.y - 0.38) / 0.62, 0.0, 1.0);
  float tint = uPaint.x;
  if (uGradient > 0.5) tint = 1.0 - (1.0 - tint) * (1.0 - uPaint.x * 0.74 * vertical);
  if (uGradient > 1.5) tint = 1.0 - (1.0 - tint) * (1.0 - uPaint.x * 0.46 * clamp(1.0 - bodyUv.x / 0.4, 0.0, 1.0));
  color = mix(color, uShadeColor, tint);
  float down = bodyUv.y < 0.56 ? 0.48 * clamp((bodyUv.y - 0.14) / 0.42, 0.0, 1.0)
    : mix(0.48, 0.94, (bodyUv.y - 0.56) / 0.44);
  float side = 0.76 * clamp(1.0 - bodyUv.x / 0.58, 0.0, 1.0);
  float corner = 0.58 * clamp(1.0 - length(vec2(bodyUv.x / 0.85, (bodyUv.y - 1.0) / 0.75)) / 0.72, 0.0, 1.0);
  float scrim = 1.0 - (1.0 - down) * (1.0 - side) * (1.0 - corner);
  color = mix(color, uShadeColor, scrim * uPaint.z);
  float inside = step(0.0, bodyUv.x) * step(bodyUv.x, 1.0) * step(0.0, bodyUv.y) * step(bodyUv.y, 1.0);
  color = mix(uBackground, color * (1.0 - uPaint.y), inside);
  // The album list backdrop belongs to the whole card, independently of cover hover/entrance UVs.
  float albumGradient = vUv.y < 0.2 ? 0.72 * vUv.y / 0.2 : mix(0.72, 0.82, (vUv.y - 0.2) / 0.8);
  color = mix(color, uAlbumBackground, albumGradient * uAlbumScrim);
  gl_FragColor = vec4(color * (1.0 - uBlackOpacity), uOpacity);
}
`;
const LENS = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uImage;
uniform float uBounds;
uniform float uStrength;
uniform float uNormalization;
void main() {
  vec2 point = vUv * 2.0 - 1.0;
  float radius = length(point);
  float factor = 1.0;
  if (radius > 0.00001 && uStrength > 0.00001) {
    float value = radius * uNormalization;
    factor = (exp(value) - exp(-value)) / (2.0 * uStrength * radius);
  }
  gl_FragColor = texture2D(uImage, (point * factor / uBounds + 1.0) * 0.5);
}
`;

function palette(id: string): [number[], number[]] {
  const values = [...fallbackGradient(id).matchAll(/hsl\((\d+) (\d+)% (\d+)%\)/g)];
  const rgb = (match: RegExpMatchArray): number[] => {
    const hue = Number(match[1]) / 30, saturation = Number(match[2]) / 100, light = Number(match[3]) / 100;
    const amplitude = saturation * Math.min(light, 1 - light);
    return [0, 8, 4].map(offset => light - amplitude * Math.max(-1, Math.min((offset + hue) % 12 - 3, 9 - (offset + hue) % 12, 1)));
  };
  return [rgb(values[0]!), rgb(values[1]!)];
}

/** Paint one flat wall, then sample it through one continuous lens. Card edges share the same warp. */
export function createFisheyeSurface(field: HTMLElement, requestFrame: () => void) {
  const canvas = document.createElement('canvas');
  canvas.className = 'fisheye-surface';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.hidden = true;
  const context = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
  if (!context) return null;
  const gl: WebGLRenderingContext = context;
  const compile = (type: number, source: string): WebGLShader => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'lens shader');
    return shader;
  };
  const program = (fragment: string) => {
    const value = gl.createProgram()!;
    const vertex = compile(gl.VERTEX_SHADER, VERTEX), pixel = compile(gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(value, vertex); gl.attachShader(value, pixel); gl.linkProgram(value);
    gl.deleteShader(vertex); gl.deleteShader(pixel);
    if (!gl.getProgramParameter(value, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(value) ?? 'lens program');
    return value;
  };
  let cover: WebGLProgram, lens: WebGLProgram;
  try { cover = program(COVER); lens = program(LENS); } catch { return null; }
  const buffer = gl.createBuffer()!;
  const attributes = new Map([cover, lens].map(value => [value, {
    position: gl.getAttribLocation(value, 'aPosition'), uv: gl.getAttribLocation(value, 'aUv'),
  }]));
  const uniforms = (value: WebGLProgram, names: string[]) => Object.fromEntries(names.map(name => [name, gl.getUniformLocation(value, name)!]));
  const c = uniforms(cover, ['uImage', 'uHasImage', 'uCrop', 'uFirst', 'uSecond', 'uShadeColor', 'uPaint', 'uOpacity', 'uBlackOpacity', 'uGradient', 'uMotion', 'uBackground', 'uDepth', 'uAlbumBackground', 'uAlbumScrim']);
  const l = uniforms(lens, ['uImage', 'uBounds', 'uStrength', 'uNormalization']);
  type Texture = { value: WebGLTexture | null; image: HTMLImageElement; waiting: boolean; failed: boolean };
  const textures = new Map<string, Texture>();
  const paints = new Map<HTMLElement, { value: number[]; alpha: number; blackOpacity: number; albumScrim: number;
    zoom: number; zoomFrom: number; zoomTarget: number; zoomStart: number }>();
  const colors = new Map<string, [number[], number[]]>();
  let target: WebGLTexture | null = null, framebuffer: WebGLFramebuffer | null = null;
  let targetWidth = 0, targetHeight = 0, disposed = false, dirty = true, lost = false, restored = false;
  const limit = Math.min(Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)), Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)));
  const configureTexture = () => {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  const empty = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, empty); configureTexture();
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  const release = () => {
    for (const texture of textures.values()) if (texture.value) gl.deleteTexture(texture.value);
    textures.clear(); paints.clear(); colors.clear();
    if (target) gl.deleteTexture(target);
    if (framebuffer) gl.deleteFramebuffer(framebuffer);
    target = null; framebuffer = null; targetWidth = targetHeight = 0;
  };
  const wake = () => { if (!disposed) { dirty = true; requestFrame(); } };
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); lost = true; canvas.hidden = true; wake(); });
  canvas.addEventListener('webglcontextrestored', () => { restored = true; wake(); });
  field.prepend(canvas);

  function imageTexture(image: HTMLImageElement): WebGLTexture | null {
    if (!image.src || image.hidden) return null;
    let cached = textures.get(image.src);
    if (!cached) { cached = { value: null, image, waiting: false, failed: false }; textures.set(image.src, cached); }
    if (cached.failed) return null;
    if (cached.value) return cached.value;
    if (!image.complete || image.naturalWidth === 0) {
      if (!cached.waiting) { cached.waiting = true; void image.decode().then(wake, wake); }
      return null;
    }
    cached.value = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, cached.value); configureTexture();
    try {
      let source: TexImageSource = image;
      // The development fixture uses viewBox-only SVGs; give them an explicit raster size.
      if (image.src.startsWith('data:image/svg+xml')) {
        const raster = document.createElement('canvas');
        raster.width = Math.max(512, image.naturalWidth);
        raster.height = Math.max(1, Math.round(raster.width * image.naturalHeight / image.naturalWidth));
        raster.getContext('2d')!.drawImage(image, 0, 0, raster.width, raster.height);
        source = raster;
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    }
    catch { gl.deleteTexture(cached.value); cached.value = null; cached.failed = true; }
    return cached.value;
  }

  function quad(value: WebGLProgram, x0: number, y0: number, x1: number, y1: number, flipUv = false): void {
    const top = flipUv ? 1 : 0, bottom = flipUv ? 0 : 1;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([x0, y0, 0, top, x1, y0, 1, top, x0, y1, 0, bottom, x1, y1, 1, bottom]), gl.STREAM_DRAW);
    const { position, uv } = attributes.get(value)!;
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(uv); gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  return {
    canvas,
    get needsReplacement() { return restored; },
    hide() { canvas.hidden = true; release(); dirty = true; },
    render(camera: Camera, cards: SurfaceCard[], visuals: WallVisualOptions, dt: number, changed: boolean, nowMs: number, depth: DepthPose, entering = false): { ready: boolean; moving: boolean } {
      if (disposed || lost) return { ready: false, moving: false };
      let moving = false;
      let paintChanged = false;
      const hasExpanded = cards.some(card => card.el.root.dataset.expanded === 'true');
      const daytime = field.ownerDocument.body.dataset.lighting === 'daytime';
      const keep = new Set<HTMLElement>();
      for (const card of cards) {
        const root = card.el.root, open = root.dataset.expanded === 'true', hover = root.dataset.lensHover === 'true';
        keep.add(root);
        const idle = !open && !card.current && !hover;
        const targetZoom = !visuals.reducedMotion && !open && !root.classList.contains('poster--enter')
          && (hover || root.dataset.focused === 'true') ? 1 : 0;
        const targetPaint = [visuals.tint && idle ? Math.min(.85, visuals.tintIntensity) : 0,
          daytime ? 0 : hasExpanded ? (open ? 0 : visuals.lightsOut ? .8 : .34) : visuals.lightsOut && idle ? .72 : 0,
          open ? 1 : 0, open ? 1.18 : hover ? 1.16 : 1];
        let state = paints.get(root);
        if (!state) {
          state = { value: [...targetPaint], alpha: 1, blackOpacity: 0, albumScrim: 0, zoom: targetZoom,
            zoomFrom: targetZoom, zoomTarget: targetZoom, zoomStart: nowMs };
          paints.set(root, state);
          paintChanged = true;
        }
        const content = card.el.expanded?.root;
        // Read the existing CSS fade so opening, closing, switching to lyrics and reduced motion
        // share one timeline. Hiding the native pseudo-element leaves its opacity animation intact.
        const albumScrim = content?.classList.contains('poster__expanded--album')
          ? Number.parseFloat(getComputedStyle(content, '::before').opacity) * Number.parseFloat(getComputedStyle(content).opacity) : 0;
        if (state.albumScrim !== albumScrim) paintChanged = true;
        state.albumScrim = albumScrim;
        const motion = sampleCoverMotion(card.el.coverMotion, nowMs, visuals.reducedMotion);
        if (state.alpha !== motion.opacity || state.blackOpacity !== motion.blackOpacity) paintChanged = true;
        state.alpha = motion.opacity; state.blackOpacity = motion.blackOpacity;
        if (motion.running) moving = true;
        else card.el.coverMotion = null;
        if (state.zoomTarget !== targetZoom) {
          state.zoomFrom = state.zoom; state.zoomTarget = targetZoom; state.zoomStart = nowMs;
        }
        const zoomProgress = visuals.reducedMotion ? 1 : Math.min(1, Math.max(0, (nowMs - state.zoomStart) / 280));
        const zoom = state.zoomFrom === state.zoomTarget ? state.zoomTarget
          : state.zoomFrom + (state.zoomTarget - state.zoomFrom) * coverEase(zoomProgress);
        if (zoom !== state.zoom) paintChanged = true;
        state.zoom = zoom;
        if (zoomProgress < 1 && state.zoomFrom !== state.zoomTarget) moving = true;
        const blend = visuals.reducedMotion ? 1 : 1 - Math.exp(-dt * 18);
        for (let i = 0; i < 4; i++) {
          const before = state.value[i]!;
          state.value[i]! += (targetPaint[i]! - state.value[i]!) * blend;
          if (Math.abs(state.value[i]! - targetPaint[i]!) > .001) moving = true;
          else state.value[i] = targetPaint[i]!;
          if (before !== state.value[i]) paintChanged = true;
        }
      }
      for (const root of paints.keys()) if (!keep.has(root)) paints.delete(root);
      if (!dirty && !changed && !paintChanged && !moving && !canvas.hidden) return { ready: true, moving: false };
      dirty = false;
      const boundsScale = FISHEYE_BOUNDS_SCALE;
      const ratio = Math.min(globalThis.devicePixelRatio || 1, 1.5, limit / (camera.viewport.width * boundsScale), limit / (camera.viewport.height * boundsScale));
      const width = Math.max(1, Math.round(camera.viewport.width * ratio)), height = Math.max(1, Math.round(camera.viewport.height * ratio));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      const fw = Math.min(limit, Math.ceil(width * boundsScale)), fh = Math.min(limit, Math.ceil(height * boundsScale));
      if (targetWidth !== fw || targetHeight !== fh) {
        if (target) gl.deleteTexture(target);
        if (framebuffer) gl.deleteFramebuffer(framebuffer);
        target = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, target); configureTexture();
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        framebuffer = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return { ready: false, moving: false };
        targetWidth = fw; targetHeight = fh;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.viewport(0, 0, fw, fh);
      gl.clearColor(0, 0, 0, entering ? 0 : 1); gl.clear(gl.COLOR_BUFFER_BIT);
      // Keep coverage separate so the lens preserves transparent holes between arriving tiles.
      gl.useProgram(cover); gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.activeTexture(gl.TEXTURE0); gl.uniform1i(c.uImage!, 0);
      const depthScale = 1 + depth.amount * HUD_ART_OVERSCAN;
      gl.uniform3f(c.uDepth!, depth.x * depth.amount * HUD_ART_PARALLAX / depthScale, depth.y * depth.amount * HUD_ART_PARALLAX / depthScale, depthScale);
      const tint = visuals.tintColor.replace('#', '');
      gl.uniform3f(c.uShadeColor!, parseInt(tint.slice(0, 2), 16) / 255, parseInt(tint.slice(2, 4), 16) / 255, parseInt(tint.slice(4, 6), 16) / 255);
      gl.uniform1f(c.uGradient!, visuals.tintGradient === 'diagonal' ? 2 : visuals.tintGradient === 'vertical' ? 1 : 0);
      const background = field.ownerDocument.documentElement.style.getPropertyValue('--host-panel').trim();
      const panel = /^#[0-9a-f]{6}$/i.test(background) ? background.slice(1) : '171a22';
      gl.uniform3f(c.uBackground!, parseInt(panel.slice(0, 2), 16) / 255, parseInt(panel.slice(2, 4), 16) / 255, parseInt(panel.slice(4, 6), 16) / 255);
      const wallBackground = getComputedStyle(field).getPropertyValue('--wall-background').trim();
      const albumBackground = /^#[0-9a-f]{6}$/i.test(wallBackground) ? wallBackground.slice(1) : '000000';
      gl.uniform3f(c.uAlbumBackground!, parseInt(albumBackground.slice(0, 2), 16) / 255,
        parseInt(albumBackground.slice(2, 4), 16) / 255, parseInt(albumBackground.slice(4, 6), 16) / 255);
      const used = new Set<string>();
      const ordered = cards.filter(card => card.el.root.dataset.expanded !== 'true').concat(cards.filter(card => card.el.root.dataset.expanded === 'true'));
      for (const card of ordered) {
        const rect = card.el.rect, image = card.el.cover;
        const texture = imageTexture(image);
        if (image.src) used.add(image.src);
        // Always bind a complete texture, including fallback-only cards.
        gl.bindTexture(gl.TEXTURE_2D, texture ?? empty);
        gl.uniform1f(c.uHasImage!, texture ? 1 : 0);
        const aspect = image.naturalWidth / Math.max(1, image.naturalHeight);
        const square = card.el.root.dataset.squareCover === 'true';
        const boxAspect = square ? 1 : rect.w / rect.h;
        let cropX = aspect > boxAspect ? boxAspect / aspect : 1, cropY = aspect < boxAspect ? aspect / boxAspect : 1;
        if (square) { const side = Math.max(rect.w, rect.h); cropX *= rect.w / side; cropY *= rect.h / side; }
        gl.uniform2f(c.uCrop!, cropX, cropY);
        const id = card.tile?.trackId ?? '';
        let colorsForCard = colors.get(id);
        if (!colorsForCard) { colorsForCard = palette(id); colors.set(id, colorsForCard); }
        gl.uniform3fv(c.uFirst!, colorsForCard[0]); gl.uniform3fv(c.uSecond!, colorsForCard[1]);
        const paint = paints.get(card.el.root)!;
        gl.uniform4fv(c.uPaint!, paint.value); gl.uniform1f(c.uOpacity!, paint.alpha);
        gl.uniform1f(c.uBlackOpacity!, paint.blackOpacity);
        gl.uniform1f(c.uAlbumScrim!, paint.albumScrim);
        const zoomGap = Math.max(0, card.el.shown.hoverGap) * paint.zoom;
        gl.uniform3f(c.uMotion!, 0, 1 + zoomGap / Math.max(1, rect.w), 1 + zoomGap / Math.max(1, rect.h));
        const x = (rect.x - camera.state.x) * camera.state.scale / (camera.viewport.width / 2 * boundsScale);
        const y = -(rect.y - camera.state.y) * camera.state.scale / (camera.viewport.height / 2 * boundsScale);
        quad(cover, x, y, x + rect.w * camera.state.scale / (camera.viewport.width / 2 * boundsScale), y - rect.h * camera.state.scale / (camera.viewport.height / 2 * boundsScale));
      }
      for (const [key, texture] of textures) if (!used.has(key)) { if (texture.value) gl.deleteTexture(texture.value); textures.delete(key); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, width, height); gl.disable(gl.BLEND);
      gl.useProgram(lens); gl.bindTexture(gl.TEXTURE_2D, target); gl.uniform1i(l.uImage!, 0);
      gl.uniform1f(l.uBounds!, boundsScale);
      const strength = 2 * camera.fisheyeAmount;
      gl.uniform1f(l.uStrength!, strength); gl.uniform1f(l.uNormalization!, Math.asinh(strength));
      quad(lens, -1, 1, 1, -1, true);
      canvas.hidden = false;
      return { ready: true, moving };
    },
    dispose() { disposed = true; release(); gl.deleteTexture(empty); gl.deleteBuffer(buffer); gl.deleteProgram(cover); gl.deleteProgram(lens); canvas.remove(); },
  };
}
