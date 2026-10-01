import * as THREE from './vendor/three.module.js';
import { createYarnGeometry, animateYarnMaterial } from './yarn.js';
import { applyScrollPose } from './scene-path.js';
import { createUnderlay } from './backing.js';

// Interactive artist-inspired material study, not a scan or a product photograph.
const canvas = document.querySelector('#rug-canvas');
const stage = document.querySelector('#stage');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const mobile = window.matchMedia('(max-width: 760px)');
const state = { ready: false, design: 'bloom', rotation: 0, renderer: null, selectDesign, reset };
window.rugeriaScene = state;
let renderer, scene, camera, rug, pile, backing, underlay, shadow, frame;
const yarnUniforms = { uAssembly: {value: 0}, uGrowth: {value: 0.45}, uCarve: {value: 0} };
let targetAngle = -0.18, angle = -0.18, tilt = 0, targetTilt = 0;
let zoom = 1, targetZoom = 1, dragging = false, lastX = 0, lastY = 0;
let paused = reducedMotion.matches, scrollTurn = 0, lastTime = 0;
let inView = true, artworkPixels = null, artworkTexture = null;
let scrollProgress = 0, scrollTarget = 0, baseRugX = 0;
let lastDraw = {p:-1,angle:0,tilt:0,zoom:0};
const story = document.querySelector('#rug-story');
const scrollPhase = document.querySelector('#scroll-phase');
const scrollTrack = document.querySelector('.scroll-track span');
const tactileTag = document.querySelector('.tactile-tag');
const stageWord = document.querySelector('.stage-word');
function updateScrollTarget() {
  if (!story || reducedMotion.matches) { scrollTarget = 0; return; }
  const rect = story.getBoundingClientRect();
  const pin = story.querySelector('.rug-pin');
  const distance = Math.max(1, story.offsetHeight - pin.offsetHeight);
  if (!paused) scrollTarget = THREE.MathUtils.clamp(-rect.top / distance, 0, 1);
}
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
  if (underlay) { rug.remove(underlay); underlay.geometry.dispose(); underlay.material.map?.dispose(); underlay.material.dispose(); }
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
  underlay = createUnderlay(shape);
  rug.add(underlay);

  const count = mobile.matches ? 8000 : 18000;
  const strand = createYarnGeometry(mobile.matches);
  const material = new THREE.MeshPhysicalMaterial({ roughness: 0.92, metalness: 0, color: '#ffffff', sheen: 0.55, sheenRoughness: 0.9, sheenColor: '#ede1d9' });
  animateYarnMaterial(material, yarnUniforms);
  pile = new THREE.InstancedMesh(strand, material, count);
  pile.frustumCulled = false;
  const scatters = new Float32Array(count * 3);
  const delays = new Float32Array(count);
  const edges = new Float32Array(count);
  const dummy = new THREE.Object3D(), tint = new THREE.Color();
  let index = 0;
  while (index < count) {
    const x = (random() * 2 - 1) * 2.15;
    const z = (random() * 2 - 1) * 2.15;
    const r = Math.hypot(x, z), theta = Math.atan2(z, x);
    if (r > boundary(theta, design) - 0.015) continue;
    const region = colorAt(x, z, design);
    const height = (0.044 + random() * 0.040) * (design === 'bloom' && region === 2 ? 1.12 : 1);
    dummy.position.set(x * sx, 0.139, z * sz);
    dummy.rotation.set((random() - 0.5) * 0.48 + 0.12, random() * Math.PI, (random() - 0.5) * 0.48);
    dummy.scale.set(0.72 + random() * 0.65, height, 0.72 + random() * 0.65);
    dummy.updateMatrix();
    pile.setMatrixAt(index, dummy.matrix);
    scatters[index*3] = (random()-0.5)*10;
    scatters[index*3+1] = 0.5 + random()*5;
    scatters[index*3+2] = (random()-0.5)*9;
    delays[index] = Math.min(0.54, r/2 * 0.38 + random()*0.13);
    edges[index] = [colorAt(x+0.04,z,design),colorAt(x-0.04,z,design),colorAt(x,z+0.04,design),colorAt(x,z-0.04,design)].some(c=>c!==region) ? 1 : 0;
    if (design !== 'bloom' || !artworkColor(x, z, tint)) tint.copy(colors[design][region]);
    tint.multiplyScalar(0.92 + random() * 0.14);
    pile.setColorAt(index, tint);
    index++;
  }
  strand.setAttribute('aScatter', new THREE.InstancedBufferAttribute(scatters, 3));
  strand.setAttribute('aDelay', new THREE.InstancedBufferAttribute(delays, 1));
  strand.setAttribute('aCarve', new THREE.InstancedBufferAttribute(edges, 1));
  pile.instanceMatrix.needsUpdate = true;
  pile.instanceColor.needsUpdate = true;
  pile.castShadow = false; // 22,000 real strands; the solid backing casts the contact silhouette.
  pile.receiveShadow = true;
  pile.computeBoundingSphere();
  rug.add(pile);
  state.fiberCount = count * (mobile.matches ? 3 : 4);
  state.tuftCount = count;
  state.needsRender = true;
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
    button.setAttribute('aria-label', paused ? 'Nadaljuj vrtenje preproge' : 'Ustavi vrtenje preproge');
    button.textContent = paused ? '▷' : 'Ⅱ';
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
  camera.aspect = aspect;
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
  baseRugX = 0;
  state.needsRender = true;
  updateScrollTarget();
}
function animate(time) {
  frame = requestAnimationFrame(animate);
  if (document.hidden || !inView || !state.ready) { lastTime = time; return; }
  const dt = Math.min((time - (lastTime || time)) / 1000, 0.05);
  lastTime = time;
  // Scroll, not an idle timer, drives the cinematic sequence.
  const smoothing = reducedMotion.matches ? 1 : 1 - Math.exp(-dt * 9);
  angle += (targetAngle - angle) * smoothing;
  tilt += (targetTilt - tilt) * smoothing;
  zoom += (targetZoom - zoom) * smoothing;
  scrollProgress += (scrollTarget - scrollProgress) * smoothing;
  if (reducedMotion.matches) scrollProgress = 0;
  const p = reducedMotion.matches ? 1 : scrollProgress;
  if (!state.needsRender && Math.abs(p-lastDraw.p)<0.00008 && Math.abs(angle-lastDraw.angle)<0.00008 && Math.abs(tilt-lastDraw.tilt)<0.00008 && Math.abs(zoom-lastDraw.zoom)<0.00008) return;
  lastDraw = {p,angle,tilt,zoom};
  state.needsRender = false;
  const pose = applyScrollPose(p, camera, rug, mobile.matches, angle, tilt, zoom);
  yarnUniforms.uAssembly.value = reducedMotion.matches ? 1 : THREE.MathUtils.smoothstep(p, 0, 0.24);
  yarnUniforms.uGrowth.value = 0.38 + 0.62 * THREE.MathUtils.smoothstep(p, 0.13, 0.38);
  yarnUniforms.uCarve.value = THREE.MathUtils.smoothstep(p, 0.42, 0.56);
  backing.visible = p > 0.16;
  underlay.visible = p > 0.18;
  shadow.position.x = 0;
  shadow.scale.setScalar(1 + pose.lift * 0.14);
  shadow.material.opacity = THREE.MathUtils.smoothstep(p, 0.14, 0.25) * Math.max(0, 1-pose.lift*0.38);
  state.rotation = rug.rotation.y;
  state.scrollScene = {progress: scrollProgress, ...pose, zoom: camera.zoom, assembly: yarnUniforms.uAssembly.value, growth: yarnUniforms.uGrowth.value, carve: yarnUniforms.uCarve.value};
  if (scrollTrack) scrollTrack.style.transform = `scaleX(${scrollProgress})`;
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
  camera = new THREE.PerspectiveCamera(38, stage.clientWidth / stage.clientHeight, 0.04, 90);
  camera.position.set(0, 7.8, 5.2);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xfff5eb, 0xbba3ac, 1.6));
  const key = new THREE.DirectionalLight(0xffeddb, 2.3);
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
  document.querySelector('#motion-toggle')?.addEventListener('click', () => { paused = !paused; if (paused) { scrollTarget = scrollProgress; targetAngle = angle; } syncMotion(); updateScrollTarget(); });
  document.querySelector('#zoom-in')?.addEventListener('click', () => { targetZoom = Math.min(1.4, targetZoom + 0.12); });
  document.querySelector('#zoom-out')?.addEventListener('click', () => { targetZoom = Math.max(0.7, targetZoom - 0.12); });
  document.querySelector('#reset-view')?.addEventListener('click', reset);
  reducedMotion.addEventListener('change', () => { paused = reducedMotion.matches; scrollTurn = 0; scrollProgress = scrollTarget = 0; syncMotion(); updateScrollTarget(); });
  mobile.addEventListener('change', () => { buildRug(state.design); resize(); });
  window.addEventListener('scroll', updateScrollTarget, { passive: true });
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
