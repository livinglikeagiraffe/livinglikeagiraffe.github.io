import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bindGalleryDrag} from '../gallery-drag.js';
class Target extends EventTarget {
 scrollLeft=0; captured=new Set(); classes=new Set();
 classList={add:n=>this.classes.add(n),remove:n=>this.classes.delete(n)};
 setPointerCapture(id){this.captured.add(id)}
 hasPointerCapture(id){return this.captured.has(id)}
 releasePointerCapture(id){this.captured.delete(id);this.dispatchEvent(new Event('lostpointercapture'))}
}
function event(target,type,props={}){
 const e=new Event(type,{cancelable:true});Object.assign(e,{pointerType:'mouse',pointerId:1,isPrimary:true,button:0,buttons:1,clientX:200,clientY:100,...props});target.dispatchEvent(e);return e;
}
test('touch remains native even before images load; missed mouse releases recover',()=>{
 globalThis.window=new Target();globalThis.document=new Target();
 const track=new Target(),selected=[];
 const dispose=bindGalleryDrag(track,[{offsetLeft:0},{offsetLeft:300},{offsetLeft:600}],i=>selected.push(i));
 event(track,'pointerdown',{pointerType:'touch'});
 assert.equal(event(track,'pointermove',{pointerType:'touch',clientX:40}).defaultPrevented,false);
 assert.equal(track.scrollLeft,0);assert.equal(track.classes.size,0);
 event(track,'pointerdown');event(track,'pointermove',{clientX:100});
 event(window,'pointerup',{clientX:100});assert.deepEqual(selected,[1]);
 event(track,'pointerdown'); // release lost before pointer capture
 event(track,'pointerdown');event(track,'pointermove',{clientX:100});
 event(window,'pointerup',{clientX:100});assert.equal(selected.length,2);
 event(track,'pointerdown');event(track,'pointermove',{clientX:100});
 track.releasePointerCapture(1);assert.equal(track.classes.size,0);
 event(track,'pointerdown');event(track,'pointermove',{clientX:100});
 window.dispatchEvent(new Event('blur'));assert.equal(track.classes.size,0);
 event(track,'pointerdown');event(track,'pointermove',{clientX:100});
 event(window,'pointercancel');assert.equal(track.classes.size,0);
 dispose();event(track,'pointerdown');event(track,'pointermove',{clientX:0});assert.equal(track.classes.size,0);
});
