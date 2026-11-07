import * as THREE from 'three';
import {SSAOPass} from '../node_modules/three/examples/jsm/postprocessing/SSAOPass.js';

// Cache the lit scene. Only this single screen-space pass runs between interactions.
export class Contours {
  constructor(renderer, animate) {
    this.animate = animate;
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: Math.min(2, renderer.capabilities.maxSamples)
    });
    this.uniforms = {
      frameImage: {value: this.target.texture},
      pixel: {value: new THREE.Vector2()},
      phase: {value: 0},
      contactMap: {value: null},
      hasContactMap: {value: false},
      amplitude: {value: animate ? .95 : 0}
    };
    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: `varying vec2 coord;
        void main(){coord=uv; gl_Position=vec4(position.xy,0.,1.);}`,
      fragmentShader: `uniform sampler2D frameImage;
        uniform sampler2D contactMap;
        uniform bool hasContactMap;
        uniform vec2 pixel;
        uniform float phase;
        uniform float amplitude;
        varying vec2 coord;
        void main(){
          vec3 color=texture2D(frameImage,coord).rgb;
          vec3 dx=texture2D(frameImage,coord+vec2(pixel.x,0.)).rgb-color;
          vec3 dy=texture2D(frameImage,coord+vec2(0.,pixel.y)).rgb-color;
          float edge=smoothstep(.035,.22,max(length(dx),length(dy))/(.25+length(color)));
          vec2 p=coord/pixel;
          vec2 jitter=vec2(sin(.77*p.y+phase)*cos(.23*p.x-phase),
                           sin(.65*p.x-phase)*cos(.31*p.y+phase));
          vec2 sampleUv=coord+edge*jitter*pixel*amplitude;
          vec4 lit=texture2D(frameImage,sampleUv);
          if(hasContactMap){
            // Negative alpha marks how much Cycles shadowing this pixel contains.
            float baked=clamp(-lit.a,0.,1.);
            lit.rgb*=mix(texture2D(contactMap,sampleUv).r,1.,baked);
          }
          gl_FragColor=vec4(lit.rgb,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    }));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.motionChanged = () => { if (this.ready) this.present(); };
    this.motion.addEventListener('change', this.motionChanged);
  }
  capture(scene, camera, useContactShadows) {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target.setSize(size.x, size.y);
    this.uniforms.pixel.value.setScalar(this.renderer.getPixelRatio()).divide(size);
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.uniforms.hasContactMap.value = useContactShadows;
    if (useContactShadows) {
      if (!this.ao) this.ao = new SSAOPass(scene, camera, 1, 1, 16);
      const ao = this.ao;
      const width = Math.ceil(size.x*.65), height = Math.ceil(size.y*.65);
      if (ao.width !== width || ao.height !== height) ao.setSize(width, height);
      ao.camera = camera;
      ao.ssaoMaterial.defines.PERSPECTIVE_CAMERA = camera.isPerspectiveCamera ? 1 : 0;
      const uniforms = ao.ssaoMaterial.uniforms;
      uniforms.cameraNear.value = camera.near;
      uniforms.cameraFar.value = camera.far;
      uniforms.cameraProjectionMatrix.value.copy(camera.projectionMatrix);
      uniforms.cameraInverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);
      ao.kernelRadius = 2.6;
      ao.minDistance = .03 / camera.far;
      ao.maxDistance = 5 / camera.far;
      // Preserve scene color. Combine SSAO only on the live-lit fraction in present().
      ao.copyMaterial.colorWrite = false;
      ao.render(this.renderer, null, this.target);
      this.uniforms.contactMap.value = ao.blurRenderTarget.texture;
    }
    this.renderer.setRenderTarget(null);
    this.ready = true;
    this.present();
  }
  present() {
    clearTimeout(this.timer);
    if (document.hidden) return;
    this.uniforms.phase.value = this.motion.matches ? 0 : Math.floor(performance.now()/160)%13;
    this.renderer.render(this.scene, this.camera);
    if (this.animate && !this.motion.matches) this.timer=setTimeout(()=>this.present(),160);
  }
  dispose() {
    clearTimeout(this.timer);
    this.motion.removeEventListener('change', this.motionChanged);
    this.ao?.dispose();
    this.target.dispose();
    this.quad.geometry.dispose();
    this.quad.material.dispose();
  }
}
