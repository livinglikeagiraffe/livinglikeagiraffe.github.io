import * as THREE from 'three';

export function installClay(material,{lightMapRange=0,strength=.42}={}){
  if(!material.isMeshStandardMaterial||material.transmission>0||material.metalness>.1)return;
  material.roughness=Math.max(.78,material.roughness);material.envMapIntensity=.2;
  material.userData.clayStrength={value:strength};
  material.onBeforeCompile=shader=>{
    shader.uniforms.clayStrength=material.userData.clayStrength;
    shader.vertexShader='varying vec3 vClayPosition;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvClayPosition = (modelMatrix * vec4(transformed, 1.)).xyz;');
    shader.fragmentShader=`varying vec3 vClayPosition; uniform float clayStrength;
float clayHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float clayNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(clayHash(i),clayHash(i+vec3(1,0,0)),f.x),mix(clayHash(i+vec3(0,1,0)),clayHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(clayHash(i+vec3(0,0,1)),clayHash(i+vec3(1,0,1)),f.x),mix(clayHash(i+vec3(0,1,1)),clayHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
`+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
float footprint=max(length(dFdx(vClayPosition)),length(dFdy(vClayPosition)));
float pores=1.-smoothstep(.018,.09,footprint);
float folds=clayNoise(vClayPosition*1.6);
float grain=clayNoise(vClayPosition*7.+folds);
float clayHeight=clayStrength*(.095*folds+.027*grain*pores);
diffuseColor.rgb*=1.+clayStrength*((folds-.5)*.085+(grain-.5)*.045*pores);
vec3 clayDx=dFdx(-vViewPosition),clayDy=dFdy(-vViewPosition);
vec3 clayR1=cross(clayDy,normal),clayR2=cross(normal,clayDx);
float clayDet=dot(clayDx,clayR1);
if(abs(clayDet)>1e-9)normal=normalize(abs(clayDet)*normal-sign(clayDet)*(dFdx(clayHeight)*clayR1+dFdy(clayHeight)*clayR2));`);
    if(lightMapRange){
      const chunk=THREE.ShaderChunk.lights_fragment_maps.replace('lightMapTexel.rgb * lightMapIntensity','lightMapTexel.rgb * lightMapTexel.a * lightMapIntensity').replace('iblIrradiance += getIBLIrradiance( geometryNormal );','// Indirect diffuse is already in the lightmap.');
      shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_maps>',chunk);
    }
  };
  material.customProgramCacheKey=()=>`studio-clay-2:${Boolean(lightMapRange)}`;material.needsUpdate=true;
}

export function hybridPlugin(parser){return {name:'STUDIO_indirect_lightmaps',async afterRoot(gltf){
  const dependencies=await parser.getDependencies('material'),materials=new Set(dependencies);
  // GLTFLoader creates geometry-specific clones before afterRoot (tangents/colors).
  // Attach maps and shader hooks to those rendered materials as well.
  for(const scene of gltf.scenes||[gltf.scene])scene?.traverse(object=>{for(const material of object.material?(Array.isArray(object.material)?object.material:[object.material]):[])materials.add(material);});
  await Promise.all([...materials].map(async material=>{
    const index=parser.associations?.get(material)?.materials??dependencies.indexOf(material);
    const spec=material.userData.studioLightMap||parser.json.materials[index]?.extras?.studioLightMap;
    if(!spec)return;
    if(spec.encoding!=='RGBM'||spec.indirectOnly!==true||!Number.isFinite(spec.range)||spec.range<=0||spec.range>1e8||!Number.isInteger(spec.texture)||spec.texCoord!==0)throw Error('지원하지 않는 간접광 텍스처입니다.');
    const texture=(await parser.getDependency('texture',spec.texture)).clone();texture.colorSpace=THREE.NoColorSpace;texture.channel=0;texture.flipY=false;texture.needsUpdate=true;
    material.lightMap=texture;material.lightMapIntensity=Math.PI*spec.range;material.userData.studioLightMap=spec;
    installClay(material,{lightMapRange:spec.range});
  }));
  gltf.userData.studioHybrid=parser.json.extras?.studioHybrid;
}};}

// Extend the studio ground while preserving texel density around the modules.
// Outside the baked rectangle, clamp to its edge instead of stretching the bake.
export function extendGround(mesh){
  const geometry=mesh.geometry,position=geometry.attributes.position,uv=geometry.attributes.uv;
  if(!position||!uv)return;
  geometry.computeBoundingBox();const center=geometry.boundingBox.getCenter(new THREE.Vector3());
  const low=new THREE.Vector2(Infinity,Infinity),high=new THREE.Vector2(-Infinity,-Infinity);
  for(let i=0;i<uv.count;i++){low.min(new THREE.Vector2(uv.getX(i),uv.getY(i)));high.max(new THREE.Vector2(uv.getX(i),uv.getY(i)));}
  const middle=low.clone().add(high).multiplyScalar(.5);
  for(let i=0;i<position.count;i++){const p=new THREE.Vector3().fromBufferAttribute(position,i).sub(center).multiplyScalar(8).add(center);position.setXYZ(i,p.x,p.y,p.z);uv.setXY(i,middle.x+(uv.getX(i)-middle.x)*8,middle.y+(uv.getY(i)-middle.y)*8);}
  position.needsUpdate=true;uv.needsUpdate=true;geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const material=mesh.material,compile=material.onBeforeCompile.bind(material);low.addScalar(.001);high.subScalar(.001);
  material.onBeforeCompile=shader=>{compile(shader);shader.uniforms.floorUvMin={value:low};shader.uniforms.floorUvMax={value:high};
    for(const chunk of ['map_fragment','roughnessmap_fragment','metalnessmap_fragment'])shader.fragmentShader=shader.fragmentShader.replace('#include <'+chunk+'>',THREE.ShaderChunk[chunk]);
    shader.fragmentShader='uniform vec2 floorUvMin; uniform vec2 floorUvMax;\n'+shader.fragmentShader.replace(/texture2D\( (map|normalMap|roughnessMap|metalnessMap|lightMap), ([^)]+) \)/g,'texture2D( $1, clamp( $2, floorUvMin, floorUvMax ) )');
  };
  material.customProgramCacheKey=()=> 'studio-clay-ground-2';material.needsUpdate=true;mesh.castShadow=false;
}
