const dictionary = {
  "محمد": "Mohammad",
  "احمد": "Ahmed",
  "أحمد": "Ahmed",
  "علي": "Ali",
  "فاطمة": "Fatima",
  "يوسف": "Yousef",
  "سالم": "Salem",
  "عائشة": "Aisha",
  "السنوسي": "Al-Senussi",
  "العبيدي": "Al-Obaidi",
  "مختار": "Mukhtar",
  "التركي": "Al-Turki"
};

const allowedRoutes = ["dashboard", "patients", "search", "settings"];
const state = {
  language: localStorage.getItem("rispro-language") || "ar",
  route: allowedRoutes.includes(localStorage.getItem("rispro-route")) ? localStorage.getItem("rispro-route") : "dashboard",
  authChecked: false,
  session: null,
  loginForm: {
    username: "",
    password: ""
  },
  loginLoading: false,
  loginError: "",
  appError: "",
  dashboardLoading: false,
  dashboardReady: null,
  dashboardError: "",
  patientForm: defaultPatientForm(),
  manualEnglishName: false,
  patientSaving: false,
  patientError: "",
  patientSuccess: "",
  savedPatient: null,
  patientSuggestions: [],
  suggestionsLoading: false,
  searchQuery: "",
  searchLoading: false,
  searchError: "",
  searchResults: [],
  settingsLoading: false,
  settingsError: "",
  users: [],
  userForm: {
    username: "",
    fullName: "",
    password: "",
    role: "receptionist"
  },
  userSaving: false,
  userError: "",
  userSuccess: ""
};

