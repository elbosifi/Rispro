import {readFileSync,writeFileSync} from 'node:fs';
const file='artifacts/operational-layout-review/proposed/mockup.html';
let s=readFileSync(file,'utf8');
s=s.replace('Mariam Salem · مريم سالم','TEST PATIENT ONLY · مريض تجريبي');
s=s.replace('<b>Referral.pdf</b><br><span class="secondary">1 page · selected</span>','<b>Imaging request.pdf</b><br><span class="secondary">10 pages · selected</span>');
s=s.replace('<div class="file">Imaging request.pdf<br><span class="secondary">10 pages</span></div>','<div class="file">Referral.pdf<br><span class="secondary">1 page</span></div>');
s=s.replace('.content{overflow:auto;display:flex;flex-direction:column}', '.content{overflow:auto;display:flex;flex-direction:column}.modality .right{order:-1}');
s=s.replace("'<div class=\"empty\"><h3>No request documents yet</h3><p>Attach a request PDF or scan a paper referral.</p><button class=\"primary\">Upload request document</button> <button>Scan paper</button></div>'", "'<div style=\"display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;text-align:left\"><div class=\"panel\" style=\"padding:18px\"><h3>No request documents yet</h3><p>Attach a request PDF or scan a paper referral.</p><div><button class=\"primary\">Upload request document</button> <button>Scan paper</button></div></div><div class=\"panel\" style=\"padding:18px\"><h3>Appointment details</h3><p><b>Examination:</b> CT liver multiphasic with contrast</p><p><b>Status:</b> Scheduled</p><p><b>Preparation:</b> Review patient-specific notes in Details.</p><button>Open patient details</button></div></div>'");
writeFileSync(file,s);
