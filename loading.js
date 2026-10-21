import * as THREE from 'three';
import { mobile } from './quality.js';

const screen = document.querySelector('#loading');
const label = document.querySelector('#loading-status');
const retry = document.querySelector('#loading-retry');
let pending = 0, failed = false;
const manager = THREE.DefaultLoadingManager;
const start = manager.itemStart.bind(manager), end = manager.itemEnd.bind(manager);
manager.itemStart = url => { pending++; start(url); };
manager.itemEnd = url => { pending--; end(url); };
manager.onError = () => { failed = true; };
if (mobile) manager.setURLModifier(url => {
  // GLB embedded images use blob URLs; they are already resized offline.
  return url.replace(/^(?:\.\/)?assets\/(green-grass|props|giraffe)\//, './assets/mobile/$1/');
});
retry.onclick = () => location.reload();
export function stage(message) { label.textContent = message; }
export async function settled() {
  // Nested glTF texture requests can begin after the model file completes.
  let quiet = 0;
  const deadline = Date.now() + 120000;
  while (quiet < 2) {
    await new Promise(resolve => setTimeout(resolve, 60));
    quiet = pending === 0 ? quiet + 1 : 0;
    if (Date.now() > deadline) throw Error('Asset loading timed out');
  }
  if (failed) throw Error('Asset loading failed');
}
export function finishLoading() {
  screen.hidden = true;
  document.body.removeAttribute('data-loading');
}
export function failLoading(error) {
  console.error(error);
  screen.hidden = false;
  document.body.dataset.loading = 'true';
  label.textContent = '초원을 불러오지 못했어요. 다시 시도해 주세요.';
  retry.hidden = false;
}
