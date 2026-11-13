import * as THREE from 'three';
import {mergeGeometries} from '../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';

export function validateRadiance(spec) {
  const finite = a => Array.isArray(a) && a.every(Number.isFinite);
  if (spec?.schema!==1 || !['1,3','3,3'].includes(spec.grid?.join(',')) || !finite(spec.domain?.azimuthRange) || !finite(spec.domain?.elevationRange) ||
      spec.domain.azimuthRange.length!==2 || spec.domain.elevationRange.length!==2 || spec.domain.azimuthRange[0]>=spec.domain.azimuthRange[1] ||
      spec.domain.elevationRange[0]>=spec.domain.elevationRange[1] || !Number.isInteger(spec.displayTexture) || spec.displayTexture<0 || spec.display?.size!==64)
    throw Error('지원하지 않는 방향별 조명 데이터입니다.');
  const d=spec.domain;
  if(!finite(d.target)||d.target.length!==3||!['azimuth','elevation','tilt','pan','zoomMax','span','distance'].every(k=>Number.isFinite(d[k]))||
     d.span<=0||d.distance<=0||d.pan<0||d.pan>1||d.zoomMax<1||d.zoomMax>4||d.tilt<0||d.tilt>.6)
    throw Error('잘못된 카메라 이동 범위입니다.');
}

