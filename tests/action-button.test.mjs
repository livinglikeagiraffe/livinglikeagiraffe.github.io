import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bindActionButton} from '../action-button.js';
class Button extends EventTarget {
 dataset={};disabled=false;capture=null;
 setPointerCapture(id){this.capture=id}
 hasPointerCapture(id){return this.capture===id}
 releasePointerCapture(){this.capture=null;this.dispatchEvent(new Event('lostpointercapture'))}
 getBoundingClientRect(){return {left:0,right:200,top:0,bottom:60}}
}
function send(button,type,props={}){
 const event=new Event(type,{cancelable:true});Object.assign(event,{pointerId:1,pointerType:'touch',button:0,isPrimary:true,clientX:50,clientY:30,...props});button.dispatchEvent(event);return event;
}
test('first touch activates once on release and provides press feedback',()=>{
 globalThis.window=new EventTarget();let count=0;const b=new Button();bindActionButton(b,()=>count++);
 send(b,'pointerdown');assert.ok('pressed' in b.dataset);assert.equal(count,0);
 send(b,'pointerup');assert.equal(count,1);assert.ok(!('pressed' in b.dataset));
 send(b,'click');assert.equal(count,1);
 send(b,'pointerdown');send(b,'pointerup');send(b,'click');assert.equal(count,2);
});
test('cancelled or moved touches never activate, mouse and keyboard still work',()=>{
 globalThis.window=new EventTarget();let count=0;const b=new Button();bindActionButton(b,()=>count++);
 send(b,'pointerdown');send(b,'pointermove',{clientX:90});send(b,'pointerup',{clientX:90});send(b,'click');assert.equal(count,0);
 send(b,'pointerdown');send(b,'pointercancel');send(b,'click');assert.equal(count,0);
 const mouse=new Button();bindActionButton(mouse,()=>count++);
 send(mouse,'pointerdown',{pointerType:'mouse'});send(mouse,'pointerup',{pointerType:'mouse'});send(mouse,'click');assert.equal(count,1);
 send(mouse,'click',{detail:0});assert.equal(count,2);
});