const copy = {
  en: {
    appName: "RISpro Reception",
    appSubtitle: "Production-ready reception workspace",
    topTitle: "Reception operations",
    topSubtitle: "Real login, real patient registration, and supervisor tools backed by the live API.",
    userRoleLabel: "Signed in as",
    note: "This build only shows features that are already connected to the backend.",
    nav: {
      dashboard: "Dashboard",
      patients: "Register patient",
      search: "Search patients",
      settings: "Settings"
    },
    login: {
      title: "A calm reception desk with real backend access",
      body: "Sign in with your actual account to use the production workspace. Sessions are handled by the backend and stored in secure cookies.",
      signIn: "Sign in",
      username: "Username",
      password: "Password",
      note: "Use the seeded supervisor or any receptionist account created by a supervisor."
    },
    dashboard: {
      title: "System dashboard",
      body: "A quick health check for the production deployment plus shortcuts to the supported workflows.",
      primary: "Register patient",
      secondary: "Search patients",
      db: "Database status",
      session: "Current session",
      modules: "Supported modules",
      date: "Today",
      ready: "Ready",
      notReady: "Attention needed",
      moduleListTitle: "Enabled in this deployment",
      plannedListTitle: "Not enabled yet",
      plannedNote: "Appointments, queue, and printing are intentionally hidden until their backend workflows are complete."
    },
    patients: {
      title: "Patient registration",
      body: "Create a real patient record in PostgreSQL. The form only includes fields that are validated and saved by the backend today.",
      save: "Save patient",
      clear: "Clear form",
      duplicates: "Check duplicates",
      success: "Patient saved successfully.",
      fields: {
        mrn: "MRN",
        arabicFullName: "Arabic full name",
        englishFullName: "English full name",
        ageYears: "Age",
        sex: "Sex",
        nationalId: "National ID",
        nationalIdConfirmation: "Confirm National ID",
        phone1: "Phone 1",
        phone2: "Phone 2",
        address: "Address"
      },
      savedRecord: "Latest saved patient",
      possibleMatches: "Possible existing matches",
      supportNote: "To avoid bad production data, unsupported prototype-only fields were removed from this form."
    },
    search: {
      title: "Patient search",
      body: "Search by Arabic name, English name, phone number, or national ID before creating a new record.",
      placeholder: "Search by name, phone, or national ID",
      submit: "Search",
      empty: "No matching patients were found yet."
    },
    settings: {
      title: "Supervisor settings",
      body: "Create staff accounts and review who can access the system.",
      users: "Users",
      addUser: "Create user",
      refresh: "Refresh list",
      blocked: "Supervisor access is required for this area.",
      fields: {
        username: "Username",
        fullName: "Full name",
        password: "Password",
        role: "Role"
      }
    },
    roles: {
      supervisor: "Supervisor",
      receptionist: "Receptionist"
    },
    common: {
      logout: "Sign out",
      loading: "Loading...",
      optional: "Optional",
      required: "Required",
      open: "Open",
      refresh: "Refresh",
      arabic: "Arabic",
      english: "English",
      healthOk: "Connected",
      healthDown: "Not reachable",
      active: "Active",
      inactive: "Inactive",
      createdAt: "Created",
      latest: "Latest",
      save: "Save",
      noData: "No data yet",
      male: "Male",
      female: "Female",
      readOnly: "Read-only",
      environment: "Environment",
      patientCount: "Patients shown",
      usersShown: "Users shown"
    }
  },
  ar: {
    appName: "نظام الاستقبال RISpro",
    appSubtitle: "واجهة إنتاجية حقيقية للاستقبال",
    topTitle: "تشغيل الاستقبال",
    topSubtitle: "دخول حقيقي وتسجيل مرضى فعلي وأدوات إشرافية مربوطة بالخادم.",
    userRoleLabel: "تم تسجيل الدخول كـ",
    note: "هذه النسخة تعرض فقط الوظائف المربوطة فعلياً بالخادم.",
    nav: {
      dashboard: "الرئيسية",
      patients: "تسجيل مريض",
      search: "البحث عن مريض",
      settings: "الإعدادات"
    },
    login: {
      title: "واجهة استقبال هادئة مع ربط حقيقي بالخادم",
      body: "سجّل الدخول بحسابك الفعلي لاستخدام بيئة الإنتاج. الجلسات تُدار من الخادم وتُحفظ في ملفات تعريف ارتباط آمنة.",
      signIn: "تسجيل الدخول",
      username: "اسم المستخدم",
      password: "كلمة المرور",
      note: "استخدم حساب المشرف المُنشأ أولاً أو أي حساب استقبال يضيفه المشرف."
    },
    dashboard: {
      title: "لوحة حالة النظام",
      body: "فحص سريع لصحة النشر الإنتاجي مع اختصارات للوظائف الجاهزة حالياً.",
      primary: "تسجيل مريض",
      secondary: "البحث عن مريض",
      db: "حالة قاعدة البيانات",
      session: "الجلسة الحالية",
      modules: "الوظائف المتاحة",
      date: "اليوم",
      ready: "جاهز",
      notReady: "يحتاج متابعة",
      moduleListTitle: "المفعّل في هذا النشر",
      plannedListTitle: "غير مفعّل بعد",
      plannedNote: "تم إخفاء المواعيد والطابور والطباعة عمداً حتى تكتمل مساراتها الخلفية بشكل صحيح."
    },
    patients: {
      title: "تسجيل المريض",
      body: "إنشاء سجل مريض حقيقي داخل PostgreSQL. النموذج يحتوي فقط على الحقول التي يتحقق منها الخادم ويحفظها اليوم.",
      save: "حفظ المريض",
      clear: "تفريغ النموذج",
      duplicates: "فحص السجلات المشابهة",
      success: "تم حفظ المريض بنجاح.",
      fields: {
        mrn: "رقم الملف",
        arabicFullName: "الاسم الكامل بالعربية",
        englishFullName: "الاسم الكامل بالإنجليزية",
        ageYears: "العمر",
        sex: "الجنس",
        nationalId: "الرقم الوطني",
        nationalIdConfirmation: "تأكيد الرقم الوطني",
        phone1: "الهاتف 1",
        phone2: "الهاتف 2",
        address: "العنوان"
      },
      savedRecord: "آخر مريض تم حفظه",
      possibleMatches: "سجلات محتملة موجودة",
      supportNote: "حتى لا ندخل بيانات غير مدعومة في الإنتاج، تم حذف الحقول التجريبية غير المكتملة من هذا النموذج."
    },
    search: {
      title: "البحث عن مريض",
      body: "ابحث بالاسم العربي أو الإنجليزي أو رقم الهاتف أو الرقم الوطني قبل إنشاء سجل جديد.",
      placeholder: "ابحث بالاسم أو الهاتف أو الرقم الوطني",
      submit: "بحث",
      empty: "لا توجد نتائج مطابقة حالياً."
    },
    settings: {
      title: "إعدادات المشرف",
      body: "إنشاء حسابات الموظفين ومراجعة من يستطيع الدخول إلى النظام.",
      users: "المستخدمون",
      addUser: "إنشاء مستخدم",
      refresh: "تحديث القائمة",
      blocked: "هذه المنطقة تحتاج صلاحية مشرف.",
      fields: {
        username: "اسم المستخدم",
        fullName: "الاسم الكامل",
        password: "كلمة المرور",
        role: "الدور"
      }
    },
    roles: {
      supervisor: "مشرف",
      receptionist: "استقبال"
    },
    common: {
      logout: "تسجيل الخروج",
      loading: "جارٍ التحميل...",
      optional: "اختياري",
      required: "إلزامي",
      open: "فتح",
      refresh: "تحديث",
      arabic: "العربية",
      english: "English",
      healthOk: "متصل",
      healthDown: "غير متاح",
      active: "نشط",
      inactive: "غير نشط",
      createdAt: "تاريخ الإنشاء",
      latest: "الأحدث",
      save: "حفظ",
      noData: "لا توجد بيانات بعد",
      male: "ذكر",
      female: "أنثى",
      readOnly: "للعرض فقط",
      environment: "البيئة",
      patientCount: "عدد السجلات المعروضة",
      usersShown: "عدد المستخدمين المعروضين"
    }
  }
};

