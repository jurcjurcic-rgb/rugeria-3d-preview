import * as THREE from './vendor/three.module.js';
const keys = [
  {p:0,cam:[0,8.5,10],look:[0,1.2,0],rot:[0,-0.12,-0.04],lift:0},
  {p:0.24,cam:[0,7.5,6.5],look:[0,0.2,0],rot:[0.02,0,0],lift:0.10},
  {p:0.40,cam:[1.45,1.10,2.50],look:[0.15,0.18,0.10],rot:[0,0.2,-0.08],lift:0.08},
  {p:0.56,cam:[-1.80,1.50,2.60],look:[-0.35,0.18,0.10],rot:[0,-0.15,0.07],lift:0.1},
  {p:0.76,cam:[0,7.5,5.0],look:[0,2.4,0],rot:[Math.PI,0.35,0.07],lift:2.4},
  {p:0.88,cam:[0,5.0,5.2],look:[0,1.5,0],rot:[Math.PI,0.1,-0.12],lift:1.5},
  {p:1,cam:[0,7.8,6.0],look:[0,0.2,0],rot:[Math.PI*2,0,0],lift:0.08}
];
const position = new THREE.Vector3(), look = new THREE.Vector3();
export function applyScrollPose(p, camera, rug, mobile, angle, tilt, zoom) {
  let a=keys[0], b=keys[1];
  for(let i=0;i<keys.length-1;i++)if(p>=keys[i].p&&p<=keys[i+1].p){a=keys[i];b=keys[i+1];break;}
  const t=THREE.MathUtils.smoothstep(p,a.p,b.p), lerp=THREE.MathUtils.lerp;
  position.set(...a.cam.map((v,i)=>lerp(v,b.cam[i],t)));
  look.set(...a.look.map((v,i)=>lerp(v,b.look[i],t)));
  // Fit the complete rug to narrow portrait viewports; keep macro passes close.
  const fit = mobile ? 1.25 : 1;
  const macroWeight = THREE.MathUtils.smoothstep(p,0.24,0.36) * (1-THREE.MathUtils.smoothstep(p,0.58,0.70));
  const macro = THREE.MathUtils.lerp(fit,1,macroWeight);
  position.sub(look).multiplyScalar(macro).add(look);
  camera.position.copy(position);
  camera.lookAt(look);
  camera.zoom=zoom;
  rug.rotation.set(lerp(a.rot[0],b.rot[0],t)+tilt,lerp(a.rot[1],b.rot[1],t)+angle,lerp(a.rot[2],b.rot[2],t));
  const lift=lerp(a.lift,b.lift,t);
  rug.position.set(0,lift,0);
  return {lift,distance:position.distanceTo(look),tilt:rug.rotation.x,rotation:rug.rotation.y};
}
