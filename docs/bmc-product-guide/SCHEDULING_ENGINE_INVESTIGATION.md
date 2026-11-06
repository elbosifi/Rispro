# RISpro Appointments V2 Scheduling Engine & Policy Manager
## Exhaustive Capability Investigation, Configuration Atlas & BMC Operational Blueprints

**Document Status:** Final Investigation & Architectural Blueprint (Phase 1 Deliverable)  
**Target Institution:** Benghazi Medical Center (BMC) — Radiology Directorate  
**Prepared By:** RIS Product Analyst & Technical Documentation Architecture Team  
**Evaluation Target:** RISpro Appointments V2 (`src/modules/appointments-v2/` & `frontend/src/v2/appointments/`)  
**Date of Audit:** November 2026  

---

## Executive Summary & Strategic Context

This document provides a comprehensive, technically authoritative, and clinically grounded capability atlas of the **RISpro Appointments V2 Scheduling Engine and Policy Manager**.

Initial assessments characterized RISpro's scheduling capabilities in broad terms as a calendar with daily quotas and supervisor overrides. This exhaustive code and architectural audit proves that RISpro possesses an **enterprise-grade, policy-driven scheduling engine** featuring multi-tiered quota pools, alternate-week anchor parity recurrence, strict transactional concurrency serialization, fine-grained exam-mix constraints, and an immutable snapshot policy lifecycle.

For **Benghazi Medical Center (BMC)**—a premier 1,200-bed tertiary general hospital operating high-volume cross-sectional imaging suites (CT, MRI, Ultrasound, Interventional, Fluoroscopy, Digital Radiography)—understanding the full breadth of this engine is vital. This report systematically details every configuration dimension, policy type, precedence rule, database lock, user interaction, and clinical demonstration scenario, providing the foundation for user documentation, administrative training, and institutional rollout.

```
+---------------------------------------------------------------------------------------------------------+
|                                    RISPRO POLICY MANAGER ARCHITECTURE                                   |
+---------------------------------------------------------------------------------------------------------+
|                                                                                                         |
|   +-----------------------+       +------------------------+       +--------------------------------+   |
|   |  Draft Policy Editor  | ----> | Visual Diff & Validate | ----> |   Atomic Publish & Snapshot    |   |
|   |  (Isolated Staging)   |       |  (Collision Detection) |       | (Immutable Versioned Policies) |   |
|   +-----------------------+       +------------------------+       +--------------------------------+   |
|                                                                                    |                    |
+------------------------------------------------------------------------------------|--------------------+
                                                                                     v
+---------------------------------------------------------------------------------------------------------+
|                             SCHEDULING ENGINE CONCURRENT EVALUATION PIPELINE                            |
+---------------------------------------------------------------------------------------------------------+
|                                                                                                         |
|   1. Bucket Mutex Serialization (SELECT ... FOR UPDATE on Modality + Date + Category)                   |
|   2. Modality Block Evaluation (Specific Date / Date Range / Yearly Cross-Year Recurrence)              |
|   3. Closed Weekday Rule (Default Friday / Saturday; Supervisor Override Gating)                        |
|   4. Modality Daily Capacity Ceiling (modality.daily_capacity — Absolute Upper Bound)                   |
|   5. Category Capacity Limits (Daily Oncology vs Non-Oncology Quotas; Special Quota Extra Bypass)       |
|   6. Exam-Type Restrictions (Day of Week / Alternate-Week Parity / Specific Dates)                     |
|   7. Exam-Mix Quotas (Multi-group Resource Caps; Lowest Limit Disambiguation; Override Exclusion)       |
|   8. Special Quota Pools (Role/User-Whitelisted Dedicated Slots; Modality-Guarded, Isolated Ledger)     |
|   9. Booking Decision Output (isAllowed, requiresOverride, bookingMode, displayStatus, Audit Trace)    |
|                                                                                                         |
+---------------------------------------------------------------------------------------------------------+
```

---

## Section 1: Comprehensive Scheduling Engine Capability Atlas

The RISpro Scheduling Engine evaluates booking eligibility by combining machine parameters, calendar configurations, policy rules, real-time consumption counters, and actor authorizations. The evaluation engine is completely decoupled from UI presentation, executing in `src/modules/appointments-v2/rules/services/pure-evaluate.ts`.

### 1.1 Dimension A: Examination-Specific Customization

Examination customization controls how specific clinical procedures are distributed across dates, weekdays, and modality resources.

| Capability | Technical Mechanism | Source Reference | Configuration Granularity | Operational Clinical Impact for BMC |
| :--- | :--- | :--- | :--- | :--- |
| **Exam-Type Specific Restrictions** | `ExamTypeRuleRow` & `appointments_v2.exam_type_rule_items` | `rule-types.ts:40-54`, `pure-evaluate.ts:454-520` | Procedure-level (`exam_type_id`). Can bind multiple exam types to a single rule row. | Restricts complex examinations (e.g., Cardiac CT, Multiparametric Prostate MRI, CT-guided biopsies) to specific days when specialized radiologists or anesthesia teams are on-site. |
| **Hard vs Overridable Restrictions** | `rule_effect`: `'hard_restriction'` vs `'restriction_overridable'` | `rule-types.ts:51-53`, `pure-evaluate.ts:489-510` | Binary flag per exam-type rule. | **Hard:** Absolute block (e.g., procedures requiring contrast media on days when emergency resuscitation teams are absent).<br>**Overridable:** Allows clinical supervisors to approve urgent booking requests with documented justification. |
| **Alternate-Week Recurrence** | `weekly_recurrence` with `alternateWeeks: true` and `isoAnchorDate` | `date-rule-matching.ts:87-118` | ISO Week Parity calculation: `(currentIsoWeek - anchorIsoWeek) % 2 === 0`. | Perfect for bi-weekly specialized clinics (e.g., Specialized Neuro-Oncology MRI every second Tuesday). |
| **Multi-Procedure Conflict Resolution** | Item iteration with multi-rule aggregation | `pure-evaluate.ts:468-485` | Per procedure in multi-order context. | Evaluates all active rules. If any rule triggers a hard restriction, the entire combination is blocked unless individual exam rules permit override. |

