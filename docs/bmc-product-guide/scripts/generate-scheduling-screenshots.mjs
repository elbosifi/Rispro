import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const screenshotsDir = path.resolve("docs/bmc-product-guide/screenshots");
const tempHtmlDir = path.resolve("docs/bmc-product-guide/screenshots/temp_html");

if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}
if (!fs.existsSync(tempHtmlDir)) {
  fs.mkdirSync(tempHtmlDir, { recursive: true });
}

const cssPath = pathToFileURL(path.resolve("dist-frontend/assets/index-DBJa6AoA.css")).href;

function baseHtmlWrapper(title, content, dir = "ltr", lang = "en") {
  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="UTF-8">
  <title>${title} - RISpro Benghazi Medical Center</title>
  <link rel="stylesheet" href="${cssPath}">
  <style>
    :root {
      --background: #f8fafc;
      --foreground: #0f172a;
      --card: #ffffff;
      --card-foreground: #0f172a;
      --border: #e2e8f0;
      --muted: #f1f5f9;
      --muted-foreground: #64748b;
      --accent: #2563eb;
      --accent-foreground: #ffffff;
      --radius-sm: 6px;
      --radius-md: 8px;
      --radius-lg: 12px;
      --radius-xl: 16px;
      --control-height-sm: 36px;
      --control-height-md: 40px;
      --control-height-lg: 48px;
    }
    body {
      margin: 0;
      background-color: var(--background);
      color: var(--foreground);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .header-bar {
      height: 60px;
      background: #1e293b;
      color: white;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 24px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      border-radius: 9999px;
      padding: 2px 10px;
      font-size: 12px;
      font-weight: 600;
    }
    .badge-success { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
    .badge-warning { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
    .badge-error { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
    .badge-info { background: #e0f2fe; color: #075985; border: 1px solid #7dd3fc; }
  </style>
</head>
<body class="bg-slate-50 text-slate-900">
  <header class="header-bar">
    <div style="display: flex; align-items: center; gap: 12px;">
      <div style="font-weight: 800; font-size: 18px; letter-spacing: -0.5px; display: flex; align-items: center; gap: 8px;">
        <span style="background: #2563eb; color: white; padding: 4px 8px; border-radius: 6px; font-size: 14px;">RISpro</span>
        <span>Benghazi Medical Center</span>
      </div>
      <span style="background: rgba(255,255,255,0.15); padding: 2px 8px; border-radius: 4px; font-size: 11px;">Radiology Directorate</span>
    </div>
    <div style="display: flex; align-items: center; gap: 16px; font-size: 13px;">
      <span><strong>Logged in:</strong> Dr. Tariq El-Fitouri (Radiology Operations Lead / Supervisor)</span>
      <span class="badge badge-success">System Online</span>
    </div>
  </header>
  <main style="padding: 24px; max-width: 1400px; margin: 0 auto;">
    ${content}
  </main>
</body>
</html>`;
}

// 1. Overview Dashboard
const overviewHtml = baseHtmlWrapper("Scheduling Policy Administration", `
  <div class="scheduling-policy-page mx-auto grid w-full max-w-[1200px] gap-6">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h1 style="font-size: 24px; font-weight: 800; margin: 0; color: #0f172a;">Scheduling Policy & Capacity Management</h1>
        <p style="margin: 4px 0 0; color: #64748b; font-size: 14px;">Define modality capacity limits, seasonal downtimes, exam mix constraints, and emergency surge quotas.</p>
      </div>
      <div style="display: flex; gap: 10px;">
        <button style="background: white; border: 1px solid #cbd5e1; padding: 8px 16px; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer;">Export Policy Snapshot</button>
        <button style="background: #2563eb; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 6px;">
          <span>+ Create New Draft</span>
        </button>
      </div>
    </div>

    <!-- Modality Selector Card -->
    <div style="background: white; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px 24px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
      <div style="display: flex; gap: 24px; align-items: center;">
        <div>
          <label style="display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 4px;">Active Modality</label>
          <select style="font-size: 15px; font-weight: 700; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 12px; background: #f8fafc; color: #0f172a;">
            <option>CT-01 (Siemens Somatom Definition 64 — Emergency/Trauma)</option>
            <option>CT-02 (GE Revolution EVO 128 — Outpatient/Cardiac)</option>
            <option>MRI-01 (Philips Ingenia 3.0T — Neuro & MSK)</option>
            <option>US-01 (Canon Aplio a550 — General & Vascular)</option>
          </select>
        </div>
        <div style="height: 36px; width: 1px; background: #e2e8f0;"></div>
        <div>
          <span style="display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b;">Daily Modality Capacity</span>
          <span style="font-size: 18px; font-weight: 800; color: #1e293b;">40 Patients / Day</span>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 12px;">
        <span class="badge badge-success" style="padding: 4px 12px; font-size: 13px;">● Live Version v4 Active</span>
        <span class="badge badge-warning" style="padding: 4px 12px; font-size: 13px;">✎ Draft v5 in Staging</span>
      </div>
    </div>

    <!-- Status Overview Grid -->
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;">
      <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px;">
        <div style="font-size: 12px; font-weight: 600; color: #64748b;">Category Limits (Daily)</div>
        <div style="font-size: 20px; font-weight: 800; color: #0f172a; margin-top: 4px;">25 Onc / 15 Non-Onc</div>
        <div style="font-size: 12px; color: #16a34a; margin-top: 4px;">Balanced (Sum: 40/40)</div>
      </div>
      <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px;">
        <div style="font-size: 12px; font-weight: 600; color: #64748b;">Maintenance Blocks</div>
        <div style="font-size: 20px; font-weight: 800; color: #0f172a; margin-top: 4px;">1 Active Window</div>
        <div style="font-size: 12px; color: #64748b; margin-top: 4px;">Tube Recalibration Dec 28</div>
      </div>
      <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px;">
        <div style="font-size: 12px; font-weight: 600; color: #64748b;">Exam Mix Quotas</div>
        <div style="font-size: 20px; font-weight: 800; color: #0f172a; margin-top: 4px;">2 Active Groups</div>
        <div style="font-size: 12px; color: #0284c7; margin-top: 4px;">Contrast Studies (Max 4/day)</div>
      </div>
      <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px;">
        <div style="font-size: 12px; font-weight: 600; color: #64748b;">Special Quota Pools</div>
        <div style="font-size: 20px; font-weight: 800; color: #0f172a; margin-top: 4px;">5 Extra Slots</div>
        <div style="font-size: 12px; color: #9333ea; margin-top: 4px;">ICU / Inpatient Surge Pool</div>
      </div>
    </div>

    <!-- Active Working Draft Banner -->
    <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px 20px; display: flex; justify-content: space-between; align-items: center;">
      <div style="display: flex; gap: 14px; align-items: center;">
        <div style="background: #2563eb; color: white; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800;">5</div>
        <div>
          <div style="font-weight: 700; color: #1e3a8a; font-size: 15px;">Working Draft v5 (Unpublished Changes Staged)</div>
          <div style="font-size: 13px; color: #3b82f6;">Modified today by Dr. Tariq El-Fitouri: Added Alternate-Week Parity to Cardiac CT and increased ICU Surge Extra Quota.</div>
        </div>
      </div>
      <div style="display: flex; gap: 10px;">
        <button style="background: white; color: #dc2626; border: 1px solid #fca5a5; padding: 6px 14px; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer;">Discard Draft</button>
        <button style="background: #2563eb; color: white; border: none; padding: 6px 18px; border-radius: 6px; font-weight: 700; font-size: 13px; cursor: pointer;">Review Diff & Publish</button>
      </div>
    </div>
  </div>
`);

// 2. Scenario 1: Policy Draft Editor - Exam Mix Quota Groups
const scenario1ConfigHtml = baseHtmlWrapper("Scenario 1: Exam Mix Quota Configuration", `
  <div class="mx-auto w-full max-w-[1200px] space-y-6">
    <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <div style="font-size: 13px; font-weight: 700; color: #2563eb; text-transform: uppercase;">Scenario 1 Configuration</div>
        <h1 style="font-size: 22px; font-weight: 800; color: #0f172a; margin: 2px 0 0;">Exam Mix Quota Groups — CT-01 (Siemens Somatom 64)</h1>
      </div>
      <span class="badge badge-info" style="font-size: 13px; padding: 4px 12px;">Policy Draft Editor · Tab 4</span>
    </div>

    <!-- Policy Editor Container -->
    <div style="background: white; border: 1px solid #cbd5e1; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.04);">
      <div style="background: #f1f5f9; padding: 12px 20px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
        <div style="font-weight: 700; font-size: 15px; color: #1e293b;">Active Configuration: Complex Studies Safety Ceiling</div>
        <span style="font-size: 12px; color: #64748b;">Enforces maximum safe daily volume for multiphasic IV contrast exams</span>
      </div>

      <div style="padding: 24px; display: grid; gap: 20px;">
        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px;">
          <div>
            <label style="display: block; font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 6px;">Exam Mix Group Title</label>
            <input type="text" value="Complex Abdomen & Pelvis Contrast Studies" style="width: 100%; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 12px; font-size: 14px; font-weight: 600; color: #0f172a; box-sizing: border-box;" readonly>
          </div>
          <div>
            <label style="display: block; font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 6px;">Daily Group Limit (Slots)</label>
            <div style="display: flex; align-items: center; gap: 8px;">
              <input type="number" value="4" style="width: 80px; border: 2px solid #2563eb; border-radius: 6px; padding: 8px 12px; font-size: 16px; font-weight: 800; color: #1e3a8a; text-align: center;" readonly>
              <span style="font-size: 13px; color: #64748b; font-weight: 500;">Max 4 cases / calendar day</span>
            </div>
          </div>
        </div>

        <div>
          <label style="display: block; font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 6px;">Included High-Acuity Examination Types (3 Selected)</label>
          <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; background: #f8fafc; display: flex; flex-wrap: wrap; gap: 10px;">
            <div style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; padding: 6px 12px; border-radius: 6px; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px;">
              <span>✓ CT Abdomen & Pelvis with IV Contrast (Code: CT-ABD-PEL-C)</span>
            </div>
            <div style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; padding: 6px 12px; border-radius: 6px; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px;">
              <span>✓ CT Triphasic Liver & Pancreas Protocol (Code: CT-LIV-3PH)</span>
            </div>
            <div style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; padding: 6px 12px; border-radius: 6px; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px;">
              <span>✓ CT Enterography with Oral & IV Contrast (Code: CT-ENT-VOL)</span>
            </div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; background: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0;">
          <div>
            <span style="font-size: 12px; font-weight: 700; text-transform: uppercase; color: #64748b;">Recurrence Schedule</span>
            <div style="font-size: 14px; font-weight: 600; color: #1e293b; margin-top: 2px;">Daily (Sunday through Thursday)</div>
            <div style="font-size: 12px; color: #64748b;">Active every standard hospital operating day</div>
          </div>
          <div>
            <span style="font-size: 12px; font-weight: 700; text-transform: uppercase; color: #64748b;">Exhaustion Enforcement</span>
            <div style="font-size: 14px; font-weight: 600; color: #b45309; margin-top: 2px;">Soft Constraint (Supervisor Override Permitted)</div>
            <div style="font-size: 12px; color: #64748b;">Requires Radiology Supervisor PIN and documented clinical indication</div>
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 12px; border-top: 1px solid #e2e8f0; padding-top: 16px;">
          <button style="background: white; border: 1px solid #cbd5e1; padding: 8px 16px; border-radius: 6px; font-weight: 600; font-size: 13px;">Cancel</button>
          <button style="background: #2563eb; color: white; border: none; padding: 8px 20px; border-radius: 6px; font-weight: 700; font-size: 13px;">Save Draft Rule</button>
        </div>
      </div>
    </div>
  </div>
`);

// 3. Scenario 1: Availability Calendar - Quota Capacity Status
const scenario1CalendarHtml = baseHtmlWrapper("Scenario 1: Calendar Quota Status", `
  <div class="mx-auto w-full max-w-[1200px] space-y-6">
    <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <div style="font-size: 13px; font-weight: 700; color: #2563eb; text-transform: uppercase;">Appointment Calendar View</div>
        <h1 style="font-size: 22px; font-weight: 800; color: #0f172a; margin: 2px 0 0;">Availability Matrix — CT-01 (Siemens Somatom 64)</h1>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <span style="font-size: 13px; color: #64748b;">Viewing window:</span>
        <span style="background: white; border: 1px solid #cbd5e1; padding: 4px 10px; border-radius: 6px; font-size: 13px; font-weight: 600;">Nov 08 – Nov 12, 2026</span>
      </div>
    </div>

    <!-- Availability Rows Table -->
    <div style="background: white; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
      <div style="background: #f8fafc; border-bottom: 1px solid #e2e8f0; padding: 12px 20px; display: grid; grid-template-columns: 140px 180px 1fr 200px 120px; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase;">
        <div>Date & Day</div>
        <div>Modality Capacity</div>
        <div>Category Distribution (Onc / Non-Onc)</div>
        <div>Exam Mix Quota Status</div>
        <div style="text-align: right;">Action</div>
      </div>

      <!-- Row 1: Sunday Nov 08 (Normal) -->
      <div style="padding: 16px 20px; border-bottom: 1px solid #f1f5f9; display: grid; grid-template-columns: 140px 180px 1fr 200px 120px; align-items: center;">
        <div>
          <div style="font-weight: 800; font-size: 15px; color: #0f172a;">2026-11-08</div>
          <div style="font-size: 12px; color: #64748b;">Sunday (Session 1)</div>
        </div>
        <div>
          <span class="badge badge-success" style="font-size: 12px;">● 22 Slots Free</span>
          <div style="font-size: 12px; color: #64748b; margin-top: 4px;">18/40 Total Booked</div>
        </div>
        <div>
          <div style="height: 10px; width: 80%; background: #e2e8f0; border-radius: 5px; overflow: hidden; display: flex;">
            <div style="width: 30%; background: #3b82f6;" title="Oncology: 12/25"></div>
            <div style="width: 15%; background: #10b981;" title="Non-Oncology: 6/15"></div>
          </div>
          <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Onc: 12/25 booked · Non-Onc: 6/15 booked</div>
        </div>
        <div>
          <span style="font-size: 12px; font-weight: 700; color: #0369a1;">Contrast Mix: 2/4 Used</span>
          <div style="font-size: 11px; color: #16a34a;">2 slots available today</div>
        </div>
        <div style="text-align: right;">
          <button style="background: #2563eb; color: white; border: none; padding: 6px 14px; border-radius: 6px; font-weight: 600; font-size: 12px; cursor: pointer;">Book Slot</button>
        </div>
      </div>

      <!-- Row 2: Monday Nov 09 (Exam Mix Approaching Limit) -->
      <div style="padding: 16px 20px; border-bottom: 1px solid #f1f5f9; display: grid; grid-template-columns: 140px 180px 1fr 200px 120px; align-items: center; background: #fffbeb;">
        <div>
          <div style="font-weight: 800; font-size: 15px; color: #0f172a;">2026-11-09</div>
          <div style="font-size: 12px; color: #64748b;">Monday (Session 2)</div>
        </div>
        <div>
          <span class="badge badge-warning" style="font-size: 12px;">▲ 8 Slots Free</span>
          <div style="font-size: 12px; color: #64748b; margin-top: 4px;">32/40 Total Booked</div>
        </div>
        <div>
          <div style="height: 10px; width: 80%; background: #e2e8f0; border-radius: 5px; overflow: hidden; display: flex;">
            <div style="width: 55%; background: #3b82f6;"></div>
            <div style="width: 25%; background: #10b981;"></div>
          </div>
          <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Onc: 22/25 booked · Non-Onc: 10/15 booked</div>
        </div>
        <div>
          <span class="badge badge-warning" style="font-size: 12px; font-weight: 700;">⚠ Contrast Mix: 4/4 FULL</span>
          <div style="font-size: 11px; color: #b45309; font-weight: 600; margin-top: 2px;">Daily limit reached (4/4)</div>
        </div>
        <div style="text-align: right;">
          <button style="background: #f59e0b; color: white; border: none; padding: 6px 14px; border-radius: 6px; font-weight: 700; font-size: 12px; cursor: pointer;">Override</button>
        </div>
      </div>

      <!-- Row 3: Tuesday Nov 10 -->
      <div style="padding: 16px 20px; display: grid; grid-template-columns: 140px 180px 1fr 200px 120px; align-items: center;">
        <div>
          <div style="font-weight: 800; font-size: 15px; color: #0f172a;">2026-11-10</div>
          <div style="font-size: 12px; color: #64748b;">Tuesday (Session 3)</div>
        </div>
        <div>
          <span class="badge badge-success" style="font-size: 12px;">● 26 Slots Free</span>
          <div style="font-size: 12px; color: #64748b; margin-top: 4px;">14/40 Total Booked</div>
        </div>
        <div>
          <div style="height: 10px; width: 80%; background: #e2e8f0; border-radius: 5px; overflow: hidden; display: flex;">
            <div style="width: 25%; background: #3b82f6;"></div>
            <div style="width: 10%; background: #10b981;"></div>
          </div>
          <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Onc: 10/25 booked · Non-Onc: 4/15 booked</div>
        </div>
        <div>
          <span style="font-size: 12px; font-weight: 700; color: #0369a1;">Contrast Mix: 1/4 Used</span>
          <div style="font-size: 11px; color: #16a34a;">3 slots available today</div>
        </div>
        <div style="text-align: right;">
          <button style="background: #2563eb; color: white; border: none; padding: 6px 14px; border-radius: 6px; font-weight: 600; font-size: 12px; cursor: pointer;">Book Slot</button>
        </div>
      </div>
    </div>
  </div>
`);

// 4. Scenario 1: Receptionist Blocked Warning
const scenario1ReceptionistHtml = baseHtmlWrapper("Scenario 1: Receptionist Booking Constraint", `
  <div class="mx-auto w-full max-w-[1000px] space-y-6">
    <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 12px;">
      <div style="font-size: 13px; font-weight: 700; color: #2563eb; text-transform: uppercase;">Reception Desk Booking Flow</div>
      <h1 style="font-size: 22px; font-weight: 800; color: #0f172a; margin: 2px 0 0;">New Appointment — Patient: Ali Omar Ben-Salem (MRN: 849204)</h1>
    </div>

    <!-- Booking Form Card -->
    <div style="background: white; border: 1px solid #cbd5e1; border-radius: 10px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); display: grid; gap: 20px;">
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div>
          <label style="display: block; font-size: 12px; font-weight: 700; color: #64748b; margin-bottom: 4px;">Target Modality</label>
          <div style="font-size: 14px; font-weight: 700; color: #0f172a; background: #f8fafc; border: 1px solid #e2e8f0; padding: 8px 12px; border-radius: 6px;">CT-01 (Siemens Somatom 64)</div>
        </div>
        <div>
          <label style="display: block; font-size: 12px; font-weight: 700; color: #64748b; margin-bottom: 4px;">Selected Procedure</label>
          <div style="font-size: 14px; font-weight: 700; color: #0f172a; background: #f8fafc; border: 1px solid #e2e8f0; padding: 8px 12px; border-radius: 6px;">CT Triphasic Liver & Pancreas Protocol (CT-LIV-3PH)</div>
        </div>
      </div>

      <div>
        <label style="display: block; font-size: 12px; font-weight: 700; color: #64748b; margin-bottom: 4px;">Requested Appointment Date</label>
        <div style="font-size: 15px; font-weight: 800; color: #0f172a;">Monday, 09 November 2026</div>
      </div>

      <!-- Warning Alert Banner -->
      <div style="background: #fffbeb; border: 1px solid #fde68a; border-left: 4px solid #f59e0b; border-radius: 6px; padding: 16px 20px;">
        <div style="display: flex; gap: 12px; align-items: flex-start;">
          <div style="font-size: 20px;">⚠️</div>
          <div>
            <div style="font-weight: 800; font-size: 15px; color: #92400e;">Daily Exam Mix Quota Exceeded</div>
            <div style="font-size: 13px; color: #78350f; margin-top: 4px; line-height: 1.5;">
              The daily safety threshold for <strong>Complex Abdomen & Pelvis Contrast Studies</strong> on Monday, 09 November 2026 has been reached (4 of 4 slots consumed).
              Standard booking is locked to safeguard IV contrast monitoring and nursing capacity.
            </div>
            <div style="font-size: 13px; font-weight: 700; color: #92400e; margin-top: 8px;">
              Selection requires Clinical Supervisor Authorization or booking on next available date: Tuesday, 10 November 2026 (3 slots free).
            </div>
          </div>
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #e2e8f0; padding-top: 16px;">
        <button style="background: white; border: 1px solid #cbd5e1; padding: 8px 16px; border-radius: 6px; font-weight: 600; font-size: 13px;">Choose Tuesday (Nov 10) Instead</button>
        <button style="background: #f59e0b; color: white; border: none; padding: 8px 20px; border-radius: 6px; font-weight: 700; font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 6px;">
          <span>Request Supervisor Override Approval →</span>
        </button>
      </div>
    </div>
  </div>
`);

// 5. Scenario 2: Policy Draft Editor - Alternate Week Recurrence
const scenario2ConfigHtml = baseHtmlWrapper("Scenario 2: Alternate-Week Parity", `
  <div class="mx-auto w-full max-w-[1200px] space-y-6">
    <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <div style="font-size: 13px; font-weight: 700; color: #2563eb; text-transform: uppercase;">Scenario 2 Configuration</div>
        <h1 style="font-size: 22px; font-weight: 800; color: #0f172a; margin: 2px 0 0;">Exam Type Restrictions — MRI-01 (Philips Ingenia 3.0T)</h1>
      </div>
      <span class="badge badge-info" style="font-size: 13px; padding: 4px 12px;">Policy Draft Editor · Tab 3</span>
    </div>

    <div style="background: white; border: 1px solid #cbd5e1; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.04);">
      <div style="background: #f1f5f9; padding: 12px 20px; border-bottom: 1px solid #e2e8f0;">
        <div style="font-weight: 700; font-size: 15px; color: #1e293b;">Rule: Specialized Neuro-Oncology Multidisciplinary Clinic Recurrence</div>
      </div>

      <div style="padding: 24px; display: grid; gap: 20px;">
        <div>
          <label style="display: block; font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 6px;">Restricted Examination Type</label>
          <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 12px; font-size: 14px; font-weight: 700; color: #1e293b;">
            MRI Functional Brain Mapping & MR Spectroscopy (MRI-NEURO-SPEC)
          </div>
        </div>

        <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 18px; display: grid; gap: 16px;">
          <div style="font-weight: 800; font-size: 14px; color: #1e3a8a;">Temporal Recurrence & Parity Rules</div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
            <div>
              <label style="display: block; font-size: 12px; font-weight: 700; color: #334155; margin-bottom: 6px;">Day of Week Availability</label>
              <div style="display: flex; gap: 8px;">
                <span style="background: white; border: 1px solid #cbd5e1; padding: 4px 10px; border-radius: 4px; font-size: 12px; color: #94a3b8;">Sun</span>
                <span style="background: white; border: 1px solid #cbd5e1; padding: 4px 10px; border-radius: 4px; font-size: 12px; color: #94a3b8;">Mon</span>
                <span style="background: #2563eb; color: white; border: 1px solid #2563eb; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 700;">✓ Tuesday (Day 2)</span>
                <span style="background: white; border: 1px solid #cbd5e1; padding: 4px 10px; border-radius: 4px; font-size: 12px; color: #94a3b8;">Wed</span>
                <span style="background: white; border: 1px solid #cbd5e1; padding: 4px 10px; border-radius: 4px; font-size: 12px; color: #94a3b8;">Thu</span>
              </div>
            </div>

            <div>
              <label style="display: block; font-size: 12px; font-weight: 700; color: #334155; margin-bottom: 6px;">Alternate-Week Parity Control</label>
              <div style="display: flex; align-items: center; gap: 10px;">
                <input type="checkbox" checked style="width: 18px; height: 18px; accent-color: #2563eb;">
                <span style="font-size: 13px; font-weight: 700; color: #1e3a8a;">Enable Alternate-Week ISO Parity</span>
              </div>
            </div>
          </div>

          <div style="border-top: 1px solid #dbeafe; padding-top: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
            <div>
              <label style="display: block; font-size: 12px; font-weight: 700; color: #334155; margin-bottom: 4px;">ISO Calendar Anchor Date</label>
              <input type="text" value="2026-01-06" style="border: 1px solid #93c5fd; border-radius: 6px; padding: 6px 12px; font-weight: 700; color: #1e3a8a; width: 140px;" readonly>
              <span style="font-size: 11px; color: #64748b; display: block; margin-top: 4px;">Anchor defines ISO Week 2 (Even Parity Cycle)</span>
            </div>
            <div>
              <label style="display: block; font-size: 12px; font-weight: 700; color: #334155; margin-bottom: 4px;">Rule Enforcement Effect</label>
              <span class="badge badge-error" style="font-size: 12px; padding: 4px 10px;">Hard Restriction (No Override)</span>
              <span style="font-size: 11px; color: #64748b; display: block; margin-top: 4px;">Off-weeks completely hidden; prevents non-MDT bookings</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
`);

// 6. Scenario 2: Calendar Alternate Week Parity
const scenario2CalendarHtml = baseHtmlWrapper("Scenario 2: Alternating Week Calendar", `
  <div class="mx-auto w-full max-w-[1200px] space-y-6">
    <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <div style="font-size: 13px; font-weight: 700; color: #2563eb; text-transform: uppercase;">Parity Comparison View</div>
        <h1 style="font-size: 22px; font-weight: 800; color: #0f172a; margin: 2px 0 0;">Availability Calendar — MRI-01 (Philips 3.0T) · Procedure: MRI-NEURO-SPEC</h1>
      </div>
      <span class="badge badge-info" style="font-size: 13px; padding: 4px 12px;">ISO Week Parity Filter</span>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
      <!-- Week 46 (Even Parity - AVAILABLE) -->
      <div style="background: white; border: 2px solid #86efac; border-radius: 10px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.04);">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px;">
          <div>
            <span class="badge badge-success" style="font-size: 12px;">ISO Week 46 · Even Parity</span>
            <div style="font-size: 18px; font-weight: 800; color: #0f172a; margin-top: 4px;">Tuesday, 10 Nov 2026</div>
          </div>
          <span style="font-size: 24px;">🟢</span>
        </div>
        <div style="margin-top: 16px; space-y: 8px;">
          <div style="font-weight: 700; color: #166534; font-size: 15px;">MDT Clinic Session Active</div>
          <p style="font-size: 13px; color: #475569; margin: 4px 0 12px;">Anchor match confirmed: (46 - 2) % 2 == 0. Examination eligible for standard booking.</p>
          <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 10px 14px; font-size: 13px; color: #166534;">
            <strong>Capacity:</strong> 4 of 6 Specialized Neuro Slots Free
          </div>
          <button style="width: 100%; margin-top: 16px; background: #16a34a; color: white; border: none; padding: 10px; border-radius: 6px; font-weight: 700; font-size: 13px; cursor: pointer;">
            Select Tuesday Nov 10 (Available)
          </button>
        </div>
      </div>

      <!-- Week 47 (Odd Parity - RESTRICTED) -->
      <div style="background: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 10px; padding: 20px; opacity: 0.9;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px;">
          <div>
            <span class="badge" style="background: #f1f5f9; color: #64748b; font-size: 12px;">ISO Week 47 · Odd Parity</span>
            <div style="font-size: 18px; font-weight: 800; color: #64748b; margin-top: 4px;">Tuesday, 17 Nov 2026</div>
          </div>
          <span style="font-size: 24px;">🔒</span>
        </div>
        <div style="margin-top: 16px; space-y: 8px;">
          <div style="font-weight: 700; color: #64748b; font-size: 15px;">Off-Week (General MRI Routine Only)</div>
          <p style="font-size: 13px; color: #64748b; margin: 4px 0 12px;">Anchor parity mismatch: (47 - 2) % 2 != 0. Neuro-Oncology MDT spectroscopy protocol blocked.</p>
          <div style="background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 14px; font-size: 13px; color: #64748b;">
            <strong>Policy Restriction:</strong> Hard Block enforced by policy engine
          </div>
          <button style="width: 100%; margin-top: 16px; background: #e2e8f0; color: #94a3b8; border: none; padding: 10px; border-radius: 6px; font-weight: 700; font-size: 13px; cursor: not-allowed;" disabled>
            Date Restricted by Hospital Policy
          </button>
        </div>
      </div>
    </div>
  </div>
`);

// 7. Scenario 3: Policy Draft Editor - Special Quota Extra Pools
const scenario3ConfigHtml = baseHtmlWrapper("Scenario 3: Special Quota Extra Configuration", `
  <div class="mx-auto w-full max-w-[1200px] space-y-6">
    <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <div style="font-size: 13px; font-weight: 700; color: #2563eb; text-transform: uppercase;">Scenario 3 Configuration</div>
        <h1 style="font-size: 22px; font-weight: 800; color: #0f172a; margin: 2px 0 0;">Special Quotas & User Whitelist — CT-01 (Siemens Somatom 64)</h1>
      </div>
      <span class="badge badge-info" style="font-size: 13px; padding: 4px 12px;">Policy Draft Editor · Tab 5</span>
    </div>

    <div style="background: white; border: 1px solid #cbd5e1; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.04);">
      <div style="background: #f1f5f9; padding: 12px 20px; border-bottom: 1px solid #e2e8f0;">
        <div style="font-weight: 700; font-size: 15px; color: #1e293b;">Dedicated High-Priority Inpatient Surge Capacity Pool</div>
      </div>

      <div style="padding: 24px; display: grid; gap: 20px;">
        <div style="display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 20px;">
          <div>
            <label style="display: block; font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 6px;">Logical System Key (Immutable)</label>
            <input type="text" value="URGENT_INPATIENT_CT" style="font-family: monospace; font-size: 14px; font-weight: 700; color: #0f172a; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 12px; width: 100%; box-sizing: border-box;" readonly>
          </div>
          <div>
            <label style="display: block; font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 6px;">Daily Extra Slots</label>
            <input type="number" value="5" style="border: 2px solid #7c3aed; border-radius: 6px; padding: 8px 12px; font-size: 16px; font-weight: 800; color: #6d28d9; text-align: center; width: 80px;" readonly>
          </div>
          <div>
            <label style="display: block; font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 6px;">Bypass Mode</label>
            <span class="badge badge-success" style="font-size: 12px; padding: 6px 10px; margin-top: 4px;">Bypasses Category Limit</span>
          </div>
        </div>

        <div>
          <label style="display: block; font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 6px;">Authorized User Whitelist (allowedUserIds)</label>
          <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; background: #f8fafc; display: flex; flex-wrap: wrap; gap: 8px;">
            <div style="background: #ede9fe; color: #5b21b6; border: 1px solid #ddd6fe; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 700;">
              ✓ Fatima Mansour (Inpatient Bed Coordinator — ID: 104)
            </div>
            <div style="background: #ede9fe; color: #5b21b6; border: 1px solid #ddd6fe; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 700;">
              ✓ Dr. Tariq El-Fitouri (Radiology Operations Lead — ID: 101)
            </div>
            <div style="background: #f1f5f9; color: #64748b; border: 1px dashed #cbd5e1; padding: 4px 10px; border-radius: 6px; font-size: 12px;">
              + Super Administrators (Implicitly Authorized)
            </div>
          </div>
          <span style="font-size: 11px; color: #64748b; margin-top: 4px; display: block;">Standard reception clerks are excluded from this pool to protect emergency capacity.</span>
        </div>

        <div>
          <label style="display: block; font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 6px;">Associated Eligible Emergency Examinations</label>
          <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; background: #f8fafc; display: flex; flex-wrap: wrap; gap: 10px;">
            <span class="badge badge-info" style="font-size: 12px; padding: 4px 10px;">CT Whole Body Polytrauma Protocol</span>
            <span class="badge badge-info" style="font-size: 12px; padding: 4px 10px;">CT Pulmonary Angiogram for PE</span>
            <span class="badge badge-info" style="font-size: 12px; padding: 4px 10px;">CT Brain Non-Contrast (Acute Stroke / Hemorrhage)</span>
          </div>
        </div>
      </div>
    </div>
  </div>
`);

// 8. Scenario 3: Friday Closed Day & Override Badge
const scenario3FridayCalendarHtml = baseHtmlWrapper("Scenario 3: Friday Closed Day", `
  <div class="mx-auto w-full max-w-[1200px] space-y-6">
    <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <div style="font-size: 13px; font-weight: 700; color: #2563eb; text-transform: uppercase;">Calendar Weekend Exception</div>
        <h1 style="font-size: 22px; font-weight: 800; color: #0f172a; margin: 2px 0 0;">Friday Operational Status — CT-01 (Siemens Somatom 64)</h1>
      </div>
      <span class="badge badge-warning" style="font-size: 13px; padding: 4px 12px;">Libyan Hospital Weekend</span>
    </div>

    <!-- Friday Alert Banner -->
    <div style="background: #fffbeb; border: 2px solid #f59e0b; border-radius: 10px; padding: 24px; box-shadow: 0 4px 6px rgba(0,0,0,0.03);">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; gap: 16px; align-items: center;">
          <div style="background: #f59e0b; color: white; width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px;">📅</div>
          <div>
            <div style="font-size: 20px; font-weight: 800; color: #92400e;">Friday, 13 November 2026 — Closed Day</div>
            <div style="font-size: 14px; color: #78350f; margin-top: 2px;">Standard outpatient scheduling is suspended under hospital policy. Emergency and ICU surge bookings are permitted with supervisor authorization.</div>
          </div>
        </div>
        <span class="badge badge-warning" style="font-size: 13px; padding: 6px 14px;">closed_day_supervisor_override</span>
      </div>

      <div style="margin-top: 20px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; background: white; padding: 16px; border-radius: 8px; border: 1px solid #fde68a;">
        <div>
          <span style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Standard Quota</span>
          <div style="font-size: 16px; font-weight: 800; color: #dc2626;">0 Slots (Closed)</div>
        </div>
        <div>
          <span style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Special Quota (ICU Surge)</span>
          <div style="font-size: 16px; font-weight: 800; color: #7c3aed;">5 Extra Slots Available</div>
        </div>
        <div>
          <span style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Override Privilege</span>
          <div style="font-size: 16px; font-weight: 800; color: #16a34a;">Supervisor PIN Required</div>
        </div>
      </div>

      <div style="margin-top: 20px; display: flex; justify-content: flex-end;">
        <button style="background: #d97706; color: white; border: none; padding: 10px 20px; border-radius: 6px; font-weight: 700; font-size: 14px; cursor: pointer; display: flex; align-items: center; gap: 8px;">
          <span>Schedule Emergency Case with Supervisor PIN →</span>
        </button>
      </div>
    </div>
  </div>
`);

// 9. Scenario 3: Supervisor Override Modal & PIN Authentication
const scenario3ModalHtml = baseHtmlWrapper("Scenario 3: Supervisor Override Authorization", `
  <div style="position: fixed; inset: 0; background: rgba(15, 23, 42, 0.7); display: flex; align-items: center; justify-content: center; z-index: 50;">
    <div style="background: white; border-radius: 12px; width: 620px; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.3); border: 1px solid #cbd5e1;">
      <div style="background: #1e293b; color: white; padding: 16px 24px; display: flex; justify-content: space-between; align-items: center;">
        <div style="font-weight: 800; font-size: 16px; display: flex; align-items: center; gap: 8px;">
          <span style="color: #f59e0b;">🛡️</span>
          <span>Supervisor Override Authorization</span>
        </div>
        <span style="font-size: 12px; background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 4px;">Level 2 Clinical Override</span>
      </div>

      <div style="padding: 24px; display: grid; gap: 16px;">
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px;">
          <div style="font-size: 12px; color: #64748b; font-weight: 600;">Booking Exception Target</div>
          <div style="font-size: 14px; font-weight: 800; color: #0f172a; margin-top: 2px;">CT Whole Body Polytrauma Protocol · Friday, 13 Nov 2026</div>
          <div style="font-size: 12px; color: #b45309; margin-top: 2px;">Reason: Closed Day (Friday) + Category Ceiling Override</div>
        </div>

        <div>
          <label style="display: block; font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 4px;">Authorizing Supervisor</label>
          <select style="width: 100%; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 12px; font-size: 14px; font-weight: 600; background: white;">
            <option>Dr. Tariq El-Fitouri (Radiology Operations Lead)</option>
            <option>Dr. Nadia Ben-Khadra (Clinical Supervisor — Body CT)</option>
          </select>
        </div>

        <div>
          <label style="display: block; font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 4px;">Mandatory Clinical Rationale</label>
          <select style="width: 100%; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 12px; font-size: 14px; font-weight: 600; background: white; color: #0f172a;">
            <option selected>Life-Threatening Emergency / High-Energy Polytrauma (ED Resus)</option>
            <option>Inpatient ICU Acute Deterioration / Septic Shock</option>
            <option>Time-Sensitive Pre-Operative Assessment</option>
          </select>
        </div>

        <div>
          <label style="display: block; font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 4px;">Supervisor Digital Signature (PIN / Passkey)</label>
          <input type="password" value="••••••••" style="width: 100%; border: 2px solid #2563eb; border-radius: 6px; padding: 8px 12px; font-size: 18px; letter-spacing: 4px; box-sizing: border-box;" readonly>
          <span style="font-size: 11px; color: #64748b; margin-top: 4px; display: block;">Authorization is cryptographically logged to appointments_v2.overrides ledger</span>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 12px; border-top: 1px solid #e2e8f0; padding-top: 16px; margin-top: 8px;">
          <button style="background: white; border: 1px solid #cbd5e1; padding: 8px 16px; border-radius: 6px; font-weight: 600; font-size: 13px;">Cancel</button>
          <button style="background: #16a34a; color: white; border: none; padding: 8px 24px; border-radius: 6px; font-weight: 800; font-size: 14px; cursor: pointer;">
            ✓ Confirm & Authorize Emergency Booking
          </button>
        </div>
      </div>
    </div>
  </div>
`);

// 10. Scenario 3: Override Approval Center & Immutable Audit Trail
const scenario3AuditHtml = baseHtmlWrapper("Scenario 3: Override Approval Center", `
  <div class="mx-auto w-full max-w-[1200px] space-y-6">
    <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <div style="font-size: 13px; font-weight: 700; color: #2563eb; text-transform: uppercase;">Governance & Compliance</div>
        <h1 style="font-size: 22px; font-weight: 800; color: #0f172a; margin: 2px 0 0;">Scheduling Override Approval Center & Audit Log</h1>
      </div>
      <span class="badge badge-success" style="font-size: 13px; padding: 4px 12px;">Audit Integrity Verified</span>
    </div>

    <!-- Audit Table -->
    <div style="background: white; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
      <div style="background: #f8fafc; border-bottom: 1px solid #e2e8f0; padding: 12px 20px; display: grid; grid-template-columns: 140px 160px 220px 1fr 140px 120px; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">
        <div>Timestamp</div>
        <div>Modality / Date</div>
        <div>Patient / MRN</div>
        <div>Override Rationale</div>
        <div>Authorizing Doctor</div>
        <div style="text-align: right;">Status</div>
      </div>

      <!-- Log Entry 1 -->
      <div style="padding: 14px 20px; border-bottom: 1px solid #f1f5f9; display: grid; grid-template-columns: 140px 160px 220px 1fr 140px 120px; align-items: center; font-size: 13px;">
        <div style="font-weight: 600; color: #475569;">13 Nov 2026 14:22</div>
        <div>
          <span style="font-weight: 700; color: #0f172a;">CT-01</span>
          <div style="font-size: 11px; color: #64748b;">2026-11-13 (Friday)</div>
        </div>
        <div>
          <div style="font-weight: 700; color: #0f172a;">Mohamed Al-Barassi</div>
          <div style="font-size: 11px; color: #64748b;">MRN: 902811 · ICU Trauma</div>
        </div>
        <div>
          <span class="badge badge-warning" style="font-size: 11px;">closed_day_supervisor_override</span>
          <div style="font-size: 12px; color: #334155; margin-top: 2px;">Life-Threatening Emergency / High-Energy Polytrauma</div>
        </div>
        <div style="font-weight: 600; color: #1e293b;">Dr. Tariq El-Fitouri</div>
        <div style="text-align: right;">
          <span class="badge badge-success" style="font-size: 11px;">✓ APPROVED</span>
        </div>
      </div>

      <!-- Log Entry 2 -->
      <div style="padding: 14px 20px; border-bottom: 1px solid #f1f5f9; display: grid; grid-template-columns: 140px 160px 220px 1fr 140px 120px; align-items: center; font-size: 13px;">
        <div style="font-weight: 600; color: #475569;">09 Nov 2026 11:05</div>
        <div>
          <span style="font-weight: 700; color: #0f172a;">CT-01</span>
          <div style="font-size: 11px; color: #64748b;">2026-11-09 (Monday)</div>
        </div>
        <div>
          <div style="font-weight: 700; color: #0f172a;">Ali Omar Ben-Salem</div>
          <div style="font-size: 11px; color: #64748b;">MRN: 849204 · Outpatient</div>
        </div>
        <div>
          <span class="badge badge-info" style="font-size: 11px;">exam_mix_quota_exceeded</span>
          <div style="font-size: 12px; color: #334155; margin-top: 2px;">Urgent Staging CT Triphasic Liver before MDT</div>
        </div>
        <div style="font-weight: 600; color: #1e293b;">Dr. Nadia Ben-Khadra</div>
        <div style="text-align: right;">
          <span class="badge badge-success" style="font-size: 11px;">✓ APPROVED</span>
        </div>
      </div>
    </div>
  </div>
`);

const pagesToCapture = [
  { name: "01_overview_policy_administration_dashboard.png", html: overviewHtml },
  { name: "02_scenario1_exam_mix_quota_configuration.png", html: scenario1ConfigHtml },
  { name: "03_scenario1_calendar_mix_capacity_status.png", html: scenario1CalendarHtml },
  { name: "04_scenario1_receptionist_blocked_exam_mix.png", html: scenario1ReceptionistHtml },
  { name: "05_scenario2_exam_restriction_alternate_weeks.png", html: scenario2ConfigHtml },
  { name: "06_scenario2_calendar_alternate_week_parity.png", html: scenario2CalendarHtml },
  { name: "07_scenario3_special_quota_extra_configuration.png", html: scenario3ConfigHtml },
  { name: "08_scenario3_closed_weekday_friday_override.png", html: scenario3FridayCalendarHtml },
  { name: "09_scenario3_supervisor_override_modal.png", html: scenario3ModalHtml },
  { name: "10_scenario3_override_approval_center.png", html: scenario3AuditHtml },
];

console.log("Starting Playwright capture for", pagesToCapture.length, "screens...");
const browser = await chromium.launch({ headless: true });

for (const item of pagesToCapture) {
  const tempPath = path.join(tempHtmlDir, item.name.replace(".png", ".html"));
  fs.writeFileSync(tempPath, item.html, "utf8");
  const fileUrl = pathToFileURL(tempPath).href;

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(fileUrl, { waitUntil: "load" });
  // Wait a moment for layout stability
  await page.waitForTimeout(300);

  const outputPath = path.join(screenshotsDir, item.name);
  await page.screenshot({ path: outputPath, fullPage: false });
  console.log("Captured:", item.name, "(size:", fs.statSync(outputPath).size, "bytes)");
  await page.close();
}

await browser.close();
console.log("All screenshots captured successfully into:", screenshotsDir);
