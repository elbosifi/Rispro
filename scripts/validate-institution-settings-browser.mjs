// Built application, synthetic HTTP responses only. No patient or live settings writes.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright-core';

const output=path.resolve('test-results/institution-ui');await fs.mkdir(output,{recursive:true});
let identity={hospitalNameEn:'Synthetic Hospital',hospitalNameAr:'مستشفى تجريبي',departmentNameEn:'Radiology',departmentNameAr:'قسم الأشعة',addressEn:'Synthetic address',addressAr:'عنوان تجريبي',contactInformation:'',primaryPhone:'0123456789',secondaryPhone:'',website:'https://hospital.example',hospitalLogo:'/assets/nccb-logo.png',departmentLogo:''};
const seen=new Set(),errors=[];
const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
  if(pathname.startsWith('/api/')){
    seen.add(pathname);
    if(pathname.endsWith('/institution-identity')){
      if(req.method==='PUT'){let body='';for await(const chunk of req)body+=chunk;identity=JSON.parse(body);}
      json(identity);return;
    }
    if(pathname==='/api/auth/me'){json({user:{id:1,username:'synthetic-admin',fullName:'Synthetic Administrator',role:'super_admin',mustChangePassword:false}});return;}
    if(pathname.endsWith('/page-visibility')){json({matrix:{}});return;}
    if(pathname==='/api/action-pin/status'){json({hasPin:false,idleLockEligible:false,idleLockActive:false,policy:{enabled:false,idleLockEnabled:false,idleLockSeconds:600}});return;}
    if(pathname==='/api/settings/deployment-identity'){json({publicAppBaseUrl:'https://rispro.example.org',updatedAt:new Date().toISOString()});return;}
    if(pathname==='/api/settings/https/status'){json({enabled:false,provider:'acmedns',providerConfigurations:{acmedns:null,cloudflare:null},hostname:'',serverUrl:'',subdomain:'',fullDomain:'',credentialsConfigured:false,encryptionReady:true,provisioned:false,managementTransportReady:true,redirectHttpToHttps:false,httpRedirectActive:false,status:'Pending',activationPending:false});return;}
    if(pathname==='/api/doctor/me'){json({hasPortalAccess:false,profile:null,allowedModalities:[],moduleCapabilities:[]});return;}
    if(pathname==='/api/teaching/identity'){json({permissions:[],displayName:'Synthetic Administrator'});return;}
    json({settings:[],notifications:[],requests:[],rows:[],permissions:[],unreadCount:0,pendingCount:0});return;
  }
  try {
    const relative=pathname==='/'||!path.extname(pathname)?'index.html':pathname.slice(1);
    const root=path.resolve('dist-frontend'),file=path.resolve(root,relative);
    if(!file.startsWith(root+path.sep))throw Error();
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':file.endsWith('.ttf')?'font/ttf':'text/html');res.end(await fs.readFile(file));
  } catch {res.statusCode=404;res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();
const browser=await chromium.launch({headless:true});
try {
  const context=await browser.newContext();await context.addInitScript(()=>localStorage.setItem('rispro-language',new URLSearchParams(location.search).get('language')==='ar'?'ar':'en'));
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  for(const [name,width,height] of [['desktop',1440,1080],['mobile',390,844],['arabic-mobile',390,844]]){
    const arabic=name==='arabic-mobile';
    await page.setViewportSize({width,height});
    await page.goto(`http://127.0.0.1:${address.port}/settings?section=deployment_identity${arabic?'&language=ar':''}`);
    const hospitalInput=page.getByLabel(arabic?'اسم المستشفى (الإنجليزية)':'Hospital name (English)');
    await hospitalInput.waitFor().catch(async error=>{
      console.log(JSON.stringify({errors,apiFixtures:[...seen],body:(await page.locator('body').innerText()).slice(0,4000)}));throw error;
    });
    assert.equal(await page.getByLabel(arabic?'اسم المستشفى (العربية)':'Hospital name (Arabic)').getAttribute('dir'),'rtl');
    await hospitalInput.fill('Synthetic Hospital Updated');
    await page.getByRole('button',{name:arabic?'حفظ هوية المؤسسة':'Save institution identity',exact:true}).click();
    await page.getByText(arabic?'تم الحفظ.':'Institution identity saved.',{exact:true}).waitFor();
    assert.equal(identity.hospitalNameEn,'Synthetic Hospital Updated');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:path.join(output,`settings-${name}.png`),fullPage:true});
    console.log(`PASS settings ${name}: bilingual input, save, no horizontal overflow`);
  }
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,'validation.json'),JSON.stringify({apiFixtures:[...seen],pageErrors:errors},null,2));
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