### 1.2 Dimension B: Modality-Specific Customization

Modality controls ensure that physical equipment (scanners, rooms, ultrasound suites) is utilized within safe operational limits.

| Capability | Technical Mechanism | Source Reference | Configuration Granularity | Operational Clinical Impact for BMC |
| :--- | :--- | :--- | :--- | :--- |
| **Modality Daily Total Capacity** | `modality.daily_capacity` | `pure-evaluate.ts:325-345`, `appointments_v2.modalities` | Integer count per modality (e.g., 40 exams/day for CT-01). | Absolute physical limit. No booking mode, including Special Quotas or Supervisor Overrides, can exceed this ceiling without an administrative schema update. |
| **Modality Downtime / Maintenance Blocks** | `ModalityBlockedRuleRow` | `rule-types.ts:25-38`, `pure-evaluate.ts:248-285` | Modality-specific by date, date range, or yearly recurrence. | Planned preventative maintenance, cryogen refilling for MRI, tube replacement for CT, or national holiday shutdowns. |
| **Modality Hard vs Overridable Blocking** | `isOverridable: boolean` | `rule-types.ts:35`, `pure-evaluate.ts:262-284` | Boolean flag on block rule. | **Hard Block:** Scanner physically unpowered or dismantled.<br>**Overridable Block:** Reduced staffing or non-essential maintenance where urgent emergency scans can still be forced by a supervisor. |
| **Multi-Modality Independent Policies** | Foreign key linking in `policy_drafts` and `policies` | `scheduling-admin-page.tsx`, `schema.sql` | Per modality device (`modality_id`). | BMC can manage distinct scheduling models for CT-01 (Emergency/Trauma 64-slice), CT-02 (Outpatient 128-slice dual-source), and MRI-01 (1.5T). |

### 1.3 Dimension C: Calendar, Date & Temporal Customization

Calendar rules govern temporal scheduling availability across weeks, months, and years.

| Capability | Technical Mechanism | Source Reference | Behavior & Validation | Operational Clinical Impact for BMC |
| :--- | :--- | :--- | :--- | :--- |
| **Weekly Closed Days** | `closedWeekdays` array (e.g., `[5, 6]` for Friday & Saturday) | `pure-evaluate.ts:287-320` | Weekday 0=Sunday, 5=Friday, 6=Saturday. Evaluated against `booking_date`. | Enforces standard Libyan hospital operating weeks (Sunday–Thursday outpatient schedule). Friday/Saturday require supervisor override. |
| **Specific Date Targeting** | `rule_type: 'specific_date'`, `target_date: 'YYYY-MM-DD'` | `date-rule-matching.ts:20-25` | Exact string equality match against target booking date. | Accommodates one-off facility events, visiting foreign consultant days, or public holidays. |
| **Continuous Date Ranges** | `rule_type: 'date_range'`, `start_date`, `end_date` | `date-rule-matching.ts:27-40` | Inclusive chronological boundary: `target >= start && target <= end`. | Extended maintenance windows, system upgrades, or multi-day conference coverage. |
| **Yearly Recurring Windows (Cross-Year Capable)** | `rule_type: 'yearly_recurrence'`, `start_month_day`, `end_month_day` | `date-rule-matching.ts:42-85` | Supports standard intervals (`05-01` to `05-05`) and year-boundary crossings (`12-25` to `01-05`). | Annual recurring public holidays (Revolution Day, Eid al-Fitr, Eid al-Adha) and year-end inventory shutdowns without requiring yearly policy re-authoring. |

### 1.4 Dimension D: User-Specific, Role-Specific & Privilege Gating

RISpro enforces strict segregation of duties between operational clerks and clinical supervisors.

```
+---------------------------------------------------------------------------------------------------------+
|                                  ROLE & PRIVILEGE BOUNDARY ENFORCEMENT                                  |
+---------------------------------------------------------------------------------------------------------+
|                                                                                                         |
|   Standard Booking Actor (Receptionist / Call Center)                                                   |
|   ├── Can book normal slots within Category Limits.                                                     |
|   ├── CANNOT book on Modality Blocked days (Hard or Overridable).                                        |
|   ├── CANNOT book on Closed Weekdays (Friday/Saturday).                                                 |
|   ├── CANNOT exceed Category Limits or Exam Mix Quotas.                                                 |
|   └── CANNOT access Special Quotas unless explicitly named in allowedUserIds.                           |
|                                                                                                         |
|   Authorized Special Quota User (Specialized Clinic Coordinator / Oncology Liaison)                     |
|   ├── Inherits standard booking capabilities.                                                           |
|   └── CAN allocate dedicated slots from assigned Special Quota pools (special_quota_extra mode).         |
|                                                                                                         |
|   Clinical Supervisor / Department Head (Supervisory Radiologist / Operations Lead)                     |
|   ├── Can override Overridable Modality Blocks (requires mandatory documented rationale).               |
|   ├── Can override Closed Weekday closures (requires clinical emergency justification).                 |
|   ├── Can override Category Daily Limits and Exam Mix Quota ceilings.                                   |
|   └── CANNOT override Modality Hard Blocks (physically impossible) or Daily Capacity Ceilings.          |
|                                                                                                         |
|   Super Administrator (System / Radiology Directorate Admin)                                            |
|   ├── Implicitly authorized for all Special Quota pools (allowedUserIds check automatically passes).     |
|   └── Full authoring, diffing, publishing, and archiving rights across all Modality Policies.           |
|                                                                                                         |
+---------------------------------------------------------------------------------------------------------+
```

