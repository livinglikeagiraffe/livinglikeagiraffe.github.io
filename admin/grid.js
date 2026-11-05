export const DEFAULT_GRID = Object.freeze({columns: 4, rows: 3, width: 40, depth: 32, gap: 2});
export function validateGrid(settings) {
  const g = {...DEFAULT_GRID, ...settings};
  for (const k of ['columns','rows']) if (!Number.isInteger(g[k]) || g[k]<1 || g[k]>6) throw Error('격자는 가로·세로 각각 1~6칸으로 설정해 주세요.');
  for (const k of ['width','depth']) if (!Number.isFinite(g[k]) || g[k]<1 || g[k]>200) throw Error('한 칸의 크기는 1~200m로 설정해 주세요.');
  if (!Number.isFinite(g.gap) || g.gap<0 || g.gap>20) throw Error('간격은 0~20m로 설정해 주세요.');
  return g;
}
export function validateLayout(layout, versions) {
  const grid=validateGrid(layout.grid), occupied=new Set(), known=new Set(versions.map(v=>v.id));
  if (!Array.isArray(layout.cells) || layout.cells.length>36) throw Error('잘못된 배치입니다.');
  for (const cell of layout.cells) {
    if (!Number.isInteger(cell.x)||!Number.isInteger(cell.z)||cell.x<0||cell.z<0||cell.x>=grid.columns||cell.z>=grid.rows) throw Error('격자 밖에 있는 모듈을 먼저 이동해 주세요.');
    const key=`${cell.x}:${cell.z}`;
    if(occupied.has(key)) throw Error('같은 칸에 모듈을 두 번 배치할 수 없습니다.');
    if(!known.has(cell.versionId)) throw Error('배치에 사용한 버전을 찾을 수 없습니다.');
    if(![0,90,180,270].includes(cell.rotation)) throw Error('회전은 90도 단위입니다.');
    occupied.add(key);
  }
  return {schema:1,grid,cells:layout.cells.map(c=>({...c}))};
}
export function nextCell(layout) {
  for(let z=0;z<layout.grid.rows;z++) for(let x=0;x<layout.grid.columns;x++) if(!layout.cells.some(c=>c.x===x&&c.z===z))return {x,z};
  return null;
}
export function cellPosition(grid,x,z) {
  return {x:(x-(grid.columns-1)/2)*(grid.width+grid.gap),z:(z-(grid.rows-1)/2)*(grid.depth+grid.gap)};
}
export function fitScale(size,grid,rotation=0) {
  const swap=rotation%180!==0, x=swap?size.z:size.x,z=swap?size.x:size.z;
  // Uniform scale preserves all proportions. Leave a 4% margin inside each cell.
  return Math.min(grid.width*.96/Math.max(x,.001),grid.depth*.96/Math.max(z,.001),1);
}
