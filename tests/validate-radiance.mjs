// Runs only in the isolated render worker. Uses the same visible validation UI.
import {chromium} from 'playwright';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const [url,output]=process.argv.slice(2);
if(!url?.startsWith('http://127.0.0.1:')||!output)throw Error('Local validation URL and output directory required');
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.locator('#status').waitFor({state:'hidden',timeout:180000});
 await page.getByRole('button',{name:'이동 범위 검증',exact:true}).click();
 await page.locator('#validation-result').waitFor({state:'attached',timeout:600000});
 const result=JSON.parse(await page.locator('#validation-result').textContent());
 result.report.errors=errors;result.report.passed&&=errors.length===0;
 result.report.modelSha256=createHash('sha256').update(await readFile(output+'/baked.glb')).digest('hex');
 for(const capture of result.captures)await writeFile(`${output}/web-${capture.id}.png`,Buffer.from(capture.png.split(',')[1],'base64'));
 await writeFile(output+'/validation.json',JSON.stringify(result.report,null,2));
 console.log(JSON.stringify(result.report));
 // Retain failed candidates for inspection; save_result enforces publication gate.
}finally{await browser.close();}
