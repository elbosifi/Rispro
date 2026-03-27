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

const allowedRoutes = ["dashboard", "patients", "appointments", "queue", "modality", "print", "search", "settings"];
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
  modalityLoading: false,
  modalityError: "",
  modalitySuccess: "",
  modalityResults: [],
  modalityFilters: defaultModalityFilters(),
  queueLoading: false,
  queueError: "",
  queueSuccess: "",
  queueScanValue: "",
  queueSnapshot: null,
  queueWalkInQuery: "",
  queueWalkInResults: [],
  queueWalkInLoading: false,
  queueSelectedPatient: null,
  queueWalkInSaving: false,
  queueWalkInForm: defaultQueueWalkInForm(),
  noShowReasons: {},
  printLoading: false,
  printError: "",
  integrationLoading: false,
  integrationError: "",
  integrationSuccess: "",
  integrationStatus: null,
  scanPreparationLoading: false,
  printPreparationLoading: false,
  printResults: [],
  printFilters: defaultPrintFilters(),
  selectedPrintAppointment: null,
  documentsLoading: false,
  documentsError: "",
  appointmentDocuments: [],
  uploadForm: defaultUploadForm(),
  uploadSaving: false,
  uploadError: "",
  uploadSuccess: "",
  searchSelectedPatient: null,
  patientEditForm: defaultPatientForm(),
  patientUpdateSaving: false,
  patientUpdateError: "",
  patientUpdateSuccess: "",
  mergeSourcePatient: null,
  mergeTargetPatient: null,
  mergeConfirmationText: "",
  mergeSaving: false,
  mergeError: "",
  mergeSuccess: "",
  appointmentEditForm: defaultAppointmentEditForm(),
  appointmentEditSaving: false,
  appointmentEditError: "",
  appointmentEditSuccess: "",
  cancelReason: "",
  appointmentCancelSaving: false,
  patientForm: defaultPatientForm(),
  manualEnglishName: false,
  patientSaving: false,
  patientError: "",
  patientSuccess: "",
  savedPatient: null,
  patientSuggestions: [],
  suggestionsLoading: false,
  appointmentLookupsLoading: false,
  appointmentCalendarLoading: false,
  appointmentSaving: false,
  appointmentError: "",
  appointmentSuccess: "",
  appointmentPatientQuery: "",
  appointmentPatientResults: [],
  appointmentPatientLoading: false,
  selectedAppointmentPatient: null,
  savedAppointment: null,
  appointmentLookups: {
    modalities: [],
    examTypes: [],
    priorities: []
  },
  appointmentCalendar: [],
  appointmentForm: defaultAppointmentForm(),
  examTypeModalOpen: false,
  examTypeForm: defaultExamTypeForm(),
  examTypeSaving: false,
  examTypeError: "",
  examTypeSuccess: "",
  searchQuery: "",
  searchLoading: false,
  searchError: "",
  searchResults: [],
  usersLoading: false,
  settingsLoading: false,
  settingsError: "",
  settingsCatalog: {},
  settingsSavingCategory: "",
  settingsSuccess: "",
  auditFilters: defaultAuditFilters(),
  auditMeta: {
    entityTypes: [],
    actionTypes: [],
    users: []
  },
  auditLoading: false,
  auditError: "",
  auditEntries: [],
  auditExportLoading: false,
  reauthPassword: "",
  reauthLoading: false,
  reauthError: "",
  backupLoading: false,
  backupError: "",
  backupSuccess: "",
  restoreLoading: false,
  restoreError: "",
  restoreSuccess: "",
  restoreFileName: "",
  restorePayloadText: "",
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
      appointments: "Create appointment",
      queue: "Queue",
      modality: "Modality board",
      print: "Printing",
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
      body: "A quick health check plus today's queue and no-show review status for the live reception workflow.",
      primary: "Register patient",
      secondary: "Search patients",
      db: "Database status",
      session: "Current session",
      modules: "Supported modules",
      date: "Today",
      waiting: "Waiting in queue",
      noShowReview: "No-show review",
      scanShortcut: "Open queue",
      reviewStarts: "Review starts at",
      reviewInactive: "No-show review is not open yet.",
      reviewEmpty: "No no-show confirmations are waiting right now.",
      queueTitle: "Today queue",
      reviewTitle: "No-show confirmations",
      ready: "Ready",
      notReady: "Attention needed",
      moduleListTitle: "Enabled in this deployment",
      plannedListTitle: "Not enabled yet",
      plannedNote: "Advanced printer-specific output and scanner bridge integrations are still planned for a later phase."
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
    patientActions: {
      edit: "Edit patient",
      saveEdit: "Save patient changes",
      mergeSource: "Merge source",
      mergeTarget: "Merge target",
      mergeNow: "Confirm merge",
      mergeHint: "Type MERGE to confirm moving the source patient into the target patient.",
      updated: "Patient updated successfully.",
      merged: "Patients were merged successfully."
    },
    appointments: {
      title: "Appointment creation",
      body: "Search for a real patient first, then choose the modality, exam, and day with live availability from PostgreSQL.",
      patientSearch: "Find patient",
      patientPlaceholder: "Search by name, phone, MRN, or national ID",
      patientSelect: "Use this patient",
      selectedPatient: "Selected patient",
      noneSelected: "Select a patient before saving an appointment.",
      lookupsLoading: "Loading modalities and priorities...",
      calendarHint: "Select a modality to load the next 14 days.",
      dateSelect: "Choose a day",
      save: "Save appointment",
      walkIn: "Walk-in patient",
      createExam: "Add exam type",
      createExamSave: "Save exam type",
      examAdded: "Exam type created successfully.",
      appointmentSaved: "Appointment saved successfully.",
      dateRequired: "Choose an appointment date before saving.",
      dateInputHint: "You can click an available day below or pick the exact date here.",
      selectedDateLabel: "Selected date",
      fullDay: "Full day",
      availableDay: "Available",
      overbookNotice: "This day is full. Supervisor overbooking is required.",
      savedCard: "Latest saved appointment",
      fields: {
        modality: "Modality",
        examType: "Exam type",
        priority: "Reporting priority",
        notes: "Notes",
        overbookingReason: "Overbooking reason",
        appointmentDate: "Appointment date",
        dailyCapacity: "Daily capacity",
        remaining: "Remaining slots",
        booked: "Booked",
        slotNumber: "Modality slot",
        accessionNumber: "Accession number",
        examNameAr: "Exam name Arabic",
        examNameEn: "Exam name English",
        specificInstructionAr: "Arabic instruction",
        specificInstructionEn: "English instruction"
      }
    },
    queue: {
      title: "Queue and arrival",
      body: "Scan today's accession number, manage waiting patients, and add walk-ins directly into the reception queue.",
      scanTitle: "Barcode / accession scan",
      scanPlaceholder: "Enter or scan accession number",
      scanButton: "Scan into queue",
      waitingList: "Waiting list",
      walkInTitle: "Walk-in patient",
      walkInSearch: "Find walk-in patient",
      walkInPlaceholder: "Search by name, phone, MRN, or national ID",
      walkInButton: "Add walk-in to queue",
      selectPatient: "Use for walk-in",
      selectedPatient: "Selected walk-in patient",
      reviewTitle: "No-show review",
      reviewButton: "Confirm no-show",
      reasonPlaceholder: "Enter no-show reason",
      scannedSuccess: "Patient added to the queue successfully.",
      walkInSuccess: "Walk-in patient added to the queue successfully."
    },
    modality: {
      title: "Modality workflow",
      body: "A focused board for modality staff to review today's studies and mark them completed.",
      filtersTitle: "Worklist filters",
      load: "Load worklist",
      complete: "Mark completed",
      blocked: "Only modality staff or supervisors can use this page.",
      completed: "Appointment marked completed successfully."
    },
    print: {
      title: "Printing and documents",
      body: "Print the daily appointment list, preview slips and labels, and upload the scanned request to the saved appointment.",
      filtersTitle: "Daily list filters",
      date: "Date",
      modality: "Modality",
      load: "Load list",
      dailyList: "Daily appointment list",
      slipPreview: "Appointment slip preview",
      labelPreview: "Patient label preview",
      documentsTitle: "Request documents",
      hardwareTitle: "Printer and scanner readiness",
      printerReady: "Printer setup",
      scannerReady: "Scanner setup",
      prepareSlip: "Prepare slip print",
      prepareLabel: "Prepare label print",
      prepareScan: "Prepare scan session",
      printerProfile: "Printer profile",
      printerMode: "Print mode",
      scannerMode: "Scanner mode",
      scannerProfile: "Scanner profile",
      allowedTypes: "Allowed file types",
      noHardwareStatus: "Hardware setup will appear here after loading.",
      uploadButton: "Upload request document",
      fileButton: "Choose file",
      fileNone: "No file selected",
      selectedAppointment: "Selected appointment",
      noAppointment: "Load the list and choose an appointment to print or upload documents.",
      editAppointment: "Edit appointment",
      saveAppointment: "Save appointment changes",
      cancelAppointment: "Cancel appointment",
      cancelReason: "Cancel reason",
      appointmentUpdated: "Appointment updated successfully.",
      appointmentCancelled: "Appointment cancelled successfully.",
      fields: {
        documentType: "Document type",
        fileName: "File",
        notes: "Notes"
      }
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
      body: "Create staff accounts, review access, and control the saved system behavior category by category.",
      reauthTitle: "Supervisor confirmation",
      reauthBody: "Enter the supervisor password again before opening sensitive settings and backup tools.",
      reauthButton: "Confirm supervisor access",
      users: "Users",
      addUser: "Create user",
      refresh: "Refresh list",
      refreshAll: "Refresh settings",
      blocked: "Supervisor access is required for this area.",
      reauthNeeded: "Recent supervisor re-authentication is required.",
      categories: "System behavior",
      saveCategory: "Save category",
      backupTitle: "Backup and restore",
      downloadBackup: "Download backup",
      restoreBackup: "Restore backup",
      restoreFile: "Backup file",
      auditTitle: "Audit log",
      refreshAudit: "Refresh audit log",
      exportAudit: "Export CSV",
      clearAudit: "Clear filters",
      auditFilters: "Audit filters",
      auditRows: "Rows shown",
      fields: {
        username: "Username",
        fullName: "Full name",
        password: "Password",
        role: "Role",
        entityType: "Entity type",
        actionType: "Action type",
        changedBy: "Changed by",
        dateFrom: "From date",
        dateTo: "To date"
      }
    },
    roles: {
      supervisor: "Supervisor",
      receptionist: "Receptionist",
      modality_staff: "Modality staff"
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
      appointments: "إنشاء موعد",
      queue: "الطابور",
      modality: "لوحة الجهاز",
      print: "الطباعة",
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
      body: "فحص سريع لصحة النشر مع متابعة طابور اليوم وتنبيهات مراجعة عدم الحضور.",
      primary: "تسجيل مريض",
      secondary: "البحث عن مريض",
      db: "حالة قاعدة البيانات",
      session: "الجلسة الحالية",
      modules: "الوظائف المتاحة",
      date: "اليوم",
      waiting: "المنتظرون في الطابور",
      noShowReview: "مراجعة عدم الحضور",
      scanShortcut: "فتح الطابور",
      reviewStarts: "تبدأ المراجعة عند",
      reviewInactive: "مراجعة عدم الحضور لم تُفتح بعد.",
      reviewEmpty: "لا توجد حالات عدم حضور تنتظر التأكيد الآن.",
      queueTitle: "طابور اليوم",
      reviewTitle: "تأكيدات عدم الحضور",
      ready: "جاهز",
      notReady: "يحتاج متابعة",
      moduleListTitle: "المفعّل في هذا النشر",
      plannedListTitle: "غير مفعّل بعد",
      plannedNote: "ما زالت تكاملات الطابعات المتخصصة وربط الماسح الضوئي المحلي مؤجلة لمرحلة لاحقة."
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
    patientActions: {
      edit: "تعديل المريض",
      saveEdit: "حفظ تعديلات المريض",
      mergeSource: "سجل المصدر للدمج",
      mergeTarget: "سجل الهدف للدمج",
      mergeNow: "تأكيد الدمج",
      mergeHint: "اكتب MERGE لتأكيد نقل سجل المصدر إلى سجل الهدف.",
      updated: "تم تحديث المريض بنجاح.",
      merged: "تم دمج السجلين بنجاح."
    },
    appointments: {
      title: "إنشاء موعد",
      body: "ابحث أولاً عن مريض فعلي ثم اختر الجهاز والفحص واليوم مع إتاحة حقيقية من PostgreSQL.",
      patientSearch: "البحث عن مريض",
      patientPlaceholder: "ابحث بالاسم أو الهاتف أو رقم الملف أو الرقم الوطني",
      patientSelect: "اختيار هذا المريض",
      selectedPatient: "المريض المختار",
      noneSelected: "اختر مريضاً قبل حفظ الموعد.",
      lookupsLoading: "جارٍ تحميل الأجهزة والأولويات...",
      calendarHint: "اختر الجهاز لتحميل الأيام الأربعة عشر القادمة.",
      dateSelect: "اختر يوماً",
      save: "حفظ الموعد",
      walkIn: "مريض مباشر",
      createExam: "إضافة نوع فحص",
      createExamSave: "حفظ نوع الفحص",
      examAdded: "تم إنشاء نوع الفحص بنجاح.",
      appointmentSaved: "تم حفظ الموعد بنجاح.",
      dateRequired: "اختر تاريخ الموعد قبل الحفظ.",
      dateInputHint: "يمكنك الضغط على يوم متاح أدناه أو اختيار التاريخ مباشرة من هنا.",
      selectedDateLabel: "التاريخ المختار",
      fullDay: "اليوم ممتلئ",
      availableDay: "متاح",
      overbookNotice: "هذا اليوم ممتلئ. يلزم تجاوز السعة بواسطة مشرف.",
      savedCard: "آخر موعد تم حفظه",
      fields: {
        modality: "الجهاز",
        examType: "نوع الفحص",
        priority: "أولوية التقرير",
        notes: "ملاحظات",
        overbookingReason: "سبب تجاوز السعة",
        appointmentDate: "تاريخ الموعد",
        dailyCapacity: "السعة اليومية",
        remaining: "الشواغر المتبقية",
        booked: "المحجوز",
        slotNumber: "رقم دور الجهاز",
        accessionNumber: "رقم الدخول",
        examNameAr: "اسم الفحص بالعربية",
        examNameEn: "اسم الفحص بالإنجليزية",
        specificInstructionAr: "تعليمات بالعربية",
        specificInstructionEn: "تعليمات بالإنجليزية"
      }
    },
    queue: {
      title: "الطابور والوصول",
      body: "امسح رقم الدخول لليوم، وتابع المرضى المنتظرين، وأضف المرضى المباشرين مباشرة إلى طابور الاستقبال.",
      scanTitle: "مسح الباركود / رقم الدخول",
      scanPlaceholder: "أدخل أو امسح رقم الدخول",
      scanButton: "إدخال إلى الطابور",
      waitingList: "قائمة الانتظار",
      walkInTitle: "مريض مباشر",
      walkInSearch: "البحث عن المريض المباشر",
      walkInPlaceholder: "ابحث بالاسم أو الهاتف أو رقم الملف أو الرقم الوطني",
      walkInButton: "إضافة المريض المباشر للطابور",
      selectPatient: "اختيار لهذا المريض المباشر",
      selectedPatient: "المريض المباشر المختار",
      reviewTitle: "مراجعة عدم الحضور",
      reviewButton: "تأكيد عدم الحضور",
      reasonPlaceholder: "أدخل سبب عدم الحضور",
      scannedSuccess: "تمت إضافة المريض إلى الطابور بنجاح.",
      walkInSuccess: "تمت إضافة المريض المباشر إلى الطابور بنجاح."
    },
    modality: {
      title: "سير عمل الجهاز",
      body: "لوحة مركزة لموظفي الأجهزة لمراجعة فحوصات اليوم ووضعها كمكتملة.",
      filtersTitle: "فلاتر قائمة العمل",
      load: "تحميل القائمة",
      complete: "تحديد كمكتمل",
      blocked: "هذه الصفحة لموظفي الأجهزة أو المشرف فقط.",
      completed: "تم تحديد الموعد كمكتمل بنجاح."
    },
    print: {
      title: "الطباعة والوثائق",
      body: "اطبع قائمة مواعيد اليوم، وعاين وصل الموعد وملصق المريض، وارفع طلب الفحص الممسوح ضوئياً إلى الموعد المحفوظ.",
      filtersTitle: "فلاتر القائمة اليومية",
      date: "التاريخ",
      modality: "الجهاز",
      load: "تحميل القائمة",
      dailyList: "قائمة مواعيد اليوم",
      slipPreview: "معاينة وصل الموعد",
      labelPreview: "معاينة ملصق المريض",
      documentsTitle: "وثائق طلب الفحص",
      hardwareTitle: "جاهزية الطابعة والماسح",
      printerReady: "إعداد الطابعة",
      scannerReady: "إعداد الماسح",
      prepareSlip: "تجهيز طباعة الوصل",
      prepareLabel: "تجهيز طباعة الملصق",
      prepareScan: "تجهيز جلسة مسح",
      printerProfile: "إعداد الطابعة",
      printerMode: "وضع الطباعة",
      scannerMode: "وضع المسح",
      scannerProfile: "إعداد الماسح",
      allowedTypes: "أنواع الملفات المقبولة",
      noHardwareStatus: "ستظهر إعدادات العتاد هنا بعد التحميل.",
      uploadButton: "رفع طلب الفحص",
      fileButton: "اختيار ملف",
      fileNone: "لم يتم اختيار ملف",
      selectedAppointment: "الموعد المختار",
      noAppointment: "حمّل القائمة ثم اختر موعداً للطباعة أو رفع الوثائق.",
      editAppointment: "تعديل الموعد",
      saveAppointment: "حفظ تعديلات الموعد",
      cancelAppointment: "إلغاء الموعد",
      cancelReason: "سبب الإلغاء",
      appointmentUpdated: "تم تحديث الموعد بنجاح.",
      appointmentCancelled: "تم إلغاء الموعد بنجاح.",
      fields: {
        documentType: "نوع الوثيقة",
        fileName: "الملف",
        notes: "ملاحظات"
      }
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
      body: "إنشاء حسابات الموظفين ومراجعة الوصول والتحكم بسلوك النظام المحفوظ حسب الفئات.",
      reauthTitle: "تأكيد المشرف",
      reauthBody: "أدخل كلمة مرور المشرف مرة أخرى قبل فتح الإعدادات الحساسة وأدوات النسخ الاحتياطي.",
      reauthButton: "تأكيد صلاحية المشرف",
      users: "المستخدمون",
      addUser: "إنشاء مستخدم",
      refresh: "تحديث القائمة",
      refreshAll: "تحديث الإعدادات",
      blocked: "هذه المنطقة تحتاج صلاحية مشرف.",
      reauthNeeded: "يلزم إعادة تحقق حديثة للمشرف.",
      categories: "سلوك النظام",
      saveCategory: "حفظ الفئة",
      backupTitle: "النسخ الاحتياطي والاستعادة",
      downloadBackup: "تنزيل النسخة الاحتياطية",
      restoreBackup: "استعادة النسخة",
      restoreFile: "ملف النسخة",
      auditTitle: "سجل التدقيق",
      refreshAudit: "تحديث سجل التدقيق",
      exportAudit: "تصدير CSV",
      clearAudit: "مسح الفلاتر",
      auditFilters: "فلاتر السجل",
      auditRows: "الصفوف المعروضة",
      fields: {
        username: "اسم المستخدم",
        fullName: "الاسم الكامل",
        password: "كلمة المرور",
        role: "الدور",
        entityType: "نوع الكيان",
        actionType: "نوع الإجراء",
        changedBy: "تم التغيير بواسطة",
        dateFrom: "من تاريخ",
        dateTo: "إلى تاريخ"
      }
    },
    roles: {
      supervisor: "مشرف",
      receptionist: "استقبال",
      modality_staff: "موظف جهاز"
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

const SETTINGS_META = {
  general_system: {
    titleEn: "General system",
    titleAr: "إعدادات عامة",
    summaryEn: "Core defaults that shape the system when staff start the day.",
    summaryAr: "الافتراضات الأساسية التي تضبط النظام عند بدء يوم العمل.",
    fields: {
      site_name: { en: "Site name", ar: "اسم الموقع" },
      default_route_after_login: { en: "Default page after login", ar: "الصفحة الافتراضية بعد الدخول" },
      business_day_start: { en: "Business day starts", ar: "بداية يوم العمل" },
      time_zone: { en: "Time zone", ar: "المنطقة الزمنية" }
    }
  },
  users_and_roles: {
    titleEn: "Users and roles",
    titleAr: "المستخدمون والصلاحيات",
    summaryEn: "Rules that define who can do what in the system.",
    summaryAr: "قواعد تحدد من يستطيع القيام بأي إجراء داخل النظام.",
    fields: {
      roles_enabled: { en: "Enabled roles", ar: "الأدوار المتاحة" },
      allow_user_creation: { en: "Allow user creation", ar: "السماح بإنشاء مستخدم" },
      overbooking_permission: { en: "Overbooking permission", ar: "صلاحية تجاوز السعة" },
      duplicate_merge_permission: { en: "Duplicate merge permission", ar: "صلاحية دمج السجلات" }
    }
  },
  security_and_access: {
    titleEn: "Security and access",
    titleAr: "الأمان والوصول",
    summaryEn: "Authentication, sessions, and protected access rules.",
    summaryAr: "قواعد الدخول والجلسات والوصول المحمي.",
    fields: {
      settings_reauth: { en: "Settings re-authentication", ar: "إعادة التحقق قبل الإعدادات" },
      password_policy: { en: "Password policy", ar: "سياسة كلمة المرور" },
      session_timeout_minutes: { en: "Session timeout in minutes", ar: "مدة الجلسة بالدقائق" },
      login_audit_log: { en: "Login audit log", ar: "سجل الدخول" }
    }
  },
  language_and_interface: {
    titleEn: "Language and interface",
    titleAr: "اللغة والواجهة",
    summaryEn: "Language defaults and interface direction behavior.",
    summaryAr: "الإعدادات الافتراضية للغة واتجاه الواجهة.",
    fields: {
      default_language: { en: "Default language", ar: "اللغة الافتراضية" },
      language_switcher: { en: "Language switcher", ar: "التبديل بين اللغات" },
      arabic_direction: { en: "Arabic direction", ar: "اتجاه العربية" },
      english_direction: { en: "English direction", ar: "اتجاه الإنجليزية" }
    }
  },
  patient_registration: {
    titleEn: "Patient registration",
    titleAr: "تسجيل المرضى",
    summaryEn: "Rules for patient identity and field validation.",
    summaryAr: "قواعد هوية المريض والتحقق من حقول التسجيل.",
    fields: {
      phone1_required: { en: "Phone 1 rule", ar: "قاعدة الهاتف 1" },
      dob_or_age_rule: { en: "DOB or age rule", ar: "قاعدة الميلاد أو العمر" },
      national_id_required: { en: "National ID rule", ar: "قاعدة الرقم الوطني" },
      custom_fields_scope: { en: "Custom field scope", ar: "نطاق الحقول المخصصة" }
    }
  },
  transliteration_and_dictionary: {
    titleEn: "Transliteration and dictionary",
    titleAr: "التحويل وقاموس الأسماء",
    summaryEn: "Arabic-English name conversion behavior.",
    summaryAr: "سلوك تحويل الأسماء من العربية إلى الإنجليزية.",
    fields: {
      live_transliteration: { en: "Live transliteration", ar: "التحويل المباشر" },
      dictionary_priority: { en: "Dictionary priority", ar: "أولوية القاموس" },
      manual_english_edit: { en: "Manual English edit", ar: "تعديل الإنجليزية يدوياً" },
      arabic_variant_matching: { en: "Arabic variant matching", ar: "مطابقة اختلافات العربية" }
    }
  },
  modalities_and_exams: {
    titleEn: "Modalities and exams",
    titleAr: "الأجهزة والفحوصات",
    summaryEn: "Modality behavior, exam list control, and instructions.",
    summaryAr: "إدارة الأجهزة وأنواع الفحوصات والتعليمات.",
    fields: {
      modalities_enabled: { en: "Enabled modalities", ar: "الأجهزة المفعلة" },
      add_exam_from_appointment: { en: "Add exam from appointment", ar: "إضافة فحص من صفحة الموعد" },
      modality_instructions: { en: "Modality instructions", ar: "تعليمات حسب الجهاز" },
      exam_specific_instructions: { en: "Exam-specific instructions", ar: "تعليمات خاصة حسب الفحص" }
    }
  },
  scheduling_and_capacity: {
    titleEn: "Scheduling and capacity",
    titleAr: "الجدولة والسعة",
    summaryEn: "Daily capacity, calendar behavior, and booking safety.",
    summaryAr: "السعة اليومية وسلوك التقويم وأمان الحجز.",
    fields: {
      capacity_mode: { en: "Capacity mode", ar: "نمط السعة" },
      calendar_window_days: { en: "Calendar window in days", ar: "عدد أيام التقويم" },
      double_booking_prevention: { en: "Prevent double booking", ar: "منع التكرار" },
      overbooking_reason_required: { en: "Require overbooking reason", ar: "إلزام سبب تجاوز السعة" }
    }
  },
  queue_and_arrival: {
    titleEn: "Queue and arrival",
    titleAr: "الطابور والوصول",
    summaryEn: "Reception arrival, walk-ins, and no-show review rules.",
    summaryAr: "قواعد الوصول والطابور والمرضى العابرين ومراجعة عدم الحضور.",
    fields: {
      barcode_check_in: { en: "Barcode check-in", ar: "الدخول بالباركود" },
      walk_in_queue: { en: "Walk-in queue", ar: "إضافة مريض مباشر للطابور" },
      no_show_review_time: { en: "No-show review time", ar: "وقت مراجعة عدم الحضور" },
      no_show_confirmation_required: { en: "Require no-show confirmation", ar: "إلزام تأكيد عدم الحضور" }
    }
  },
  printing_and_labels: {
    titleEn: "Printing and labels",
    titleAr: "الطباعة والملصقات",
    summaryEn: "Appointment slip, barcode, and label output behavior.",
    summaryAr: "سلوك الوصل والباركود وملصقات الطباعة.",
    fields: {
      appointment_slip: { en: "Appointment slip", ar: "وصل الموعد" },
      patient_label: { en: "Patient label", ar: "ملصق المريض" },
      barcode_value_source: { en: "Barcode value source", ar: "مصدر قيمة الباركود" },
      label_printer_profile: { en: "Label printer profile", ar: "إعداد طابعة الملصقات" },
      slip_printer_profile: { en: "Slip printer profile", ar: "إعداد طابعة الوصل" },
      label_output_mode: { en: "Label output mode", ar: "وضع إخراج الملصق" },
      direct_print_bridge_mode: { en: "Direct print bridge", ar: "ربط الطباعة المباشرة" }
    }
  },
  documents_and_uploads: {
    titleEn: "Documents and uploads",
    titleAr: "الوثائق والرفع",
    summaryEn: "Referral documents, file rules, and scanning behavior.",
    summaryAr: "طلب الفحص وقواعد الملفات وسلوك المسح الضوئي.",
    fields: {
      referral_upload: { en: "Referral upload", ar: "رفع طلب الفحص" },
      allowed_file_types: { en: "Allowed file types", ar: "أنواع الملفات المقبولة" },
      document_link_scope: { en: "Document linking scope", ar: "نطاق ربط الوثيقة" },
      scanner_bridge_mode: { en: "Scanner bridge mode", ar: "وضع الربط مع الماسح" },
      scanner_profile_name: { en: "Scanner profile name", ar: "اسم إعداد الماسح" },
      scanner_source: { en: "Scanner source", ar: "مصدر الماسح" },
      scan_dpi: { en: "Scan DPI", ar: "دقة المسح" },
      scan_color_mode: { en: "Scan color mode", ar: "نمط ألوان المسح" },
      scan_file_format: { en: "Scan file format", ar: "صيغة ملف المسح" }
    }
  },
  dashboard_and_ui: {
    titleEn: "Dashboard and UI",
    titleAr: "الرئيسية والواجهة",
    summaryEn: "Visual control over the dashboard and operational widgets.",
    summaryAr: "التحكم المرئي في الرئيسية وعناصر التشغيل.",
    fields: {
      dashboard_cards: { en: "Dashboard cards", ar: "بطاقات الرئيسية" },
      status_color_coding: { en: "Status colors", ar: "ألوان الحالات" },
      quick_actions: { en: "Quick actions", ar: "الإجراءات السريعة" },
      capacity_board: { en: "Capacity board", ar: "لوحة الشواغر" }
    }
  },
  audit_and_logging: {
    titleEn: "Audit and logging",
    titleAr: "السجل والتدقيق",
    summaryEn: "Tracking sensitive changes and old/new values.",
    summaryAr: "تتبع التغييرات الحساسة والقيم القديمة والجديدة.",
    fields: {
      audit_trail: { en: "Audit trail", ar: "سجل التدقيق" },
      store_old_new_values: { en: "Store old and new values", ar: "حفظ القيم القديمة والجديدة" },
      store_no_show_reason: { en: "Store no-show reason", ar: "حفظ سبب عدم الحضور" },
      store_cancel_reason: { en: "Store cancel reason", ar: "حفظ سبب الإلغاء" }
    }
  },
  backup_and_restore: {
    titleEn: "Backup and restore",
    titleAr: "النسخ الاحتياطي والاستعادة",
    summaryEn: "Browser download backups and restore permissions.",
    summaryAr: "نسخ احتياطي عبر المتصفح وصلاحيات الاستعادة.",
    fields: {
      allow_backup_download: { en: "Allow backup download", ar: "السماح بتنزيل النسخة" },
      allow_restore_upload: { en: "Allow restore upload", ar: "السماح برفع الاستعادة" },
      backup_target: { en: "Backup target", ar: "وجهة النسخ" },
      restore_permission: { en: "Restore permission", ar: "صلاحية الاستعادة" }
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

function defaultAppointmentForm() {
  return {
    modalityId: "",
    examTypeId: "",
    reportingPriorityId: "",
    appointmentDate: "",
    notes: "",
    overbookingReason: "",
    isWalkIn: false
  };
}

function defaultExamTypeForm() {
  return {
    modalityId: "",
    nameAr: "",
    nameEn: "",
    specificInstructionAr: "",
    specificInstructionEn: ""
  };
}

function defaultQueueWalkInForm() {
  return {
    modalityId: "",
    examTypeId: "",
    reportingPriorityId: "",
    notes: "",
    overbookingReason: ""
  };
}

function defaultPrintFilters() {
  return {
    date: getCurrentDateInputValue(),
    modalityId: ""
  };
}

function defaultUploadForm() {
  return {
    documentType: "referral_request",
    fileName: "",
    mimeType: "",
    fileContentBase64: "",
    fileSize: 0
  };
}

function defaultAppointmentEditForm() {
  return {
    modalityId: "",
    examTypeId: "",
    reportingPriorityId: "",
    appointmentDate: "",
    notes: "",
    overbookingReason: ""
  };
}

function defaultModalityFilters() {
  return {
    date: getCurrentDateInputValue(),
    modalityId: ""
  };
}

function defaultAuditFilters() {
  return {
    entityType: "",
    actionType: "",
    changedByUserId: "",
    dateFrom: "",
    dateTo: ""
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

function humanizeAuditValue(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatAuditEntityType(value) {
  const labels = {
    auth: { en: "Authentication", ar: "تسجيل الدخول" },
    user: { en: "User", ar: "مستخدم" },
    patient: { en: "Patient", ar: "مريض" },
    patient_merge: { en: "Patient merge", ar: "دمج المرضى" },
    appointment: { en: "Appointment", ar: "موعد" },
    queue_entry: { en: "Queue", ar: "الطابور" },
    document: { en: "Document", ar: "وثيقة" },
    system_setting: { en: "System setting", ar: "إعداد نظام" },
    backup: { en: "Backup", ar: "نسخة احتياطية" },
    audit_log: { en: "Audit log", ar: "سجل التدقيق" },
    integration: { en: "Integration", ar: "تكامل" }
  };

  return labels[value]?.[state.language] || humanizeAuditValue(value);
}

function formatAuditActionType(value) {
  const labels = {
    login: { en: "Login", ar: "تسجيل الدخول" },
    supervisor_reauth: { en: "Supervisor re-auth", ar: "إعادة تحقق المشرف" },
    create: { en: "Create", ar: "إنشاء" },
    update: { en: "Update", ar: "تعديل" },
    merge: { en: "Merge", ar: "دمج" },
    cancel: { en: "Cancel", ar: "إلغاء" },
    complete: { en: "Complete", ar: "إكمال" },
    upload: { en: "Upload", ar: "رفع" },
    upsert: { en: "Save setting", ar: "حفظ إعداد" },
    download: { en: "Download", ar: "تنزيل" },
    restore: { en: "Restore", ar: "استعادة" },
    confirm_no_show: { en: "Confirm no-show", ar: "تأكيد عدم الحضور" },
    scan_into_queue: { en: "Scan into queue", ar: "إدخال للطابور" },
    export: { en: "Export", ar: "تصدير" },
    prepare_print: { en: "Prepare print", ar: "تجهيز طباعة" },
    prepare_scan: { en: "Prepare scan", ar: "تجهيز مسح" }
  };

  return labels[value]?.[state.language] || humanizeAuditValue(value);
}

function getSettingsMeta(category) {
  return SETTINGS_META[category] || {
    titleEn: category,
    titleAr: category,
    summaryEn: "",
    summaryAr: "",
    fields: {}
  };
}

function getSettingsCategoryTitle(category) {
  const meta = getSettingsMeta(category);
  return state.language === "ar" ? meta.titleAr : meta.titleEn;
}

function getSettingsCategorySummary(category) {
  const meta = getSettingsMeta(category);
  return state.language === "ar" ? meta.summaryAr : meta.summaryEn;
}

function getSettingsFieldLabel(category, key) {
  const meta = getSettingsMeta(category);
  const field = meta.fields[key];

  if (field) {
    return state.language === "ar" ? field.ar : field.en;
  }

  return key.replaceAll("_", " ");
}

function getSettingsFieldValue(entry) {
  if (entry?.setting_value && typeof entry.setting_value === "object" && "value" in entry.setting_value) {
    return String(entry.setting_value.value ?? "");
  }

  return String(entry?.setting_value ?? "");
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

function keepDigits(value, maxLength) {
  return String(value || "")
    .replace(/\D/g, "")
    .slice(0, maxLength);
}

function formatDisplayDate(value) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat(state.language === "ar" ? "ar-LY" : "en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

function formatDisplayDateTime(value) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat(state.language === "ar" ? "ar-LY" : "en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function normalizeDateText(value) {
  return String(value || "").slice(0, 10);
}

function getCurrentDateInputValue() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Tripoli",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = formatter.formatToParts(new Date()).reduce((accumulator, part) => {
    if (part.type !== "literal") {
      accumulator[part.type] = part.value;
    }

    return accumulator;
  }, {});

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatSex(value) {
  if (value === "female") {
    return t().common.female;
  }

  return t().common.male;
}

function currentAppointmentModality() {
  return state.appointmentLookups.modalities.find(
    (modality) => String(modality.id) === String(state.appointmentForm.modalityId)
  );
}

function filteredExamTypes() {
  return state.appointmentLookups.examTypes.filter(
    (examType) => String(examType.modality_id) === String(state.appointmentForm.modalityId)
  );
}

function selectedAppointmentDay() {
  return state.appointmentCalendar.find(
    (day) => normalizeDateText(day.appointment_date) === normalizeDateText(state.appointmentForm.appointmentDate)
  );
}

function queueExamTypes() {
  return state.appointmentLookups.examTypes.filter(
    (examType) => String(examType.modality_id) === String(state.queueWalkInForm.modalityId)
  );
}

function selectedPrintInstruction(appointment) {
  if (!appointment) {
    return "";
  }

  if (state.language === "ar") {
    return appointment.specific_instruction_ar || appointment.general_instruction_ar || "";
  }

  return appointment.specific_instruction_en || appointment.general_instruction_en || "";
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

function hasRecentSupervisorReauth() {
  return Boolean(state.session?.recentSupervisorReauth);
}

function canAccessModalityBoard() {
  return ["modality_staff", "supervisor"].includes(state.session?.role);
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

async function loadQueueSnapshot() {
  state.queueLoading = true;
  state.queueError = "";
  render();

  try {
    const result = await api("/api/queue", { method: "GET" });
    state.queueSnapshot = result;
  } catch (error) {
    state.queueError = error.message;
  } finally {
    state.queueLoading = false;
    render();
  }
}

async function loadModalityWorklist() {
  if (!canAccessModalityBoard()) {
    return;
  }

  state.modalityLoading = true;
  state.modalityError = "";
  render();

  try {
    const params = new URLSearchParams();
    params.set("date", state.modalityFilters.date);

    if (state.modalityFilters.modalityId) {
      params.set("modalityId", state.modalityFilters.modalityId);
    }

    const result = await api(`/api/modality/worklist?${params.toString()}`, { method: "GET" });
    state.modalityResults = result.appointments || [];
  } catch (error) {
    state.modalityError = error.message;
  } finally {
    state.modalityLoading = false;
    render();
  }
}

async function loadPrintAppointments() {
  state.printLoading = true;
  state.printError = "";
  render();

  try {
    const params = new URLSearchParams();
    params.set("date", state.printFilters.date);

    if (state.printFilters.modalityId) {
      params.set("modalityId", state.printFilters.modalityId);
    }

    const result = await api(`/api/appointments?${params.toString()}`, { method: "GET" });
    state.printResults = result.appointments || [];

    if (
      state.selectedPrintAppointment &&
      !state.printResults.some((appointment) => appointment.id === state.selectedPrintAppointment.id)
    ) {
      state.selectedPrintAppointment = null;
      state.appointmentDocuments = [];
    }

    if (!state.selectedPrintAppointment && state.printResults[0]) {
      state.selectedPrintAppointment = state.printResults[0];
      fillAppointmentEditForm(state.selectedPrintAppointment);
      await loadAppointmentDocuments(state.selectedPrintAppointment.id);
    }
  } catch (error) {
    state.printError = error.message;
  } finally {
    state.printLoading = false;
    render();
  }
}

async function loadIntegrationStatus() {
  state.integrationLoading = true;
  state.integrationError = "";
  render();

  try {
    const result = await api("/api/integrations/status", { method: "GET" });
    state.integrationStatus = result.status || null;
  } catch (error) {
    state.integrationError = error.message;
  } finally {
    state.integrationLoading = false;
    render();
  }
}

async function loadAppointmentDocuments(appointmentId) {
  if (!appointmentId) {
    state.appointmentDocuments = [];
    render();
    return;
  }

  state.documentsLoading = true;
  state.documentsError = "";
  render();

  try {
    const result = await api(`/api/documents?appointmentId=${encodeURIComponent(appointmentId)}`, { method: "GET" });
    state.appointmentDocuments = result.documents || [];
  } catch (error) {
    state.documentsError = error.message;
  } finally {
    state.documentsLoading = false;
    render();
  }
}

async function loadAppointmentLookups() {
  state.appointmentLookupsLoading = true;
  state.appointmentError = "";
  render();

  try {
    const result = await api("/api/appointments/lookups", { method: "GET" });
    state.appointmentLookups = {
      modalities: result.modalities || [],
      examTypes: result.examTypes || [],
      priorities: result.priorities || []
    };

    if (!state.appointmentForm.modalityId && state.appointmentLookups.modalities[0]) {
      state.appointmentForm.modalityId = String(state.appointmentLookups.modalities[0].id);
      state.examTypeForm.modalityId = state.appointmentForm.modalityId;
    }

    if (!state.queueWalkInForm.modalityId && state.appointmentLookups.modalities[0]) {
      state.queueWalkInForm.modalityId = String(state.appointmentLookups.modalities[0].id);
    }

    if (state.appointmentForm.modalityId) {
      await loadAppointmentAvailability();
    }
  } catch (error) {
    state.appointmentError = error.message;
  } finally {
    state.appointmentLookupsLoading = false;
    render();
  }
}

async function loadAppointmentAvailability() {
  if (!state.appointmentForm.modalityId) {
    state.appointmentCalendar = [];
    render();
    return;
  }

  state.appointmentCalendarLoading = true;
  state.appointmentError = "";
  render();

  try {
    const result = await api(
      `/api/appointments/availability?modalityId=${encodeURIComponent(state.appointmentForm.modalityId)}&days=14`,
      { method: "GET" }
    );
    state.appointmentCalendar = result.availability || [];

    const selectedDateStillAvailable = state.appointmentCalendar.some(
      (day) => normalizeDateText(day.appointment_date) === normalizeDateText(state.appointmentForm.appointmentDate)
    );

    if (!selectedDateStillAvailable) {
      state.appointmentForm.appointmentDate = "";
      state.appointmentForm.overbookingReason = "";
    }
  } catch (error) {
    state.appointmentError = error.message;
  } finally {
    state.appointmentCalendarLoading = false;
    render();
  }
}

async function loadUsers() {
  if (!isSupervisor() || !hasRecentSupervisorReauth()) {
    return;
  }

  state.usersLoading = true;
  state.settingsError = "";
  render();

  try {
    const result = await api("/api/users", { method: "GET" });
    state.users = result.users || [];
  } catch (error) {
    state.settingsError = error.message;
  } finally {
    state.usersLoading = false;
    render();
  }
}

async function loadSettings() {
  if (!isSupervisor() || !hasRecentSupervisorReauth()) {
    return;
  }

  state.settingsLoading = true;
  state.settingsError = "";
  render();

  try {
    const result = await api("/api/settings", { method: "GET" });
    state.settingsCatalog = result.settings || {};
  } catch (error) {
    state.settingsError = error.message;
  } finally {
    state.settingsLoading = false;
    render();
  }
}

async function loadAuditEntries() {
  if (!isSupervisor() || !hasRecentSupervisorReauth()) {
    return;
  }

  state.auditLoading = true;
  state.auditError = "";
  render();

  try {
    const params = new URLSearchParams({ limit: "80" });

    if (state.auditFilters.entityType) {
      params.set("entityType", state.auditFilters.entityType);
    }

    if (state.auditFilters.actionType) {
      params.set("actionType", state.auditFilters.actionType);
    }

    if (state.auditFilters.changedByUserId) {
      params.set("changedByUserId", state.auditFilters.changedByUserId);
    }

    if (state.auditFilters.dateFrom) {
      params.set("dateFrom", state.auditFilters.dateFrom);
    }

    if (state.auditFilters.dateTo) {
      params.set("dateTo", state.auditFilters.dateTo);
    }

    const result = await api(`/api/audit?${params.toString()}`, { method: "GET" });
    state.auditEntries = result.entries || [];
    state.auditMeta = result.meta || { entityTypes: [], actionTypes: [], users: [] };
  } catch (error) {
    state.auditError = error.message;
  } finally {
    state.auditLoading = false;
    render();
  }
}

async function hydrateRoute() {
  if (!state.session) {
    return;
  }

  if (state.route === "dashboard") {
    await Promise.all([loadDashboardStatus(), loadQueueSnapshot()]);
    return;
  }

  if (state.route === "settings") {
    if (hasRecentSupervisorReauth()) {
      await Promise.all([loadUsers(), loadSettings(), loadAuditEntries()]);
    }
    return;
  }

  if (state.route === "appointments") {
    await loadAppointmentLookups();
    return;
  }

  if (state.route === "queue") {
    await Promise.all([loadQueueSnapshot(), loadAppointmentLookups()]);
    return;
  }

  if (state.route === "modality") {
    await Promise.all([loadAppointmentLookups(), loadModalityWorklist()]);
    return;
  }

  if (state.route === "print") {
    await Promise.all([loadAppointmentLookups(), loadPrintAppointments(), loadIntegrationStatus()]);
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
    state.settingsCatalog = {};
    state.settingsSuccess = "";
    state.appointmentLookups = { modalities: [], examTypes: [], priorities: [] };
    state.appointmentCalendar = [];
    state.selectedAppointmentPatient = null;
    state.appointmentPatientResults = [];
    state.appointmentPatientQuery = "";
    state.appointmentForm = defaultAppointmentForm();
    state.savedAppointment = null;
    state.queueSnapshot = null;
    state.queueScanValue = "";
    state.queueWalkInQuery = "";
    state.queueWalkInResults = [];
    state.queueSelectedPatient = null;
    state.queueWalkInForm = defaultQueueWalkInForm();
    state.queueSuccess = "";
    state.noShowReasons = {};
    state.modalityResults = [];
    state.modalityFilters = defaultModalityFilters();
    state.modalityError = "";
    state.modalitySuccess = "";
    state.auditEntries = [];
    state.auditError = "";
    state.auditFilters = defaultAuditFilters();
    state.auditMeta = { entityTypes: [], actionTypes: [], users: [] };
    state.auditExportLoading = false;
    state.reauthPassword = "";
    state.reauthError = "";
    state.backupSuccess = "";
    state.backupError = "";
    state.restoreSuccess = "";
    state.restoreError = "";
    state.restoreFileName = "";
    state.restorePayloadText = "";
    state.printResults = [];
    state.integrationStatus = null;
    state.integrationError = "";
    state.integrationSuccess = "";
    state.integrationLoading = false;
    state.scanPreparationLoading = false;
    state.printPreparationLoading = false;
    state.printFilters = defaultPrintFilters();
    state.selectedPrintAppointment = null;
    state.appointmentDocuments = [];
    state.uploadForm = defaultUploadForm();
    state.uploadSuccess = "";
    state.searchSelectedPatient = null;
    state.patientEditForm = defaultPatientForm();
    state.mergeSourcePatient = null;
    state.mergeTargetPatient = null;
    state.mergeConfirmationText = "";
    state.appointmentEditForm = defaultAppointmentEditForm();
    state.cancelReason = "";
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

async function searchAppointmentPatients() {
  const term = state.appointmentPatientQuery.trim();

  if (!term) {
    state.appointmentPatientResults = [];
    state.appointmentError =
      state.language === "ar"
        ? "أدخل اسماً أو هاتفاً أو رقماً وطنياً للبحث عن المريض."
        : "Enter a name, phone number, or national ID to search for a patient.";
    render();
    return;
  }

  state.appointmentPatientLoading = true;
  state.appointmentError = "";
  render();

  try {
    const result = await api(`/api/patients?q=${encodeURIComponent(term)}`, {
      method: "GET"
    });
    state.appointmentPatientResults = result.patients || [];
  } catch (error) {
    state.appointmentError = error.message;
  } finally {
    state.appointmentPatientLoading = false;
    render();
  }
}

async function searchQueuePatients() {
  const term = state.queueWalkInQuery.trim();

  if (!term) {
    state.queueWalkInResults = [];
    state.queueError =
      state.language === "ar"
        ? "أدخل اسماً أو هاتفاً أو رقماً وطنياً للبحث عن المريض المباشر."
        : "Enter a name, phone number, or national ID to search for the walk-in patient.";
    render();
    return;
  }

  state.queueWalkInLoading = true;
  state.queueError = "";
  render();

  try {
    const result = await api(`/api/patients?q=${encodeURIComponent(term)}`, {
      method: "GET"
    });
    state.queueWalkInResults = result.patients || [];
  } catch (error) {
    state.queueError = error.message;
  } finally {
    state.queueWalkInLoading = false;
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

async function submitSupervisorReauth() {
  if (!isSupervisor()) {
    return;
  }

  state.reauthLoading = true;
  state.reauthError = "";
  render();

  try {
    await api("/api/auth/re-auth", {
      method: "POST",
      body: JSON.stringify({ password: state.reauthPassword })
    });
    state.reauthPassword = "";
    await refreshSession();
    await Promise.all([loadUsers(), loadSettings(), loadAuditEntries()]);
  } catch (error) {
    state.reauthError = error.message;
  } finally {
    state.reauthLoading = false;
    render();
  }
}

async function downloadBackup() {
  state.backupLoading = true;
  state.backupError = "";
  state.backupSuccess = "";
  render();

  try {
    const response = await fetch("/api/admin/backup", {
      method: "GET",
      credentials: "same-origin"
    });

    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload?.error?.message || "Backup download failed.");
    }

    const backup = await response.json();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `rispro-backup-${getCurrentDateInputValue()}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    state.backupSuccess =
      state.language === "ar" ? "تم تنزيل النسخة الاحتياطية بنجاح." : "The backup was downloaded successfully.";
  } catch (error) {
    state.backupError = error.message;
  } finally {
    state.backupLoading = false;
    render();
  }
}

async function downloadAuditExport() {
  if (!isSupervisor() || !hasRecentSupervisorReauth()) {
    return;
  }

  state.auditExportLoading = true;
  state.auditError = "";
  render();

  try {
    const params = new URLSearchParams({ limit: "2000" });

    if (state.auditFilters.entityType) {
      params.set("entityType", state.auditFilters.entityType);
    }

    if (state.auditFilters.actionType) {
      params.set("actionType", state.auditFilters.actionType);
    }

    if (state.auditFilters.changedByUserId) {
      params.set("changedByUserId", state.auditFilters.changedByUserId);
    }

    if (state.auditFilters.dateFrom) {
      params.set("dateFrom", state.auditFilters.dateFrom);
    }

    if (state.auditFilters.dateTo) {
      params.set("dateTo", state.auditFilters.dateTo);
    }

    const response = await fetch(`/api/audit/export?${params.toString()}`, {
      method: "GET",
      credentials: "same-origin"
    });

    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload?.error?.message || "Audit export failed.");
    }

    const csv = await response.text();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `rispro-audit-${getCurrentDateInputValue()}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    state.auditError = error.message;
  } finally {
    state.auditExportLoading = false;
    render();
  }
}

async function restoreBackup() {
  if (!state.restorePayloadText) {
    state.restoreError =
      state.language === "ar" ? "اختر ملف نسخة احتياطية أولاً." : "Choose a backup file first.";
    render();
    return;
  }

  state.restoreLoading = true;
  state.restoreError = "";
  state.restoreSuccess = "";
  render();

  try {
    const payload = JSON.parse(state.restorePayloadText);
    await api("/api/admin/restore", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    state.restoreSuccess =
      state.language === "ar" ? "تمت استعادة النسخة الاحتياطية بنجاح." : "The backup was restored successfully.";
    state.restoreFileName = "";
    state.restorePayloadText = "";
    await refreshSession();
    await Promise.all([loadUsers(), loadSettings(), loadAuditEntries()]);
  } catch (error) {
    state.restoreError = error.message;
  } finally {
    state.restoreLoading = false;
    render();
  }
}

async function createExamType() {
  state.examTypeSaving = true;
  state.examTypeError = "";
  state.examTypeSuccess = "";
  render();

  try {
    const payload = {
      ...state.examTypeForm,
      modalityId: state.examTypeForm.modalityId || state.appointmentForm.modalityId
    };
    const result = await api("/api/appointments/exam-types", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    state.appointmentLookups.examTypes = [result.examType, ...state.appointmentLookups.examTypes];
    state.appointmentForm.examTypeId = String(result.examType.id);
    state.examTypeSuccess = t().appointments.examAdded;
    state.examTypeModalOpen = false;
    state.examTypeForm = defaultExamTypeForm();
  } catch (error) {
    state.examTypeError = error.message;
  } finally {
    state.examTypeSaving = false;
    render();
  }
}

async function saveAppointment() {
  if (!state.selectedAppointmentPatient) {
    state.appointmentError = t().appointments.noneSelected;
    render();
    return;
  }

  if (!normalizeDateText(state.appointmentForm.appointmentDate)) {
    state.appointmentError = t().appointments.dateRequired;
    render();
    return;
  }

  state.appointmentSaving = true;
  state.appointmentError = "";
  state.appointmentSuccess = "";
  render();

  try {
    const payload = {
      patientId: state.selectedAppointmentPatient.id,
      modalityId: state.appointmentForm.modalityId,
      examTypeId: state.appointmentForm.examTypeId,
      reportingPriorityId: state.appointmentForm.reportingPriorityId,
      appointmentDate: state.appointmentForm.appointmentDate,
      notes: state.appointmentForm.notes,
      overbookingReason: state.appointmentForm.overbookingReason,
      isWalkIn: state.appointmentForm.isWalkIn
    };
    const result = await api("/api/appointments", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    state.appointmentSuccess = t().appointments.appointmentSaved;
    state.savedAppointment = result;
    state.appointmentForm = {
      ...defaultAppointmentForm(),
      modalityId: state.appointmentForm.modalityId,
      reportingPriorityId: state.appointmentForm.reportingPriorityId
    };
    await loadAppointmentAvailability();
  } catch (error) {
    state.appointmentError = error.message;
  } finally {
    state.appointmentSaving = false;
    render();
  }
}

async function scanQueueAccession() {
  const accessionNumber = state.queueScanValue.trim();

  if (!accessionNumber) {
    state.queueError =
      state.language === "ar" ? "أدخل رقم الدخول أو امسح الباركود أولاً." : "Enter or scan an accession number first.";
    render();
    return;
  }

  state.queueLoading = true;
  state.queueError = "";
  state.queueSuccess = "";
  render();

  try {
    await api("/api/queue/scan", {
      method: "POST",
      body: JSON.stringify({ accessionNumber })
    });
    state.queueSuccess = t().queue.scannedSuccess;
    state.queueScanValue = "";
    await loadQueueSnapshot();
  } catch (error) {
    state.queueError = error.message;
  } finally {
    state.queueLoading = false;
    render();
  }
}

async function saveWalkInQueueEntry() {
  if (!state.queueSelectedPatient) {
    state.queueError =
      state.language === "ar" ? "اختر مريضاً قبل إضافته مباشرة إلى الطابور." : "Select a patient before adding a walk-in.";
    render();
    return;
  }

  state.queueWalkInSaving = true;
  state.queueError = "";
  state.queueSuccess = "";
  render();

  try {
    await api("/api/queue/walk-in", {
      method: "POST",
      body: JSON.stringify({
        patientId: state.queueSelectedPatient.id,
        modalityId: state.queueWalkInForm.modalityId,
        examTypeId: state.queueWalkInForm.examTypeId,
        reportingPriorityId: state.queueWalkInForm.reportingPriorityId,
        notes: state.queueWalkInForm.notes,
        overbookingReason: state.queueWalkInForm.overbookingReason
      })
    });
    state.queueSuccess = t().queue.walkInSuccess;
    state.queueWalkInForm = {
      ...defaultQueueWalkInForm(),
      modalityId: state.queueWalkInForm.modalityId
    };
    state.queueWalkInQuery = "";
    state.queueWalkInResults = [];
    state.queueSelectedPatient = null;
    await loadQueueSnapshot();
  } catch (error) {
    state.queueError = error.message;
  } finally {
    state.queueWalkInSaving = false;
    render();
  }
}

async function confirmQueueNoShow(appointmentId) {
  const reason = (state.noShowReasons[appointmentId] || "").trim();

  if (!reason) {
    state.queueError = state.language === "ar" ? "أدخل سبب عدم الحضور أولاً." : "Enter a no-show reason first.";
    render();
    return;
  }

  state.queueLoading = true;
  state.queueError = "";
  state.queueSuccess = "";
  render();

  try {
    await api("/api/queue/confirm-no-show", {
      method: "POST",
      body: JSON.stringify({
        appointmentId,
        reason
      })
    });
    state.queueSuccess =
      state.language === "ar" ? "تم تأكيد عدم حضور المريض." : "The no-show was confirmed successfully.";
    delete state.noShowReasons[appointmentId];
    await loadQueueSnapshot();
  } catch (error) {
    state.queueError = error.message;
  } finally {
    state.queueLoading = false;
    render();
  }
}

async function completeModalityAppointment(appointmentId) {
  state.modalityLoading = true;
  state.modalityError = "";
  state.modalitySuccess = "";
  render();

  try {
    await api(`/api/modality/${encodeURIComponent(appointmentId)}/complete`, {
      method: "POST"
    });
    state.modalitySuccess = t().modality.completed;
    await loadModalityWorklist();
    await loadQueueSnapshot();
  } catch (error) {
    state.modalityError = error.message;
  } finally {
    state.modalityLoading = false;
    render();
  }
}

async function uploadAppointmentDocument() {
  if (!state.selectedPrintAppointment) {
    state.uploadError = t().print.noAppointment;
    render();
    return;
  }

  if (!state.uploadForm.fileContentBase64) {
    state.uploadError =
      state.language === "ar" ? "اختر ملفاً أولاً قبل الرفع." : "Choose a file before uploading.";
    render();
    return;
  }

  state.uploadSaving = true;
  state.uploadError = "";
  state.uploadSuccess = "";
  render();

  try {
    await api("/api/documents", {
      method: "POST",
      body: JSON.stringify({
        patientId: state.selectedPrintAppointment.patient_id,
        appointmentId: state.selectedPrintAppointment.id,
        documentType: state.uploadForm.documentType,
        originalFilename: state.uploadForm.fileName,
        mimeType: state.uploadForm.mimeType,
        fileContentBase64: state.uploadForm.fileContentBase64
      })
    });
    state.uploadSuccess =
      state.language === "ar" ? "تم رفع الوثيقة بنجاح." : "The document was uploaded successfully.";
    state.uploadForm = defaultUploadForm();
    await loadAppointmentDocuments(state.selectedPrintAppointment.id);
  } catch (error) {
    state.uploadError = error.message;
  } finally {
    state.uploadSaving = false;
    render();
  }
}

async function preparePrintOutput(outputType) {
  if (!state.selectedPrintAppointment) {
    state.integrationError = t().print.noAppointment;
    render();
    return;
  }

  state.printPreparationLoading = true;
  state.integrationError = "";
  state.integrationSuccess = "";
  render();

  try {
    const result = await api("/api/integrations/print-prepare", {
      method: "POST",
      body: JSON.stringify({
        appointmentId: state.selectedPrintAppointment.id,
        outputType
      })
    });

    const preparation = result.preparation;
    state.integrationSuccess =
      state.language === "ar"
        ? `تم تجهيز ${outputType === "label" ? "طباعة الملصق" : "طباعة الوصل"} باستخدام الإعداد ${preparation.printerProfile}.`
        : `${outputType === "label" ? "Label" : "Slip"} print prepared with profile ${preparation.printerProfile}.`;
  } catch (error) {
    state.integrationError = error.message;
  } finally {
    state.printPreparationLoading = false;
    render();
  }
}

async function prepareScanSession() {
  if (!state.selectedPrintAppointment) {
    state.integrationError = t().print.noAppointment;
    render();
    return;
  }

  state.scanPreparationLoading = true;
  state.integrationError = "";
  state.integrationSuccess = "";
  render();

  try {
    const result = await api("/api/integrations/scan-prepare", {
      method: "POST",
      body: JSON.stringify({
        appointmentId: state.selectedPrintAppointment.id,
        documentType: state.uploadForm.documentType || "referral_request"
      })
    });

    const preparation = result.preparation;
    state.integrationSuccess =
      state.language === "ar"
        ? `تم تجهيز جلسة المسح ${preparation.sessionCode}. ${preparation.guidance}`
        : `Scan session ${preparation.sessionCode} is ready. ${preparation.guidance}`;

    if (!state.uploadForm.fileName) {
      state.uploadForm.fileName = preparation.suggestedFileName || state.uploadForm.fileName;
    }
  } catch (error) {
    state.integrationError = error.message;
  } finally {
    state.scanPreparationLoading = false;
    render();
  }
}

function fillPatientEditForm(patient) {
  state.patientEditForm = {
    mrn: patient.mrn || "",
    arabicFullName: patient.arabic_full_name || "",
    englishFullName: patient.english_full_name || "",
    ageYears: String(patient.age_years || ""),
    sex: patient.sex || "male",
    nationalId: patient.national_id || "",
    nationalIdConfirmation: patient.national_id || "",
    phone1: patient.phone_1 || "",
    phone2: patient.phone_2 || "",
    address: patient.address || ""
  };
}

function fillAppointmentEditForm(appointment) {
  state.appointmentEditForm = {
    modalityId: String(appointment.modality_id || ""),
    examTypeId: String(appointment.exam_type_id || ""),
    reportingPriorityId: String(appointment.reporting_priority_id || ""),
    appointmentDate: String(appointment.appointment_date || "").slice(0, 10),
    notes: appointment.notes || "",
    overbookingReason: appointment.overbooking_reason || ""
  };
}

async function updateSelectedPatient() {
  if (!state.searchSelectedPatient) {
    return;
  }

  state.patientUpdateSaving = true;
  state.patientUpdateError = "";
  state.patientUpdateSuccess = "";
  render();

  try {
    const result = await api(`/api/patients/${encodeURIComponent(state.searchSelectedPatient.id)}`, {
      method: "PUT",
      body: JSON.stringify(state.patientEditForm)
    });
    state.searchSelectedPatient = result.patient;
    fillPatientEditForm(result.patient);
    state.patientUpdateSuccess = t().patientActions.updated;
    state.searchResults = state.searchResults.map((patient) =>
      patient.id === result.patient.id ? result.patient : patient
    );
  } catch (error) {
    state.patientUpdateError = error.message;
  } finally {
    state.patientUpdateSaving = false;
    render();
  }
}

async function mergeSelectedPatients() {
  if (!state.mergeSourcePatient || !state.mergeTargetPatient) {
    state.mergeError =
      state.language === "ar" ? "اختر سجل المصدر وسجل الهدف أولاً." : "Choose a merge source and target first.";
    render();
    return;
  }

  state.mergeSaving = true;
  state.mergeError = "";
  state.mergeSuccess = "";
  render();

  try {
    const result = await api("/api/patients/merge", {
      method: "POST",
      body: JSON.stringify({
        sourcePatientId: state.mergeSourcePatient.id,
        targetPatientId: state.mergeTargetPatient.id,
        confirmationText: state.mergeConfirmationText
      })
    });
    state.mergeSuccess = t().patientActions.merged;
    state.searchSelectedPatient = result.patient;
    fillPatientEditForm(result.patient);
    state.searchResults = state.searchResults.filter((patient) => patient.id !== state.mergeSourcePatient.id);
    state.searchResults = state.searchResults.map((patient) =>
      patient.id === result.patient.id ? result.patient : patient
    );
    state.mergeSourcePatient = null;
    state.mergeTargetPatient = null;
    state.mergeConfirmationText = "";
  } catch (error) {
    state.mergeError = error.message;
  } finally {
    state.mergeSaving = false;
    render();
  }
}

async function updateSelectedAppointment() {
  if (!state.selectedPrintAppointment) {
    return;
  }

  state.appointmentEditSaving = true;
  state.appointmentEditError = "";
  state.appointmentEditSuccess = "";
  render();

  try {
    const result = await api(`/api/appointments/${encodeURIComponent(state.selectedPrintAppointment.id)}`, {
      method: "PUT",
      body: JSON.stringify(state.appointmentEditForm)
    });
    const refreshed = await api(`/api/appointments/${encodeURIComponent(state.selectedPrintAppointment.id)}`, {
      method: "GET"
    });
    state.selectedPrintAppointment = refreshed.appointment;
    fillAppointmentEditForm(refreshed.appointment);
    state.appointmentEditSuccess = t().print.appointmentUpdated;
    state.printResults = state.printResults.map((appointment) =>
      appointment.id === refreshed.appointment.id ? refreshed.appointment : appointment
    );
  } catch (error) {
    state.appointmentEditError = error.message;
  } finally {
    state.appointmentEditSaving = false;
    render();
  }
}

async function cancelSelectedAppointment() {
  if (!state.selectedPrintAppointment) {
    return;
  }

  state.appointmentCancelSaving = true;
  state.appointmentEditError = "";
  state.appointmentEditSuccess = "";
  render();

  try {
    await api(`/api/appointments/${encodeURIComponent(state.selectedPrintAppointment.id)}/cancel`, {
      method: "POST",
      body: JSON.stringify({ cancelReason: state.cancelReason })
    });
    state.appointmentEditSuccess = t().print.appointmentCancelled;
    state.cancelReason = "";
    await loadPrintAppointments();
  } catch (error) {
    state.appointmentEditError = error.message;
  } finally {
    state.appointmentCancelSaving = false;
    render();
  }
}

async function saveSettingsCategory(category) {
  const entries = state.settingsCatalog[category] || [];

  if (!entries.length) {
    return;
  }

  state.settingsSavingCategory = category;
  state.settingsError = "";
  state.settingsSuccess = "";
  render();

  try {
    await api(`/api/settings/${encodeURIComponent(category)}`, {
      method: "PUT",
      body: JSON.stringify({
        entries: entries.map((entry) => ({
          key: entry.setting_key,
          value: {
            value: getSettingsFieldValue(entry)
          }
        }))
      })
    });

    state.settingsSuccess =
      state.language === "ar"
        ? `تم حفظ فئة ${getSettingsCategoryTitle(category)} بنجاح.`
        : `${getSettingsCategoryTitle(category)} was saved successfully.`;
  } catch (error) {
    state.settingsError = error.message;
  } finally {
    state.settingsSavingCategory = "";
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
  const summary = state.queueSnapshot?.summary || {};
  const queueEntries = state.queueSnapshot?.queueEntries || [];
  const noShowCandidates = state.queueSnapshot?.noShowCandidates || [];
  const reviewActive = Boolean(state.queueSnapshot?.reviewActive);
  const reviewTime = state.queueSnapshot?.reviewTime || "17:00";

  return `
    <div class="page">
      ${pageHero(
        t().dashboard.title,
        t().dashboard.body,
        `<button type="button" class="button-primary" data-route="patients">${escapeHtml(t().dashboard.primary)}</button>
         <button type="button" class="button-secondary" data-route="queue">${escapeHtml(t().dashboard.scanShortcut)}</button>`,
        t().dashboard.ready
      )}

      ${alertMarkup("error", state.dashboardError || state.queueError)}
      ${alertMarkup("success", state.queueSuccess)}

      <section class="card-grid">
        ${statCard(t().dashboard.db, readinessLabel, state.dashboardReady ? t().dashboard.ready : t().dashboard.notReady, "var(--teal)")}
        ${statCard(t().dashboard.session, formatRole(state.session.role), state.session.fullName, "var(--amber)")}
        ${statCard(t().dashboard.waiting, String(summary.waiting_count || 0), `${queueEntries.length} ${t().queue.waitingList}`, "var(--blue)")}
        ${statCard(t().dashboard.noShowReview, String(noShowCandidates.length), `${t().dashboard.reviewStarts} ${reviewTime}`, "var(--red)")}
        ${statCard(t().dashboard.modules, "8", state.language === "ar" ? "الرئيسية + المرضى + المواعيد + الطابور + لوحة الجهاز + الطباعة + البحث + الإعدادات" : "Dashboard + Patients + Appointments + Queue + Modality + Print + Search + Settings", "var(--blue)")}
        ${statCard(t().dashboard.date, localizedDate(), t().common.environment + `: ${state.dashboardLoading || state.queueLoading ? t().common.loading : "API"}`, "var(--green)")}
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
            <div class="item"><div class="item-copy"><div class="item-title">${escapeHtml(t().nav.appointments)}</div><div class="item-subtitle">/api/appointments POST, /api/appointments/lookups</div></div><span class="chip accent">${escapeHtml(t().common.active)}</span></div>
            <div class="item"><div class="item-copy"><div class="item-title">${escapeHtml(t().nav.queue)}</div><div class="item-subtitle">/api/queue GET, /api/queue/scan, /api/queue/walk-in</div></div><span class="chip accent">${escapeHtml(t().common.active)}</span></div>
            <div class="item"><div class="item-copy"><div class="item-title">${escapeHtml(t().nav.modality)}</div><div class="item-subtitle">/api/modality/worklist, /api/modality/:id/complete</div></div><span class="chip accent">${escapeHtml(canAccessModalityBoard() ? t().common.active : t().common.readOnly)}</span></div>
            <div class="item"><div class="item-copy"><div class="item-title">${escapeHtml(t().nav.print)}</div><div class="item-subtitle">/api/appointments GET, /api/documents POST</div></div><span class="chip accent">${escapeHtml(t().common.active)}</span></div>
            <div class="item"><div class="item-copy"><div class="item-title">${escapeHtml(t().nav.search)}</div><div class="item-subtitle">/api/patients GET</div></div><span class="chip accent">${escapeHtml(t().common.active)}</span></div>
            <div class="item"><div class="item-copy"><div class="item-title">${escapeHtml(t().nav.settings)}</div><div class="item-subtitle">/api/users GET/POST</div></div><span class="chip accent">${escapeHtml(isSupervisor() ? t().common.active : t().common.readOnly)}</span></div>
          </div>
        </article>

        <article class="surface">
          <div class="section-head">
            <h2 class="section-title">${escapeHtml(t().dashboard.queueTitle)}</h2>
            <span class="chip subtle">${escapeHtml(String(queueEntries.length))}</span>
          </div>
          ${
            queueEntries.length
              ? `<div class="list">
                  ${queueEntries
                    .slice(0, 5)
                    .map(
                      (entry) => `
                        <div class="item">
                          <div class="item-copy">
                            <div class="item-title">#${escapeHtml(String(entry.queue_number))} • ${escapeHtml(
                              state.language === "ar" ? entry.arabic_full_name : entry.english_full_name
                            )}</div>
                            <div class="item-subtitle">${escapeHtml(entry.accession_number)} • ${escapeHtml(
                              state.language === "ar" ? entry.modality_name_ar : entry.modality_name_en
                            )}</div>
                          </div>
                          <span class="chip accent">${escapeHtml(entry.queue_status)}</span>
                        </div>
                      `
                    )
                    .join("")}
                </div>`
              : `<div class="empty">${escapeHtml(t().common.noData)}</div>`
          }
        </article>
      </section>

      <section class="dual-grid">
        <article class="surface">
          <div class="section-head">
            <h2 class="section-title">${escapeHtml(t().dashboard.reviewTitle)}</h2>
            <span class="chip ${reviewActive ? "accent" : "subtle"}">${escapeHtml(reviewTime)}</span>
          </div>
          ${
            !reviewActive
              ? `<div class="empty">${escapeHtml(t().dashboard.reviewInactive)}</div>`
              : noShowCandidates.length
                ? `<div class="list">
                    ${noShowCandidates
                      .map(
                        (candidate) => `
                          <div class="item queue-review-item">
                            <div class="item-copy">
                              <div class="item-title">${escapeHtml(
                                state.language === "ar" ? candidate.arabic_full_name : candidate.english_full_name
                              )}</div>
                              <div class="item-subtitle">${escapeHtml(candidate.accession_number)} • ${escapeHtml(
                                state.language === "ar" ? candidate.modality_name_ar : candidate.modality_name_en
                              )}</div>
                              <input
                                class="input ${state.language === "ar" ? "field-ar" : ""} queue-reason-input"
                                data-no-show-reason="true"
                                data-appointment-id="${escapeHtml(String(candidate.appointment_id))}"
                                value="${escapeHtml(state.noShowReasons[candidate.appointment_id] || "")}"
                                placeholder="${escapeHtml(t().queue.reasonPlaceholder)}"
                              />
                            </div>
                            <button class="button-secondary" type="button" data-action="confirm-no-show" data-appointment-id="${escapeHtml(String(candidate.appointment_id))}">
                              ${escapeHtml(t().queue.reviewButton)}
                            </button>
                          </div>
                        `
                      )
                      .join("")}
                  </div>`
                : `<div class="empty">${escapeHtml(t().dashboard.reviewEmpty)}</div>`
          }
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
                <input class="input field-en" name="phone1" value="${escapeHtml(state.patientForm.phone1)}" inputmode="numeric" maxlength="10" autocomplete="off" />
              </label>

              <label class="field">
                <span class="label">${escapeHtml(t().patients.fields.phone2)}</span>
                <input class="input field-en" name="phone2" value="${escapeHtml(state.patientForm.phone2)}" inputmode="numeric" maxlength="10" autocomplete="off" />
              </label>

              <label class="field">
                <span class="label">${escapeHtml(t().patients.fields.nationalId)}</span>
                <input class="input field-en" name="nationalId" value="${escapeHtml(state.patientForm.nationalId)}" inputmode="numeric" maxlength="11" autocomplete="off" />
              </label>

              <label class="field">
                <span class="label">${escapeHtml(t().patients.fields.nationalIdConfirmation)}</span>
                <input class="input field-en" name="nationalIdConfirmation" value="${escapeHtml(state.patientForm.nationalIdConfirmation)}" inputmode="numeric" maxlength="11" autocomplete="off" data-prevent-paste="true" />
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

function renderAppointmentPatientResults() {
  if (!state.appointmentPatientResults.length) {
    return `<div class="empty">${escapeHtml(t().common.noData)}</div>`;
  }

  return `
    <div class="list">
      ${state.appointmentPatientResults
        .map(
          (patient) => `
            <div class="item patient-result">
              <div class="item-copy">
                <div class="item-title">${escapeHtml(state.language === "ar" ? patient.arabic_full_name : patient.english_full_name)}</div>
                <div class="item-subtitle">${escapeHtml(patient.national_id || "N/A")} • ${escapeHtml(patient.phone_1 || "N/A")}</div>
              </div>
              <button class="button-secondary" type="button" data-action="select-appointment-patient" data-patient-id="${escapeHtml(String(patient.id))}">
                ${escapeHtml(t().appointments.patientSelect)}
              </button>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderSelectedAppointmentPatient() {
  if (!state.selectedAppointmentPatient) {
    return `<div class="empty">${escapeHtml(t().appointments.noneSelected)}</div>`;
  }

  const patient = state.selectedAppointmentPatient;

  return `
    <div class="info-grid">
      ${infoTile(t().patients.fields.arabicFullName, patient.arabic_full_name, "tone-good")}
      ${infoTile(t().patients.fields.englishFullName, patient.english_full_name, "")}
      ${infoTile(t().patients.fields.ageYears, String(patient.age_years || ""), "")}
      ${infoTile(t().patients.fields.sex, formatSex(patient.sex), "")}
      ${infoTile(t().patients.fields.phone1, patient.phone_1 || "N/A", "tone-warm")}
      ${infoTile(t().patients.fields.nationalId, patient.national_id || "N/A", "")}
      ${infoTile(t().patients.fields.address, patient.address || "—", "")}
      ${infoTile(t().patients.fields.mrn, patient.mrn || `#${patient.id}`, "")}
    </div>
  `;
}

function renderAppointmentCalendar() {
  if (!state.appointmentForm.modalityId) {
    return `<div class="empty">${escapeHtml(t().appointments.calendarHint)}</div>`;
  }

  if (state.appointmentCalendarLoading) {
    return `<div class="empty">${escapeHtml(t().common.loading)}</div>`;
  }

  if (!state.appointmentCalendar.length) {
    return `<div class="empty">${escapeHtml(t().common.noData)}</div>`;
  }

  return `
    <div class="calendar">
      ${state.appointmentCalendar
        .map((day) => {
          const normalizedDate = normalizeDateText(day.appointment_date);
          const isSelected = normalizedDate === normalizeDateText(state.appointmentForm.appointmentDate);
          const isFull = day.remaining_capacity <= 0;
          const canSelect = !isFull || isSupervisor();

          return `
            <button
              type="button"
              class="day ${isSelected ? "active" : ""} ${isFull ? "day-full" : ""}"
              data-action="${canSelect ? "select-appointment-day" : "disabled-day"}"
              data-date="${escapeHtml(normalizedDate)}"
            >
              <div class="day-date">${escapeHtml(formatDisplayDate(normalizedDate))}</div>
              <div class="day-value">${escapeHtml(String(day.remaining_capacity))}</div>
              <div class="day-note">
                ${escapeHtml(isFull ? t().appointments.fullDay : t().appointments.availableDay)}
                • ${escapeHtml(`${t().appointments.fields.dailyCapacity}: ${day.daily_capacity}`)}
              </div>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderSavedAppointment() {
  if (!state.savedAppointment?.appointment) {
    return `<div class="empty">${escapeHtml(t().common.noData)}</div>`;
  }

  const result = state.savedAppointment;

  return `
    <div class="list">
      <div class="item">
        <div class="item-copy">
          <div class="item-title">${escapeHtml(result.barcodeValue)}</div>
          <div class="item-subtitle">${escapeHtml(formatDisplayDate(result.appointment.appointment_date))} • ${escapeHtml(state.language === "ar" ? result.modality.name_ar : result.modality.name_en)}</div>
        </div>
        <span class="chip ${result.appointment.is_overbooked ? "subtle" : "success"}">${escapeHtml(
          `${t().appointments.fields.slotNumber}: ${result.appointment.modality_slot_number}`
        )}</span>
      </div>
    </div>
  `;
}

function renderExamTypeModal() {
  if (!state.examTypeModalOpen) {
    return "";
  }

  return `
    <section class="surface modal-surface">
      <form id="exam-type-form" class="stack">
        <div class="section-head">
          <h2 class="section-title">${escapeHtml(t().appointments.createExam)}</h2>
          <button class="button-ghost" type="button" data-action="close-exam-type-modal">×</button>
        </div>

        ${alertMarkup("error", state.examTypeError)}
        ${alertMarkup("success", state.examTypeSuccess)}

        <div class="form-grid">
          <label class="field">
            <span class="label">${escapeHtml(t().appointments.fields.examNameAr)}</span>
            <input class="input field-ar" name="nameAr" data-exam-type-field="true" value="${escapeHtml(state.examTypeForm.nameAr)}" />
          </label>

          <label class="field">
            <span class="label">${escapeHtml(t().appointments.fields.examNameEn)}</span>
            <input class="input field-en" name="nameEn" data-exam-type-field="true" value="${escapeHtml(state.examTypeForm.nameEn)}" />
          </label>

          <label class="field full">
            <span class="label">${escapeHtml(t().appointments.fields.specificInstructionAr)}</span>
            <textarea class="textarea field-ar" name="specificInstructionAr" data-exam-type-field="true">${escapeHtml(state.examTypeForm.specificInstructionAr)}</textarea>
          </label>

          <label class="field full">
            <span class="label">${escapeHtml(t().appointments.fields.specificInstructionEn)}</span>
            <textarea class="textarea field-en" name="specificInstructionEn" data-exam-type-field="true">${escapeHtml(state.examTypeForm.specificInstructionEn)}</textarea>
          </label>
        </div>

        <div class="form-actions">
          <button class="button-primary" type="submit">${escapeHtml(
            state.examTypeSaving ? t().common.loading : t().appointments.createExamSave
          )}</button>
        </div>
      </form>
    </section>
  `;
}

function renderAppointments() {
  const modality = currentAppointmentModality();
  const examTypes = filteredExamTypes();
  const selectedDay = selectedAppointmentDay();
  const selectedDateValue = normalizeDateText(state.appointmentForm.appointmentDate);

  return `
    <div class="page">
      ${pageHero(
        t().appointments.title,
        t().appointments.body,
        "",
        state.appointmentLookupsLoading ? t().common.loading : t().appointments.selectedPatient
      )}
      ${alertMarkup("error", state.appointmentError)}
      ${alertMarkup("success", state.appointmentSuccess)}

      <section class="split-grid">
        <div class="stack">
          <article class="surface">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().appointments.patientSearch)}</h2>
              <span class="chip subtle">${escapeHtml(String(state.appointmentPatientResults.length))}</span>
            </div>

            <form id="appointment-patient-search-form" class="search-bar">
              <input
                class="input ${state.language === "ar" ? "field-ar" : ""}"
                name="appointmentPatientQuery"
                value="${escapeHtml(state.appointmentPatientQuery)}"
                placeholder="${escapeHtml(t().appointments.patientPlaceholder)}"
              />
              <button class="button-primary" type="submit">${escapeHtml(
                state.appointmentPatientLoading ? t().common.loading : t().appointments.patientSearch
              )}</button>
            </form>

            ${renderAppointmentPatientResults()}
          </article>

          <article class="surface">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().appointments.selectedPatient)}</h2>
              <span class="chip accent">${escapeHtml(state.selectedAppointmentPatient ? t().common.active : t().common.noData)}</span>
            </div>
            ${renderSelectedAppointmentPatient()}
          </article>

          <article class="surface">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().appointments.savedCard)}</h2>
              <span class="chip success">${escapeHtml(t().common.latest)}</span>
            </div>
            ${renderSavedAppointment()}
          </article>
        </div>

        <div class="stack">
          <article class="surface">
            <form id="appointment-form" class="stack">
              <div class="section-head">
                <h2 class="section-title">${escapeHtml(t().appointments.title)}</h2>
                <div class="badge-row">
                  <span class="chip accent">${escapeHtml(modality ? (state.language === "ar" ? modality.name_ar : modality.name_en) : t().appointments.lookupsLoading)}</span>
                </div>
              </div>

              <div class="form-grid">
                <label class="field">
                  <span class="label">${escapeHtml(t().appointments.fields.modality)}</span>
                  <select class="select" name="modalityId">
                    ${state.appointmentLookups.modalities
                      .map(
                        (entry) => `
                          <option value="${escapeHtml(String(entry.id))}" ${String(entry.id) === String(state.appointmentForm.modalityId) ? "selected" : ""}>
                            ${escapeHtml(state.language === "ar" ? entry.name_ar : entry.name_en)}
                          </option>
                        `
                      )
                      .join("")}
                  </select>
                </label>

                <label class="field">
                  <span class="label">${escapeHtml(t().appointments.fields.examType)}</span>
                  <select class="select" name="examTypeId">
                    <option value="">${escapeHtml(t().common.optional)}</option>
                    ${examTypes
                      .map(
                        (entry) => `
                          <option value="${escapeHtml(String(entry.id))}" ${String(entry.id) === String(state.appointmentForm.examTypeId) ? "selected" : ""}>
                            ${escapeHtml(state.language === "ar" ? entry.name_ar : entry.name_en)}
                          </option>
                        `
                      )
                      .join("")}
                  </select>
                </label>

                <label class="field">
                  <span class="label">${escapeHtml(t().appointments.fields.priority)}</span>
                  <select class="select" name="reportingPriorityId">
                    <option value="">${escapeHtml(t().common.optional)}</option>
                    ${state.appointmentLookups.priorities
                      .map(
                        (entry) => `
                          <option value="${escapeHtml(String(entry.id))}" ${String(entry.id) === String(state.appointmentForm.reportingPriorityId) ? "selected" : ""}>
                            ${escapeHtml(state.language === "ar" ? entry.name_ar : entry.name_en)}
                          </option>
                        `
                      )
                      .join("")}
                  </select>
                </label>

                <label class="field">
                  <span class="label">${escapeHtml(t().appointments.fields.appointmentDate)}</span>
                  <input
                    class="input field-en"
                    type="date"
                    name="appointmentDate"
                    value="${escapeHtml(selectedDateValue)}"
                  />
                  <div class="small">${escapeHtml(t().appointments.dateInputHint)}</div>
                </label>

                <label class="field checkbox-field">
                  <span class="label">${escapeHtml(t().appointments.walkIn)}</span>
                  <input type="checkbox" name="isWalkIn" ${state.appointmentForm.isWalkIn ? "checked" : ""} />
                </label>

                <label class="field full">
                  <span class="label">${escapeHtml(t().appointments.fields.notes)}</span>
                  <textarea class="textarea ${state.language === "ar" ? "field-ar" : ""}" name="notes">${escapeHtml(state.appointmentForm.notes)}</textarea>
                </label>

                ${selectedDay?.is_full ? `
                  <label class="field full">
                    <span class="label">${escapeHtml(t().appointments.fields.overbookingReason)}</span>
                    <textarea class="textarea ${state.language === "ar" ? "field-ar" : ""}" name="overbookingReason">${escapeHtml(
                      state.appointmentForm.overbookingReason
                    )}</textarea>
                  </label>
                ` : ""}
              </div>

              <div class="form-actions">
                <button class="button-secondary" type="button" data-action="open-exam-type-modal">${escapeHtml(t().appointments.createExam)}</button>
                <button class="button-primary" type="submit">${escapeHtml(
                  state.appointmentSaving ? t().common.loading : t().appointments.save
                )}</button>
              </div>
            </form>
          </article>

          <article class="surface">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().appointments.dateSelect)}</h2>
              <span class="chip subtle">${escapeHtml(
                selectedDay
                  ? `${t().appointments.fields.appointmentDate}: ${normalizeDateText(selectedDay.appointment_date)}`
                  : selectedDateValue || t().appointments.calendarHint
              )}</span>
            </div>
            <div class="date-selection-summary">
              <div class="metric-tile tone-good">
                <div class="metric-label">${escapeHtml(t().appointments.selectedDateLabel)}</div>
                <div class="metric-value">${escapeHtml(selectedDateValue || t().common.noData)}</div>
              </div>
            </div>
            ${selectedDay?.is_full ? `<div class="alert alert-error">${escapeHtml(t().appointments.overbookNotice)}</div>` : ""}
            ${renderAppointmentCalendar()}
          </article>
        </div>
      </section>

      ${renderExamTypeModal()}
    </div>
  `;
}

function renderQueuePatientResults() {
  if (!state.queueWalkInResults.length) {
    return `<div class="empty">${escapeHtml(t().common.noData)}</div>`;
  }

  return `
    <div class="list">
      ${state.queueWalkInResults
        .map(
          (patient) => `
            <div class="item patient-result">
              <div class="item-copy">
                <div class="item-title">${escapeHtml(state.language === "ar" ? patient.arabic_full_name : patient.english_full_name)}</div>
                <div class="item-subtitle">${escapeHtml(patient.national_id || "N/A")} • ${escapeHtml(patient.phone_1 || "N/A")}</div>
              </div>
              <button class="button-secondary" type="button" data-action="select-queue-patient" data-patient-id="${escapeHtml(String(patient.id))}">
                ${escapeHtml(t().queue.selectPatient)}
              </button>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderSelectedQueuePatient() {
  if (!state.queueSelectedPatient) {
    return `<div class="empty">${escapeHtml(t().appointments.noneSelected)}</div>`;
  }

  const patient = state.queueSelectedPatient;

  return `
    <div class="info-grid">
      ${infoTile(t().patients.fields.arabicFullName, patient.arabic_full_name, "tone-good")}
      ${infoTile(t().patients.fields.englishFullName, patient.english_full_name, "")}
      ${infoTile(t().patients.fields.phone1, patient.phone_1 || "N/A", "tone-warm")}
      ${infoTile(t().patients.fields.nationalId, patient.national_id || "N/A", "")}
    </div>
  `;
}

function renderQueueEntries() {
  const entries = state.queueSnapshot?.queueEntries || [];

  if (!entries.length) {
    return `<div class="empty">${escapeHtml(t().common.noData)}</div>`;
  }

  return `
    <div class="list">
      ${entries
        .map(
          (entry) => `
            <div class="item">
              <div class="item-copy">
                <div class="item-title">#${escapeHtml(String(entry.queue_number))} • ${escapeHtml(
                  state.language === "ar" ? entry.arabic_full_name : entry.english_full_name
                )}</div>
                <div class="item-subtitle">${escapeHtml(entry.accession_number)} • ${escapeHtml(
                  state.language === "ar" ? entry.modality_name_ar : entry.modality_name_en
                )}${entry.is_walk_in ? ` • ${escapeHtml(t().appointments.walkIn)}` : ""}</div>
              </div>
              <span class="chip accent">${escapeHtml(entry.queue_status)}</span>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderQueueNoShowReview() {
  const snapshot = state.queueSnapshot;
  const candidates = snapshot?.noShowCandidates || [];

  if (!snapshot?.reviewActive) {
    return `<div class="empty">${escapeHtml(t().dashboard.reviewInactive)}</div>`;
  }

  if (!candidates.length) {
    return `<div class="empty">${escapeHtml(t().dashboard.reviewEmpty)}</div>`;
  }

  return `
    <div class="list">
      ${candidates
        .map(
          (candidate) => `
            <div class="item queue-review-item">
              <div class="item-copy">
                <div class="item-title">${escapeHtml(
                  state.language === "ar" ? candidate.arabic_full_name : candidate.english_full_name
                )}</div>
                <div class="item-subtitle">${escapeHtml(candidate.accession_number)} • ${escapeHtml(
                  state.language === "ar" ? candidate.modality_name_ar : candidate.modality_name_en
                )}</div>
                <input
                  class="input ${state.language === "ar" ? "field-ar" : ""} queue-reason-input"
                  data-no-show-reason="true"
                  data-appointment-id="${escapeHtml(String(candidate.appointment_id))}"
                  value="${escapeHtml(state.noShowReasons[candidate.appointment_id] || "")}"
                  placeholder="${escapeHtml(t().queue.reasonPlaceholder)}"
                />
              </div>
              <button class="button-secondary" type="button" data-action="confirm-no-show" data-appointment-id="${escapeHtml(String(candidate.appointment_id))}">
                ${escapeHtml(t().queue.reviewButton)}
              </button>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderQueue() {
  const summary = state.queueSnapshot?.summary || {};
  const walkInExamTypes = queueExamTypes();

  return `
    <div class="page">
      ${pageHero(
        t().queue.title,
        t().queue.body,
        `<button class="button-secondary" type="button" data-action="refresh-queue">${escapeHtml(t().common.refresh)}</button>`,
        state.queueSnapshot?.queueDate || localizedDate()
      )}
      ${alertMarkup("error", state.queueError)}
      ${alertMarkup("success", state.queueSuccess)}

      <section class="card-grid">
        ${statCard(t().dashboard.waiting, String(summary.waiting_count || 0), t().queue.waitingList, "var(--amber)")}
        ${statCard(t().dashboard.noShowReview, String((state.queueSnapshot?.noShowCandidates || []).length), `${t().dashboard.reviewStarts} ${state.queueSnapshot?.reviewTime || "17:00"}`, "var(--red)")}
        ${statCard(t().dashboard.date, state.queueSnapshot?.queueDate || localizedDate(), t().queue.scanTitle, "var(--teal)")}
      </section>

      <section class="split-grid">
        <div class="stack">
          <article class="surface">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().queue.scanTitle)}</h2>
              <span class="chip accent">${escapeHtml(t().queue.scanButton)}</span>
            </div>

            <form id="queue-scan-form" class="search-bar">
              <input class="input field-en" name="queueScanValue" value="${escapeHtml(state.queueScanValue)}" placeholder="${escapeHtml(t().queue.scanPlaceholder)}" autocomplete="off" />
              <button class="button-primary" type="submit">${escapeHtml(state.queueLoading ? t().common.loading : t().queue.scanButton)}</button>
            </form>
          </article>

          <article class="surface">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().queue.waitingList)}</h2>
              <span class="chip subtle">${escapeHtml(String((state.queueSnapshot?.queueEntries || []).length))}</span>
            </div>
            ${renderQueueEntries()}
          </article>

          <article class="surface">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().queue.reviewTitle)}</h2>
              <span class="chip ${state.queueSnapshot?.reviewActive ? "accent" : "subtle"}">${escapeHtml(state.queueSnapshot?.reviewTime || "17:00")}</span>
            </div>
            ${renderQueueNoShowReview()}
          </article>
        </div>

        <div class="stack">
          <article class="surface">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().queue.walkInSearch)}</h2>
              <span class="chip subtle">${escapeHtml(String(state.queueWalkInResults.length))}</span>
            </div>

            <form id="queue-patient-search-form" class="search-bar">
              <input class="input ${state.language === "ar" ? "field-ar" : ""}" name="queueWalkInQuery" value="${escapeHtml(state.queueWalkInQuery)}" placeholder="${escapeHtml(t().queue.walkInPlaceholder)}" />
              <button class="button-primary" type="submit">${escapeHtml(state.queueWalkInLoading ? t().common.loading : t().queue.walkInSearch)}</button>
            </form>

            ${renderQueuePatientResults()}
          </article>

          <article class="surface">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().queue.selectedPatient)}</h2>
              <span class="chip accent">${escapeHtml(state.queueSelectedPatient ? t().common.active : t().common.noData)}</span>
            </div>
            ${renderSelectedQueuePatient()}
          </article>

          <article class="surface">
            <form id="queue-walk-in-form" class="stack">
              <div class="section-head">
                <h2 class="section-title">${escapeHtml(t().queue.walkInTitle)}</h2>
                <span class="chip success">${escapeHtml(t().appointments.walkIn)}</span>
              </div>

              <div class="form-grid">
                <label class="field">
                  <span class="label">${escapeHtml(t().appointments.fields.modality)}</span>
                  <select class="select" name="modalityId">
                    <option value="">${escapeHtml(t().common.required)}</option>
                    ${state.appointmentLookups.modalities
                      .map(
                        (entry) => `
                          <option value="${escapeHtml(String(entry.id))}" ${String(entry.id) === String(state.queueWalkInForm.modalityId) ? "selected" : ""}>
                            ${escapeHtml(state.language === "ar" ? entry.name_ar : entry.name_en)}
                          </option>
                        `
                      )
                      .join("")}
                  </select>
                </label>

                <label class="field">
                  <span class="label">${escapeHtml(t().appointments.fields.examType)}</span>
                  <select class="select" name="examTypeId">
                    <option value="">${escapeHtml(t().common.optional)}</option>
                    ${walkInExamTypes
                      .map(
                        (entry) => `
                          <option value="${escapeHtml(String(entry.id))}" ${String(entry.id) === String(state.queueWalkInForm.examTypeId) ? "selected" : ""}>
                            ${escapeHtml(state.language === "ar" ? entry.name_ar : entry.name_en)}
                          </option>
                        `
                      )
                      .join("")}
                  </select>
                </label>

                <label class="field">
                  <span class="label">${escapeHtml(t().appointments.fields.priority)}</span>
                  <select class="select" name="reportingPriorityId">
                    <option value="">${escapeHtml(t().common.optional)}</option>
                    ${state.appointmentLookups.priorities
                      .map(
                        (entry) => `
                          <option value="${escapeHtml(String(entry.id))}" ${String(entry.id) === String(state.queueWalkInForm.reportingPriorityId) ? "selected" : ""}>
                            ${escapeHtml(state.language === "ar" ? entry.name_ar : entry.name_en)}
                          </option>
                        `
                      )
                      .join("")}
                  </select>
                </label>

                <label class="field full">
                  <span class="label">${escapeHtml(t().appointments.fields.notes)}</span>
                  <textarea class="textarea ${state.language === "ar" ? "field-ar" : ""}" name="notes">${escapeHtml(state.queueWalkInForm.notes)}</textarea>
                </label>

                <label class="field full">
                  <span class="label">${escapeHtml(t().appointments.fields.overbookingReason)}</span>
                  <textarea class="textarea ${state.language === "ar" ? "field-ar" : ""}" name="overbookingReason">${escapeHtml(state.queueWalkInForm.overbookingReason)}</textarea>
                </label>
              </div>

              <div class="form-actions">
                <button class="button-primary" type="submit">${escapeHtml(state.queueWalkInSaving ? t().common.loading : t().queue.walkInButton)}</button>
              </div>
            </form>
          </article>
        </div>
      </section>
    </div>
  `;
}

function renderPrintList() {
  if (state.printLoading) {
    return `<div class="empty">${escapeHtml(t().common.loading)}</div>`;
  }

  if (!state.printResults.length) {
    return `<div class="empty">${escapeHtml(t().common.noData)}</div>`;
  }

  return `
    <div class="list">
      ${state.printResults
        .map(
          (appointment) => `
            <div class="item patient-result">
              <div class="item-copy">
                <div class="item-title">${escapeHtml(appointment.accession_number)} • ${escapeHtml(
                  state.language === "ar" ? appointment.arabic_full_name : appointment.english_full_name
                )}</div>
                <div class="item-subtitle">${escapeHtml(
                  state.language === "ar" ? appointment.modality_name_ar : appointment.modality_name_en
                )} • ${escapeHtml(appointment.exam_name_ar ? (state.language === "ar" ? appointment.exam_name_ar : appointment.exam_name_en) : "—")}</div>
              </div>
              <button class="button-secondary" type="button" data-action="select-print-appointment" data-appointment-id="${escapeHtml(String(appointment.id))}">
                ${escapeHtml(t().common.open)}
              </button>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderPrintSlipPreview() {
  const appointment = state.selectedPrintAppointment;

  if (!appointment) {
    return `<div class="empty">${escapeHtml(t().print.noAppointment)}</div>`;
  }

  return `
    <div class="slip-card">
      <div class="slip-top">
        <div>
          <div class="eyebrow">${escapeHtml(t().print.slipPreview)}</div>
          <div class="slip-title">${escapeHtml(appointment.accession_number)}</div>
          <div class="slip-subtitle">${escapeHtml(formatDisplayDate(appointment.appointment_date))}</div>
        </div>
        <span class="chip accent">${escapeHtml(appointment.status)}</span>
      </div>

      <div class="slip-grid">
        <div class="slip-info">
          <div class="label">${escapeHtml(t().patients.fields.arabicFullName)}</div>
          <div>${escapeHtml(appointment.arabic_full_name)}</div>
        </div>
        <div class="slip-info">
          <div class="label">${escapeHtml(t().patients.fields.englishFullName)}</div>
          <div>${escapeHtml(appointment.english_full_name)}</div>
        </div>
        <div class="slip-info">
          <div class="label">${escapeHtml(t().appointments.fields.modality)}</div>
          <div>${escapeHtml(state.language === "ar" ? appointment.modality_name_ar : appointment.modality_name_en)}</div>
        </div>
        <div class="slip-info">
          <div class="label">${escapeHtml(t().appointments.fields.examType)}</div>
          <div>${escapeHtml(appointment.exam_name_ar ? (state.language === "ar" ? appointment.exam_name_ar : appointment.exam_name_en) : "—")}</div>
        </div>
        <div class="slip-info full-span">
          <div class="label">${escapeHtml(t().appointments.fields.notes)}</div>
          <div>${escapeHtml(appointment.notes || selectedPrintInstruction(appointment) || "—")}</div>
        </div>
      </div>

      <div class="barcode-block">
        <div class="label">${escapeHtml(t().appointments.fields.accessionNumber)}</div>
        <div class="barcode-visual"></div>
        <div class="barcode-text">${escapeHtml(appointment.accession_number)}</div>
      </div>
    </div>
  `;
}

function renderPrintLabelPreview() {
  const appointment = state.selectedPrintAppointment;

  if (!appointment) {
    return `<div class="empty">${escapeHtml(t().print.noAppointment)}</div>`;
  }

  return `
    <div class="label-card">
      <div class="item-title">${escapeHtml(appointment.arabic_full_name)}</div>
      <div class="item-subtitle">${escapeHtml(appointment.english_full_name)}</div>
      <div class="barcode-panel">
        <div class="barcode-visual small-barcode"></div>
        <div class="barcode-text">${escapeHtml(appointment.accession_number)}</div>
      </div>
    </div>
  `;
}

function renderIntegrationStatusPanel() {
  if (state.integrationLoading && !state.integrationStatus) {
    return `<div class="empty">${escapeHtml(t().common.loading)}</div>`;
  }

  if (!state.integrationStatus) {
    return `<div class="empty">${escapeHtml(t().print.noHardwareStatus)}</div>`;
  }

  const printer = state.integrationStatus.printer;
  const scanner = state.integrationStatus.scanner;

  return `
    <div class="dual-grid">
      <article class="surface surface-compact">
        <div class="section-head">
          <h3 class="section-title">${escapeHtml(t().print.printerReady)}</h3>
          <span class="chip ${printer.directLabelPrintReady ? "success" : "subtle"}">${escapeHtml(
            printer.directLabelPrintReady
              ? state.language === "ar"
                ? "الربط جاهز"
                : "Bridge ready"
              : state.language === "ar"
                ? "طباعة المتصفح"
                : "Browser print"
          )}</span>
        </div>
        <div class="stack">
          <div class="info-grid">
            ${infoTile(t().print.printerProfile, printer.labelPrinterProfile || "customize_later", "tone-good")}
            ${infoTile(t().print.printerMode, printer.labelOutputMode || "browser_print", "")}
          </div>
          <div class="form-actions">
            <button class="button-secondary" type="button" data-action="prepare-slip-print">${escapeHtml(
              state.printPreparationLoading ? t().common.loading : t().print.prepareSlip
            )}</button>
            <button class="button-primary" type="button" data-action="prepare-label-print">${escapeHtml(
              state.printPreparationLoading ? t().common.loading : t().print.prepareLabel
            )}</button>
          </div>
        </div>
      </article>

      <article class="surface surface-compact">
        <div class="section-head">
          <h3 class="section-title">${escapeHtml(t().print.scannerReady)}</h3>
          <span class="chip ${scanner.bridgeReady ? "success" : "subtle"}">${escapeHtml(scanner.scannerBridgeMode)}</span>
        </div>
        <div class="stack">
          <div class="info-grid">
            ${infoTile(t().print.scannerProfile, scanner.scannerProfileName || "default_twain_profile", "tone-warm")}
            ${infoTile(t().print.scannerMode, scanner.scanFileFormat ? `${scanner.scannerSource} • ${scanner.scanFileFormat}` : "—", "")}
          </div>
          <div class="small">${escapeHtml(`${t().print.allowedTypes}: ${(scanner.allowedFileTypes || []).join(", ") || "—"}`)}</div>
          <div class="form-actions">
            <button class="button-primary" type="button" data-action="prepare-scan-session">${escapeHtml(
              state.scanPreparationLoading ? t().common.loading : t().print.prepareScan
            )}</button>
          </div>
        </div>
      </article>
    </div>
  `;
}

function renderDocumentsList() {
  if (state.documentsLoading) {
    return `<div class="empty">${escapeHtml(t().common.loading)}</div>`;
  }

  if (!state.appointmentDocuments.length) {
    return `<div class="empty">${escapeHtml(t().common.noData)}</div>`;
  }

  return `
    <div class="list">
      ${state.appointmentDocuments
        .map(
          (document) => `
            <div class="item">
              <div class="item-copy">
                <div class="item-title">${escapeHtml(document.original_filename)}</div>
                <div class="item-subtitle">${escapeHtml(document.document_type)} • ${escapeHtml(String(document.file_size || 0))} bytes</div>
              </div>
              <span class="chip subtle">${escapeHtml(document.mime_type || "file")}</span>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderModalityWorklist() {
  if (state.modalityLoading) {
    return `<div class="empty">${escapeHtml(t().common.loading)}</div>`;
  }

  if (!state.modalityResults.length) {
    return `<div class="empty">${escapeHtml(t().common.noData)}</div>`;
  }

  return `
    <div class="list">
      ${state.modalityResults
        .map(
          (appointment) => `
            <div class="item patient-result">
              <div class="item-copy">
                <div class="item-title">#${escapeHtml(String(appointment.modality_slot_number || "—"))} • ${escapeHtml(
                  state.language === "ar" ? appointment.arabic_full_name : appointment.english_full_name
                )}</div>
                <div class="item-subtitle">${escapeHtml(appointment.accession_number)} • ${escapeHtml(
                  state.language === "ar" ? appointment.modality_name_ar : appointment.modality_name_en
                )} • ${escapeHtml(appointment.exam_name_ar ? (state.language === "ar" ? appointment.exam_name_ar : appointment.exam_name_en) : "—")}</div>
              </div>
              ${
                appointment.status === "completed"
                  ? `<span class="chip success">${escapeHtml(appointment.status)}</span>`
                  : `<button class="button-secondary" type="button" data-action="complete-appointment" data-appointment-id="${escapeHtml(String(appointment.id))}">${escapeHtml(t().modality.complete)}</button>`
              }
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderModality() {
  if (!canAccessModalityBoard()) {
    return `
      <div class="page">
        ${pageHero(t().modality.title, t().modality.body, "", t().common.readOnly)}
        <section class="surface">
          <div class="empty">${escapeHtml(t().modality.blocked)}</div>
        </section>
      </div>
    `;
  }

  return `
    <div class="page">
      ${pageHero(
        t().modality.title,
        t().modality.body,
        `<button class="button-secondary" type="button" data-action="refresh-modality">${escapeHtml(t().common.refresh)}</button>`,
        t().nav.modality
      )}
      ${alertMarkup("error", state.modalityError)}
      ${alertMarkup("success", state.modalitySuccess)}
      <section class="surface">
        <form id="modality-filter-form" class="stack">
          <div class="section-head">
            <h2 class="section-title">${escapeHtml(t().modality.filtersTitle)}</h2>
            <span class="chip accent">${escapeHtml(t().modality.load)}</span>
          </div>
          <div class="form-grid">
            <label class="field">
              <span class="label">${escapeHtml(t().print.date)}</span>
              <input class="input field-en" type="date" name="date" value="${escapeHtml(state.modalityFilters.date)}" />
            </label>
            <label class="field">
              <span class="label">${escapeHtml(t().appointments.fields.modality)}</span>
              <select class="select" name="modalityId">
                <option value="">${escapeHtml(t().common.optional)}</option>
                ${state.appointmentLookups.modalities
                  .map(
                    (entry) => `
                      <option value="${escapeHtml(String(entry.id))}" ${String(entry.id) === String(state.modalityFilters.modalityId) ? "selected" : ""}>
                        ${escapeHtml(state.language === "ar" ? entry.name_ar : entry.name_en)}
                      </option>
                    `
                  )
                  .join("")}
              </select>
            </label>
          </div>
          <div class="form-actions">
            <button class="button-primary" type="submit">${escapeHtml(state.modalityLoading ? t().common.loading : t().modality.load)}</button>
          </div>
        </form>
      </section>

      <section class="surface">
        <div class="section-head">
          <h2 class="section-title">${escapeHtml(t().modality.title)}</h2>
          <span class="chip subtle">${escapeHtml(String(state.modalityResults.length))}</span>
        </div>
        ${renderModalityWorklist()}
      </section>
    </div>
  `;
}

function renderPrint() {
  return `
    <div class="page">
      ${pageHero(
        t().print.title,
        t().print.body,
        "",
        t().print.selectedAppointment
      )}
      ${alertMarkup("error", state.printError || state.documentsError || state.uploadError || state.integrationError)}
      ${alertMarkup("success", state.uploadSuccess || state.integrationSuccess)}

      <section class="split-grid">
        <div class="stack">
          <article class="surface">
            <form id="print-filter-form" class="stack">
              <div class="section-head">
                <h2 class="section-title">${escapeHtml(t().print.filtersTitle)}</h2>
                <span class="chip accent">${escapeHtml(t().print.load)}</span>
              </div>
              <div class="form-grid">
                <label class="field">
                  <span class="label">${escapeHtml(t().print.date)}</span>
                  <input class="input field-en" type="date" name="date" value="${escapeHtml(state.printFilters.date)}" />
                </label>
                <label class="field">
                  <span class="label">${escapeHtml(t().print.modality)}</span>
                  <select class="select" name="modalityId">
                    <option value="">${escapeHtml(t().common.optional)}</option>
                    ${state.appointmentLookups.modalities
                      .map(
                        (entry) => `
                          <option value="${escapeHtml(String(entry.id))}" ${String(entry.id) === String(state.printFilters.modalityId) ? "selected" : ""}>
                            ${escapeHtml(state.language === "ar" ? entry.name_ar : entry.name_en)}
                          </option>
                        `
                      )
                      .join("")}
                  </select>
                </label>
              </div>
              <div class="form-actions">
                <button class="button-primary" type="submit">${escapeHtml(state.printLoading ? t().common.loading : t().print.load)}</button>
              </div>
            </form>
          </article>

          <article class="surface">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().print.dailyList)}</h2>
              <span class="chip subtle">${escapeHtml(String(state.printResults.length))}</span>
            </div>
            ${renderPrintList()}
          </article>
        </div>

        <div class="stack">
          <article class="surface">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().print.hardwareTitle)}</h2>
              <span class="chip subtle">${escapeHtml(state.selectedPrintAppointment?.accession_number || t().common.noData)}</span>
            </div>
            ${renderIntegrationStatusPanel()}
          </article>

          <article class="surface slip-surface">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().print.slipPreview)}</h2>
              <button class="button-secondary" type="button" data-action="browser-print">${escapeHtml(t().nav.print)}</button>
            </div>
            ${renderPrintSlipPreview()}
          </article>

          <article class="surface">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().print.labelPreview)}</h2>
            </div>
            ${renderPrintLabelPreview()}
          </article>

          <article class="surface">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().print.documentsTitle)}</h2>
              <span class="chip accent">${escapeHtml(String(state.appointmentDocuments.length))}</span>
            </div>
            ${renderDocumentsList()}

            <form id="document-upload-form" class="stack">
              <div class="form-grid">
                <label class="field">
                  <span class="label">${escapeHtml(t().print.fields.documentType)}</span>
                  <input class="input field-en" name="documentType" value="${escapeHtml(state.uploadForm.documentType)}" />
                </label>
                <label class="field">
                  <span class="label">${escapeHtml(t().print.fields.fileName)}</span>
                  <input class="input field-en" value="${escapeHtml(state.uploadForm.fileName || t().print.fileNone)}" readonly />
                </label>
                <label class="field full">
                  <span class="label">${escapeHtml(t().print.fileButton)}</span>
                  <input class="input" type="file" name="documentFile" data-upload-file="true" />
                </label>
              </div>
              <div class="form-actions">
                <button class="button-primary" type="submit">${escapeHtml(state.uploadSaving ? t().common.loading : t().print.uploadButton)}</button>
              </div>
            </form>
          </article>

          <article class="surface">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().print.editAppointment)}</h2>
              <span class="chip subtle">${escapeHtml(state.selectedPrintAppointment?.accession_number || t().common.noData)}</span>
            </div>
            ${alertMarkup("error", state.appointmentEditError)}
            ${alertMarkup("success", state.appointmentEditSuccess)}
            ${
              state.selectedPrintAppointment
                ? `<form id="appointment-edit-form" class="stack">
                    <div class="form-grid">
                      <label class="field">
                        <span class="label">${escapeHtml(t().appointments.fields.modality)}</span>
                        <select class="select" name="modalityId">
                          ${state.appointmentLookups.modalities
                            .map(
                              (entry) => `
                                <option value="${escapeHtml(String(entry.id))}" ${String(entry.id) === String(state.appointmentEditForm.modalityId) ? "selected" : ""}>
                                  ${escapeHtml(state.language === "ar" ? entry.name_ar : entry.name_en)}
                                </option>
                              `
                            )
                            .join("")}
                        </select>
                      </label>
                      <label class="field">
                        <span class="label">${escapeHtml(t().appointments.fields.examType)}</span>
                        <select class="select" name="examTypeId">
                          <option value="">${escapeHtml(t().common.optional)}</option>
                          ${state.appointmentLookups.examTypes
                            .filter((entry) => String(entry.modality_id) === String(state.appointmentEditForm.modalityId))
                            .map(
                              (entry) => `
                                <option value="${escapeHtml(String(entry.id))}" ${String(entry.id) === String(state.appointmentEditForm.examTypeId) ? "selected" : ""}>
                                  ${escapeHtml(state.language === "ar" ? entry.name_ar : entry.name_en)}
                                </option>
                              `
                            )
                            .join("")}
                        </select>
                      </label>
                      <label class="field">
                        <span class="label">${escapeHtml(t().appointments.fields.priority)}</span>
                        <select class="select" name="reportingPriorityId">
                          <option value="">${escapeHtml(t().common.optional)}</option>
                          ${state.appointmentLookups.priorities
                            .map(
                              (entry) => `
                                <option value="${escapeHtml(String(entry.id))}" ${String(entry.id) === String(state.appointmentEditForm.reportingPriorityId) ? "selected" : ""}>
                                  ${escapeHtml(state.language === "ar" ? entry.name_ar : entry.name_en)}
                                </option>
                              `
                            )
                            .join("")}
                        </select>
                      </label>
                      <label class="field">
                        <span class="label">${escapeHtml(t().appointments.fields.appointmentDate)}</span>
                        <input class="input field-en" type="date" name="appointmentDate" value="${escapeHtml(state.appointmentEditForm.appointmentDate)}" />
                      </label>
                      <label class="field full">
                        <span class="label">${escapeHtml(t().appointments.fields.notes)}</span>
                        <textarea class="textarea ${state.language === "ar" ? "field-ar" : ""}" name="notes">${escapeHtml(state.appointmentEditForm.notes)}</textarea>
                      </label>
                      <label class="field full">
                        <span class="label">${escapeHtml(t().appointments.fields.overbookingReason)}</span>
                        <textarea class="textarea ${state.language === "ar" ? "field-ar" : ""}" name="overbookingReason">${escapeHtml(state.appointmentEditForm.overbookingReason)}</textarea>
                      </label>
                    </div>
                    <div class="form-actions">
                      <button class="button-primary" type="submit">${escapeHtml(state.appointmentEditSaving ? t().common.loading : t().print.saveAppointment)}</button>
                    </div>
                  </form>
                  <form id="appointment-cancel-form" class="stack">
                    <label class="field">
                      <span class="label">${escapeHtml(t().print.cancelReason)}</span>
                      <textarea class="textarea ${state.language === "ar" ? "field-ar" : ""}" name="cancelReason">${escapeHtml(state.cancelReason)}</textarea>
                    </label>
                    <div class="form-actions">
                      <button class="button-secondary" type="submit">${escapeHtml(state.appointmentCancelSaving ? t().common.loading : t().print.cancelAppointment)}</button>
                    </div>
                  </form>`
                : `<div class="empty">${escapeHtml(t().print.noAppointment)}</div>`
            }
          </article>
        </div>
      </section>
    </div>
  `;
}

function renderSearchResultsList() {
  if (!state.searchResults.length) {
    return `<div class="empty">${escapeHtml(state.searchLoading ? t().common.loading : t().search.empty)}</div>`;
  }

  return `
    <div class="list">
      ${state.searchResults
        .map(
          (patient) => `
            <div class="item patient-result">
              <div class="item-copy">
                <div class="item-title">${escapeHtml(state.language === "ar" ? patient.arabic_full_name : patient.english_full_name)}</div>
                <div class="item-subtitle">${escapeHtml(patient.national_id || "N/A")} • ${escapeHtml(patient.phone_1 || "N/A")}</div>
              </div>
              <div class="hero-actions">
                <button class="button-secondary" type="button" data-action="select-search-patient" data-patient-id="${escapeHtml(String(patient.id))}">${escapeHtml(t().patientActions.edit)}</button>
                <button class="button-ghost" type="button" data-action="set-merge-source" data-patient-id="${escapeHtml(String(patient.id))}">${escapeHtml(t().patientActions.mergeSource)}</button>
                <button class="button-ghost" type="button" data-action="set-merge-target" data-patient-id="${escapeHtml(String(patient.id))}">${escapeHtml(t().patientActions.mergeTarget)}</button>
              </div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderSearch() {
  return `
    <div class="page">
      ${pageHero(t().search.title, t().search.body, "", t().common.open)}
      ${alertMarkup("error", state.searchError)}
      ${alertMarkup("success", state.patientUpdateSuccess || state.mergeSuccess)}
      <section class="split-grid">
        <div class="stack">
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
            ${renderSearchResultsList()}
          </section>
        </div>

        <div class="stack">
          <section class="surface">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().patientActions.edit)}</h2>
              <span class="chip accent">${escapeHtml(state.searchSelectedPatient ? (state.searchSelectedPatient.mrn || `#${state.searchSelectedPatient.id}`) : t().common.noData)}</span>
            </div>
            ${alertMarkup("error", state.patientUpdateError)}
            ${
              state.searchSelectedPatient
                ? `<form id="patient-edit-form" class="stack">
                    <div class="form-grid">
                      <label class="field">
                        <span class="label">${escapeHtml(t().patients.fields.mrn)}</span>
                        <input class="input field-en" name="mrn" value="${escapeHtml(state.patientEditForm.mrn)}" />
                      </label>
                      <label class="field">
                        <span class="label">${escapeHtml(t().patients.fields.ageYears)}</span>
                        <input class="input field-en" name="ageYears" value="${escapeHtml(state.patientEditForm.ageYears)}" inputmode="numeric" />
                      </label>
                      <label class="field full">
                        <span class="label">${escapeHtml(t().patients.fields.arabicFullName)}</span>
                        <input class="input field-ar" name="arabicFullName" value="${escapeHtml(state.patientEditForm.arabicFullName)}" />
                      </label>
                      <label class="field full">
                        <span class="label">${escapeHtml(t().patients.fields.englishFullName)}</span>
                        <input class="input field-en" name="englishFullName" value="${escapeHtml(state.patientEditForm.englishFullName)}" />
                      </label>
                      <label class="field">
                        <span class="label">${escapeHtml(t().patients.fields.sex)}</span>
                        <select class="select" name="sex">
                          <option value="male" ${state.patientEditForm.sex === "male" ? "selected" : ""}>${escapeHtml(t().common.male)}</option>
                          <option value="female" ${state.patientEditForm.sex === "female" ? "selected" : ""}>${escapeHtml(t().common.female)}</option>
                        </select>
                      </label>
                      <label class="field">
                        <span class="label">${escapeHtml(t().patients.fields.phone1)}</span>
                        <input class="input field-en" name="phone1" value="${escapeHtml(state.patientEditForm.phone1)}" inputmode="numeric" maxlength="10" />
                      </label>
                      <label class="field">
                        <span class="label">${escapeHtml(t().patients.fields.phone2)}</span>
                        <input class="input field-en" name="phone2" value="${escapeHtml(state.patientEditForm.phone2)}" inputmode="numeric" maxlength="10" />
                      </label>
                      <label class="field">
                        <span class="label">${escapeHtml(t().patients.fields.nationalId)}</span>
                        <input class="input field-en" name="nationalId" value="${escapeHtml(state.patientEditForm.nationalId)}" inputmode="numeric" maxlength="11" />
                      </label>
                      <label class="field">
                        <span class="label">${escapeHtml(t().patients.fields.nationalIdConfirmation)}</span>
                        <input class="input field-en" name="nationalIdConfirmation" value="${escapeHtml(state.patientEditForm.nationalIdConfirmation)}" inputmode="numeric" maxlength="11" data-prevent-paste="true" />
                      </label>
                      <label class="field full">
                        <span class="label">${escapeHtml(t().patients.fields.address)}</span>
                        <textarea class="textarea ${state.language === "ar" ? "field-ar" : ""}" name="address">${escapeHtml(state.patientEditForm.address)}</textarea>
                      </label>
                    </div>
                    <div class="form-actions">
                      <button class="button-primary" type="submit">${escapeHtml(state.patientUpdateSaving ? t().common.loading : t().patientActions.saveEdit)}</button>
                    </div>
                  </form>`
	                : `<div class="empty">${escapeHtml(t().common.noData)}</div>`
            }
          </section>

          <section class="surface">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().patientActions.mergeNow)}</h2>
              <span class="chip subtle">${escapeHtml("MERGE")}</span>
            </div>
            ${alertMarkup("error", state.mergeError)}
            <div class="info-grid">
              ${infoTile(t().patientActions.mergeSource, state.mergeSourcePatient ? (state.language === "ar" ? state.mergeSourcePatient.arabic_full_name : state.mergeSourcePatient.english_full_name) : "—", "tone-warm")}
              ${infoTile(t().patientActions.mergeTarget, state.mergeTargetPatient ? (state.language === "ar" ? state.mergeTargetPatient.arabic_full_name : state.mergeTargetPatient.english_full_name) : "—", "tone-good")}
            </div>
            <form id="patient-merge-form" class="stack">
              <label class="field">
                <span class="label">${escapeHtml(t().patientActions.mergeHint)}</span>
                <input class="input field-en" name="mergeConfirmationText" value="${escapeHtml(state.mergeConfirmationText)}" autocomplete="off" />
              </label>
              <div class="form-actions">
                <button class="button-secondary" type="submit">${escapeHtml(state.mergeSaving ? t().common.loading : t().patientActions.mergeNow)}</button>
              </div>
            </form>
          </section>
        </div>
      </section>
    </div>
  `;
}

function renderUsersList() {
  if (state.usersLoading) {
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

function renderSettingsCatalog() {
  if (state.settingsLoading && Object.keys(state.settingsCatalog).length === 0) {
    return `<div class="empty">${escapeHtml(t().common.loading)}</div>`;
  }

  const categories = Object.keys(state.settingsCatalog);

  if (!categories.length) {
    return `<div class="empty">${escapeHtml(t().common.noData)}</div>`;
  }

  return `
    <div class="settings-catalog">
      ${categories
        .map((category) => {
          const entries = state.settingsCatalog[category] || [];
          const title = getSettingsCategoryTitle(category);
          const summary = getSettingsCategorySummary(category);
          const isSaving = state.settingsSavingCategory === category;

          return `
            <article class="surface settings-category">
              <form class="stack" data-settings-form="${escapeHtml(category)}">
                <div class="section-head">
                  <div>
                    <h2 class="section-title">${escapeHtml(title)}</h2>
                    ${summary ? `<div class="settings-summary">${escapeHtml(summary)}</div>` : ""}
                  </div>
                  <span class="chip accent">${escapeHtml(String(entries.length))}</span>
                </div>

                <div class="settings-rows">
                  ${entries
                    .map(
                      (entry) => `
                        <label class="field">
                          <span class="label">${escapeHtml(getSettingsFieldLabel(category, entry.setting_key))}</span>
                          <input
                            class="input ${String(getSettingsFieldValue(entry)).match(/^\d|:|[a-z_,-]+$/i) ? "field-en" : ""}"
                            data-setting-field="true"
                            data-setting-category="${escapeHtml(category)}"
                            data-setting-key="${escapeHtml(entry.setting_key)}"
                            value="${escapeHtml(getSettingsFieldValue(entry))}"
                            autocomplete="off"
                          />
                        </label>
                      `
                    )
                    .join("")}
                </div>

                <div class="form-actions">
                  <button class="button-primary" type="submit">
                    ${escapeHtml(isSaving ? t().common.loading : t().settings.saveCategory)}
                  </button>
                </div>
              </form>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderAuditList() {
  if (state.auditLoading) {
    return `<div class="empty">${escapeHtml(t().common.loading)}</div>`;
  }

  if (!state.auditEntries.length) {
    return `<div class="empty">${escapeHtml(t().common.noData)}</div>`;
  }

  return `
    <div class="list">
      ${state.auditEntries
        .map(
          (entry) => `
            <div class="item">
              <div class="item-copy">
                <div class="item-title">${escapeHtml(formatAuditActionType(entry.action_type))} • ${escapeHtml(
                  formatAuditEntityType(entry.entity_type)
                )}</div>
                <div class="item-subtitle">${escapeHtml(entry.changed_by_name || entry.changed_by_username || "System")} • ${escapeHtml(
                  formatDisplayDateTime(entry.created_at)
                )}</div>
              </div>
              <div class="badge-row">
                <span class="chip subtle">${escapeHtml(String(entry.entity_id ?? "—"))}</span>
                <span class="chip accent">${escapeHtml(entry.changed_by_username || "system")}</span>
              </div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderAuditFilters() {
  const allLabel = state.language === "ar" ? "الكل" : "All";

  return `
    <form id="audit-filter-form" class="stack">
      <div class="form-grid">
        <label class="field">
          <span class="label">${escapeHtml(t().settings.fields.entityType)}</span>
          <select class="select" name="entityType" data-audit-filter="true">
            <option value="">${escapeHtml(allLabel)}</option>
            ${state.auditMeta.entityTypes
              .map(
                (entityType) => `<option value="${escapeHtml(entityType)}" ${
                  state.auditFilters.entityType === entityType ? "selected" : ""
                }>${escapeHtml(formatAuditEntityType(entityType))}</option>`
              )
              .join("")}
          </select>
        </label>

        <label class="field">
          <span class="label">${escapeHtml(t().settings.fields.actionType)}</span>
          <select class="select" name="actionType" data-audit-filter="true">
            <option value="">${escapeHtml(allLabel)}</option>
            ${state.auditMeta.actionTypes
              .map(
                (actionType) => `<option value="${escapeHtml(actionType)}" ${
                  state.auditFilters.actionType === actionType ? "selected" : ""
                }>${escapeHtml(formatAuditActionType(actionType))}</option>`
              )
              .join("")}
          </select>
        </label>

        <label class="field">
          <span class="label">${escapeHtml(t().settings.fields.changedBy)}</span>
          <select class="select" name="changedByUserId" data-audit-filter="true">
            <option value="">${escapeHtml(allLabel)}</option>
            ${state.auditMeta.users
              .map((user) => {
                const label = user.full_name ? `${user.full_name} (${user.username})` : user.username;
                return `<option value="${escapeHtml(String(user.id))}" ${
                  String(state.auditFilters.changedByUserId) === String(user.id) ? "selected" : ""
                }>${escapeHtml(label)}</option>`;
              })
              .join("")}
          </select>
        </label>

        <label class="field">
          <span class="label">${escapeHtml(t().settings.fields.dateFrom)}</span>
          <input class="input field-en" type="date" name="dateFrom" data-audit-filter="true" value="${escapeHtml(state.auditFilters.dateFrom)}" />
        </label>

        <label class="field">
          <span class="label">${escapeHtml(t().settings.fields.dateTo)}</span>
          <input class="input field-en" type="date" name="dateTo" data-audit-filter="true" value="${escapeHtml(state.auditFilters.dateTo)}" />
        </label>
      </div>

      <div class="form-actions">
        <button class="button-secondary" type="submit">${escapeHtml(t().settings.refreshAudit)}</button>
        <button class="button-ghost" type="button" data-action="clear-audit-filters">${escapeHtml(t().settings.clearAudit)}</button>
        <button class="button-primary" type="button" data-action="export-audit">${escapeHtml(
          state.auditExportLoading ? t().common.loading : t().settings.exportAudit
        )}</button>
      </div>
    </form>
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

  if (!hasRecentSupervisorReauth()) {
    return `
      <div class="page">
        ${pageHero(t().settings.title, t().settings.body, "", t().settings.reauthNeeded)}
        <section class="surface">
          <div class="section-head">
            <h2 class="section-title">${escapeHtml(t().settings.reauthTitle)}</h2>
            <span class="chip accent">${escapeHtml(t().common.required)}</span>
          </div>
          <p class="settings-summary">${escapeHtml(t().settings.reauthBody)}</p>
          ${alertMarkup("error", state.reauthError)}
          <form id="reauth-form" class="stack">
            <label class="field">
              <span class="label">${escapeHtml(t().settings.fields.password)}</span>
              <input class="input field-en" type="password" name="reauthPassword" value="${escapeHtml(state.reauthPassword)}" autocomplete="current-password" />
            </label>
            <div class="form-actions">
              <button class="button-primary" type="submit">${escapeHtml(state.reauthLoading ? t().common.loading : t().settings.reauthButton)}</button>
            </div>
          </form>
        </section>
      </div>
    `;
  }

  return `
    <div class="page">
      ${pageHero(
        t().settings.title,
        t().settings.body,
        `<button class="button-secondary" type="button" data-action="refresh-settings">${escapeHtml(t().settings.refreshAll)}</button>`,
        t().common.required
      )}
      ${alertMarkup("error", state.settingsError || state.userError)}
      ${alertMarkup("success", state.settingsSuccess || state.userSuccess)}

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
                  <option value="modality_staff" ${state.userForm.role === "modality_staff" ? "selected" : ""}>${escapeHtml(formatRole("modality_staff"))}</option>
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

      <section class="surface">
        <div class="section-head">
          <h2 class="section-title">${escapeHtml(t().settings.categories)}</h2>
          <span class="chip subtle">${escapeHtml(`${Object.keys(state.settingsCatalog).length} categories`)}</span>
        </div>
        ${renderSettingsCatalog()}
      </section>

      <section class="surface">
        <div class="section-head">
          <h2 class="section-title">${escapeHtml(t().settings.auditTitle)}</h2>
          <span class="chip subtle">${escapeHtml(`${t().settings.auditRows}: ${state.auditEntries.length}`)}</span>
        </div>
        ${alertMarkup("error", state.auditError)}
        ${renderAuditFilters()}
        ${renderAuditList()}
      </section>

      <section class="surface">
        <div class="section-head">
          <h2 class="section-title">${escapeHtml(t().settings.backupTitle)}</h2>
          <span class="chip accent">${escapeHtml(t().common.required)}</span>
        </div>
        ${alertMarkup("error", state.backupError || state.restoreError)}
        ${alertMarkup("success", state.backupSuccess || state.restoreSuccess)}
        <div class="split-grid">
          <article class="surface surface-compact">
            <div class="stack">
              <h3 class="section-title">${escapeHtml(t().settings.downloadBackup)}</h3>
              <div class="form-actions">
                <button class="button-primary" type="button" data-action="download-backup">${escapeHtml(state.backupLoading ? t().common.loading : t().settings.downloadBackup)}</button>
              </div>
            </div>
          </article>
          <article class="surface surface-compact">
            <form id="restore-form" class="stack">
              <h3 class="section-title">${escapeHtml(t().settings.restoreBackup)}</h3>
              <label class="field">
                <span class="label">${escapeHtml(t().settings.restoreFile)}</span>
                <input class="input" type="file" name="restoreFile" data-restore-file="true" />
              </label>
              <div class="small">${escapeHtml(state.restoreFileName || t().print.fileNone)}</div>
              <div class="form-actions">
                <button class="button-secondary" type="submit">${escapeHtml(state.restoreLoading ? t().common.loading : t().settings.restoreBackup)}</button>
              </div>
            </form>
          </article>
        </div>
      </section>
    </div>
  `;
}

function renderPage() {
  switch (state.route) {
    case "patients":
      return renderPatients();
    case "appointments":
      return renderAppointments();
    case "queue":
      return renderQueue();
    case "modality":
      return renderModality();
    case "print":
      return renderPrint();
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

  if (target.closest("#reauth-form")) {
    state.reauthPassword = target.value;
    return;
  }

  if (target.closest("#audit-filter-form")) {
    state.auditFilters[target.name] = target.value;
    return;
  }

  if (target.closest("#patient-form")) {
    if (target.name === "nationalId" || target.name === "nationalIdConfirmation") {
      target.value = keepDigits(target.value, 11);
    }

    if (target.name === "phone1" || target.name === "phone2") {
      target.value = keepDigits(target.value, 10);
    }

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

  if (target.closest("#patient-edit-form")) {
    if (target.name === "nationalId" || target.name === "nationalIdConfirmation") {
      target.value = keepDigits(target.value, 11);
    }

    if (target.name === "phone1" || target.name === "phone2") {
      target.value = keepDigits(target.value, 10);
    }

    state.patientEditForm[target.name] = target.value;
    return;
  }

  if (target.closest("#appointment-patient-search-form")) {
    state.appointmentPatientQuery = target.value;
    return;
  }

  if (target.closest("#queue-scan-form")) {
    state.queueScanValue = target.value;
    return;
  }

  if (target.closest("#queue-patient-search-form")) {
    state.queueWalkInQuery = target.value;
    return;
  }

  if (target.closest("#print-filter-form")) {
    state.printFilters[target.name] = target.value;
    return;
  }

  if (target.closest("#modality-filter-form")) {
    state.modalityFilters[target.name] = target.value;
    return;
  }

  if (target.closest("#patient-merge-form")) {
    state.mergeConfirmationText = target.value;
    return;
  }

  if (target.closest("#appointment-form")) {
    if (target instanceof HTMLInputElement && target.type === "checkbox") {
      state.appointmentForm[target.name] = target.checked;
    } else {
      state.appointmentForm[target.name] = target.value;
    }

    if (target.name === "modalityId") {
      state.appointmentForm.examTypeId = "";
      state.appointmentForm.appointmentDate = "";
      state.appointmentForm.overbookingReason = "";
      state.examTypeForm.modalityId = target.value;
      void loadAppointmentAvailability();
    }

    return;
  }

  if (target.closest("#appointment-edit-form")) {
    state.appointmentEditForm[target.name] = target.value;

    if (target.name === "modalityId") {
      state.appointmentEditForm.examTypeId = "";
    }

    return;
  }

  if (target.closest("#queue-walk-in-form")) {
    state.queueWalkInForm[target.name] = target.value;

    if (target.name === "modalityId") {
      state.queueWalkInForm.examTypeId = "";
    }

    return;
  }

  if (target.closest("#appointment-cancel-form")) {
    state.cancelReason = target.value;
    return;
  }

  if (target.closest("#document-upload-form")) {
    if (target instanceof HTMLInputElement && target.type === "file") {
      void readUploadFile(target.files?.[0] || null);
      return;
    }

    state.uploadForm[target.name] = target.value;
    return;
  }

  if (target.closest("#restore-form")) {
    if (target instanceof HTMLInputElement && target.type === "file") {
      void readRestoreFile(target.files?.[0] || null);
    }
    return;
  }

  if (target.hasAttribute("data-user-field")) {
    state.userForm[target.name] = target.value;
    return;
  }

  if (target.hasAttribute("data-exam-type-field")) {
    state.examTypeForm[target.name] = target.value;
    return;
  }

  if (target.hasAttribute("data-setting-field")) {
    const category = target.dataset.settingCategory;
    const key = target.dataset.settingKey;

    state.settingsSuccess = "";

    if (!category || !key || !state.settingsCatalog[category]) {
      return;
    }

    state.settingsCatalog[category] = state.settingsCatalog[category].map((entry) =>
      entry.setting_key === key
        ? {
            ...entry,
            setting_value: {
              ...(entry.setting_value || {}),
              value: target.value
            }
          }
        : entry
    );
    return;
  }

  if (target.hasAttribute("data-no-show-reason")) {
    const appointmentId = target.dataset.appointmentId;

    if (appointmentId) {
      state.noShowReasons[appointmentId] = target.value;
    }
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

  if (target.dataset.action === "select-appointment-patient") {
    event.preventDefault();
    const patientId = target.dataset.patientId;
    state.selectedAppointmentPatient = state.appointmentPatientResults.find(
      (patient) => String(patient.id) === String(patientId)
    ) || null;
    state.appointmentError = "";
    render();
    return;
  }

  if (target.dataset.action === "select-search-patient") {
    event.preventDefault();
    const patientId = target.dataset.patientId;
    state.searchSelectedPatient = state.searchResults.find((patient) => String(patient.id) === String(patientId)) || null;
    state.patientUpdateError = "";
    state.patientUpdateSuccess = "";
    if (state.searchSelectedPatient) {
      fillPatientEditForm(state.searchSelectedPatient);
    }
    render();
    return;
  }

  if (target.dataset.action === "set-merge-source") {
    event.preventDefault();
    state.mergeSourcePatient = state.searchResults.find((patient) => String(patient.id) === String(target.dataset.patientId)) || null;
    state.mergeError = "";
    render();
    return;
  }

  if (target.dataset.action === "set-merge-target") {
    event.preventDefault();
    state.mergeTargetPatient = state.searchResults.find((patient) => String(patient.id) === String(target.dataset.patientId)) || null;
    state.mergeError = "";
    render();
    return;
  }

  if (target.dataset.action === "complete-appointment") {
    event.preventDefault();
    void completeModalityAppointment(target.dataset.appointmentId);
    return;
  }

  if (target.dataset.action === "select-appointment-day") {
    event.preventDefault();
    state.appointmentForm.appointmentDate = target.dataset.date || "";
    state.appointmentError = "";
    render();
    return;
  }

  if (target.dataset.action === "open-exam-type-modal") {
    event.preventDefault();
    state.examTypeModalOpen = true;
    state.examTypeError = "";
    state.examTypeSuccess = "";
    state.examTypeForm = {
      ...defaultExamTypeForm(),
      modalityId: state.appointmentForm.modalityId
    };
    render();
    return;
  }

  if (target.dataset.action === "close-exam-type-modal") {
    event.preventDefault();
    state.examTypeModalOpen = false;
    state.examTypeError = "";
    render();
    return;
  }

  if (target.dataset.action === "select-queue-patient") {
    event.preventDefault();
    const patientId = target.dataset.patientId;
    state.queueSelectedPatient = state.queueWalkInResults.find((patient) => String(patient.id) === String(patientId)) || null;
    state.queueError = "";
    render();
    return;
  }

  if (target.dataset.action === "select-print-appointment") {
    event.preventDefault();
    const appointmentId = target.dataset.appointmentId;
    state.selectedPrintAppointment = state.printResults.find(
      (appointment) => String(appointment.id) === String(appointmentId)
    ) || null;
    state.printError = "";
    state.uploadError = "";
    state.integrationError = "";
    state.integrationSuccess = "";
    state.appointmentEditError = "";
    state.appointmentEditSuccess = "";
    state.cancelReason = "";
    if (state.selectedPrintAppointment) {
      fillAppointmentEditForm(state.selectedPrintAppointment);
    }
    void loadAppointmentDocuments(appointmentId);
    render();
    return;
  }

  if (target.dataset.action === "confirm-no-show") {
    event.preventDefault();
    void confirmQueueNoShow(target.dataset.appointmentId);
    return;
  }

  if (target.dataset.action === "refresh-users") {
    event.preventDefault();
    void loadUsers();
    return;
  }

  if (target.dataset.action === "refresh-settings") {
    event.preventDefault();
    void Promise.all([loadUsers(), loadSettings(), loadAuditEntries()]);
    return;
  }

  if (target.dataset.action === "refresh-queue") {
    event.preventDefault();
    void loadQueueSnapshot();
    return;
  }

  if (target.dataset.action === "refresh-modality") {
    event.preventDefault();
    void loadModalityWorklist();
    return;
  }

  if (target.dataset.action === "browser-print") {
    event.preventDefault();
    window.print();
    return;
  }

  if (target.dataset.action === "prepare-slip-print") {
    event.preventDefault();
    void preparePrintOutput("slip");
    return;
  }

  if (target.dataset.action === "prepare-label-print") {
    event.preventDefault();
    void preparePrintOutput("label");
    return;
  }

  if (target.dataset.action === "prepare-scan-session") {
    event.preventDefault();
    void prepareScanSession();
    return;
  }

  if (target.dataset.action === "download-backup") {
    event.preventDefault();
    void downloadBackup();
    return;
  }

  if (target.dataset.action === "refresh-audit") {
    event.preventDefault();
    void loadAuditEntries();
    return;
  }

  if (target.dataset.action === "clear-audit-filters") {
    event.preventDefault();
    state.auditFilters = defaultAuditFilters();
    void loadAuditEntries();
    return;
  }

  if (target.dataset.action === "export-audit") {
    event.preventDefault();
    void downloadAuditExport();
  }
}

function handlePaste(event) {
  const target = event.target;

  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    return;
  }

  if (
    (target.closest("#patient-form") || target.closest("#patient-edit-form")) &&
    target.name === "nationalIdConfirmation"
  ) {
    event.preventDefault();
  }
}

async function readUploadFile(file) {
  if (!file) {
    state.uploadForm = defaultUploadForm();
    render();
    return;
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }

  state.uploadForm = {
    ...state.uploadForm,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    fileSize: file.size,
    fileContentBase64: btoa(binary)
  };
  state.uploadError = "";
  render();
}

async function readRestoreFile(file) {
  if (!file) {
    state.restoreFileName = "";
    state.restorePayloadText = "";
    render();
    return;
  }

  state.restoreFileName = file.name;
  state.restorePayloadText = await file.text();
  state.restoreError = "";
  render();
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

  if (event.target.id === "reauth-form") {
    event.preventDefault();
    void submitSupervisorReauth();
    return;
  }

  if (event.target.id === "patient-search-form") {
    event.preventDefault();
    void searchPatients();
    return;
  }

  if (event.target.id === "patient-edit-form") {
    event.preventDefault();
    void updateSelectedPatient();
    return;
  }

  if (event.target.id === "patient-merge-form") {
    event.preventDefault();
    void mergeSelectedPatients();
    return;
  }

  if (event.target.id === "appointment-patient-search-form") {
    event.preventDefault();
    void searchAppointmentPatients();
    return;
  }

  if (event.target.id === "appointment-form") {
    event.preventDefault();
    void saveAppointment();
    return;
  }

  if (event.target.id === "queue-scan-form") {
    event.preventDefault();
    void scanQueueAccession();
    return;
  }

  if (event.target.id === "queue-patient-search-form") {
    event.preventDefault();
    void searchQueuePatients();
    return;
  }

  if (event.target.id === "queue-walk-in-form") {
    event.preventDefault();
    void saveWalkInQueueEntry();
    return;
  }

  if (event.target.id === "print-filter-form") {
    event.preventDefault();
    void loadPrintAppointments();
    return;
  }

  if (event.target.id === "modality-filter-form") {
    event.preventDefault();
    void loadModalityWorklist();
    return;
  }

  if (event.target.id === "appointment-edit-form") {
    event.preventDefault();
    void updateSelectedAppointment();
    return;
  }

  if (event.target.id === "appointment-cancel-form") {
    event.preventDefault();
    void cancelSelectedAppointment();
    return;
  }

  if (event.target.id === "document-upload-form") {
    event.preventDefault();
    void uploadAppointmentDocument();
    return;
  }

  if (event.target.id === "restore-form") {
    event.preventDefault();
    void restoreBackup();
    return;
  }

  if (event.target.id === "exam-type-form") {
    event.preventDefault();
    void createExamType();
    return;
  }

  if (event.target.id === "user-form") {
    event.preventDefault();
    void createUser();
    return;
  }

  if (event.target.id === "audit-filter-form") {
    event.preventDefault();
    void loadAuditEntries();
    return;
  }

  if (event.target.dataset.settingsForm) {
    event.preventDefault();
    void saveSettingsCategory(event.target.dataset.settingsForm);
  }
}

document.addEventListener("input", handleInput);
document.addEventListener("change", handleInput);
document.addEventListener("click", handleClick);
document.addEventListener("paste", handlePaste);
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
