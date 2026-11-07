import * as THREE from 'three';
import {GLTFLoader} from '../node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {installClay, inverseToneMapping} from './materials.js';

const floorNames = new Set([
  'Supporters_Floor', 'Sports_Floor', 'Vintage_Floor', 'Sauna_Floor',
  'V06_Cinema_zone', 'V06_Threshold_stone'
]);

const floorShader = `${inverseToneMapping}
uniform sampler2D v06Floor;
varying vec3 floorPlan;
float doorway(vec2 p, vec2 center) {
  return 1.-smoothstep(4., 10., distance(p,center));
}
`;

function floorMaterial(source, texture) {
  const material = source.clone();
  installClay(material);
  const applyClay = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = shader => {
    applyClay(shader);
    shader.uniforms.v06Floor = {value: texture};
    shader.vertexShader = 'attribute vec3 receiverPlan; varying vec3 floorPlan;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nfloorPlan = receiverPlan;');
    shader.fragmentShader = floorShader + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      vec2 p = floorPlan.xy;
      vec2 seatBorder = abs(p-vec2(33.6,39.))-vec2(8.5,6.5);
      float seating = 1.-smoothstep(0.,2.5,max(seatBorder.x,seatBorder.y));
      float weight = max(seating,max(doorway(p,vec2(12.,24.)),doorway(p,vec2(24.,29.))));
      vec2 uv=(p-vec2(0.,16.))/vec2(48.,32.);
      vec2 border=min(uv,1.-uv)*vec2(48.,32.);
      weight *= smoothstep(0.,1.,min(border.x,border.y))*smoothstep(.7,.97,floorPlan.z);
      vec3 baked=fromDisplay(texture2D(v06Floor,uv).rgb);
      outgoingLight=mix(outgoingLight,baked,.97*weight);
      #include <opaque_fragment>
      gl_FragColor.a=-.97*weight;`);
  };
  material.customProgramCacheKey = () => 'v06-floor-cycles';
  return material;
}

// These are the same two authored walls with an extra UV unwrap for the reveal
// surfaces. A top-down sample alone cannot light a vertical door jamb.
function replaceDoorWalls(root, walls) {
  for (const name of ['Shared_Sauna_Sports_Wall','Prayer_Back_Wall']) {
    const original = root.getObjectByName(name);
    const replacement = walls.getObjectByName(name);
    if (!original?.isMesh || !replacement?.isMesh) throw Error('문 조명 메시를 찾을 수 없습니다.');
    const material = replacement.material.clone();
    const baseColor = original.material.color;
    material.color.copy(baseColor);
    material.roughness = original.material.roughness;
    const baked = replacement.material.map;
    // Keep the authored base color in the small real-time clay contribution.
    material.map = null;
    installClay(material);
    const applyClay = material.onBeforeCompile.bind(material);
    material.onBeforeCompile = shader => {
      applyClay(shader);
      shader.uniforms.wallLight = {value:baked};
      shader.vertexShader = 'varying vec2 lightingUv;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nlightingUv=uv;');
      shader.fragmentShader = inverseToneMapping+'\nuniform sampler2D wallLight; varying vec2 lightingUv;\n'+shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
        outgoingLight=mix(outgoingLight,fromDisplay(texture2D(wallLight,lightingUv).rgb),.95);
        #include <opaque_fragment>
        gl_FragColor.a=-.95;`);
    };
    material.customProgramCacheKey = () => 'v06-wall-cycles';
    material.addEventListener('dispose',()=>baked.dispose());
    replacement.material = material;
    replacement.castShadow = replacement.receiveShadow = true;
    original.removeFromParent();
    root.add(replacement);
  }
}

export async function applyV06FloorLighting(root) {
  const [texture, walls] = await Promise.all([
    new THREE.TextureLoader().loadAsync(new URL('./assets/v06-floor-light.png',import.meta.url).href),
    new GLTFLoader().loadAsync(new URL('./assets/v06-door-walls.glb',import.meta.url).href)
  ]);
  replaceDoorWalls(root,walls.scene);
  texture.colorSpace = THREE.SRGBColorSpace;
  const materials = new Map();
  root.traverse(mesh => {
    if (!mesh.isMesh || !floorNames.has((mesh.userData.name || mesh.name).split('.')[0])) return;
    // The plan is defined in authored coordinates before centering or batching.
    const geometry = mesh.geometry.clone();
    const positions = geometry.attributes.position;
    const plan = new Float32Array(positions.count*3);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const position = new THREE.Vector3(), normal = new THREE.Vector3();
    for (let i=0; i<positions.count; i++) {
      position.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld);
      normal.fromBufferAttribute(geometry.attributes.normal,i).applyNormalMatrix(normalMatrix);
      plan.set([position.x,-position.z,normal.y],i*3);
    }
    geometry.setAttribute('receiverPlan',new THREE.BufferAttribute(plan,3));
    mesh.geometry = geometry;
    if (!materials.has(mesh.material)) materials.set(mesh.material,floorMaterial(mesh.material,texture));
    mesh.material = materials.get(mesh.material);
  });
  return texture;
}