| Actor Role | Modality Hard Block | Modality Overridable Block | Closed Weekday (Fri/Sat) | Category Limit Exceeded | Exam Mix Exceeded | Special Quota Pool | Total Modality Capacity Exceeded |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Receptionist / Clerk** | ❌ Blocked | ❌ Blocked | ❌ Blocked | ❌ Blocked | ❌ Blocked | ❌ Denied (Unless whitelisted) | ❌ Hard Block |
| **Whitelisted Quota User** | ❌ Blocked | ❌ Blocked | ❌ Blocked | ❌ Blocked | ❌ Blocked | ✅ Permitted (extra mode) | ❌ Hard Block |
| **Clinical Supervisor** | ❌ Blocked | ⚠️ Allowed w/ Rationale | ⚠️ Allowed w/ Rationale | ⚠️ Allowed w/ Rationale | ⚠️ Allowed w/ Rationale | ❌ Denied (Unless whitelisted) | ❌ Hard Block |
| **Super Administrator** | ❌ Blocked | ⚠️ Allowed w/ Rationale | ⚠️ Allowed w/ Rationale | ⚠️ Allowed w/ Rationale | ⚠️ Allowed w/ Rationale | ✅ Automatically Whitelisted | ❌ Hard Block |

### 1.5 Dimension E: The Complete Multi-Tiered Quota Architecture

RISpro's quota system consists of four concentric, interacting operational tiers:

```
+---------------------------------------------------------------------------------------------------+
| TIER 1: TOTAL MODALITY DAILY CAPACITY CEILING (modality.daily_capacity)                           |
| Absolute mechanical/staffing limit (e.g. 40 scans/day on CT-01). Enforced across all booking modes|
| +-----------------------------------------------------------------------------------------------+ |
| | TIER 2: CATEGORY DAILY LIMITS (appointments_v2.category_daily_limits)                         | |
| | Partitioned by clinical track (e.g., Oncology: 25 slots | Non-Oncology: 15 slots)             | |
| | +-------------------------------------------------------------------------------------------+ | |
| | | TIER 3: EXAM MIX QUOTAS (appointments_v2.exam_mix_quotas)                                 | | |
| | | Caps time-consuming or high-acuity exam groupings within general quotas                  | | |
| | | (e.g., Max 4 Abdominal/Pelvis Contrast CTs per morning session)                          | | |
| | +-------------------------------------------------------------------------------------------+ | |
| +-----------------------------------------------------------------------------------------------+ |
|                                                                                                   |
| +-----------------------------------------------------------------------------------------------+ |
| | TIER 4: SPECIAL QUOTA EXTRA POOLS (appointments_v2.special_quota_rules)                       | |
| | Reserved high-priority slots (e.g., Urgent Inpatient / Emergency slots)                       | |
| | • Bypasses Tier 2 Category Daily Limits!                                                      | |
| | • Bypasses Tier 3 Exam Mix Quota consumption!                                                 | |
| | • MUST respect Tier 1 Modality Daily Capacity Ceiling!                                        | |
| | • Tracked in isolated ledger (appointments_v2.special_quota_consumptions)                     | |
| +-----------------------------------------------------------------------------------------------+ |
+---------------------------------------------------------------------------------------------------+
```

#### Detailed Quota Analysis Table

| Quota Level | Database Table | Governing Parameters | Consumption Calculation | Bypass & Override Rules |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 1: Modality Daily Capacity** | `appointments_v2.modalities` | `daily_capacity: number` | Sum of all booked appointments on date regardless of category. | **Absolute Wall:** No override permitted in application logic. Protects physical equipment from overheating and staffing collapse. |
| **Tier 2: Category Daily Limit** | `appointments_v2.category_daily_limits` | `case_category` (`'oncology'` / `'non_oncology'`), `daily_limit: number` | Count of active appointments booked under that category for the target date. | • **Supervisor Override:** Permitted with clinical justification.<br>• **Special Quota Extra:** Automatically bypasses category limits. |
| **Tier 3: Exam Mix Quota** | `appointments_v2.exam_mix_quotas` & `exam_mix_quota_items` | `group_name`, `daily_limit`, associated `exam_type_ids`, recurrence parameters. | Count of booked appointments matching the grouped exam types for the target date. | • **Supervisor Override:** Permitted when slots are exhausted.<br>• **Special Quota Extra:** Bypasses exam mix counts entirely. |
| **Tier 4: Special Quota Extra** | `appointments_v2.special_quota_rules` | `logical_key`, `daily_limit`, `allowed_user_ids`, associated `exam_type_ids`. | Stored in dedicated ledger `appointments_v2.special_quota_consumptions` keyed by `(logical_key, booking_date)`. | • Available ONLY to whitelisted users or Super Admins.<br>• Non-overlapping: an exam type can only belong to one active special quota per policy.<br>• Bypasses Category and Exam Mix limits. |

### 1.6 Dimension F: Concurrency Safety & Mutex Serialization

In a busy tertiary hospital like Benghazi Medical Center, dozens of receptionists and ward clerks book appointments simultaneously. RISpro guarantees that concurrent booking requests cannot double-book or breach quota ceilings through **strict database mutex serialization**.

