// Versioned, bounded values only. Never persist Three.js instances or credentials.
export const LOOK_DEFAULTS=Object.freeze({schema:1,exposure:-.15,key:1,fill:.85,ambient:.18,softness:18,contact:1,roughness:1,texture:.4,warmth:.1,contrast:1.12,saturation:1.1,background:'#aaa79f',tone:'aces',camera:'authored'});
export const LOOK_RANGES=Object.freeze({exposure:[-2,2],key:[0,3],fill:[0,3],ambient:[0,1],softness:[1,40],contact:[0,2],roughness:[.5,1.5],texture:[0,2],warmth:[-1,1],contrast:[.7,1.4],saturation:[.5,1.5]});
export function normalizeLook(value={}){
  const look={...LOOK_DEFAULTS};
  for(const [key,[min,max]] of Object.entries(LOOK_RANGES))if(typeof value?.[key]==='number'&&Number.isFinite(value[key]))look[key]=Math.min(max,Math.max(min,value[key]));
  if(/^#[\da-f]{6}$/i.test(value?.background))look.background=value.background;
  if(['neutral','aces','agx'].includes(value?.tone))look.tone=value.tone;
  if(['authored','fit'].includes(value?.camera))look.camera=value.camera;
  return look;
}
export function sceneProfile(value){
  const vector=(v,n)=>Array.isArray(v)&&v.length===n&&v.every(x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<1e7);
  if(value?.schema!==1||value.coordinateSystem!=='gltf-y-up')return null;
  const lights=(Array.isArray(value.lights)?value.lights:[]).filter(l=>l&&vector(l.position,3)&&vector(l.direction,3)&&vector(l.color,3)&&Number.isFinite(l.energy)&&l.energy>=0&&l.energy<1e8).slice(0,24).map(l=>({...l,size:Number.isFinite(l.size)?Math.min(10000,Math.max(.2,l.size)):1,angle:Number.isFinite(l.angle)?l.angle:Math.PI/2}));
  const c=value.camera,camera=c&&['ORTHO','PERSP'].includes(c.type)&&vector(c.position,3)&&vector(c.quaternion,4)&&Number.isFinite(c.orthoScale)&&c.orthoScale>0&&Number.isFinite(c.aspect)&&c.aspect>.01&&c.aspect<100&&(c.type==='ORTHO'||Number.isFinite(c.fov)&&c.fov>.01&&c.fov<Math.PI)?c:null;
  return {schema:1,coordinateSystem:'gltf-y-up',camera,lights,world:value.world,view:value.view,source:value.source};
}
