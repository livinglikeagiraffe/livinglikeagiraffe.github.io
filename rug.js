import * as THREE from './node_modules/three/build/three.module.js';

// The original team avatar is printed directly onto a thin, walkable textile.
export function addTeamRug(scene, renderer) {
  const rug = new THREE.Group();
  rug.name = 'Living Like a Giraffe profile rug';
  rug.position.set(-1, 0, 10.5);
  rug.rotation.y = Math.PI / 4;

  const portrait = new THREE.TextureLoader().load('./assets/projects/team-profile.jpg');
  portrait.colorSpace = THREE.SRGBColorSpace;
  portrait.anisotropy = renderer.capabilities.getMaxAnisotropy();

  // A repeating weave affects the surface relief, without altering the artwork.
  const size = 64;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const thread = (Math.cos(x * Math.PI / 2) + Math.cos(y * Math.PI / 2)) * 24;
      const v = 128 + thread;
      pixels.set([v, v, v, 255], i);
    }
  }
  const weave = new THREE.DataTexture(pixels, size, size);
  weave.wrapS = weave.wrapT = THREE.RepeatWrapping;
  weave.repeat.set(20, 20);
  weave.magFilter = THREE.LinearFilter;
  weave.minFilter = THREE.LinearMipmapLinearFilter;
  weave.generateMipmaps = true;
  weave.needsUpdate = true;

  const binding = new THREE.MeshStandardMaterial({ color: '#d2bd8e', roughness: 1 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.65, 2.65, .035, 128), binding);
  base.position.y = .006;
  base.receiveShadow = true;
  rug.add(base);

  const surface = new THREE.Mesh(new THREE.CircleGeometry(2.56, 128), new THREE.MeshStandardMaterial({
    map: portrait, color: '#fff8e8', roughness: 1, metalness: 0,
    bumpMap: weave, bumpScale: .012,
  }));
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = .025;
  surface.receiveShadow = true;
  rug.add(surface);

  const stitches = new THREE.InstancedMesh(
    new THREE.BoxGeometry(.045, .006, .012),
    new THREE.MeshStandardMaterial({ color: '#f4e8c9', roughness: 1 }),
    180,
  );
  const stitch = new THREE.Object3D();
  for (let i = 0; i < stitches.count; i++) {
    const angle = i / stitches.count * Math.PI * 2;
    stitch.position.set(Math.cos(angle) * 2.61, .026, Math.sin(angle) * 2.61);
    stitch.rotation.y = -angle;
    stitch.updateMatrix();
    stitches.setMatrixAt(i, stitch.matrix);
  }
  stitches.receiveShadow = true;
  rug.add(stitches);
  scene.add(rug);
  return rug;
}