```
    User A (Outpatient Desk)                      User B (Emergency Triage)
               |                                              |
               v                                              v
    POST /appointments/book                       POST /appointments/book
               |                                              |
               +----------------------+-----------------------+
                                      |
                                      v
                     BEGIN DB TRANSACTION (ISOLATION LEVEL RC)
                                      |
                                      v
                      SELECT * FROM appointments_v2.bucket_mutex
                      WHERE modality_id = $1 
                        AND booking_date = $2 
                        AND case_category = $3
                      FOR UPDATE;  <--- EXCLUSIVE ROW-LEVEL MUTEX LOCK
                                      |
                     [User A acquires lock; User B blocks & waits]
                                      |
                     • Fetch fresh consumption counts from DB
                     • Evaluate pure-evaluate() with real counts
                     • Insert appointment record
                     • Increment special_quota_consumptions ledger
                     • COMMIT TRANSACTION (Lock released)
                                      |
                     [User B acquires lock; evaluates updated counts]
                                      |
                     • Evaluates pure-evaluate() against NEW totals
                     • Rejects if quota reached OR books cleanly
                     • COMMIT TRANSACTION
```

- **Lock Scope:** `(modality_id, booking_date, case_category)` in `appointments_v2.bucket_mutex`.
- **Zero Race Conditions:** Capacity queries and booking insertions occur within the same serial atomic transaction.
- **Fail-Safe Release:** Database rollback automatically releases row locks in the event of any network or validation failure.

---

## Section 2: Policy Manager Configuration Dictionary

The Policy Manager is the administrative command center of RISpro Appointments V2. Implemented across `frontend/src/v2/appointments/pages/scheduling-admin-page.tsx` and `policy-draft-editor.tsx`, it allows radiology administrators to author, test, and publish complex scheduling rules safely.

### 2.1 The Policy Lifecycle: Safe Draft & Snapshot Model

To prevent configuration errors from impacting active clinical booking operations, RISpro employs an **immutable snapshot policy architecture**.

```
+---------------------------------------------------------------------------------------------------+
|                                  POLICY LIFECYCLE STATE MACHINE                                   |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|    +-----------------------+              Save Draft              +---------------------------+   |
|    |      Empty State      | -----------------------------------> |       Draft Policy        |   |
|    |  (No Active Edits)    |                                      |   (Working Sandbox Copy)  |   |
|    +-----------------------+                                      +---------------------------+   |
|                ^                                                                |                 |
|                |                                                                | Visual Diff     |
|                | Discard / Rollback                                             v Verification    |
|                |                                                  +---------------------------+   |
|                +------------------------------------------------- |      Diff & Validate      |   |
|                                                                   +---------------------------+   |
|                                                                                 |                 |
|                                                                                 | Atomic Publish  |
|                                                                                 v                 |
|    +-----------------------+           Superseded by New          +---------------------------+   |
|    |    Archived Policy    | <----------------------------------- |     Published Policy      |   |
|    |  (Immutable History)  |               Version                |   (Active Booking Engine) |   |
|    +-----------------------+                                      +---------------------------+   |
|                                                                                                   |
+---------------------------------------------------------------------------------------------------+
```

1. **Working Draft (`draft`):** Administrators modify quotas, add exam restrictions, or schedule downtime in an isolated sandbox. Live booking operations remain entirely unaffected.
2. **Visual Diff Preview:** Before committing changes, the administrator reviews an automated side-by-side diff comparing the draft against the currently published policy.
3. **Atomic Snapshot Publish (`published`):** On publication, the draft is converted into an immutable snapshot record in `appointments_v2.policies`. The scheduling engine immediately switches its reference pointer to the new policy version.
4. **Historical Archive (`archived`):** Previous policy versions are never deleted. They are archived with cryptographic SHA timestamps, preserving an auditable historical record of the exact rules active on any past date.

### 2.2 Configuration Interface Dictionary: Screens, Tabs & Fields

#### Screen A: Policy Administration Overview (`scheduling-admin-page.tsx`)
- **Modality Selector:** Dropdown listing all active imaging modalities (CT-01, CT-02, MRI-01, US-01). Selecting a modality loads its published policy and active draft status.
- **Status Badges:** Visual indicators displaying current state: `Published (v3)`, `Draft in Progress`, or `Unpublished`.
- **Primary Actions:**
  - `Create Draft / Edit Draft`: Opens the comprehensive Draft Editor.
  - `View Published Snapshot`: Inspects the currently active rules in read-only mode.
  - `Publish Draft`: Triggers validation, diff modal, and publication pipeline.
  - `Discard Draft`: Reverts all uncommitted changes back to the published baseline.

#### Screen B: Comprehensive Draft Editor (`policy-draft-editor.tsx`)

##### Tab 1: Category Daily Limits
Configures overall clinical track quotas for the modality.
- **Fields:**
  - `Oncology Daily Limit`: Integer input specifying the maximum standard oncology appointments allowed per day.
  - `Non-Oncology Daily Limit`: Integer input specifying standard non-oncology outpatient appointments per day.
- **Validation Rules:**
  - Sum of `Oncology Limit + Non-Oncology Limit` must not exceed `modality.daily_capacity`.
  - Negative values or decimals are strictly rejected.

##### Tab 2: Modality Downtime & Maintenance Blocks
Configures planned equipment closures, holidays, and maintenance schedules.
- **Fields:**
  - `Rule Name / Description`: Text identifier (e.g., "MRI Cold Head Replacement").
  - `Recurrence Type`:
    - `specific_date`: Target single date picker (`target_date`).
    - `date_range`: Date picker range (`start_date`, `end_date`).
    - `yearly_recurrence`: Month-Day inputs (`start_month_day`, `end_month_day`), supports year-end crossing.
  - `Overridable Toggle`: Checkbox (`isOverridable`). If checked, clinical supervisors can override with documented rationale; if unchecked, represents an absolute mechanical block.

