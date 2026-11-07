import * as THREE from 'three';

// Project the static model onto the ground from the softbox side. Filter the
// silhouette in world space so that zooming does not change the penumbra width.
export function addGroundShadow(renderer, model, bounds, material) {
  const span = bounds.getSize(new THREE.Vector3()).length() * .64;
  const center = bounds.getCenter(new THREE.Vector3());
  const camera = new THREE.OrthographicCamera(-span, span, span, -span, .1, span * 5);
  camera.position.copy(center).addScaledVector(new THREE.Vector3(.56, 1, .38), span * 2);
  camera.lookAt(center);
  camera.updateMatrixWorld();
  const projection = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse);
  const mask = new THREE.WebGLRenderTarget(512, 512, {
    generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter
  });
  const scene = new THREE.Scene();
  const parent = model.parent;
  scene.background = new THREE.Color(0xffffff);
  scene.overrideMaterial = new THREE.MeshBasicMaterial({color: 0});
  scene.add(model);
  const previous = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(mask);
    renderer.render(scene, camera);
  } finally {
    renderer.setRenderTarget(previous);
    parent.add(model);
    scene.overrideMaterial.dispose();
  }
  material.onBeforeCompile = shader => {
    shader.uniforms.groundProjection = {value: projection};
    shader.uniforms.groundSilhouette = {value: mask.texture};
    shader.vertexShader = 'uniform mat4 groundProjection; varying vec2 shadowCoord;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      shadowCoord = (groundProjection * modelMatrix * vec4(transformed,1.)).xy*.5+.5;`);
    shader.fragmentShader = 'uniform sampler2D groundSilhouette; varying vec2 shadowCoord;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      float visibility = textureLod(groundSilhouette, shadowCoord, 2.4).r*.6
                       + textureLod(groundSilhouette, shadowCoord, 3.8).r*.4;
      outgoingLight *= mix(.40, 1., visibility);
      #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'soft-ground-shadow';
  material.addEventListener('dispose', () => mask.dispose());
}
