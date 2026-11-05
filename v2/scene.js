import * as THREE from 'three';
import { GLTFLoader } from '../node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from '../node_modules/three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from '../node_modules/three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from '../node_modules/three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../node_modules/three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from '../node_modules/three/examples/jsm/postprocessing/SSAOPass.js';
import { OutputPass } from '../node_modules/three/examples/jsm/postprocessing/OutputPass.js';

const world = document.querySelector('#world');
const loading = document.querySelector('#loading');
const status = document.querySelector('#status');
const reset = document.querySelector('#reset');
const compare = document.querySelector('#compare');
const reference = document.querySelector('#reference');
const mobile = matchMedia('(pointer: coarse)').matches || innerWidth < 650;
let renderer, composer, controls, camera, scene, bounds, ao, frame = 0, ready = false;
let originalPosition, originalRotation, originalTarget;

function fail(message) {
  ready = false;
  loading.hidden = false;
  status.textContent = message;
  document.querySelector('#retry').hidden = false;
}
document.querySelector('#retry').addEventListener('click', () => location.reload());
compare.addEventListener('click', () => {
  const show = reference.hidden;
  reference.hidden = !show;
  compare.setAttribute('aria-pressed', String(show));
  compare.textContent = show ? '3D 공간으로' : '참고 이미지';
  reset.disabled = show || !ready;
  document.querySelector('#hint').style.visibility = show ? 'hidden' : 'visible';
  if (!show) requestRender();
});

// The scene is static: draw only after input, loading, or a viewport change.
function requestRender() {
  if (frame || !ready || document.hidden || !reference.hidden) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    ao.ssaoMaterial.uniforms.cameraProjectionMatrix.value.copy(camera.projectionMatrix);
    ao.ssaoMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);
    composer.render();
  });
}

function fitCamera() {
  const aspect = innerWidth / innerHeight;
  camera.position.copy(originalPosition);
  camera.quaternion.copy(originalRotation);
  camera.zoom = 1;
  camera.updateMatrixWorld(true);
  // Fit in camera space, preserving the authored orthographic camera direction.
  const projected = bounds.clone().applyMatrix4(camera.matrixWorldInverse);
  const center = projected.getCenter(new THREE.Vector3());
  const size = projected.getSize(new THREE.Vector3());
  const offset = new THREE.Vector3(center.x, center.y, 0).applyQuaternion(camera.quaternion);
  camera.position.add(offset);
  controls.target.copy(originalTarget).add(offset);
  const halfHeight = Math.max(size.y / 2 / (mobile ? .62 : .72), size.x / 2 / aspect / .84);
  camera.left = -halfHeight * aspect;
  camera.right = halfHeight * aspect;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
  controls.update();
}

async function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.25 : 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .95;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', '3D 공간. 드래그로 회전, 스크롤 또는 두 손가락으로 확대. 처음 시점 버튼으로 복원.');
  renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    fail('3D 화면이 중단되었어요. 다시 불러와 주세요.');
  });
  world.append(renderer.domElement);
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#d5d2c9');
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, .04);
  scene.environment = environment.texture;
  scene.environmentIntensity = .3;
  room.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight('#fff6df', '#969a91', .65));

  const gltf = await new GLTFLoader().loadAsync('./assets/riraji_normal.glb', event => {
    if (event.total) status.textContent = `공간을 불러오고 있어요. ${Math.round(event.loaded / event.total * 100)}%`;
  });
  gltf.scene.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = !object.material.transmission;
    object.receiveShadow = true;
  });
  scene.add(gltf.scene);
  bounds = new THREE.Box3().setFromObject(gltf.scene);
  const center = bounds.getCenter(new THREE.Vector3());
  camera = gltf.cameras.find(item => item.name === 'Quarter_Camera');
  if (!camera?.isOrthographicCamera) throw new Error('Missing authored camera');
  camera.removeFromParent();
  camera.near = .1;
  camera.far = 250;
  originalPosition = camera.position.clone();
  originalRotation = camera.quaternion.clone();
  const direction = camera.getWorldDirection(new THREE.Vector3());
  originalTarget = camera.position.clone().addScaledVector(direction, center.clone().sub(camera.position).dot(direction));

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({color: '#d5d2c9', roughness: 1}));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(center.x, bounds.min.y - .025, center.z);
  ground.receiveShadow = true;
  scene.add(ground);
  const key = new THREE.DirectionalLight('#fff1d6', 2.1);
  key.position.set(-12, 45, 16);
  key.target.position.copy(center);
  key.castShadow = true;
  key.shadow.mapSize.setScalar(mobile ? 1024 : 2048);
  Object.assign(key.shadow.camera, {left:-32,right:32,top:32,bottom:-32,near:1,far:120});
  key.shadow.normalBias = .035;
  key.shadow.bias = -.00015;
  key.shadow.radius = 9;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight('#e0ecff', .35);
  fill.position.set(12, 20, -35);
  scene.add(fill);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.minZoom = .7;
  controls.maxZoom = 2.5;
  controls.minPolarAngle = .18;
  controls.maxPolarAngle = Math.PI / 2 - .1;
  controls.addEventListener('change', requestRender);
  composer = new EffectComposer(renderer);
  composer.renderTarget1.samples = mobile ? 0 : 4;
  composer.renderTarget2.samples = mobile ? 0 : 4;
  composer.addPass(new RenderPass(scene, camera));
  ao = new SSAOPass(scene, camera, innerWidth, innerHeight, mobile ? 12 : 24);
  ao.ssaoMaterial.defines.PERSPECTIVE_CAMERA = 0;
  ao.depthRenderMaterial.defines.PERSPECTIVE_CAMERA = 0;
  ao.kernelRadius = 1.3;
  ao.minDistance = .0003;
  ao.maxDistance = .035;
  composer.addPass(ao);
  composer.addPass(new OutputPass());
  fitCamera();
  ao.ssaoMaterial.uniforms.cameraProjectionMatrix.value.copy(camera.projectionMatrix);
  ao.ssaoMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);
  ready = true;
  composer.render();
  loading.hidden = true;
  reset.disabled = false;
  reset.addEventListener('click', () => { fitCamera(); requestRender(); });
  window.addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    fitCamera();
    requestRender();
  });
  document.addEventListener('visibilitychange', requestRender);
  if (mobile) document.querySelector('#hint').textContent = '한 손가락으로 둘러보기 · 두 손가락으로 가까이';
}
init().catch(error => {
  console.error(error);
  fail('공간을 불러오지 못했어요. 다시 시도해 주세요.');
});
