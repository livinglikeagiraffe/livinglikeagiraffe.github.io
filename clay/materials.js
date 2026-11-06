import * as THREE from 'three';

export function installClay(material,{lightMapRange=0,strength=.14}={}){
  if(!material.isMeshStandardMaterial||material.transmission>0||material.metalness>.1)return;
  material.roughness=Math.max(.78,material.roughness);material.envMapIntensity=.2;
  material.userData.clayStrength={value:strength};
  material.onBeforeCompile=shader=>{
    shader.uniforms.clayStrength=material.userData.clayStrength;
    shader.vertexShader='varying vec3 vClayPosition;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvClayPosition = position;');
    shader.fragmentShader=`varying vec3 vClayPosition; uniform float clayStrength;
float clayHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float clayNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(clayHash(i),clayHash(i+vec3(1,0,0)),f.x),mix(clayHash(i+vec3(0,1,0)),clayHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(clayHash(i+vec3(0,0,1)),clayHash(i+vec3(1,0,1)),f.x),mix(clayHash(i+vec3(0,1,1)),clayHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
`+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
float clayHeight=(clayNoise(vClayPosition*5.)*.7+clayNoise(vClayPosition*17.)*.3)*clayStrength*.045;
vec3 clayDx=dFdx(-vViewPosition),clayDy=dFdy(-vViewPosition);
vec3 clayR1=cross(clayDy,normal),clayR2=cross(normal,clayDx);
float clayDet=dot(clayDx,clayR1);
if(abs(clayDet)>1e-9)normal=normalize(abs(clayDet)*normal-sign(clayDet)*(dFdx(clayHeight)*clayR1+dFdy(clayHeight)*clayR2));`);
    if(lightMapRange){
      const chunk=THREE.ShaderChunk.lights_fragment_maps.replace('lightMapTexel.rgb * lightMapIntensity','lightMapTexel.rgb * lightMapTexel.a * lightMapIntensity').replace('iblIrradiance += getIBLIrradiance( geometryNormal );','// Indirect diffuse is already in the lightmap.');
      shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_maps>',chunk);
    }
  };
  material.customProgramCacheKey=()=>`studio-clay-1:${Boolean(lightMapRange)}`;material.needsUpdate=true;
}

export function hybridPlugin(parser){return {name:'STUDIO_indirect_lightmaps',async afterRoot(gltf){
  const materials=await parser.getDependencies('material');
  await Promise.all(materials.map(async(material,index)=>{
    const spec=parser.json.materials[index].extras?.studioLightMap;
    if(!spec)return;
    if(spec.encoding!=='RGBM'||spec.indirectOnly!==true||!Number.isFinite(spec.range)||spec.range<=0||spec.range>1e8||!Number.isInteger(spec.texture)||spec.texCoord!==0)throw Error('지원하지 않는 간접광 텍스처입니다.');
    const texture=(await parser.getDependency('texture',spec.texture)).clone();texture.colorSpace=THREE.NoColorSpace;texture.channel=0;texture.flipY=false;texture.needsUpdate=true;
    material.lightMap=texture;material.lightMapIntensity=Math.PI*spec.range;material.userData.studioLightMap=spec;
    installClay(material,{lightMapRange:spec.range});
  }));
  gltf.userData.studioHybrid=parser.json.extras?.studioHybrid;
}};}
