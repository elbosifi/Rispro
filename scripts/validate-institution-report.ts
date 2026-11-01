// Synthetic local print proof. Never reads a patient record or PACS instance.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { chromium } from "playwright-core";
import sharp from "sharp";
import { buildNativeReportHtml, type NativeReportPrintData } from "../src/services/generated-print-html-service.js";
import { EMPTY_INSTITUTION_IDENTITY, validateLogo } from "../src/services/institution-identity-service.js";

const output = path.resolve("output/pdf");
await fs.mkdir(output,{recursive:true});
const hospitalLogo = await validateLogo("data:image/png;base64,"+(await fs.readFile("assets/nccb-logo.png")).toString("base64"));
const regular = (await fs.readFile("frontend/src/assets/fonts/NotoNaskhArabic-Regular.ttf")).toString("base64");
const bold = (await fs.readFile("frontend/src/assets/fonts/NotoNaskhArabic-Bold.ttf")).toString("base64");
const image = await sharp(Buffer.from('<svg width="420" height="420"><rect width="420" height="420" fill="black"/><ellipse cx="210" cy="210" rx="140" ry="175" fill="#777"/><ellipse cx="210" cy="210" rx="115" ry="150" fill="#444"/><circle cx="178" cy="180" r="38" fill="#bbb"/><path d="M210 80V340M70 210H350" stroke="#999"/><text x="24" y="30" font-family="Arial" font-size="15" fill="white">SYNTHETIC PRINT TEST - NOT DIAGNOSTIC</text></svg>')).png().toBuffer();
const imageUrl = "data:image/png;base64,"+image.toString("base64");
const report: NativeReportPrintData = {
  appointmentId:1,status:"final",studyKey:"synthetic",id:1,
  identity:{patientName:"SYNTHETIC Patient - Print Validation",patientIdentifier:"TEST-0001",birthDate:"20170101",sex:"M",studyDate:"20261029",studyTime:"111810",modality:"MR",examination:"MRI Brain with IV Contrast",accession:"SYNTHETIC-0001"},
  institution:{...EMPTY_INSTITUTION_IDENTITY,hospitalNameEn:"Synthetic General Hospital",hospitalNameAr:"مستشفى تجريبي عام",departmentNameEn:"Diagnostic Radiology Department",departmentNameAr:"قسم الأشعة التشخيصية",hospitalLogo,website:"https://hospital.example"},
  sections:{clinicalHistory:"Synthetic examination for print layout validation. No clinical patient data.",technique:"Multiplanar sequences before and after intravenous contrast.\nSynthetic protocol text only.",comparison:"No comparison provided.",findings:"Synthetic findings paragraph one. Line breaks and spaces are retained.\nSecond line of the same paragraph.\n\nA separate paragraph describes the synthetic examination.\nهذا سطر عربي تجريبي للتحقق من الطباعة.",impression:"Synthetic impression.\nFor print validation only."},
  author:"Synthetic Author",finalizer:"Dr. Synthetic Signer",finalizedAt:"2026-10-29T10:47:31Z",keyImages:[],addenda:[],
};
const cases: [string,NativeReportPrintData][] = [
  ["report-no-images",report],
  ["report-one-image",{...report,keyImages:[{id:"synthetic-1",caption:"Synthetic key image 1",provenance:{}}]}],
  ["report-five-images",{...report,keyImages:Array.from({length:5},(_,i)=>({id:`synthetic-${i+1}`,caption:`Synthetic key image ${i+1}`,provenance:{}}))}],
  ["report-long",{...report,sections:{...report.sections,findings:Array.from({length:65},(_,i)=>`Synthetic paragraph ${i+1}: report content spans pages naturally.\nRetained line-by-line text without bullets or numbered list formatting.\n`).join("\n")},keyImages:Array.from({length:5},(_,i)=>({id:`synthetic-${i+1}`,caption:`Synthetic key image ${i+1}`,provenance:{}}))}],
  ["report-draft",{...report,status:"draft",finalizer:null,finalizedAt:null}],
  ["report-missing-demographics",{...report,identity:{patientName:"SYNTHETIC Patient",patientIdentifier:"TEST-0002",examination:"CT Head",accession:"",studyDate:""}}],
];
const browser = await chromium.launch({headless:true});
const server = http.createServer(async (req,res) => {
  try {
    const url=new URL(req.url||'/', 'http://localhost');
    if (url.pathname === '/pdf.mjs' || url.pathname === '/pdf.worker.mjs') {
      res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(path.join('frontend/node_modules/pdfjs-dist/build',url.pathname.slice(1))));return;
    }
    const name=url.pathname.slice(1).replace(/\.pdf$/,'');
    if (cases.some(([item])=>item===name)) {res.setHeader('Content-Type','application/pdf');res.end(await fs.readFile(path.join(output,name+'.pdf')));return;}
    res.setHeader('Content-Type','text/html');res.end(`<!doctype html><style>body{margin:0;background:#ddd}canvas{display:block;margin:12px;background:white}</style><script type="module">
      import * as pdfjs from '/pdf.mjs';pdfjs.GlobalWorkerOptions.workerSrc='/pdf.worker.mjs';
      const pdf=await pdfjs.getDocument(new URLSearchParams(location.search).get('file')).promise;
      window.pdfProof=[];
      for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i),view=page.getViewport({scale:1.35});const canvas=document.createElement('canvas');canvas.width=view.width;canvas.height=view.height;document.body.append(canvas);await page.render({canvasContext:canvas.getContext('2d'),viewport:view}).promise;window.pdfProof.push({page:i,width:page.view[2],height:page.view[3],text:(await page.getTextContent()).items.filter(item=>item.str).map(item=>item.str).join(' ')});}
      document.body.dataset.ready='true';</script>`);
  } catch {res.statusCode=500;res.end('Synthetic viewer failed.');}
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
  const page = await browser.newPage({viewport:{width:794,height:1123}});
  for (const [name,data] of cases) {
    const html=buildNativeReportHtml(data)
      .replace("url('/api/native-reporting/print-font/regular')",`url('data:font/ttf;base64,${regular}')`)
      .replace("url('/api/native-reporting/print-font/bold')",`url('data:font/ttf;base64,${bold}')`)
      .replace(/src="\/api\/native-reporting\/[^\"]+"/g,`src="${imageUrl}"`);
    await fs.writeFile(path.join(output,name+".html"),html);
    await page.setContent(html);
    await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(img=>img.decode()));});
    assert.equal(await page.locator('figure').count(),data.keyImages.length);
    assert.equal(await page.locator('h1').textContent(),data.identity.examination);
    assert.equal(await page.locator('.draft').count(),data.status==='draft'?1:0);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
    assert.equal(overflow,false,name+' has horizontal overflow');
    await page.pdf({path:path.join(output,name+".pdf"),format:"A4",preferCSSPageSize:true,displayHeaderFooter:false,printBackground:true});
    console.log('PASS '+name);
  }
  const address=server.address();assert.ok(address&&typeof address==='object');
  const proof=[];
  for(const [name] of cases){
    await page.goto(`http://127.0.0.1:${address.port}/?file=/${name}.pdf`);
    await page.waitForSelector('body[data-ready="true"]');
    const pages=await page.evaluate(()=> (window as unknown as {pdfProof:{page:number;width:number;height:number;text:string}[]}).pdfProof);
    assert.ok(pages.every(p=>Math.abs(p.width-595.28)<1&&Math.abs(p.height-841.89)<1),'A4 size');
    for(const entry of pages){
      assert.ok(entry.text.includes(`${entry.page} / ${pages.length}`),'Accurate page number');
      assert.ok(entry.text.includes('Synthetic General Hospital'),'Institutional header repeats on every page');
      if(name==='report-draft')assert.ok(entry.text.includes('DRAFT / UNSIGNED'));
      await page.locator('canvas').nth(entry.page-1).screenshot({path:path.join(output,`${name}-page-${entry.page}.png`)});
    }
    if(name==='report-long'){
      assert.ok(pages.length>=3);
      const printed=pages.map(p=>p.text).join(' ');
      for(let i=1;i<=65;i++)assert.ok(printed.includes(`Synthetic paragraph ${i}:`),'All long-report paragraphs survive pagination');
    }
    proof.push({name,pages:pages.length});console.log(`PASS rendered ${name}: ${pages.length} A4 pages`);
  }
  await fs.writeFile(path.join(output,'validation.json'),JSON.stringify(proof,null,2));
} finally {await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
