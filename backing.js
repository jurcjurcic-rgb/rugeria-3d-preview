import * as THREE from './vendor/three.module.js';
export function createUnderlay(shape) {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
  const c=canvas.getContext('2d');c.fillStyle='#d8c9b3';c.fillRect(0,0,512,512);
  for(let i=0;i<512;i+=6){
    c.fillStyle=i%12===0?'#b7a58d':'#f0e2cf';c.fillRect(i,0,2,512);
    c.fillStyle=i%12===0?'#bdac94':'#f4e8d9';c.fillRect(0,i,512,2);
    c.fillStyle='#9f8b7340';for(let j=0;j<512;j+=12)c.fillRect(i,j+(i%12),3,3);
  }
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
  map.wrapS=map.wrapT=THREE.RepeatWrapping;
  const geometry=new THREE.ShapeGeometry(shape,48);geometry.rotateX(-Math.PI/2);
  const positions=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');
  for(let i=0;i<positions.count;i++)uv.setXY(i,positions.getX(i)*0.8,positions.getZ(i)*0.8);
  uv.needsUpdate=true;
  const material=new THREE.MeshStandardMaterial({map,bumpMap:map,bumpScale:0.012,roughness:0.98,side:THREE.DoubleSide,color:'#e7ded0'});
  const mesh=new THREE.Mesh(geometry,material);mesh.position.y=0.012;return mesh;
}