##### Tab 3: Exam-Type Restrictions & Day-of-Week Rules
Controls which days specific examinations may be performed.
- **Fields:**
  - `Exam Type Selector`: Multi-select dropdown mapping to active procedure codes.
  - `Restriction Type`:
    - `weekly_recurrence`: Days of week checkboxes (Sunday through Saturday).
    - `alternateWeeks`: Checkbox enabling bi-weekly parity. Requires `isoAnchorDate` (anchor calendar week).
    - `specific_date` / `date_range`: For temporary exam-level suspensions.
  - `Rule Effect`:
    - `hard_restriction`: Exam cannot be booked on non-matching days.
    - `restriction_overridable`: System flags a warning and requires supervisor override.

##### Tab 4: Exam Mix Quotas
Prevents high-acuity examinations from consuming all standard appointment slots.
- **Fields:**
  - `Group Name`: Descriptive title (e.g., "Complex Contrast Studies").
  - `Daily Limit`: Maximum allowed examinations of this group per day (e.g., 6).
  - `Included Exam Types`: Multi-select procedure picker.
  - `Recurrence Window`: Applies mix restriction daily, on specific weekdays, or during specified date intervals.
- **Behavior:** The engine calculates real-time consumed slots for all exams in the group. Once reached, booking is blocked unless approved as an override.

##### Tab 5: Special Quota Extra Pools
Allocates dedicated slots for urgent, VIP, or specialty department referrals.
- **Fields:**
  - `Logical Key`: Unique system identifier preserved across policy revisions (e.g., `URGENT_INPATIENT_CT`).
  - `Pool Name / Label`: Display label (e.g., "ICU / Emergency Surge CT Capacity").
  - `Daily Extra Slots`: Integer count of dedicated slots (e.g., 4).
  - `Associated Exam Types`: Specific procedures eligible for this quota.
  - `Allowed Users`: User selection list. Only designated individuals (or Super Admins) can utilize this pool.
- **Key Administrative Rules:**
  - **No Exam Overlap:** An individual exam type cannot be assigned to more than one active Special Quota pool on the same modality.
  - **Capacity Safeguard:** Special Quotas bypass Category Limits but are strictly bounded by total modality daily capacity.

---

## Section 3: Scheduling Rule Interaction & Precedence Matrix

When a user initiates an appointment booking, the Scheduling Engine evaluates the request against active policies. The logic is strictly deterministic and follows an immutable 7-step sequence implemented in `pure-evaluate.ts`.

### 3.1 The 7-Step Evaluation Pipeline

```
                                  INCOMING BOOKING REQUEST
           (Modality, Date, Exam Type, Category, Requesting User, Override Flag)
                                              |
                                              v
           +----------------------------------------------------------------------+
           | STEP 1: Modality Hard Block Evaluation                               |
           | Matches date/range/yearly recurrence?                                |
           +----------------------------------------------------------------------+
                       |                                      |
                    [MATCH]                               [NO MATCH]
                       v                                      v
              REJECT IMMEDIATELY                              |
           (modality_blocked_hard)                            v
                                          +---------------------------------------+
                                          | STEP 2: Modality Overridable Block    |
                                          +---------------------------------------+
                                                      |               |
                                                   [MATCH]        [NO MATCH]
                                                      v               v
                                            REQUIRES OVERRIDE         |
                                         (modality_blocked_overridable)v
                                          +---------------------------------------+
                                          | STEP 3: Closed Weekday Rule           |
                                          | Is booking date a Friday or Saturday? |
                                          +---------------------------------------+
                                                      |               |
                                                   [MATCH]        [NO MATCH]
                                                      v               v
                                            REQUIRES OVERRIDE         |
                                        (closed_day_supervisor_override)
                                                                      v
                                          +---------------------------------------+
                                          | STEP 4: Modality Daily Capacity       |
                                          | Total Booked >= Daily Capacity?       |
                                          +---------------------------------------+
                                                      |               |
                                                    [YES]            [NO]
                                                      v               v
                                             REJECT IMMEDIATELY       |
                                         (modality_capacity_exceeded) v
                                          +---------------------------------------+
                                          | STEP 5: Category Daily Limit          |
                                          | Booked >= Limit AND NOT Special Extra?|
                                          +---------------------------------------+
                                                      |               |
                                                    [YES]            [NO]
                                                      v               v
                                            REQUIRES OVERRIDE         |
                                         (category_limit_exceeded)    v
                                          +---------------------------------------+
                                          | STEP 6: Exam-Type Restriction Rules   |
                                          | Day/Recurrence/Date restriction?      |
                                          +---------------------------------------+
                                                      |               |
                                               [RESTRICTED]       [ALLOWED]
                                                      v               v
                                            Hard -> REJECT (error)    |
                                            Overridable -> OVERRIDE   v
                                          +---------------------------------------+
                                          | STEP 7: Exam Mix Quota Rules          |
                                          | Group Limit Reached AND NOT Extra?    |
                                          +---------------------------------------+
                                                      |               |
                                                    [YES]            [NO]
                                                      v               v
                                            REQUIRES OVERRIDE         |
                                          (exam_mix_quota_exceeded)   v
                                          +---------------------------------------+
                                          | FINAL EVALUATION:                     |
                                          | Clean Booking Allowed (isAllowed:true)|
                                          +---------------------------------------+
```

### 3.2 Exhaustive Rule Precedence & Interaction Matrix