function defaultPatientForm() {
  return {
    mrn: "",
    arabicFullName: "",
    englishFullName: "",
    ageYears: "",
    sex: "male",
    nationalId: "",
    nationalIdConfirmation: "",
    phone1: "",
    phone2: "",
    address: ""
  };
}

function t() {
  return copy[state.language];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function localizedDate() {
  return new Intl.DateTimeFormat(state.language === "ar" ? "ar-LY" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date());
}

function formatRole(role) {
  return t().roles[role] || role;
}

function initials(name) {
  return String(name || "RS")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase() || "")
    .join("");
}

function transliterateName(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((chunk) => dictionary[chunk] || chunk)
    .join(" ");
}

function setLanguage(language) {
  state.language = language;
  localStorage.setItem("rispro-language", language);
  render();
}

function setRoute(route) {
  state.route = allowedRoutes.includes(route) ? route : "dashboard";
  localStorage.setItem("rispro-route", state.route);
  render();
  void hydrateRoute();
}

function resetPatientForm() {
  state.patientForm = defaultPatientForm();
  state.manualEnglishName = false;
  state.patientError = "";
  state.patientSuccess = "";
  state.savedPatient = null;
  state.patientSuggestions = [];
  render();
}

function isSupervisor() {
  return state.session?.role === "supervisor";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const contentType = response.headers.get("content-type") || "";
  let payload = null;

  if (response.status !== 204) {
    payload = contentType.includes("application/json") ? await response.json() : await response.text();
  }

  if (!response.ok) {
    const message =
      typeof payload === "string"
        ? payload
        : payload?.error?.message || `Request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return payload;
}

async function refreshSession() {
  try {
    const result = await api("/api/auth/me", { method: "GET" });
    state.session = result.user;
    state.appError = "";
  } catch (error) {
    state.session = null;
    if (!["Authentication required.", "Invalid session."].includes(error.message)) {
      state.appError = error.message;
    }
  } finally {
    state.authChecked = true;
  }
}

async function loadDashboardStatus() {
  state.dashboardLoading = true;
  state.dashboardError = "";
  render();

  try {
    const result = await api("/api/ready", { method: "GET" });
    state.dashboardReady = Boolean(result.ok);
  } catch (error) {
    state.dashboardReady = false;
    state.dashboardError = error.message;
  } finally {
    state.dashboardLoading = false;
    render();
  }
}

async function loadUsers() {
  if (!isSupervisor()) {
    return;
  }

  state.settingsLoading = true;
  state.settingsError = "";
  render();

  try {
    const result = await api("/api/users", { method: "GET" });
    state.users = result.users || [];
  } catch (error) {
    state.settingsError = error.message;
  } finally {
    state.settingsLoading = false;
    render();
  }
}

async function hydrateRoute() {
  if (!state.session) {
    return;
  }

  if (state.route === "dashboard") {
    await loadDashboardStatus();
    return;
  }

  if (state.route === "settings") {
    await loadUsers();
  }
}

async function signIn() {
  state.loginLoading = true;
  state.loginError = "";
  render();

  try {
    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(state.loginForm)
    });
    state.loginForm.password = "";
    await refreshSession();
    if (!state.session) {
      throw new Error("Login did not return an active session.");
    }
    await hydrateRoute();
  } catch (error) {
    state.loginError = error.message;
    state.session = null;
  } finally {
    state.loginLoading = false;
    render();
  }
}

async function signOut() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch (error) {
    state.appError = error.message;
  } finally {
    state.session = null;
    state.users = [];
    state.searchResults = [];
    state.searchQuery = "";
    state.route = "dashboard";
    render();
  }
}

async function checkDuplicates() {
  const term =
    state.patientForm.nationalId.trim() ||
    state.patientForm.phone1.trim() ||
    state.patientForm.arabicFullName.trim() ||
    state.patientForm.englishFullName.trim();

  if (!term) {
    state.patientSuggestions = [];
    state.patientError =
      state.language === "ar"
        ? "أدخل اسماً أو هاتفاً أو رقماً وطنياً قبل فحص السجلات المشابهة."
        : "Enter a name, phone number, or national ID before checking for duplicates.";
    render();
    return;
  }

  state.suggestionsLoading = true;
  state.patientError = "";
  render();

  try {
    const result = await api(`/api/patients?q=${encodeURIComponent(term)}`, { method: "GET" });
    state.patientSuggestions = result.patients || [];
  } catch (error) {
    state.patientError = error.message;
  } finally {
    state.suggestionsLoading = false;
    render();
  }
}

async function savePatient() {
  state.patientSaving = true;
  state.patientError = "";
  state.patientSuccess = "";
  render();

  try {
    const payload = {
      mrn: state.patientForm.mrn,
      arabicFullName: state.patientForm.arabicFullName,
      englishFullName: state.patientForm.englishFullName,
      ageYears: state.patientForm.ageYears,
      sex: state.patientForm.sex,
      nationalId: state.patientForm.nationalId,
      nationalIdConfirmation: state.patientForm.nationalIdConfirmation,
      phone1: state.patientForm.phone1,
      phone2: state.patientForm.phone2,
      address: state.patientForm.address
    };
    const result = await api("/api/patients", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    state.savedPatient = result.patient;
    state.patientSuccess = t().patients.success;
    state.patientForm = defaultPatientForm();
    state.manualEnglishName = false;
    state.patientSuggestions = [];
  } catch (error) {
    state.patientError = error.message;
  } finally {
    state.patientSaving = false;
    render();
  }
}

async function searchPatients() {
  state.searchLoading = true;
  state.searchError = "";
  render();

  try {
    const result = await api(`/api/patients?q=${encodeURIComponent(state.searchQuery.trim())}`, {
      method: "GET"
    });
    state.searchResults = result.patients || [];
  } catch (error) {
    state.searchError = error.message;
  } finally {
    state.searchLoading = false;
    render();
  }
}

async function createUser() {
  state.userSaving = true;
  state.userError = "";
  state.userSuccess = "";
  render();

  try {
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify(state.userForm)
    });
    state.userSuccess =
      state.language === "ar" ? "تم إنشاء المستخدم بنجاح." : "User created successfully.";
    state.userForm = {
      username: "",
      fullName: "",
      password: "",
      role: "receptionist"
    };
    await loadUsers();
  } catch (error) {
    state.userError = error.message;
  } finally {
    state.userSaving = false;
    render();
  }
}

function pageHero(title, body, actions = "", eyebrow = "") {
  return `
    <section class="hero">
      <div>
        ${eyebrow ? `<div class="eyebrow">${escapeHtml(eyebrow)}</div>` : ""}
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(body)}</p>
      </div>
      <div class="hero-actions">${actions}</div>
    </section>
  `;
}

function statCard(label, value, note, color) {
  return `
    <article class="surface surface-compact">
      <div class="card-label">${escapeHtml(label)}</div>
      <div class="card-value" style="color:${escapeHtml(color)}">${escapeHtml(value)}</div>
      <div class="card-note">${escapeHtml(note)}</div>
    </article>
  `;
}

function infoTile(label, value, tone = "") {
  return `
    <div class="metric-tile ${tone}">
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value">${escapeHtml(value)}</div>
    </div>
  `;
}

function alertMarkup(kind, message) {
  if (!message) {
    return "";
  }

  return `<div class="alert alert-${kind}">${escapeHtml(message)}</div>`;
}

function languageToggle() {
  return `
    <div class="toggle">
      <button type="button" class="${state.language === "ar" ? "active" : ""}" data-language="ar">${t().common.arabic}</button>
      <button type="button" class="${state.language === "en" ? "active" : ""}" data-language="en">${t().common.english}</button>
    </div>
  `;
}

function renderLogin() {
  return `
    <div class="login-shell">
      <div class="login-card">
        <section class="login-showcase">
          <div class="brand">
            <div class="brand-mark">R</div>
            <div>
              <div class="brand-title">${escapeHtml(t().appName)}</div>
              <div class="brand-subtitle">${escapeHtml(t().appSubtitle)}</div>
            </div>
          </div>
          <h1>${escapeHtml(t().login.title)}</h1>
          <p>${escapeHtml(t().login.body)}</p>
          <div class="showcase-list">
            <div class="showcase-item">${escapeHtml(t().note)}</div>
            <div class="showcase-item">${escapeHtml(t().login.note)}</div>
            <div class="showcase-item">${escapeHtml(localizedDate())}</div>
          </div>
        </section>

        <section class="login-form">
          ${languageToggle()}
          ${alertMarkup("error", state.loginError || state.appError)}
          <form id="login-form" class="stack">
            <label class="field">
              <span class="label">${escapeHtml(t().login.username)}</span>
              <input class="input field-en" name="username" value="${escapeHtml(state.loginForm.username)}" autocomplete="username" />
            </label>
            <label class="field">
              <span class="label">${escapeHtml(t().login.password)}</span>
              <input class="input field-en" type="password" name="password" value="${escapeHtml(state.loginForm.password)}" autocomplete="current-password" />
            </label>
            <button class="button-primary" type="submit">${escapeHtml(state.loginLoading ? t().common.loading : t().login.signIn)}</button>
          </form>
        </section>
      </div>
    </div>
  `;
}

function renderDashboard() {
  const readinessLabel =
    state.dashboardReady == null
      ? t().common.loading
      : state.dashboardReady
        ? t().common.healthOk
        : t().common.healthDown;

  return `
    <div class="page">
      ${pageHero(
        t().dashboard.title,
        t().dashboard.body,
        `<button type="button" class="button-primary" data-route="patients">${escapeHtml(t().dashboard.primary)}</button>
         <button type="button" class="button-secondary" data-route="search">${escapeHtml(t().dashboard.secondary)}</button>`,
        t().dashboard.ready
      )}

      ${alertMarkup("error", state.dashboardError)}

      <section class="card-grid">
        ${statCard(t().dashboard.db, readinessLabel, state.dashboardReady ? t().dashboard.ready : t().dashboard.notReady, "var(--teal)")}
        ${statCard(t().dashboard.session, formatRole(state.session.role), state.session.fullName, "var(--amber)")}
        ${statCard(t().dashboard.modules, "4", state.language === "ar" ? "الرئيسية + المرضى + البحث + الإعدادات" : "Dashboard + Patients + Search + Settings", "var(--blue)")}
        ${statCard(t().dashboard.date, localizedDate(), t().common.environment + `: ${state.dashboardLoading ? t().common.loading : "API"}`, "var(--green)")}
      </section>

      <section class="dual-grid">
        <article class="surface">
          <div class="section-head">
            <h2 class="section-title">${escapeHtml(t().dashboard.moduleListTitle)}</h2>
            <span class="chip success">${escapeHtml(t().dashboard.ready)}</span>
          </div>
          <div class="list">
            <div class="item"><div class="item-copy"><div class="item-title">${escapeHtml(t().nav.dashboard)}</div><div class="item-subtitle">/api/ready, /api/auth/me</div></div><span class="chip accent">${escapeHtml(t().common.active)}</span></div>
            <div class="item"><div class="item-copy"><div class="item-title">${escapeHtml(t().nav.patients)}</div><div class="item-subtitle">/api/patients POST</div></div><span class="chip accent">${escapeHtml(t().common.active)}</span></div>
            <div class="item"><div class="item-copy"><div class="item-title">${escapeHtml(t().nav.search)}</div><div class="item-subtitle">/api/patients GET</div></div><span class="chip accent">${escapeHtml(t().common.active)}</span></div>
            <div class="item"><div class="item-copy"><div class="item-title">${escapeHtml(t().nav.settings)}</div><div class="item-subtitle">/api/users GET/POST</div></div><span class="chip accent">${escapeHtml(isSupervisor() ? t().common.active : t().common.readOnly)}</span></div>
          </div>
        </article>

        <article class="surface">
          <div class="section-head">
            <h2 class="section-title">${escapeHtml(t().dashboard.plannedListTitle)}</h2>
            <span class="chip subtle">${escapeHtml(t().common.readOnly)}</span>
          </div>
          <div class="empty">${escapeHtml(t().dashboard.plannedNote)}</div>
        </article>
      </section>
    </div>
  `;
}

function renderSavedPatient() {
  if (!state.savedPatient) {
    return `<div class="empty">${escapeHtml(t().common.noData)}</div>`;
  }

  return `
    <div class="list">
      <div class="item">
        <div class="item-copy">
          <div class="item-title">${escapeHtml(state.language === "ar" ? state.savedPatient.arabic_full_name : state.savedPatient.english_full_name)}</div>
          <div class="item-subtitle">${escapeHtml(state.savedPatient.national_id)} • ${escapeHtml(state.savedPatient.phone_1)}</div>
        </div>
        <span class="chip success">#${escapeHtml(state.savedPatient.id)}</span>
      </div>
    </div>
  `;
}

function renderPatientResults(items, emptyText) {
  if (!items.length) {
    return `<div class="empty">${escapeHtml(emptyText)}</div>`;
  }

  return `
    <div class="list">
      ${items
        .map(
          (patient) => `
            <div class="item patient-result">
              <div class="item-copy">
                <div class="item-title">${escapeHtml(state.language === "ar" ? patient.arabic_full_name : patient.english_full_name)}</div>
                <div class="item-subtitle">${escapeHtml(patient.national_id || "N/A")} • ${escapeHtml(patient.phone_1 || "N/A")}</div>
              </div>
              <span class="chip subtle">${escapeHtml(patient.mrn || `#${patient.id}`)}</span>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderPatients() {
  return `
    <div class="page">
      ${pageHero(t().patients.title, t().patients.body, "", t().common.required)}
      ${alertMarkup("error", state.patientError)}
      ${alertMarkup("success", state.patientSuccess)}

      <section class="split-grid">
        <article class="surface">
          <form id="patient-form" class="stack">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().patients.title)}</h2>
              <div class="badge-row">
                <span class="chip success">${escapeHtml(t().common.required)}</span>
                <span class="chip subtle">${escapeHtml(t().common.optional)}</span>
              </div>
            </div>

            <div class="form-grid">
              <label class="field">
                <span class="label">${escapeHtml(t().patients.fields.mrn)}</span>
                <input class="input field-en" name="mrn" value="${escapeHtml(state.patientForm.mrn)}" />
              </label>

              <label class="field">
                <span class="label">${escapeHtml(t().patients.fields.ageYears)}</span>
                <input class="input field-en" name="ageYears" value="${escapeHtml(state.patientForm.ageYears)}" inputmode="numeric" />
              </label>

              <label class="field full">
                <span class="label">${escapeHtml(t().patients.fields.arabicFullName)}</span>
                <input class="input field-ar" lang="ar" dir="rtl" name="arabicFullName" value="${escapeHtml(state.patientForm.arabicFullName)}" />
              </label>

              <label class="field full">
                <span class="label">${escapeHtml(t().patients.fields.englishFullName)}</span>
                <input class="input field-en" lang="en" dir="ltr" name="englishFullName" value="${escapeHtml(state.patientForm.englishFullName)}" />
              </label>

              <label class="field">
                <span class="label">${escapeHtml(t().patients.fields.sex)}</span>
                <select class="select" name="sex">
                  <option value="male" ${state.patientForm.sex === "male" ? "selected" : ""}>${escapeHtml(t().common.male)}</option>
                  <option value="female" ${state.patientForm.sex === "female" ? "selected" : ""}>${escapeHtml(t().common.female)}</option>
                </select>
              </label>

              <label class="field">
                <span class="label">${escapeHtml(t().patients.fields.phone1)}</span>
                <input class="input field-en" name="phone1" value="${escapeHtml(state.patientForm.phone1)}" inputmode="tel" />
              </label>

              <label class="field">
                <span class="label">${escapeHtml(t().patients.fields.phone2)}</span>
                <input class="input field-en" name="phone2" value="${escapeHtml(state.patientForm.phone2)}" inputmode="tel" />
              </label>

              <label class="field">
                <span class="label">${escapeHtml(t().patients.fields.nationalId)}</span>
                <input class="input field-en" name="nationalId" value="${escapeHtml(state.patientForm.nationalId)}" inputmode="numeric" />
              </label>

              <label class="field">
                <span class="label">${escapeHtml(t().patients.fields.nationalIdConfirmation)}</span>
                <input class="input field-en" name="nationalIdConfirmation" value="${escapeHtml(state.patientForm.nationalIdConfirmation)}" inputmode="numeric" />
              </label>

              <label class="field full">
                <span class="label">${escapeHtml(t().patients.fields.address)}</span>
                <textarea class="textarea ${state.language === "ar" ? "field-ar" : ""}" name="address">${escapeHtml(state.patientForm.address)}</textarea>
              </label>
            </div>

            <div class="form-actions">
              <button class="button-primary" type="submit">${escapeHtml(state.patientSaving ? t().common.loading : t().patients.save)}</button>
              <button class="button-secondary" type="button" data-action="check-duplicates">${escapeHtml(state.suggestionsLoading ? t().common.loading : t().patients.duplicates)}</button>
              <button class="button-ghost" type="button" data-action="clear-patient-form">${escapeHtml(t().patients.clear)}</button>
            </div>
          </form>
        </article>

        <div class="stack">
          <article class="surface">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().patients.savedRecord)}</h2>
              <span class="chip accent">${escapeHtml(t().common.latest)}</span>
            </div>
            ${renderSavedPatient()}
          </article>

          <article class="surface">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().patients.possibleMatches)}</h2>
              <span class="chip subtle">${escapeHtml(String(state.patientSuggestions.length))}</span>
            </div>
            ${renderPatientResults(
              state.patientSuggestions,
              state.suggestionsLoading ? t().common.loading : t().common.noData
            )}
          </article>

          <article class="surface">
            <h2 class="section-title">${escapeHtml(t().common.readOnly)}</h2>
            <div class="empty">${escapeHtml(t().patients.supportNote)}</div>
          </article>
        </div>
      </section>
    </div>
  `;
}

function renderSearch() {
  return `
    <div class="page">
      ${pageHero(t().search.title, t().search.body, "", t().common.open)}
      ${alertMarkup("error", state.searchError)}
      <section class="surface">
        <form id="patient-search-form" class="search-bar">
          <input class="input ${state.language === "ar" ? "field-ar" : ""}" name="searchQuery" value="${escapeHtml(state.searchQuery)}" placeholder="${escapeHtml(t().search.placeholder)}" />
          <button class="button-primary" type="submit">${escapeHtml(state.searchLoading ? t().common.loading : t().search.submit)}</button>
        </form>
      </section>

      <section class="surface">
        <div class="section-head">
          <h2 class="section-title">${escapeHtml(t().nav.search)}</h2>
          <span class="chip subtle">${escapeHtml(`${t().common.patientCount}: ${state.searchResults.length}`)}</span>
        </div>
        ${renderPatientResults(state.searchResults, state.searchLoading ? t().common.loading : t().search.empty)}
      </section>
    </div>
  `;
}

function renderUsersList() {
  if (state.settingsLoading) {
    return `<div class="empty">${escapeHtml(t().common.loading)}</div>`;
  }

  if (!state.users.length) {
    return `<div class="empty">${escapeHtml(t().common.noData)}</div>`;
  }

  return `
    <div class="list">
      ${state.users
        .map(
          (user) => `
            <div class="item">
              <div class="item-copy">
                <div class="item-title">${escapeHtml(user.full_name)}</div>
                <div class="item-subtitle">${escapeHtml(user.username)} • ${escapeHtml(formatRole(user.role))}</div>
              </div>
              <span class="chip ${user.is_active ? "success" : "subtle"}">${escapeHtml(user.is_active ? t().common.active : t().common.inactive)}</span>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderSettings() {
  if (!isSupervisor()) {
    return `
      <div class="page">
        ${pageHero(t().settings.title, t().settings.body, "", t().common.readOnly)}
        <section class="surface">
          <div class="empty">${escapeHtml(t().settings.blocked)}</div>
        </section>
      </div>
    `;
  }

  return `
    <div class="page">
      ${pageHero(
        t().settings.title,
        t().settings.body,
        `<button class="button-secondary" type="button" data-action="refresh-users">${escapeHtml(t().settings.refresh)}</button>`,
        t().common.required
      )}
      ${alertMarkup("error", state.settingsError || state.userError)}
      ${alertMarkup("success", state.userSuccess)}

      <section class="split-grid">
        <article class="surface">
          <div class="section-head">
            <h2 class="section-title">${escapeHtml(t().settings.users)}</h2>
            <span class="chip accent">${escapeHtml(`${t().common.usersShown}: ${state.users.length}`)}</span>
          </div>
          ${renderUsersList()}
        </article>

        <article class="surface">
          <form id="user-form" class="stack">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().settings.addUser)}</h2>
              <span class="chip success">${escapeHtml(formatRole(state.userForm.role))}</span>
            </div>

            <div class="form-grid">
              <label class="field">
                <span class="label">${escapeHtml(t().settings.fields.username)}</span>
                <input class="input field-en" name="username" data-user-field="true" value="${escapeHtml(state.userForm.username)}" autocomplete="off" />
              </label>

              <label class="field">
                <span class="label">${escapeHtml(t().settings.fields.fullName)}</span>
                <input class="input ${state.language === "ar" ? "field-ar" : ""}" name="fullName" data-user-field="true" value="${escapeHtml(state.userForm.fullName)}" />
              </label>

              <label class="field">
                <span class="label">${escapeHtml(t().settings.fields.password)}</span>
                <input class="input field-en" type="password" name="password" data-user-field="true" value="${escapeHtml(state.userForm.password)}" autocomplete="new-password" />
              </label>

              <label class="field">
                <span class="label">${escapeHtml(t().settings.fields.role)}</span>
                <select class="select" name="role" data-user-field="true">
                  <option value="receptionist" ${state.userForm.role === "receptionist" ? "selected" : ""}>${escapeHtml(formatRole("receptionist"))}</option>
                  <option value="supervisor" ${state.userForm.role === "supervisor" ? "selected" : ""}>${escapeHtml(formatRole("supervisor"))}</option>
                </select>
              </label>
            </div>

            <div class="form-actions">
              <button class="button-primary" type="submit">${escapeHtml(state.userSaving ? t().common.loading : t().settings.addUser)}</button>
            </div>
          </form>
        </article>
      </section>
    </div>
  `;
}

function renderPage() {
  switch (state.route) {
    case "patients":
      return renderPatients();
    case "search":
      return renderSearch();
    case "settings":
      return renderSettings();
    default:
      return renderDashboard();
  }
}

function renderAppFrame(content) {
  const routeLabel = t().nav[state.route];

  return `
    <div class="shell">
      <div class="layout">
        <aside class="sidebar">
          <div class="brand">
            <div class="brand-mark">R</div>
            <div>
              <div class="brand-title">${escapeHtml(t().appName)}</div>
              <div class="brand-subtitle">${escapeHtml(t().appSubtitle)}</div>
            </div>
          </div>

          <nav class="nav">
            ${allowedRoutes
              .map(
                (route, index) => `
                  <a href="#" class="nav-link ${state.route === route ? "active" : ""}" data-route="${route}">
                    <span>${escapeHtml(t().nav[route])}</span>
                    <span>${String(index + 1).padStart(2, "0")}</span>
                  </a>
                `
              )
              .join("")}
          </nav>

          <div class="sidebar-note">
            <div class="sidebar-note-title">${escapeHtml(t().common.environment)}</div>
            <div>${escapeHtml(localizedDate())}</div>
            <div class="sidebar-note-copy">${escapeHtml(t().note)}</div>
          </div>
        </aside>

        <div class="content">
          <header class="topbar">
            <div>
              <div class="topbar-path">${escapeHtml(t().nav.dashboard)} / ${escapeHtml(routeLabel)}</div>
              <div class="topbar-title">${escapeHtml(t().topTitle)}</div>
              <div class="topbar-subtitle">${escapeHtml(t().topSubtitle)}</div>
            </div>

            <div class="topbar-actions">
              <div class="topbar-meta">
                <span class="chip subtle">${escapeHtml(localizedDate())}</span>
                <span class="chip accent">${escapeHtml(routeLabel)}</span>
              </div>
              ${languageToggle()}
              <div class="user-chip">
                <div class="avatar">${escapeHtml(initials(state.session.fullName))}</div>
                <div>
                  <div>${escapeHtml(state.session.fullName)}</div>
                  <div class="small">${escapeHtml(`${t().userRoleLabel} ${formatRole(state.session.role)}`)}</div>
                </div>
              </div>
              <button class="button-ghost" type="button" id="logout-button">${escapeHtml(t().common.logout)}</button>
            </div>
          </header>

          ${state.appError ? alertMarkup("error", state.appError) : ""}
          ${content}
        </div>
      </div>
    </div>
  `;
}

function renderLoading() {
  return `
    <div class="login-shell">
      <div class="surface" style="width:min(520px,100%);">
        <div class="section-head">
          <h2 class="section-title">${escapeHtml(t().appName)}</h2>
          <span class="chip accent">${escapeHtml(t().common.loading)}</span>
        </div>
        <div class="empty">${escapeHtml(t().common.loading)}</div>
      </div>
    </div>
  `;
}

function render() {
  document.documentElement.lang = state.language;
  document.documentElement.dir = state.language === "ar" ? "rtl" : "ltr";
  const app = document.getElementById("app");

  if (!state.authChecked) {
    app.innerHTML = renderLoading();
    return;
  }

  app.innerHTML = state.session ? renderAppFrame(renderPage()) : renderLogin();
}

function handleInput(event) {
  const target = event.target;

  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
    return;
  }

  if (target.closest("#login-form")) {
    state.loginForm[target.name] = target.value;
    return;
  }

  if (target.closest("#patient-form")) {
    state.patientForm[target.name] = target.value;

    if (target.name === "arabicFullName" && !state.manualEnglishName) {
      state.patientForm.englishFullName = transliterateName(target.value);
      const englishInput = document.querySelector('#patient-form [name="englishFullName"]');

      if (englishInput) {
        englishInput.value = state.patientForm.englishFullName;
      }

      return;
    }

    if (target.name === "englishFullName") {
      state.manualEnglishName = Boolean(target.value.trim());
    }

    return;
  }

  if (target.closest("#patient-search-form")) {
    state.searchQuery = target.value;
    return;
  }

  if (target.hasAttribute("data-user-field")) {
    state.userForm[target.name] = target.value;
  }
}

function handleClick(event) {
  const target = event.target.closest("[data-language], [data-route], [data-action], #logout-button");

  if (!target) {
    return;
  }

  if (target.matches("[data-language]")) {
    event.preventDefault();
    setLanguage(target.dataset.language);
    return;
  }

  if (target.matches("[data-route]")) {
    event.preventDefault();
    setRoute(target.dataset.route);
    return;
  }

  if (target.id === "logout-button") {
    event.preventDefault();
    void signOut();
    return;
  }

  if (target.dataset.action === "check-duplicates") {
    event.preventDefault();
    void checkDuplicates();
    return;
  }

  if (target.dataset.action === "clear-patient-form") {
    event.preventDefault();
    resetPatientForm();
    return;
  }

  if (target.dataset.action === "refresh-users") {
    event.preventDefault();
    void loadUsers();
  }
}

function handleSubmit(event) {
  if (event.target.id === "login-form") {
    event.preventDefault();
    void signIn();
    return;
  }

  if (event.target.id === "patient-form") {
    event.preventDefault();
    void savePatient();
    return;
  }

  if (event.target.id === "patient-search-form") {
    event.preventDefault();
    void searchPatients();
    return;
  }

  if (event.target.id === "user-form") {
    event.preventDefault();
    void createUser();
  }
}

document.addEventListener("input", handleInput);
document.addEventListener("change", handleInput);
document.addEventListener("click", handleClick);
document.addEventListener("submit", handleSubmit);

async function bootstrap() {
  await refreshSession();

  if (state.session) {
    await hydrateRoute();
  }

  render();
}

render();
void bootstrap();
