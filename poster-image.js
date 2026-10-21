const posters=new Map();
export function preparePoster(url){
 if(!posters.has(url)){
  const image=new Image();image.fetchPriority='high';image.loading='eager';image.src=url;
  const ready=image.decode().then(()=>image).catch(error=>{posters.delete(url);throw error;});
  posters.set(url,ready);
 }
 return posters.get(url);
}
