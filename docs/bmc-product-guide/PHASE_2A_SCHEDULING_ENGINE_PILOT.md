# RISpro Product and Workflow Guide — Phase 2A Pilot
## Enterprise Scheduling Engine & Policy Manager Illustrated Clinical Guide
### Benghazi Medical Center (BMC) — Radiology Directorate

**Document Version:** 2.0 (Phase 2A Customer Pilot)  
**Target Institution:** Benghazi Medical Center (BMC)  
**Prepared By:** RIS Senior Product Analyst & Technical Documentation Team  
**System Scope:** RISpro Appointments V2 & Policy Administration Engine  
**Release Target:** Enterprise Radiology Deployment  

---

## Executive Overview: Enterprise Scheduling Customization Architecture

Modern tertiary hospital radiology operations require far more than an electronic appointment diary. At **Benghazi Medical Center (BMC)**—a 1,200-bed regional referral center managing high-acuity polytrauma, specialized neurosurgery, acute stroke, and complex oncology—scheduling is the critical clinical gateway that balances machine throughput, patient safety, radiation governance, and clinical staffing.

RISpro provides a fully integrated, policy-driven scheduling ecosystem. Instead of relying on static slot templates or informal manual coordination, RISpro automates clinical governance across multiple interacting dimensions:

```
+---------------------------------------------------------------------------------------------------------+
|                                  RISPRO SCHEDULING CONFIGURATION ATLAS                                  |
+---------------------------------------------------------------------------------------------------------+
|                                                                                                         |
|   1. Physical Equipment Capacity (modality.daily_capacity)                                              |
|      • Hard mechanical & staffing upper bound per scanner (e.g., 40 exams/day on CT-01).               |
|      • Protected by database mutex serialization against simultaneous booking collisions.               |
|                                                                                                         |
|   2. Clinical Track Allocations (Category Daily Limits)                                                 |
|      • Daily capacity partitioning between dedicated clinical tracks (Oncology vs Non-Oncology).         |
|      • Prevents routine outpatient bookings from consuming acute clinical slots.                       |
|                                                                                                         |
|   3. High-Acuity Procedure Protection (Exam Mix Quota Groups)                                           |
|      • Limits time-consuming or high-risk exams (e.g., max 4 Multiphasic Contrast studies/day).         |
|      • Disambiguates overlapping constraints by prioritizing the most restrictive threshold.            |
|                                                                                                         |
|   4. Specialized Temporal Recurrence (Alternate-Week ISO Week Parity)                                  |
|      • Restricts specialized procedures to alternating clinic days (e.g., Bi-weekly MDT Neuro-MRI).     |
|      • ISO calendar anchor parity automatically calculates even/odd week cycles without manual renewal. |
|                                                                                                         |
|   5. Protected Priority Pools (Special Quota Extra)                                                     |
|      • Dedicated emergency and inpatient surge slots (e.g., 5 reserved ICU slots).                      |
|      • Bypasses category limits for authorized actors while strictly respecting machine ceilings.       |
|                                                                                                         |
|   6. Supervisory Override & Two-Person Clinical Integrity                                               |
|      • Two-tier override model: reception initiates directed requests; supervisors authorize with PIN.  |
|      • Mandatory clinical indication logging creates an immutable, tamper-evident audit ledger.         |
|                                                                                                         |
+---------------------------------------------------------------------------------------------------------+
```

### The Policy Administration Command Center

Radiology administrators configure and govern these scheduling rules through the **RISpro Policy Administration Overview**. Rules are authored in isolated working drafts, validated against schema collisions, and published as immutable snapshots.

