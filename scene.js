import * as THREE from './vendor/three.module.js';

// Interactive artist-inspired material study, not a scan or a product photograph.
const canvas = document.querySelector('#rug-canvas');
const stage = document.querySelector('#stage');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const mobile = window.matchMedia('(max-width: 760px)');
const state = { ready: false, design: 'bloom', rotation: 0, renderer: null, selectDesign, reset };
window.rugeriaScene = state;
let renderer, scene, camera, rug, pile, backing, shadow, frame;
let targetAngle = -0.18, angle = -0.18, tilt = 0, targetTilt = 0;
let zoom = 1, targetZoom = 1, dragging = false, lastX = 0, lastY = 0;
let paused = reducedMotion.matches, scrollTurn = 0, lastTime = 0;
let inView = true, artworkPixels = null, artworkTexture = null;
const artworkCrop = { x: 0.10, y: 0.235, width: 0.79, height: 0.57 };
function artworkColor(x, z, target) {
  if (!artworkPixels) return false;
  const u = THREE.MathUtils.clamp(artworkCrop.x + (x / 4 + 0.5) * artworkCrop.width, 0, 0.999);
  const v = THREE.MathUtils.clamp(artworkCrop.y + (z / 4 + 0.5) * artworkCrop.height, 0, 0.999);
  const pixel = (Math.floor(v * artworkPixels.height) * artworkPixels.width + Math.floor(u * artworkPixels.width)) * 4;
  const data = artworkPixels.data;
  if (Math.hypot(x, z) > 1.14 && Math.min(data[pixel], data[pixel + 1], data[pixel + 2]) > 227) {
    target.set('#b9477e');
  } else target.setRGB(data[pixel] / 255, data[pixel + 1] / 255, data[pixel + 2] / 255, THREE.SRGBColorSpace);
  return true;
}
function loadArtwork() {
  const image = new Image();
  image.onload = () => {
    try {
      const sample = document.createElement('canvas');
      sample.width = image.naturalWidth; sample.height = image.naturalHeight;
      const context = sample.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      artworkPixels = context.getImageData(0, 0, sample.width, sample.height);
      artworkTexture = new THREE.Texture(image);
      artworkTexture.colorSpace = THREE.SRGBColorSpace;
      artworkTexture.needsUpdate = true;
      state.artworkLoaded = true;
      if (state.design === 'bloom') buildRug('bloom');
    } catch (error) { console.warn('Using procedural artwork interpretation:', error); }
  };
  image.src = './assets/instagram-6.jpg';
}
const initialAngle = -0.18;
const palettes = {
  bloom: ['#e68cb0', '#f9ebd7', '#ac284a'],
  wave: ['#294dcb', '#f5e9cf', '#182997'],
  acid: ['#c6db55', '#79548f', '#a8c142']
};
const colors = Object.fromEntries(Object.entries(palettes).map(([key, values]) => [key, values.map(c => new THREE.Color(c))]));

function fail(error) {
  state.ready = false;
  cancelAnimationFrame(frame);
  document.querySelectorAll('.webgl-fallback').forEach(el => {
    el.hidden = false;
    el.style.display = 'flex';
    el.setAttribute('aria-hidden', 'false');
  });
  if (canvas) canvas.style.visibility = 'hidden';
  console.warn('Rugeria interactive concept unavailable:', error);
}