| Scenario / Combination | Rule 1 | Rule 2 | Engine Precedence Outcome | User Experience & Booking Status | Supervisor Override Eligible? |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **1. Maintenance vs Supervisor Override** | Modality Hard Block active | Supervisor attempts manual override | **Hard Block takes absolute precedence.** Evaluation aborts at Step 1. | Booking blocked. Banner: *"Modality is completely unavailable due to scheduled maintenance."* | ❌ No |
| **2. Friday Booking vs Category Limit** | Date is Friday (Closed Weekday) | Category slots available | **Closed Weekday takes precedence.** Step 3 requires supervisor override before quota check. | Action required: System prompts for Supervisor PIN & Clinical Justification. | ⚠️ Yes |
| **3. Special Quota vs Category Exhaustion** | Category Quota full (25/25 booked) | User is whitelisted for Special Quota Extra | **Special Quota Extra bypasses Step 5.** Allowed under `suggestedBookingMode: 'special_quota_extra'`. | Allowed cleanly. Dedicated slot consumed from `special_quota_consumptions`. | ✅ Not Required (Auto-allowed) |
| **4. Special Quota vs Modality Total Capacity** | Special Quota slots remain (1/4 used) | Modality Total Capacity full (40/40) | **Tier 1 Capacity takes absolute precedence at Step 4.** | Booking blocked. Banner: *"Modality daily capacity ceiling reached. No further bookings possible."* | ❌ No |
| **5. Exam Mix Exhaustion vs Available Category** | Non-Oncology has 10 slots free | Abdomen Contrast Mix is full (4/4 used) | **Exam Mix blocks booking at Step 7.** | Blocked with warning: *"Daily limit for Complex Contrast studies has been reached."* | ⚠️ Yes (Requires Override) |
| **6. Multi-Group Exam Mix Conflict** | Exam belongs to Group A (Limit 4, full) | Exam belongs to Group B (Limit 8, full) | **Disambiguation logic selects lowest daily limit.** Group A reported as `primaryBlockingGroup`. | Clear diagnostic message points to the tighter constraint (Group A). | ⚠️ Yes |
| **7. Hard Exam Restriction vs Valid Quota** | Exam restricted to Tuesdays (Hard) | User books on Wednesday; quota has 15 free slots | **Hard Exam Restriction halts evaluation at Step 6.** | Blocked with error: *"This examination cannot be performed on Wednesdays."* | ❌ No |
| **8. Overridable Exam Restriction vs Quota** | Exam restricted to Tuesdays (Overridable) | User books on Wednesday; quota has slots | **Overridable restriction triggers override warning.** | Warning displayed: *"Exam usually scheduled on Tuesdays. Supervisor override required."* | ⚠️ Yes |

---

## Section 4: Customer Demonstration Scenarios (BMC Realistic)

To validate the engine in realistic clinical conditions at Benghazi Medical Center, the following five scenarios demonstrate real-world operational challenges and their automated resolution by RISpro.

### Scenario 1: Friday Polytrauma Emergency CT (Closed Weekday Override)
- **Clinical Context:** An urgent polytrauma patient from a road traffic collision arrives at the BMC Emergency Department on Friday afternoon requiring immediate Whole-Body Trauma CT.
- **Engine Rules Active:**
  - Modality: `CT-01` (Emergency Scanner).
  - Closed Weekdays: `[5, 6]` (Friday/Saturday outpatient closure).
- **Execution Flow:**
  1. Triage clerk enters patient details and selects Trauma CT protocol for Friday.
  2. Engine Step 3 flags `closed_day_supervisor_override`.
  3. UI opens the **Supervisor Override Modal**.
  4. On-duty Radiology Supervisor enters credentials and selects override reason: *"Emergency Polytrauma / Life-Threatening Case"*.
  5. Engine logs supervisor ID, timestamp, and rationale to `appointments_v2.overrides`.
  6. Appointment is scheduled instantly, and DICOM Modality Worklist (MWL) is broadcast to the scanner console.

### Scenario 2: Alternate-Week Neuro-Oncology MRI (Recurrence Parity)
- **Clinical Context:** The Specialized Neuro-Oncology multidisciplinary team meets every second Tuesday. Advanced Functional MRI (fMRI) with MR Spectroscopy is restricted to those specific alternating weeks.
- **Engine Rules Active:**
  - Modality: `MRI-01` (3.0T Scanner).
  - Exam Type: `MRI-NEURO-SPEC` (fMRI + Spectroscopy).
  - Rule Type: `weekly_recurrence`, Weekday: Tuesday (2), `alternateWeeks: true`, `isoAnchorDate: '2026-01-06'`.
- **Execution Flow:**
  1. Booking clerk searches for fMRI availability on Tuesday, November 10, 2026 (Even ISO week parity).
  2. Engine matches week parity: `(46 - 2) % 2 === 0`. Date is confirmed **Available**.
  3. Clerk navigates to Tuesday, November 17, 2026 (Odd ISO week parity).
  4. Engine flags non-matching parity: `(47 - 2) % 2 !== 0`.
  5. UI displays: *"Examination only permitted on alternating Neuro-Oncology clinic weeks. Next available date: Tuesday, November 24."*

### Scenario 3: Morning Outpatient Ultrasound Cap with Urgent Ward Bypass
- **Clinical Context:** BMC General Ultrasound (US-01) experiences severe morning crowding. Outpatient abdominal ultrasounds are capped at 15 daily to reserve room for urgent inpatient ward referrals.
- **Engine Rules Active:**
  - Category Daily Limit: Non-Oncology Outpatient = 15.
  - Special Quota Pool: `US_WARD_URGENT` = 5 slots. Whitelisted to Inpatient Bed Coordinator.
- **Execution Flow:**
  1. At 10:30 AM, outpatient quota reaches 15/15.
  2. Outpatient clerk attempts to book a 16th outpatient: Engine Step 5 blocks booking (`category_limit_exceeded`).
  3. Concurrently, the Inpatient Bed Coordinator books an urgent ultrasound for an acute pancreatitis patient from Ward 4.
  4. Engine identifies user in `allowedUserIds` for `US_WARD_URGENT`.
  5. Engine activates `suggestedBookingMode: 'special_quota_extra'`, bypassing the exhausted outpatient category limit.
  6. The booking is confirmed, incrementing the dedicated ward quota ledger from 0/5 to 1/5.

