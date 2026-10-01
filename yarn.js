import * as THREE from './vendor/three.module.js';

// A tuft is a small cluster of curved yarn strands, not a flat particle.
export function createYarnGeometry(mobile) {
  const positions = [], normals = [], uvs = [], indices = [];
  const strands = mobile ? 3 : 4;
  for (let i = 0; i < strands; i++) {
    const angle = i / strands * Math.PI * 2;
    const g = new THREE.CylinderGeometry(0.0055, 0.0085, 1, 5, 3, false);
    g.translate(Math.cos(angle) * 0.008, 0.5, Math.sin(angle) * 0.008);
    const p = g.getAttribute('position');
    for (let j = 0; j < p.count; j++) {
      const y = p.getY(j);
      p.setXYZ(j, p.getX(j) + Math.sin(y * Math.PI * 1.7 + angle) * 0.012 * y, y * (0.85 + i * 0.07), p.getZ(j) + Math.cos(y * Math.PI * 1.4 + angle) * 0.009 * y);
    }
    g.computeVertexNormals();
    const offset = positions.length / 3;
    indices.push(...Array.from(g.index.array, index => index + offset));
    positions.push(...g.getAttribute('position').array);
    normals.push(...g.getAttribute('normal').array);
    uvs.push(...g.getAttribute('uv').array);
    g.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

export function animateYarnMaterial(material, uniforms) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `attribute vec3 aScatter;\nattribute float aDelay;\nattribute float aCarve;\nuniform float uAssembly;\nuniform float uGrowth;\nuniform float uCarve;\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      float arrive = smoothstep(aDelay, aDelay + 0.42, uAssembly);
      transformed.y *= uGrowth * (1.0 - aCarve * uCarve * 0.42);
      transformed.xz *= 1.0 + (1.0 - arrive) * 1.5;
    `);
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      vec4 mvPosition = vec4(transformed, 1.0);
      #ifdef USE_BATCHING
        mvPosition = batchingMatrix * mvPosition;
      #endif
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      mvPosition.xyz += (aScatter - instanceMatrix[3].xyz) * (1.0 - arrive);
      mvPosition.y += sin(arrive * 3.14159265) * (0.12 + aDelay * 0.3);
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;
    `);
    material.userData.shader = shader;
  };
  material.customProgramCacheKey = () => 'rugeria-yarn-assembly-v1';
}