// Directional radiance uses original world coordinates. An inverse model matrix
// allows admin grid clones and translated scene roots to share immutable caches.
export function radiancePlugin(parser) {
  return {name:'STUDIO_surface_radiance', async afterRoot(gltf) {
    const spec=parser.json.extras?.studioRadiance;
    if(!spec)return;
    validateRadiance(spec);
    const columns=spec.grid[0],viewCount=columns*spec.grid[1];
    const getTexture=async index=>{
      if(!Number.isInteger(index)||index<0||index>=parser.json.textures.length)throw Error('잘못된 조명 텍스처입니다.');
      const t=(await parser.getDependency('texture',index)).clone();
      t.colorSpace=THREE.NoColorSpace;t.flipY=false;t.generateMipmaps=false;t.minFilter=t.magFilter=THREE.LinearFilter;t.needsUpdate=true;
      return t;
    };
    const originals=await parser.getDependencies('material'),converted=new Map();
    for(let index=0;index<originals.length;index++){
      const info=parser.json.materials[index]?.extras?.studioRadiance;
      if(!info)continue;
      if(info.schema!==1||info.views?.length!==viewCount)throw Error('방향별 조명 샘플이 누락되었습니다.');
      const maps=[info.diffuse,...info.views];
      if(maps.some(m=>!Number.isFinite(m.range)||m.range<=0||m.range>1e8))throw Error('잘못된 조명 범위입니다.');
      const textures=await Promise.all(maps.map(m=>getTexture(m.texture)));
      const uniforms={diffuseCache:{value:textures[0]},diffuseRange:{value:info.diffuse.range},
        diffuseSize:{value:new THREE.Vector2(textures[0].image.width,textures[0].image.height)},
        radianceDirection:{value:new THREE.Vector3()},radianceEye:{value:new THREE.Vector3()},radianceOrtho:{value:true},
        azimuthRange:{value:new THREE.Vector2(...spec.domain.azimuthRange)},elevationRange:{value:new THREE.Vector2(...spec.domain.elevationRange)}};
      for(let i=0;i<viewCount;i++){uniforms['cache'+i]={value:textures[i+1]};uniforms['range'+i]={value:info.views[i].range};uniforms['size'+i]={value:new THREE.Vector2(textures[i+1].image.width,textures[i+1].image.height)};}
      const material=new THREE.ShaderMaterial({uniforms,side:THREE.DoubleSide,toneMapped:false,
        vertexShader:`varying vec2 cacheUV; varying vec3 cachePosition;
          void main(){cacheUV=uv;cachePosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader:`precision highp float;
          varying vec2 cacheUV; varying vec3 cachePosition;
          uniform sampler2D diffuseCache; uniform float diffuseRange;uniform vec2 diffuseSize;
          uniform vec3 radianceDirection,radianceEye; uniform bool radianceOrtho;
          uniform vec2 azimuthRange,elevationRange;
          ${Array.from({length:viewCount},(_,i)=>`uniform sampler2D cache${i}; uniform float range${i}; uniform vec2 size${i};`).join('\n')}
          vec3 texel(sampler2D tex,vec2 p,float range){vec4 v=texture2D(tex,p);return v.rgb*v.a*range;}
          vec3 decode(sampler2D tex,float range,vec2 size){
            vec2 p=clamp(cacheUV,vec2(0.),vec2(1.))*size-.5,f=fract(p),a=(floor(p)+.5)/size,b=a+1./size;
            return mix(mix(texel(tex,a,range),texel(tex,vec2(b.x,a.y),range),f.x),mix(texel(tex,vec2(a.x,b.y),range),texel(tex,b,range),f.x),f.y);
          }
          void main(){
            vec3 direction=radianceOrtho?radianceDirection:normalize(radianceEye-cachePosition);
            float az=atan(direction.x,direction.z);
            float center=(azimuthRange.x+azimuthRange.y)*.5;
            az=center+atan(sin(az-center),cos(az-center));
            vec2 p=clamp(vec2(${columns===1?'0.':'(az-azimuthRange.x)/(azimuthRange.y-azimuthRange.x)'},
                      (asin(clamp(direction.y,-1.,1.))-elevationRange.x)/(elevationRange.y-elevationRange.x)),0.,1.)*2.;
            vec3 light=decode(diffuseCache,diffuseRange,diffuseSize);
            ${Array.from({length:viewCount},(_,i)=>`{float weight=max(0.,1.-abs(p.x-${(i%columns).toFixed(1)}))*max(0.,1.-abs(p.y-${Math.floor(i/columns).toFixed(1)}));if(weight>0.)light+=decode(cache${i},range${i},size${i})*weight;}`).join('\n')}
            gl_FragColor=vec4(light,1.);
          }`});
      material.name=originals[index].name;material.userData.studioRadiance=true;
      material.userData.cacheTextures=textures;
      converted.set(index,material);
    }
    gltf.scene.traverse(object=>{
      if(!object.isMesh)return;
      const convert=material=>{
        const index=parser.associations?.get(material)?.materials??originals.indexOf(material);
        const next=converted.get(index);
        if(!next)throw Error('조명 데이터가 없는 표면: '+object.name);
        return next;
      };
      object.material=Array.isArray(object.material)?object.material.map(convert):convert(object.material);
      object.castShadow=object.receiveShadow=false;
      // The bake position is object local here; transform camera rays to it.
      const inverse=new THREE.Matrix4(),eye=new THREE.Vector3(),direction=new THREE.Vector3();
      object.onBeforeRender=function(renderer,scene,camera,geometry,material){
        const object=this;
        inverse.copy(object.matrixWorld).invert();
        camera.getWorldPosition(eye).applyMatrix4(inverse);
        camera.getWorldDirection(direction).negate().transformDirection(inverse);
        // Atlas directions are in exported scene coordinates, not object local.
        // The original transform is restored below by the stored matrix.
        const original=object.userData.radianceSourceMatrix;
        if(original){eye.applyMatrix4(original);direction.transformDirection(original);}
        material.uniforms.radianceEye.value.copy(eye);
        material.uniforms.radianceDirection.value.copy(direction);
        material.uniforms.radianceOrtho.value=Boolean(camera.isOrthographicCamera);
        material.uniformsNeedUpdate=true;
      };
    });
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(object=>{
      if(!object.isMesh)return;
      // Bake source world positions into geometry, then retain the hierarchy.
      // A shader attribute avoids modifying geometry/normal transforms.
      const matrix=object.matrixWorld.clone(),position=object.geometry.attributes.position;
      const data=new Float32Array(position.count*3),point=new THREE.Vector3();
      for(let i=0;i<position.count;i++){point.fromBufferAttribute(position,i).applyMatrix4(matrix);point.toArray(data,i*3);}
      object.geometry=object.geometry.clone();object.geometry.setAttribute('radiancePosition',new THREE.BufferAttribute(data,3));
      object.userData.radianceSourceMatrix=matrix;
      for(const material of Array.isArray(object.material)?object.material:[object.material]){
        material.vertexShader=material.vertexShader.replace('cachePosition=position;','cachePosition=radiancePosition;');
        if(!material.vertexShader.includes('attribute vec3 radiancePosition;'))material.vertexShader='attribute vec3 radiancePosition;\n'+material.vertexShader;
      }
    });
    // Batching happens after transport. It never changes source shader coordinates.
    const batches=new Map(),rootInverse=gltf.scene.matrixWorld.clone().invert();
    gltf.scene.traverse(object=>{if(!object.isMesh||Array.isArray(object.material))return;const group=batches.get(object.material)||[];group.push(object);batches.set(object.material,group);});
    for(const [material,objects] of batches){
      if(objects.length<2)continue;
      const parts=objects.map(object=>{
        const geometry=object.geometry.clone();geometry.applyMatrix4(rootInverse.clone().multiply(object.matrixWorld));
        for(const key of Object.keys(geometry.attributes))if(!['position','uv','radiancePosition'].includes(key))geometry.deleteAttribute(key);
        return geometry;
      });
      const geometry=mergeGeometries(parts,false);for(const part of parts)part.dispose();
      if(!geometry)throw Error('조명 메시 결합에 실패했습니다.');
      const mesh=new THREE.Mesh(geometry,material);mesh.name=material.name;mesh.userData.radianceSourceMatrix=gltf.scene.matrixWorld.clone();mesh.userData.studioRadiance=true;
      mesh.onBeforeRender=objects[0].onBeforeRender;gltf.scene.add(mesh);
      for(const object of objects){object.removeFromParent();object.geometry.dispose();}
    }
    gltf.userData.studioRadiance={...spec,displayMap:await getTexture(spec.displayTexture)};
  }};
}

export class RadianceOutput {
  constructor(renderer,profile){
    this.renderer=renderer;
    if(!renderer.extensions.has('EXT_color_buffer_float')||renderer.capabilities.maxTextures<profile.grid[0]*profile.grid[1]+1||renderer.capabilities.maxTextureSize<4096)
      throw Error('이 기기는 원본 조명 정밀도를 지원하지 않습니다. 데스크톱 브라우저에서 열어 주세요.');
    this.target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples:Math.min(4,renderer.capabilities.maxSamples)});
    this.scene=new THREE.Scene();this.camera=new THREE.Camera();
    this.uniforms={frame:{value:this.target.texture},displayLut:{value:profile.displayMap},lutSize:{value:profile.display.size}};
    this.mesh=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,uniforms:this.uniforms,
      vertexShader:'varying vec2 coord;void main(){coord=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader:`varying vec2 coord;uniform sampler2D frame,displayLut;uniform float lutSize;
        vec3 sampleSlice(vec3 p,float b){return texture2D(displayLut,vec2((b*lutSize+p.r+.5)/(lutSize*lutSize),1.-(p.g+.5)/lutSize)).rgb;}
        void main(){vec3 linear=max(texture2D(frame,coord).rgb,0.);vec3 p=clamp(log2(1.+16.*linear)/16.,0.,1.)*(lutSize-1.);
          gl_FragColor=vec4(mix(sampleSlice(p,floor(p.b)),sampleSlice(p,min(floor(p.b)+1.,lutSize-1.)),fract(p.b)),1.);}`
    }));this.scene.add(this.mesh);
  }
  render(scene,camera){
    const size=this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if(this.target.width!==size.x||this.target.height!==size.y)this.target.setSize(size.x,size.y);
    this.renderer.setRenderTarget(this.target);this.renderer.render(scene,camera);this.renderer.setRenderTarget(null);this.renderer.render(this.scene,this.camera);
  }
  dispose(){this.target.dispose();this.mesh.geometry.dispose();this.mesh.material.dispose();}
}
