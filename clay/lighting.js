import * as THREE from 'three';

export function createLighting(profile,bounds,{mobile=false,offset=new THREE.Vector3()}={}){
  const group=new THREE.Group(),span=Math.max(bounds.getSize(new THREE.Vector3()).length(),10),center=bounds.getCenter(new THREE.Vector3());
  const sources=profile?.lights?.length?profile.lights:[
    {type:'AREA',position:[center.x-span*.3,span*.85,center.z+span*.4],direction:[.3,-1,-.4],color:[1,.93,.83],energy:span*span*7,size:span*.5},
    {type:'AREA',position:[center.x+span*.4,span*.6,center.z-span*.3],direction:[-.3,-1,.2],color:[.88,.93,1],energy:span*span*3,size:span*.5}
  ];
  const ranked=[...sources].sort((a,b)=>b.energy-a.energy);
  ranked.slice(0,24).forEach((source,i)=>{
    const light=source.type==='SUN'?new THREE.DirectionalLight():source.type==='POINT'?new THREE.PointLight():new THREE.SpotLight();
    light.color.setRGB(...source.color);light.position.fromArray(source.position).add(offset);
    if(light.target){light.target.position.copy(light.position).add(new THREE.Vector3().fromArray(source.direction||[0,-1,0]));group.add(light.target);}
    if(light.isSpotLight){light.angle=source.type==='SPOT'?THREE.MathUtils.clamp(source.angle/2,.05,1.5):1.4;light.penumbra=source.type==='SPOT'?.5:1;light.decay=2;}
    // An area emitter radiates into a hemisphere with a cosine distribution.
    // Its on-axis radiant intensity is power/pi, rather than power/(4*pi).
    light.intensity=source.type==='SUN'?source.energy:source.energy/(source.type==='AREA'?Math.PI:4*Math.PI);
    light.userData={energy:light.intensity,role:i===0?'key':'fill'};
    // Shadow budget is bounded independently of the number of uploaded lights.
    light.castShadow=i<(mobile?3:6);
    if(light.shadow){light.shadow.mapSize.setScalar(mobile?1024:2048);light.shadow.camera.near=.05;light.shadow.camera.far=span*5;light.shadow.normalBias=span*.00015;light.shadow.bias=-.00002;light.shadow.radius=source.type==='AREA'?8:3;light.shadow.blurSamples=8;
      if(light.isDirectionalLight)Object.assign(light.shadow.camera,{left:-span,right:span,top:span,bottom:-span});}
    group.add(light);
  });
  return group;
}
