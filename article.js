import { createMediaViewer } from './media-viewer.js';
// Original project copy and local media, read from the four supplied posts.
const posts=await fetch('./assets/projects/posts.json').then(r=>{if(!r.ok)throw Error('Project media unavailable');return r.json();});
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const external=(url,label)=>`<a href="${escape(url)}" target="_blank" rel="noopener">${escape(label)}</a>`;
function gallery(key,title){
 const post=posts[key];
 return `<div class="media-gallery${post.media.every(m=>m.width&&m.height)?' natural-media':''}" data-gallery="${key}" data-title="${title}"><div class="media-track" tabindex="0" aria-label="${title} 갤러리">${post.media.map((m,i)=>`<figure class="media-slide"${m.width&&m.height?` style="--media-ratio:${m.width/m.height}"`:""} aria-label="${i+1} / ${post.media.length}"><button class="media-open" aria-label="${title} ${i+1} 크게 보기">${m.type==='video'?`<video muted loop playsinline preload="none" poster="${m.poster}" aria-label="${title} 영상 ${i+1}"><source src="${m.src}" type="video/mp4"></video>`:`<img src="${m.src}" alt="${title} 사진 ${i+1}" loading="lazy" decoding="async">`}</button></figure>`).join('')}</div><div class="gallery-controls"><span data-count aria-live="polite">01 / ${String(post.media.length).padStart(2,'0')}</span><div><button data-prev aria-label="${title} 이전 미디어">←</button><button data-next aria-label="${title} 다음 미디어">→</button></div></div></div>`;
}
function originalCopy(key){
 const body=posts[key].caption.split(/\n\n기획[ |@]/)[0];
 const lines=body.split('\n');const title=lines.shift();
 return `<h3 class="intro-heading">${escape(title)}</h3>${lines.join('\n').trim().split(/\n\s*\n/).map(p=>`<p>${escape(p.replace(/\s*\n\s*/g,' '))}</p>`).join('')}`;
}
function credits(key){
 const caption=posts[key].caption;
 const start=caption.search(/\n기획[ |@]/);
 const lines=caption.slice(start).trim().split('\n');
 return `<dl class="project-credits">${lines.map(line=>{const handles=line.match(/@[a-zA-Z0-9._]+/g)||[];const role=line.split('@')[0].replace(/\|/g,'').trim();return `<div><dt>${escape(role)}</dt><dd>${handles.map(h=>external(`https://www.instagram.com/${h.slice(1)}/`,h)).join(' ')}</dd></div>`;}).join('')}</dl>`;
}
export function renderArticle(project){
 const sauna=project.id==='sauna',key=sauna?'sauna-intro':'sports-intro',extra=sauna?'sauna-bts':'sports-photos',extraTitle=sauna?'BTS':'현장 사진';
 return `<figure class="article-hero"><button class="hero-open" aria-label="${project.title} 포스터 크게 보기"><img class="hero-poster" src="${project.image}" alt="${project.title} 공식 포스터" width="1440" height="1800"></button><figcaption class="poster-caption"><strong>${project.title}</strong><time datetime="${project.date.replaceAll('.','-')}">${project.date}</time></figcaption></figure><div class="detail-body"><nav class="article-toc" aria-label="글 목차"><a href="#project-intro">프로젝트 소개</a><a href="#project-gallery">${extraTitle}</a><a href="#project-people">만든 사람들</a></nav><section id="project-intro"><h2>프로젝트 소개</h2>${gallery(key,'프로젝트 소개')}${originalCopy(key)}<p class="article-links">${external(posts[key].post,sauna?'현장 영상과 후기':'프로젝트 소개')}</p></section><section id="project-gallery"><h2>${extraTitle}</h2>${gallery(extra,extraTitle)}<p class="article-links">${external(posts[extra].post,extraTitle)}</p></section><section id="project-people"><h2>만든 사람들</h2>${credits(key)}</section><footer class="article-author"><a href="https://www.instagram.com/livinglikeagiraffe_/" target="_blank" rel="noopener" aria-label="Living Like a Giraffe Instagram"><img src="assets/projects/team-profile.jpg" width="32" height="32" alt="Living Like a Giraffe 프로필"><span><span class="author-by">by </span>Living Like a Giraffe</span></a></footer></div>`;
}
export function mountArticle(root){
 const disposers=[];const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const videos=[...root.querySelectorAll('video')],visibility=new Map();let active=true;
 function syncVideos(){const canPlay=active&&!document.hidden&&!viewer.isOpen;videos.forEach(video=>{
  if(canPlay&&(visibility.get(video)||0)>=.55){video.muted=true;video.play().catch(()=>{});}else video.pause();
 });}
 const viewer=createMediaViewer({onOpen:()=>videos.forEach(v=>v.pause()),onClose:syncVideos});
 // IntersectionObserver accounts for both the article viewport and horizontal clipping.
 const observer=new IntersectionObserver(entries=>{entries.forEach(entry=>visibility.set(entry.target,entry.intersectionRatio));syncVideos();},{threshold:[0,.1,.55,.9]});
 videos.forEach(video=>{video.muted=true;observer.observe(video);});
 document.addEventListener('visibilitychange',syncVideos);
 root.querySelectorAll('[data-gallery]').forEach(gallery=>{
  const track=gallery.querySelector('.media-track'),slides=[...track.children],counter=gallery.querySelector('[data-count]'),prev=gallery.querySelector('[data-prev]'),next=gallery.querySelector('[data-next]');
  let index=0,raf=0;
  const select=()=>{index=slides.reduce((best,slide,i)=>Math.abs(slide.offsetLeft-track.scrollLeft)<Math.abs(slides[best].offsetLeft-track.scrollLeft)?i:best,0);counter.textContent=`${String(index+1).padStart(2,'0')} / ${String(slides.length).padStart(2,'0')}`;prev.disabled=index===0;next.disabled=index===slides.length-1;};
  const scroll=()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(select);};
  const go=direction=>{const slide=slides[Math.max(0,Math.min(slides.length-1,index+direction))];track.scrollTo({left:slide.offsetLeft,behavior:reduced?'instant':'smooth'});};
  prev.onclick=()=>go(-1);next.onclick=()=>go(1);track.addEventListener('scroll',scroll,{passive:true});
  const keydown=e=>{if(e.target!==track)return;if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();go(e.key==='ArrowRight'?1:-1);}};track.addEventListener('keydown',keydown);select();
  slides.forEach((slide,i)=>{const button=slide.querySelector('.media-open');button.onclick=()=>viewer.open(posts[gallery.dataset.gallery].media,i,gallery.dataset.title,button);});
  disposers.push(()=>{cancelAnimationFrame(raf);track.removeEventListener('scroll',scroll);track.removeEventListener('keydown',keydown);});
 });
 const hero=root.querySelector('.hero-open');hero.onclick=()=>viewer.open([{type:'image',src:hero.querySelector('img').getAttribute('src')}],0,'프로젝트 포스터',hero);
 // One set of section destinations, presented beside the article or as a sticky mobile bar.
 const dialog=root.closest('dialog'),toc=root.querySelector('.article-toc'),sideToc=toc.cloneNode(true);
 sideToc.className='summary-toc';sideToc.setAttribute('aria-label','프로젝트 목차');
 dialog.querySelector('.summary-team').before(sideToc);
 const links=[...toc.querySelectorAll('a'),...sideToc.querySelectorAll('a')];
 const sections=[...root.querySelectorAll('.detail-body section[id]')];
 const mobile=matchMedia('(max-width:650px)');let tocFrame=0;
 function updateToc(){
  const tocRect=toc.getBoundingClientRect();
  toc.classList.toggle('is-stuck',mobile.matches&&tocRect.top<=1);
  const inset=mobile.matches?tocRect.height+16:32;
  let current=null;
  for(const section of sections){if(section.getBoundingClientRect().top<=inset+2)current=section.id;}
  const scroller=mobile.matches?dialog:root;
  if(scroller.scrollTop>0&&scroller.scrollTop+scroller.clientHeight>=scroller.scrollHeight-2)current=sections.at(-1).id;
  links.forEach(a=>{if(a.hash==='#'+current)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');});
 }
 const scheduleToc=()=>{cancelAnimationFrame(tocFrame);tocFrame=requestAnimationFrame(updateToc);};
 const measureToc=()=>{root.style.setProperty('--toc-height',`${toc.getBoundingClientRect().height}px`);scheduleToc();};
 const tocSize=new ResizeObserver(measureToc);tocSize.observe(toc);
 links.forEach(a=>a.onclick=e=>{e.preventDefault();root.querySelector(a.hash)?.scrollIntoView({behavior:reduced?'instant':'smooth',block:'start'});});
 dialog.addEventListener('scroll',scheduleToc,true);window.addEventListener('resize',measureToc);measureToc();
 disposers.push(()=>{cancelAnimationFrame(tocFrame);tocSize.disconnect();dialog.removeEventListener('scroll',scheduleToc,true);window.removeEventListener('resize',measureToc);sideToc.remove();});
 return ()=>{active=false;disposers.forEach(fn=>fn());observer.disconnect();document.removeEventListener('visibilitychange',syncVideos);viewer.destroy();videos.forEach(v=>v.pause());};
}