![Policy Administration Overview](file:///C:/Users/elbos/.gemini/antigravity/brain/c9e1e244-fab5-4cfb-b162-9ac60a22e18f/screenshots/01_overview_policy_administration_dashboard.png)
*Figure 1.1: RISpro Policy Administration Command Center showing active published policy baseline (v4), working draft in staging, modality capacity telemetry, and multi-dimensional status metrics.*

---

## Scenario 1: High-Acuity Contrast & Radiation Safety Mix with Modality Capacity Safeguard

### 1. Hospital Operational Requirement
At Benghazi Medical Center, scanner **CT-01 (Siemens Somatom 64)** serves as the high-volume workhorse for body imaging. While the scanner has a mechanical capacity of 40 patients per day, multiphasic contrast studies (e.g., Triphasic Liver, Enterography, Combined Abdomen & Pelvis with Contrast) require:
- Pre-procedure renal function verification ($eGFR$ / serum creatinine).
- Intravenous cannula placement (18G/20G) and automated dual-syringe power injector setup.
- 15–20 minutes of post-injection monitoring for contrast-induced adverse reactions.

If too many contrast examinations are scheduled on the same day, nursing staff face dangerous workload spikes, patient wait times escalate, and resuscitation coverage becomes strained.

**Operational Mandate:**  
1. Enforce an absolute machine ceiling of **40 total examinations per day**.
2. Allocate baseline clinical tracks: **25 Oncology slots** and **15 Non-Oncology slots**.
3. Establish an automated safety cap of **no more than 4 complex multiphasic contrast studies per day**.
4. Automatically block standard receptionists once 4 contrast studies are booked, requiring clinical supervisor authorization for additional cases.

---

### 2. Exact Policy Manager Configuration

To configure this clinical protection, the radiology administrator accesses the **Policy Draft Editor** and defines an **Exam Mix Quota Group**:

- **Target Modality:** `CT-01 (Siemens Somatom Definition 64)`
- **Category Daily Limits:** Oncology = `25`, Non-Oncology = `15` (Sum = 40, matching total capacity)
- **Exam Mix Group Title:** `Complex Abdomen & Pelvis Contrast Studies`
- **Daily Group Limit:** `4`
- **Associated Examination Codes:**
  - `CT-ABD-PEL-C` (CT Abdomen & Pelvis with IV Contrast)
  - `CT-LIV-3PH` (CT Triphasic Liver & Pancreas Dynamic Protocol)
  - `CT-ENT-VOL` (CT Enterography with Oral & IV Volume Contrast)
- **Recurrence Window:** Daily (Sunday through Thursday)
- **Exhaustion Enforcement:** Soft constraint (`restriction_overridable` requiring Supervisor Override)

![Exam Mix Quota Configuration](file:///C:/Users/elbos/.gemini/antigravity/brain/c9e1e244-fab5-4cfb-b162-9ac60a22e18f/screenshots/02_scenario1_exam_mix_quota_configuration.png)
*Figure 1.2: Policy Draft Editor (Tab 4: Exam Mix Quota Groups) configuring the 4-case daily safety cap across three high-acuity multiphasic CT protocols.*

---

### 3. Scheduling Outcome on the Appointment Calendar

When reception staff open the **Availability Calendar**, RISpro renders real-time visual telemetry for every date. Rather than showing a simple binary open/closed status, each date row displays segmented category distributions and exam mix counters.

![Calendar Mix Capacity Status](file:///C:/Users/elbos/.gemini/antigravity/brain/c9e1e244-fab5-4cfb-b162-9ac60a22e18f/screenshots/03_scenario1_calendar_mix_capacity_status.png)
*Figure 1.3: Availability Calendar displaying normal booking on Sunday Nov 8 (2/4 contrast slots used), quota exhaustion warning on Monday Nov 9 (4/4 FULL), and available capacity on Tuesday Nov 10.*

As seen on Monday, 09 November 2026:
- **Total Modality Capacity:** 32 of 40 slots booked (8 total slots remain physically open).
- **Exam Mix Status:** 4 of 4 contrast slots have been consumed (`4/4 FULL`).
- **Engine Response:** Standard booking for contrast protocols is instantly locked, marked with an amber warning badge.

---

### 4. Receptionist Experience & Exception Handling

When a receptionist attempts to book a 5th contrast study (e.g., CT Triphasic Liver) on Monday, November 9, the Scheduling Engine evaluates Step 7 of the evaluation pipeline and halts standard confirmation:

![Receptionist Blocked Exam Mix](file:///C:/Users/elbos/.gemini/antigravity/brain/c9e1e244-fab5-4cfb-b162-9ac60a22e18f/screenshots/04_scenario1_receptionist_blocked_exam_mix.png)
*Figure 1.4: Reception desk booking interface displaying automated exam mix quota block, offering date redirection to Tuesday Nov 10 or directed supervisor override escalation.*

#### What the Receptionist Sees:
1. **Diagnostic Banner:**  
   *"Daily Exam Mix Quota Exceeded: The daily safety threshold for Complex Abdomen & Pelvis Contrast Studies on Monday, 09 November 2026 has been reached (4 of 4 slots consumed). Standard booking is locked to safeguard IV contrast monitoring and nursing capacity."*
2. **One-Click Clinical Redirection:**  
   The UI highlights the next available date with open contrast capacity: **Tuesday, 10 November 2026 (3 slots free)**.
3. **Escalation Path:**  
   If the patient's condition is clinically urgent, the receptionist clicks **Request Supervisor Override Approval**, which triggers the directed approval workflow.

---

### 5. Operational Benefits for Benghazi Medical Center
- **Eliminates Contrast Complication Risks:** Distributes intravenous contrast administrations evenly across the clinical week, preventing emergency resuscitation team saturation.
- **Protects Nursing Workload:** Ensures nursing staff have sufficient time for pre-cannulation, renal lab reviews, and mandatory 15-minute post-scan extravasation observations.
- **Preserves Scanner Throughput:** Routine non-contrast examinations (e.g., non-contrast CT brain, spine, extremities) can still be booked in the remaining 8 open slots without restriction.

---

## Scenario 2: Specialized Neuro-Oncology Multidisciplinary Clinic with Alternate-Week Recurrence

### 1. Hospital Operational Requirement
Benghazi Medical Center hosts a subspecialized **Neuro-Oncology Multidisciplinary Team (MDT)** comprising neurosurgeons, neuroradiologists, medical oncologists, and radiation therapists. The MDT meets every alternating Tuesday to review complex brain tumor cases.

Advanced functional neuroimaging—specifically **Functional Brain MRI (fMRI)** and **MR Spectroscopy (1H-MRS)**—requires the on-site presence of specialized neuroradiologists and medical physicists to calibrate multi-voxel sequences and interpret metabolic ratios ($Cho/Cr$, $NAA/Cr$).

**Operational Mandate:**  
1. Restrict Functional Brain MRI and Spectroscopy on scanner **MRI-01 (Philips Ingenia 3.0T)** exclusively to **Tuesdays**.
2. Enforce an **alternating-week schedule** matching the MDT clinic calendar.
3. Automatically lock off-week Tuesdays against routine booking without requiring manual clerical intervention each week.
4. Apply a **hard restriction policy** that cannot be overridden by routine clerical staff.

---

### 2. Exact Policy Manager Configuration

In the **Policy Draft Editor (Tab 3: Exam Type Restrictions)**, the administrator configures the alternate-week ISO recurrence rule:

- **Target Modality:** `MRI-01 (Philips Ingenia 3.0T)`
- **Restricted Examination:** `MRI-NEURO-SPEC` (MRI Functional Brain Mapping & MR Spectroscopy)
- **Recurrence Type:** `weekly_recurrence`
- **Active Weekday:** Tuesday (Day 2 checked; all other days unchecked)
- **Alternate-Week Parity:** `alternateWeeks: true` (Checked)
- **ISO Calendar Anchor Date:** `2026-01-06` (Tuesday of ISO Week 2, establishing an **Even ISO Week Parity Cycle**)
- **Rule Effect:** `hard_restriction` (Absolute block; non-matching dates are hidden/rejected)

![Exam Restriction Alternate Weeks](file:///C:/Users/elbos/.gemini/antigravity/brain/c9e1e244-fab5-4cfb-b162-9ac60a22e18f/screenshots/05_scenario2_exam_restriction_alternate_weeks.png)
*Figure 2.1: Policy Draft Editor (Tab 3: Exam Type Restrictions) establishing Tuesday alternate-week parity using ISO anchor date 2026-01-06.*

---

### 3. Scheduling Outcome on the Appointment Calendar

The Scheduling Engine evaluates alternate-week eligibility using the mathematical parity equation:
$$\text{Parity Match} = (\text{Target ISO Week} - \text{Anchor ISO Week}) \pmod 2 = 0$$

When reception staff check availability for this procedure, the calendar dynamically filters dates based on week parity:

![Calendar Alternate Week Parity](file:///C:/Users/elbos/.gemini/antigravity/brain/c9e1e244-fab5-4cfb-b162-9ac60a22e18f/screenshots/06_scenario2_calendar_alternate_week_parity.png)
*Figure 2.2: Side-by-side calendar comparison demonstrating automated parity filtering: Tuesday Nov 10 (Even ISO Week 46) is Available, while Tuesday Nov 17 (Odd ISO Week 47) is Locked.*

#### Parity Evaluation Breakdown:
- **Tuesday, 10 November 2026 (ISO Week 46):**  
  $(46 - 2) \pmod 2 = 44 \pmod 2 = 0$ $\rightarrow$ **Match (Even Parity).**  
  *Result:* Calendar shows **Available (Green)**; 4 of 6 dedicated MDT slots open.
- **Tuesday, 17 November 2026 (ISO Week 47):**  
  $(47 - 2) \pmod 2 = 45 \pmod 2 = 1$ $\rightarrow$ **Mismatch (Odd Parity).**  
  *Result:* Calendar shows **Policy Locked (Gray Hatched)** with padlock indicator. Standard booking button is completely disabled.

---

### 4. Receptionist Experience & Exception Handling

If a booking clerk manually searches for November 17 or attempts to force the appointment:
- The date selector displays: *"Selected examination [MRI-NEURO-SPEC] is not permitted on this date under active hospital policy. Next available clinic date: Tuesday, 24 November 2026."*
- Because the rule is configured with `hard_restriction`, **no supervisor override bypass button is presented**.
- Routine brain MRI exams (e.g., standard stroke or headache protocols) remain bookable on November 17, ensuring general scanner utilization is not compromised.

---

### 5. Operational Benefits for Benghazi Medical Center
- **Guarantees Subspecialist Presence:** Prevents complex spectroscopy exams from being performed on days when specialized neuroradiologists are absent.
- **Zero Ongoing Administrative Overhead:** The ISO parity formula automatically maintains the bi-weekly schedule for years without requiring monthly re-configuration.
- **Optimized Multidisciplinary Alignment:** Patients undergo scanning on Tuesday morning, and their processed metabolic maps are available for clinical review in the MDT conference that same afternoon.

---

## Scenario 3: Urgent Inpatient & ICU Surge Special Quota with Closed-Day Supervisor Override

### 1. Hospital Operational Requirement
Benghazi Medical Center operates under the standard Libyan healthcare schedule: **Sunday through Thursday are full outpatient clinical days**, while **Fridays and Saturdays are closed for routine appointments**.

However, BMC's Intensive Care Unit (ICU) and Emergency Department (ED) admit acute polytrauma and stroke patients 24/7. Routine outpatient clerks frequently overbook scanners during weekdays, leaving no buffer for emergency inpatient admissions.

**Operational Mandate:**  
1. Enforce **Friday and Saturday outpatient closures** on scanner **CT-01**.
2. Establish a dedicated **Special Quota Extra Pool of 5 slots** reserved exclusively for Inpatient Ward and ICU surge referrals.
3. Restrict access to this surge pool to designated clinical coordinators (**Inpatient Bed Coordinator** and **Super Administrators**).
4. Provide a secure **Supervisor Override Workflow** allowing on-duty emergency radiologists to authorize weekend cases with mandatory clinical rationale logging.

---

### 2. Exact Policy Manager Configuration

In the **Policy Draft Editor**, the administrator establishes the closed-day baseline and defines the Special Quota Extra pool:

#### A. Closed Weekday Setting
- Modality: `CT-01`
- Closed Weekdays: `[5, 6]` (Friday & Saturday)
- Effect: `closed_day_supervisor_override` (Overridable by clinical supervisors)

#### B. Special Quota Extra Pool (Tab 5)
- **Logical Key:** `URGENT_INPATIENT_CT` (Durable identifier preserved across policy revisions)
- **Pool Title:** `ICU / Urgent Inpatient Surge Capacity`
- **Daily Extra Slots:** `5`
- **Authorized User Whitelist (`allowedUserIds`):**
  - Fatima Mansour (Inpatient Bed Coordinator — User ID: `104`)
  - Dr. Tariq El-Fitouri (Radiology Operations Lead — User ID: `101`)
  - Super Administrators (Implicitly authorized by system security rules)
- **Eligible Emergency Protocols:**
  - CT Whole Body Polytrauma Protocol
  - CT Pulmonary Angiogram for Suspected PE
  - CT Brain Non-Contrast for Acute Stroke

![Special Quota Extra Configuration](file:///C:/Users/elbos/.gemini/antigravity/brain/c9e1e244-fab5-4cfb-b162-9ac60a22e18f/screenshots/07_scenario3_special_quota_extra_configuration.png)
*Figure 3.1: Policy Draft Editor (Tab 5: Special Quotas) reserving 5 dedicated surge slots for ICU bed coordinators, bypassing outpatient category limits.*

---

### 3. Scheduling Outcome on the Appointment Calendar

When viewing Friday on the Availability Calendar, the system displays the institutional weekend status while surfacing emergency surge capacity:

![Friday Closed Day Override](file:///C:/Users/elbos/.gemini/antigravity/brain/c9e1e244-fab5-4cfb-b162-9ac60a22e18f/screenshots/08_scenario3_closed_weekday_friday_override.png)
*Figure 3.2: Availability Calendar highlighting Friday weekend closure, showing 0 standard outpatient slots, 5 active ICU surge slots, and supervisor override gating.*

---

### 4. Supervisor Override & Two-Tier Authorization

When an acute road traffic collision victim arrives at the BMC Emergency Department on Friday afternoon:

1. **Initiation:** The emergency clerk enters the patient's MRN and selects the *CT Whole Body Polytrauma Protocol*.
2. **System Prompt:** The engine detects Friday closure and opens the **Supervisor Override Authorization Modal**.
3. **Supervisor PIN Verification:** The on-duty Radiology Supervisor enters their credentials and selects the mandatory clinical justification.

![Supervisor Override Modal](file:///C:/Users/elbos/.gemini/antigravity/brain/c9e1e244-fab5-4cfb-b162-9ac60a22e18f/screenshots/09_scenario3_supervisor_override_modal.png)
*Figure 3.3: Supervisor Override Authorization Modal requiring digital credentials and structured clinical indication selection.*

#### The Immutable Override Audit Trail
Every authorized override is committed to the database ledger (`appointments_v2.overrides`). Radiology directors can inspect the **Scheduling Override Approval Center** at any time to verify compliance:

![Override Approval Center](file:///C:/Users/elbos/.gemini/antigravity/brain/c9e1e244-fab5-4cfb-b162-9ac60a22e18f/screenshots/10_scenario3_override_approval_center.png)
*Figure 3.4: Scheduling Override Approval Center displaying the immutable audit ledger with timestamps, patient MRNs, override categories, and authorizing physician identities.*

---

### 5. Operational Benefits for Benghazi Medical Center
- **Guaranteed Emergency Access:** Reserving 5 dedicated surge slots ensures critically ill ICU patients never wait for routine outpatient backlogs to clear.
- **Strict Role Boundaries:** Outpatient clerks cannot exploit emergency slots; only whitelisted bed coordinators and supervisors have access.
- **Complete Institutional Governance:** Every exception made outside normal hospital hours is permanently logged with the clinical rationale and supervisor signature, supporting monthly directorate audits.

---

## Field-Level Configuration Reference

The following dictionary provides a field-level reference for every configuration parameter demonstrated across the three clinical scenarios:

| Setting / Field Name | Screen & Tab Location | Data Type / Format | Validation Constraints | Operational Clinical Description |
| :--- | :--- | :--- | :--- | :--- |
| **Active Modality** | Policy Admin Overview | Dropdown (`modality_id`) | Must match active scanner | Selects the physical machine profile (CT-01, MRI-01) governing the policy. |
| **Daily Modality Capacity** | Modality Settings / Summary | Integer (`daily_capacity`) | $> 0$; Physical machine upper bound | Absolute mechanical and staffing ceiling. Cannot be bypassed by any booking mode. |
| **Category Daily Limits** | Draft Editor $\rightarrow$ Tab 1 | Integer pair (`daily_limit`) | Sum must be $\le$ Modality Capacity | Allocates standard daily slot quotas between Oncology and Non-Oncology tracks. |
| **Exam Mix Group Title** | Draft Editor $\rightarrow$ Tab 4 | Text String (`group_name`) | 3–100 characters; unique per policy | Descriptive label for high-acuity exam groupings (e.g., "Complex Contrast Studies"). |
| **Mix Daily Limit** | Draft Editor $\rightarrow$ Tab 4 | Integer (`daily_limit`) | $> 0$; $\le$ Category Daily Limit | Maximum number of examinations in this group permitted per calendar day. |
| **Included Exam Types** | Draft Editor $\rightarrow$ Tabs 3, 4, 5 | Multi-select checkboxes | Minimum 1 active procedure code | Binds specific clinical procedure codes to the quota or restriction rule. |
| **Recurrence Type** | Draft Editor $\rightarrow$ Tabs 2, 3 | Enum: `weekly`, `range`, `yearly` | Valid enum literal | Determines whether the rule applies on days of week, date ranges, or annual windows. |
| **Day of Week Picker** | Draft Editor $\rightarrow$ Tab 3 | Checkboxes (0=Sun to 6=Sat) | At least 1 day selected | Restricts procedures to specific weekdays (e.g., Tuesday only for MDT clinics). |
| **Alternate-Week Parity** | Draft Editor $\rightarrow$ Tab 3 | Boolean (`alternateWeeks`) | Requires valid ISO Anchor Date | Enables bi-weekly recurrence based on calendar ISO week parity calculations. |
| **ISO Anchor Date** | Draft Editor $\rightarrow$ Tab 3 | ISO Date (`YYYY-MM-DD`) | Must be valid calendar date | Base date establishing the Even/Odd ISO week reference cycle. |
| **Rule Effect** | Draft Editor $\rightarrow$ Tab 3 | Enum: `hard` vs `overridable` | Binary restriction mode | `hard`: absolute block (hidden/unbookable); `overridable`: permits supervisor override. |
| **Special Quota Key** | Draft Editor $\rightarrow$ Tab 5 | String (`logical_key`) | Unique, stable UUID or uppercase key | Permanent identifier linking quota tracking across versioned policy snapshots. |
| **Daily Extra Slots** | Draft Editor $\rightarrow$ Tab 5 | Integer (`daily_limit`) | $> 0$; bounded by remaining capacity | Number of dedicated slots reserved for priority departments (ICU, Emergency). |
| **Allowed Users Whitelist** | Draft Editor $\rightarrow$ Tab 5 | Multi-select (`allowedUserIds`) | Valid active user IDs | Restricts Special Quota booking rights to specific authorized coordinators. |
| **Closed Weekdays** | System Settings $\rightarrow$ Modality | Array of Integers (e.g. `[5, 6]`) | 0 (Sun) to 6 (Sat) | Defines weekend closure days (Friday/Saturday) requiring supervisor override. |
| **Override PIN / Passkey** | Supervisor Override Modal | Cryptographic credential | Valid supervisor/super_admin auth | Authenticates the clinical supervisor approving an operational exception. |
| **Clinical Rationale** | Supervisor Override Modal | Dropdown + Text note | Mandatory selection; $> 10$ chars | Formal clinical justification permanently logged to the audit ledger. |

---

## Technical Appendix: Architectural Verifications & Institutional Governance

### A.1 Disambiguation of User Controls: Policies vs Permissions vs Quotas
To ensure operational clarity at Benghazi Medical Center, RISpro enforces strict separation between three distinct layers of user control:

```
+---------------------------------------------------------------------------------------------------+
| LAYER 1: RBAC SYSTEM PERMISSIONS (Role-Based Access Control)                                      |
| • Defines what a user CAN DO based on their job role.                                             |
| • Example: Receptionist (can book standard slots); Supervisor (can authorize overrides);          |
|   Super Admin (can publish policies).                                                             |
| +-----------------------------------------------------------------------------------------------+ |
| | LAYER 2: SPECIAL QUOTA AUTHORIZATION (allowedUserIds Whitelist)                               | |
| | • Defines which SPECIFIC INDIVIDUALS can draw from dedicated priority pools.                  | |
| | • Configured per Special Quota rule (e.g., Bed Coordinator Fatima Mansour can book ICU surge). | |
| | • Completely separate from calendar policies. Super admins are implicitly authorized.         | |
| +-----------------------------------------------------------------------------------------------+ |
|                                                                                                   |
| +-----------------------------------------------------------------------------------------------+ |
| | LAYER 3: SCHEDULING CALENDAR POLICIES (Modality & Exam Rules)                                 | |
| | • Defines machine capacity, calendar dates, exam mix caps, and equipment blocks.              | |
| | • Evaluated identically regardless of who initiates the booking, establishing institutional   | |
| |   equity across all departments.                                                              | |
| +-----------------------------------------------------------------------------------------------+ |
+---------------------------------------------------------------------------------------------------+
```

### A.2 Quota Precedence & Special Quota Bypass Boundaries
A frequent misconception is that Special Quotas represent an "unlimited pass" to overbook equipment. In RISpro's `pure-evaluate.ts`, quota evaluation follows an absolute mathematical precedence:

1. **Modality Total Capacity Ceiling is Absolute:**  
   If scanner `CT-01` has a daily capacity of 40 and 40 appointments are booked, **Special Quotas CANNOT bypass Step 4**. The engine halts evaluation with `modality_capacity_exceeded`. Special Quota extra slots can only be allocated within the unbooked total machine buffer.
2. **Category Limit Bypass is Explicit:**  
   When an authorized user books via `special_quota_extra`, the engine skips Step 5 (Category Daily Limit), allowing the booking to proceed even if Oncology or Non-Oncology quotas are 100% full.
3. **Isolated Quota Accounting:**  
   Special Quota bookings are recorded in a separate durable ledger (`appointments_v2.special_quota_consumptions`) keyed by `(logical_key, booking_date)`. They do not decrement standard category counters.

### A.3 Concurrency Protection Across Patient Categories
In a tertiary hospital with multiple booking terminals, concurrent booking attempts could potentially breach daily ceilings. RISpro protects against this race condition using **database-level mutex serialization**:

```sql
-- Transactional Mutex Lock in src/modules/appointments-v2/services/booking-service.ts
BEGIN;

-- Acquires an exclusive row-level lock on the modality bucket for the target date
SELECT * FROM appointments_v2.bucket_mutex
WHERE modality_id = $1 
  AND booking_date = $2 
  AND case_category = $3
FOR UPDATE;

-- Recalculate real-time booked counts while lock is held
SELECT COUNT(*) FROM appointments_v2.bookings
WHERE modality_id = $1 AND booking_date = $2;

-- Evaluate pure-evaluate() with real-time atomic counts
-- If valid, insert booking and commit; if capacity reached, abort transaction
COMMIT;
```

Because row-level locks are acquired prior to evaluating capacity and inserting the appointment, concurrent requests from reception and ICU triage are strictly serialized. Double-booking is mathematically impossible.

### A.4 Institutional Realities for Benghazi Medical Center Rollout

The following operational notes clarify current system behavior and planned enhancements:

1. **Patient Track Categorization:**  
   The current RISpro database schema defines two active case category enums: `'oncology'` and `'non_oncology'`. While this pilot demonstrates how BMC can utilize these partitions to protect clinical throughput, **the system does not currently feature dynamic Inpatient / Outpatient / Emergency category enums out of the box**. A dedicated schema migration is scheduled for Phase 2B to expand category enums to general hospital tracks.
2. **Policy Rollback Governance:**  
   While published policies are stored immutably in `appointments_v2.policies` with full historical version tracking, **the current user interface does not feature an automated one-click "Rollback" button**. To revert to a prior policy version, administrators branch a new draft from the historical snapshot and re-publish it through the standard validation modal.
3. **Zero-Downtime Policy Activation:**  
   Policy publication operates atomically: the database updates the active version pointer within a single transaction. New booking requests immediately evaluate against the newly published snapshot without requiring web server restarts or user cache clearing.
4. **Standalone RIS Operation:**  
   RISpro's native Master Patient Index (MPI), bilingual Arabic/English name normalization, and National ID barcode scanning operate autonomously, providing complete operational capability at BMC prior to hospital-wide HIS/ADT network integration.

---

## Conclusion & Readiness for Full Guide Development

This illustrated pilot demonstrates that RISpro's Scheduling Engine and Policy Manager provide the exact operational controls required by Benghazi Medical Center. By combining **fine-grained exam mix caps**, **automated alternate-week MDT recurrence**, **dedicated ICU surge quotas**, and **tamper-evident supervisor overrides**, RISpro transforms radiology scheduling into a reliable instrument of clinical quality and patient safety.

Upon institutional acceptance of this Phase 2A pilot, the documentation team will proceed to author the remaining illustrated operational chapters covering Patient Registration, Reception Queues, Modality Worklists, Diagnostic Reporting, and Administrative Dashboards.