// All geometry shares the same polar boundary, including the extruded felt edge.
function boundary(theta, design) {
  if (design === 'wave') return 1.71 * (1 + 0.045 * Math.sin(5 * theta + 0.5));
  if (design === 'acid') return 1.71 * (1 + 0.075 * Math.sin(3 * theta) + 0.055 * Math.cos(7 * theta));
  return 1.67 * (1 + 0.15 * Math.cos(12 * theta + 0.25) + 0.035 * Math.sin(3 * theta));
}
function stretch(design) { return design === 'wave' ? [1.16, 0.83] : design === 'acid' ? [1.08, 0.95] : [1, 1]; }
function colorAt(x, z, design) {
  const radius = Math.hypot(x, z), theta = Math.atan2(z, x);
  if (design === 'bloom') {
    const center = 0.45 * (1 + 0.09 * Math.cos(6 * theta));
    const creamFlower = 0.96 * (1 + 0.22 * Math.cos(6 * theta + 0.25));
    return radius < center ? 2 : radius < creamFlower ? 1 : 0;
  }
  if (design === 'wave') {
    const wave = x * 3.5 + Math.sin(z * 3.4) * 1.2 + 0.35 * Math.sin(z * 6.1);
    return Math.sin(wave) > -0.04 ? 0 : 1;
  }
  return (Math.floor((x + 2.3 + 0.065 * Math.sin(z * 5)) / 0.49) + Math.floor((z + 2.3) / 0.49)) % 2 === 0 ? 0 : 1;
}
function randomGenerator(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

function buildRug(design) {
  const random = randomGenerator(27941);
  if (pile) { rug.remove(pile); pile.geometry.dispose(); pile.material.dispose(); }
  if (backing) { rug.remove(backing); backing.geometry.dispose(); backing.material.dispose(); }
  const [sx, sz] = stretch(design);
  const shape = new THREE.Shape();
  for (let i = 0; i <= 256; i++) {
    const t = i / 256 * Math.PI * 2;
    const r = boundary(t, design);
    const x = Math.cos(t) * r * sx, y = Math.sin(t) * r * sz;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  const baseGeometry = new THREE.ExtrudeGeometry(shape, { depth: 0.075, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.024, bevelThickness: 0.022, curveSegments: 64 });
  baseGeometry.rotateX(-Math.PI / 2);
  if (design === 'bloom' && artworkTexture) {
    const positions = baseGeometry.attributes.position;
    const uv = baseGeometry.attributes.uv;
    for (let i = 0; i < positions.count; i++) {
      uv.setXY(i, artworkCrop.x + (positions.getX(i) / sx / 4 + 0.5) * artworkCrop.width, 1 - (artworkCrop.y + (positions.getZ(i) / sz / 4 + 0.5) * artworkCrop.height));
    }
    uv.needsUpdate = true;
  }
  backing = new THREE.Mesh(baseGeometry, new THREE.MeshStandardMaterial({ color: design === 'bloom' && artworkTexture ? '#ffffff' : colors[design][0], map: design === 'bloom' ? artworkTexture : null, roughness: 1 }));
  backing.position.y = 0.038;
  backing.castShadow = true;
  backing.receiveShadow = true;
  rug.add(backing);

  const count = mobile.matches ? 10000 : 22000;
  const strand = new THREE.CylinderGeometry(0.009, 0.016, 1, 5, 1);
  strand.translate(0, 0.5, 0);
  pile = new THREE.InstancedMesh(strand, new THREE.MeshStandardMaterial({ roughness: 0.98, metalness: 0, color: '#ffffff' }), count);
  const dummy = new THREE.Object3D(), tint = new THREE.Color();
  let index = 0;
  while (index < count) {
    const x = (random() * 2 - 1) * 2.15;
    const z = (random() * 2 - 1) * 2.15;
    const r = Math.hypot(x, z), theta = Math.atan2(z, x);
    if (r > boundary(theta, design) - 0.015) continue;
    const region = colorAt(x, z, design);
    const height = (0.068 + random() * 0.085) * (design === 'bloom' && region === 2 ? 1.12 : 1);
    dummy.position.set(x * sx, 0.115, z * sz);
    dummy.rotation.set((random() - 0.5) * 0.48 + 0.12, random() * Math.PI, (random() - 0.5) * 0.48);
    dummy.scale.set(0.72 + random() * 0.65, height, 0.72 + random() * 0.65);
    dummy.updateMatrix();
    pile.setMatrixAt(index, dummy.matrix);
    if (design !== 'bloom' || !artworkColor(x, z, tint)) tint.copy(colors[design][region]);
    tint.multiplyScalar(0.79 + random() * 0.34);
    pile.setColorAt(index, tint);
    index++;
  }
  pile.instanceMatrix.needsUpdate = true;
  pile.instanceColor.needsUpdate = true;
  pile.castShadow = false; // 22,000 real strands; the solid backing casts the contact silhouette.
  pile.receiveShadow = true;
  pile.computeBoundingSphere();
  rug.add(pile);
  state.fiberCount = count;
}

function selectDesign(design) {
  if (!palettes[design]) return false;
  state.design = design;
  if (rug) buildRug(design);
  document.querySelectorAll('[data-design]').forEach(button => {
    const selected = button.dataset.design === design;
    button.setAttribute('aria-pressed', String(selected));
    button.classList.toggle('is-active', selected);
    button.classList.toggle('active', selected);
  });
  if (canvas) canvas.setAttribute('aria-label', `${design === 'bloom' ? 'Eye bloom, pink twelve-petal artist-inspired' : design === 'wave' ? 'Cobalt and cream wavy oval' : 'Chartreuse and purple checker'} rug. Approximate 3D interpretation, not an exact product. Drag to rotate or use arrow keys.`);
  window.dispatchEvent(new CustomEvent('rugeria:design', { detail: { design } }));
  return true;
}
function syncMotion() {
  const button = document.querySelector('#motion-toggle');
  if (button) {
    button.setAttribute('aria-pressed', String(paused));
    button.setAttribute('aria-label', paused ? 'Resume rug rotation' : 'Pause rug rotation');
    button.dataset.paused = String(paused);
    button.classList.toggle('is-paused', paused);
  }
}
function reset() {
  targetAngle = angle = initialAngle;
  targetTilt = tilt = 0;
  targetZoom = zoom = 1;
  scrollTurn = 0;
  if (rug) rug.rotation.set(0, initialAngle, 0);
  state.rotation = initialAngle;
  resize();
}
function resize() {
  if (!renderer || !stage || !camera) return;
  const width = Math.max(1, stage.clientWidth), height = Math.max(1, stage.clientHeight);
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile.matches ? 1.5 : 2));
  const aspect = width / height;
  const span = mobile.matches ? Math.max(5.15, 4.9 / aspect) : Math.max(5.3, 6.8 / aspect);
  camera.left = -span * aspect / 2;
  camera.right = span * aspect / 2;
  camera.top = span / 2;
  camera.bottom = -span / 2;
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
  rug.position.x = mobile.matches ? 0 : Math.min(1.12, span * aspect * 0.115);
  shadow.position.x = rug.position.x;
}
function animate(time) {
  frame = requestAnimationFrame(animate);
  if (document.hidden || !inView || !state.ready) { lastTime = time; return; }
  const dt = Math.min((time - (lastTime || time)) / 1000, 0.05);
  lastTime = time;
  if (!paused && !dragging && !reducedMotion.matches) targetAngle += dt * 0.045;
  const smoothing = reducedMotion.matches ? 1 : 1 - Math.exp(-dt * 9);
  angle += (targetAngle - angle) * smoothing;
  tilt += (targetTilt - tilt) * smoothing;
  zoom += (targetZoom - zoom) * smoothing;
  rug.rotation.y = angle + scrollTurn;
  rug.rotation.x = tilt;
  state.rotation = rug.rotation.y;
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
  try { renderer.render(scene, camera); } catch (error) { fail(error); }
}