### Scenario 4: Pediatric Cardiac CT Radiation Safety Quota (Exam Mix)
- **Clinical Context:** Pediatric Cardiac CT requires pediatric anesthesia, tailored low-kV protocoling, and specialized dual-syringe contrast injection. To prevent clinical fatigue and ensure patient safety, BMC limits these studies to a maximum of 3 cases per day on CT-02.
- **Engine Rules Active:**
  - Exam Mix Quota: `PEDIATRIC_CARDIAC_GROUP` (Daily Limit: 3).
  - Included Exams: `CT-PED-CARD-01`, `CT-PED-CARD-02`.
- **Execution Flow:**
  1. Cases 1, 2, and 3 are booked during morning rounds.
  2. An afternoon clinic attempts to book a 4th Pediatric Cardiac CT for the same day.
  3. Engine Step 7 evaluates active mix counters: `consumedCount (3) >= dailyLimit (3)`.
  4. System flags `exam_mix_quota_exceeded`. UI highlights: *"Daily safety threshold for Pediatric Cardiac CT studies reached (3/3). Additional booking requires Pediatric Radiology Lead override."*

### Scenario 5: End-of-Year Cold Head Maintenance (Cross-Year Date Range)
- **Clinical Context:** BMC Engineering schedules preventative maintenance and cold-head helium re-pressurization for MRI-01 across the year-end transition from December 28, 2026 through January 3, 2027.
- **Engine Rules Active:**
  - Modality: `MRI-01`.
  - Rule Type: `yearly_recurrence`, `start_month_day: '12-28'`, `end_month_day: '01-03'`.
  - `isOverridable: false` (Hard Block).
- **Execution Flow:**
  1. A clerk attempts to schedule a routine lumbar spine MRI for December 30, 2026.
  2. Engine Step 1 evaluates cross-year logic in `date-rule-matching.ts`: `(target >= '12-28' || target <= '01-03')` evaluates to `true`.
  3. System halts evaluation with `modality_blocked_hard`.
  4. UI renders the entire calendar window (Dec 28 – Jan 3) in solid gray with a padlock icon, preventing any slot selection or override attempt.

---

## Section 5: Multi-State, Multi-Viewport & Bilingual Screenshot Plan

To produce authentic, authoritative customer documentation, screenshots must capture actual clinical scenarios across standard states and languages.

```
+---------------------------------------------------------------------------------------------------------+
|                                    VISUAL SCREENSHOT ACQUISITION MATRIX                                 |
+---------------------------------------------------------------------------------------------------------+
|                                                                                                         |
|   1. Policy Admin Overview (`scheduling-admin-page.tsx`)                                                |
|      ├── Published Baseline State (Active v3, Category quotas, Summary cards)                           |
|      ├── In-Draft Staging State (Draft active banner, discard/publish action bar)                        |
|      └── Visual Diff Modal (Side-by-side color-coded additions/deletions)                               |
|                                                                                                         |
|   2. Policy Draft Editor (`policy-draft-editor.tsx`)                                                    |
|      ├── Tab 1: Category Limits & Daily Capacity Ceiling                                                |
|      ├── Tab 2: Modality Downtime & Maintenance Form (Date ranges, Cross-year logic)                     |
|      ├── Tab 3: Exam Restrictions Form (Day checkboxes, Alternate-week parity anchors)                  |
|      ├── Tab 4: Exam Mix Quotas (Grouping selector, multi-exam association pills)                       |
|      └── Tab 5: Special Quota Pools (User whitelist multiselect, isolated quota counters)              |
|                                                                                                         |
|   3. Availability Calendar (`AvailabilityCalendar.tsx`)                                                 |
|      ├── Normal Capacity Day (Green status pills, slot availability counts)                             |
|      ├── Quota Warning State (Amber pill, 90% threshold reached)                                        |
|      ├── Modality Blocked Day (Gray hatched pattern, Maintenance banner)                                |
|      └── Friday/Saturday Closed State (Gold warning border, Supervisor override badge)                  |
|                                                                                                         |
|   4. Supervisor Override Center (`SchedulingOverrideApprovalCenter.tsx`)                                |
|      ├── Active Pending Override Requests (Real-time queue)                                             |
|      ├── Override Approval Modal (PIN authentication, Clinical rationale dropdown)                      |
|      └── Audit Trail Table (Immutable ledger of approved overrides with timestamps)                      |
|                                                                                                         |
+---------------------------------------------------------------------------------------------------------+
```

### Technical Capture Specifications
- **Resolutions:** Desktop standard (1920x1080) and Clinical Workstation tablet (1366x768).
- **Localization:** English (LTR) and Arabic (RTL) captures for all administrative and booking screens.
- **Data Fidelity:** All captures must use realistic Libyan patient nomenclature (e.g., Ali Omar Ben-Salem), standard BMC modality codes (CT-01, MRI-01), and genuine ICD-10 / procedure naming.

---

## Section 6: Revised Scheduling Chapters Syllabus

The product guide will dedicate five structured, customer-facing chapters (Chapters 5A through 5E) to the scheduling ecosystem:

### Chapter 5A: Operational Appointment Scheduling & The Booking Calendar
- **Purpose:** Daily receptionist workflow guide for finding slots, registering appointments, and handling standard patient bookings.
- **Key Topics:** Patient lookup, modality selection, reading calendar heatmaps, understanding morning/afternoon slot distributions, and printing bilingual appointment confirmation slips with QR codes.