function init() {
  if (!canvas || !stage) throw new Error('Missing #rug-canvas or #stage');
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  state.renderer = renderer;
  renderer.setClearColor(0xf6f0e7, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.23;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-4, 4, 3, -3, 0.1, 50);
  camera.position.set(0, 7.8, 5.2);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xfff5eb, 0xbba3ac, 2.2));
  const key = new THREE.DirectionalLight(0xffeddb, 3.3);
  key.position.set(-3, 7, 4);
  key.castShadow = true;
  const shadowResolution = mobile.matches ? 1024 : 2048;
  key.shadow.mapSize.set(shadowResolution, shadowResolution);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 20 });
  key.shadow.normalBias = 0.025;
  key.shadow.bias = -0.0001;
  key.shadow.radius = 4;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xe4e8ff, 0.8);
  fill.position.set(4, 3, -2);
  scene.add(fill);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ color: 0x583b42, opacity: 0.19 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.025;
  floor.receiveShadow = true;
  scene.add(floor);
  // Broad, soft contact shadow keeps the pile grounded even on low-end GPUs.
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 128;
  const ctx = shadowCanvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 12, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(76,43,48,.24)');
  gradient.addColorStop(0.65, 'rgba(76,43,48,.12)');
  gradient.addColorStop(1, 'rgba(76,43,48,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(shadowCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  shadow = new THREE.Mesh(new THREE.PlaneGeometry(4.7, 4.7), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.018;
  scene.add(shadow);
  rug = new THREE.Group();
  scene.add(rug);
  selectDesign('bloom');
  canvas.tabIndex = 0;
  canvas.style.touchAction = 'pan-y';
  canvas.style.cursor = 'grab';
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    dragging = true; lastX = event.clientX; lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grabbing';
    canvas.focus({ preventScroll: true });
  });
  canvas.addEventListener('pointermove', event => {
    if (!dragging) return;
    targetAngle += (event.clientX - lastX) * 0.008;
    if (event.pointerType !== 'touch') targetTilt = THREE.MathUtils.clamp(targetTilt + (event.clientY - lastY) * 0.002, -0.2, 0.28);
    lastX = event.clientX; lastY = event.clientY;
  });
  const release = () => { dragging = false; canvas.style.cursor = 'grab'; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);
  canvas.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'ArrowLeft') targetAngle -= 0.15;
    if (event.key === 'ArrowRight') targetAngle += 0.15;
    if (event.key === 'ArrowUp') targetTilt = Math.max(-0.2, targetTilt - 0.045);
    if (event.key === 'ArrowDown') targetTilt = Math.min(0.28, targetTilt + 0.045);
    if (event.key === 'Home') reset();
  });
  document.querySelectorAll('[data-design]').forEach(button => button.addEventListener('click', () => selectDesign(button.dataset.design)));
  document.querySelector('#motion-toggle')?.addEventListener('click', () => { paused = !paused; syncMotion(); });
  document.querySelector('#zoom-in')?.addEventListener('click', () => { targetZoom = Math.min(1.4, targetZoom + 0.12); });
  document.querySelector('#zoom-out')?.addEventListener('click', () => { targetZoom = Math.max(0.7, targetZoom - 0.12); });
  document.querySelector('#reset-view')?.addEventListener('click', reset);
  reducedMotion.addEventListener('change', () => { paused = reducedMotion.matches; scrollTurn = 0; syncMotion(); });
  mobile.addEventListener('change', () => { buildRug(state.design); resize(); });
  window.addEventListener('scroll', () => { if (!reducedMotion.matches && !paused) scrollTurn = Math.min(window.scrollY / 6000, 0.22); }, { passive: true });
  new ResizeObserver(resize).observe(stage);
  new IntersectionObserver(entries => { inView = entries[0].isIntersecting; }, { rootMargin: '80px' }).observe(stage);
  window.addEventListener('resize', resize, { passive: true });
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); fail('WebGL context lost'); });
  canvas.addEventListener('webglcontextrestored', () => window.location.reload());
  syncMotion();
  resize();
  renderer.render(scene, camera);
  state.ready = true;
  loadArtwork();
  window.dispatchEvent(new CustomEvent('rugeria:ready'));
  frame = requestAnimationFrame(animate);
}
try { init(); } catch (error) { fail(error); }