### Chapter 5B: The RISpro Scheduling Engine & Capacity Controls
- **Purpose:** Comprehensive explanation of capacity limits, automated rule enforcement, and daily ceilings.
- **Key Topics:** Total modality capacity vs category limits, exam-specific restrictions, alternate-week clinic schedules, and automated closed-day enforcement.

### Chapter 5C: Multi-Tiered Quota Management & Special Slot Pools
- **Purpose:** Operational guide to managing competing clinical priorities and protected departmental slots.
- **Key Topics:** Exam Mix Quotas for high-acuity studies, Special Quota Extra pools for urgent/ward referrals, user whitelisting, and quota ledger tracking.

### Chapter 5D: Clinical Exceptions, Supervisor Overrides & Audit Accountability
- **Purpose:** Standard operating procedures for handling clinical emergencies, capacity overrides, and supervisory approvals.
- **Key Topics:** When overrides are clinically appropriate, step-by-step override authorization, supervisor PIN authentication, recording clinical rationale, and reviewing the immutable override audit ledger.

### Chapter 5E: Policy Administration & Safe Rule Authoring
- **Purpose:** Administrative manual for radiology managers configuring modality rules and seasonal schedules.
- **Key Topics:** The Policy Draft sandbox, setting maintenance downtimes, defining exam mixes, pre-publication diff validation, atomic snapshot publishing, and historical policy archiving.

---

## Section 7: Implementation Evidence & Verification Matrix

Every capability described in this investigation is verified against the RISpro codebase and database schema:

| Architectural Component | Source Code Implementation | Database Schema & Tables | Automated Test Verification |
| :--- | :--- | :--- | :--- |
| **Pure Evaluation Engine** | `src/modules/appointments-v2/rules/services/pure-evaluate.ts` (863 lines) | `appointments_v2.policies`, `modalities` | `tests/backend/unit/appointments-v2/pure-evaluate.spec.ts` |
| **Rule Type Definitions** | `src/modules/appointments-v2/rules/models/rule-types.ts` | `appointments_v2.category_daily_limits`, `exam_type_rules` | Type contract tests |
| **Date & Recurrence Math** | `src/modules/appointments-v2/rules/utils/date-rule-matching.ts` | ISO-8601 string fields | `tests/backend/unit/appointments-v2/date-rule-matching.spec.ts` |
| **Booking Decision Models** | `src/modules/appointments-v2/rules/models/booking-decision.ts` | Decision enum types | Integration test assertions |
| **Concurrency & Mutex Locks** | `src/modules/appointments-v2/services/booking-service.ts` | `appointments_v2.bucket_mutex` (`FOR UPDATE`) | `tests/backend/db/appointments-v2/concurrency.spec.ts` |
| **Special Quota Ledger** | `src/modules/appointments-v2/services/special-quota-service.ts` | `appointments_v2.special_quota_consumptions` | Quota ledger integration tests |
| **Policy Draft UI & Diff** | `frontend/src/v2/appointments/pages/policy-draft-editor.tsx` | `appointments_v2.policy_drafts` | Frontend Vitest component tests |
| **Override Approval Center** | `frontend/src/v2/appointments/components/SchedulingOverrideApprovalCenter.tsx` | `appointments_v2.overrides` | End-to-end booking journey tests |

---

## Section 8: Benghazi Medical Center Adaptation Realities & Recommendations

While RISpro's Scheduling Engine provides enterprise-grade flexibility, the investigation confirms three structural realities that must be addressed during the BMC rollout:

```
+---------------------------------------------------------------------------------------------------------+
|                                    BMC SYSTEM ADAPTATION BLUEPRINT                                      |
+---------------------------------------------------------------------------------------------------------+
|                                                                                                         |
|   1. Category Expansion (Oncology vs Non-Oncology ---> Inpatient / Outpatient / Emergency)              |
|      • Current Code: Category limits hardcoded to 'oncology' and 'non_oncology' enums.                 |
|      • BMC Reality: General hospital requiring Inpatient, Outpatient, and Emergency tracks.             |
|      • Interim Rollout: Map 'oncology' to Outpatient General and 'non_oncology' to Inpatient/Ward.     |
|      • Long-Term Phase: Extend CategoryDailyLimitRow schema to dynamic, hospital-defined categories.    |
|                                                                                                         |
|   2. Multi-Procedure Single Accession Booking                                                           |
|      • Current Code: Pure evaluation operates per procedure with single accession generation.           |
|      • BMC Reality: Polytrauma patients routinely receive Combined CT (Brain, Chest, Abdomen, Pelvis).  |
|      • Workflow Recommendation: Utilize parent-child accession linkage, reserving single time-slots     |
|        with compounded duration counters.                                                               |
|                                                                                                         |
|   3. Standalone RIS Operation (No Hospital HIS)                                                         |
|      • Current Code: Master Patient Index (MPI) supports self-contained registration and deduplication. |
|      • BMC Reality: Initial phase operates without hospital-wide ADT/HIS integration.                  |
|      • Verification: RISpro native Libyan MPI and National ID barcode scanning fully fulfill this need. |
|                                                                                                         |
+---------------------------------------------------------------------------------------------------------+
```

---

## Conclusion & Next Steps

This exhaustive investigation demonstrates that the **RISpro Appointments V2 Scheduling Engine** is fully equipped to handle the high volume, complex clinical subspecialties, and rigorous governance demanded by **Benghazi Medical Center**. 

With this architectural and clinical capability blueprint complete, we are ready to transition to **Phase 2A: Illustrated Pilot Chapter Writing** (focusing on Chapter 5B: The RISpro Scheduling Engine & Capacity Controls), including high-resolution bilingual screen captures and step-by-step user workflows.

**Awaiting user review and formal authorization to begin Phase 2A.**
