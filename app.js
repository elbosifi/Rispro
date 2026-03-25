const state = {
  language: localStorage.getItem("rispro-language") || "ar",
  route: localStorage.getItem("rispro-route") || "dashboard",
  loggedIn: localStorage.getItem("rispro-logged-in") === "true"
};

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

const data = {
  stats: { total: 34, arrived: 19, waiting: 8, noShow: 3 },
  modalities: [
    { code: "MRI", ar: "الرنين", en: "MRI", booked: 7, capacity: 10, color: "var(--teal)" },
    { code: "CT", ar: "الطبقي", en: "CT", booked: 11, capacity: 14, color: "var(--amber)" },
    { code: "US", ar: "الألتراساوند", en: "Ultrasound", booked: 9, capacity: 18, color: "var(--blue)" },
    { code: "XR", ar: "الأشعة", en: "X-Ray", booked: 16, capacity: 26, color: "#7c3aed" }
  ],
  queue: [
    {
      accession: "ACC-20260325-00142",
      patientAr: "محمد علي السنوسي",
      patientEn: "Mohammad Ali Al-Senussi",
      modality: "MRI",
      status: "waiting",
      priority: "urgent"
    },
    {
      accession: "ACC-20260325-00143",
      patientAr: "فاطمة سالم العبيدي",
      patientEn: "Fatima Salem Al-Obaidi",
      modality: "CT",
      status: "arrived",
      priority: "routine"
    },
    {
      accession: "ACC-20260325-00144",
      patientAr: "يوسف رجب القماطي",
      patientEn: "Yousef Rajab Al-Gamati",
      modality: "US",
      status: "no_show",
      priority: "stat"
    }
  ],
  calendar: [
    { en: "25 Mar", ar: "25 مارس", remaining: 3, booked: 7 },
    { en: "26 Mar", ar: "26 مارس", remaining: 5, booked: 5 },
    { en: "27 Mar", ar: "27 مارس", remaining: 0, booked: 10, active: true },
    { en: "28 Mar", ar: "28 مارس", remaining: 4, booked: 6 },
    { en: "29 Mar", ar: "29 مارس", remaining: 8, booked: 2 },
    { en: "30 Mar", ar: "30 مارس", remaining: 1, booked: 9 },
    { en: "31 Mar", ar: "31 مارس", remaining: 6, booked: 4 }
  ],
  settings: [
    { key: "modalities", count: 4, itemsAr: ["الرنين 10 يومياً", "الطبقي 14 يومياً"], itemsEn: ["MRI 10 per day", "CT 14 per day"] },
    { key: "examTypes", count: 23, itemsAr: ["دماغ بدون صبغة", "بطن وحوض"], itemsEn: ["Brain without contrast", "Abdomen and pelvis"] },
    { key: "dictionary", count: 148, itemsAr: ["محمد -> Mohammad", "أحمد -> Ahmed"], itemsEn: ["Mohammad -> Mohammad", "Ahmed -> Ahmed"] },
    { key: "fields", count: 9, itemsAr: ["الهاتف 1 إلزامي", "الرقم الوطني اختياري"], itemsEn: ["Phone 1 required", "National ID optional"] },
    { key: "priorities", count: 3, itemsAr: ["روتيني", "مستعجل", "عاجل جداً"], itemsEn: ["Routine", "Urgent", "STAT"] },
    { key: "users", count: 4, itemsAr: ["Seraj - مشرف", "Aisha - موظف استقبال"], itemsEn: ["Seraj - Supervisor", "Aisha - Receptionist"] }
  ],
  settingsCatalog: [
    {
      titleAr: "إعدادات عامة",
      titleEn: "General system",
      summaryAr: "الأساسيات العامة التي تحدد سلوك النظام عند بدء العمل اليومي.",
      summaryEn: "Core defaults that shape daily system behavior from the moment staff sign in.",
      items: [
        { labelAr: "اسم الموقع", labelEn: "Site name", valueAr: "RISpro Reception", valueEn: "RISpro Reception" },
        { labelAr: "الصفحة الافتراضية بعد الدخول", labelEn: "Default page after login", valueAr: "الرئيسية", valueEn: "Dashboard" },
        { labelAr: "بداية يوم العمل", labelEn: "Business day starts", valueAr: "07:00", valueEn: "07:00" },
        { labelAr: "المنطقة الزمنية", labelEn: "Time zone", valueAr: "Africa/Tripoli", valueEn: "Africa/Tripoli" }
      ]
    },
    {
      titleAr: "المستخدمون والصلاحيات",
      titleEn: "Users and roles",
      summaryAr: "التحكم في المشرفين وموظفي الاستقبال وصلاحياتهم التشغيلية.",
      summaryEn: "Manage supervisors, receptionists, and operational permissions.",
      items: [
        { labelAr: "الأدوار المتاحة", labelEn: "Available roles", valueAr: "مشرف، استقبال", valueEn: "Supervisor, Receptionist" },
        { labelAr: "إضافة مستخدم جديد", labelEn: "Add new user", valueAr: "مفعل", valueEn: "Enabled" },
        { labelAr: "صلاحية تجاوز السعة", labelEn: "Overbooking permission", valueAr: "للمشرف فقط", valueEn: "Supervisor only" },
        { labelAr: "المستخدمون النشطون", labelEn: "Active users", valueAr: "4", valueEn: "4" }
      ]
    },
    {
      titleAr: "الأمان والوصول",
      titleEn: "Security and access",
      summaryAr: "خيارات الحماية والدخول والجلسات والتحقق الإضافي.",
      summaryEn: "Authentication, sessions, re-authentication, and system protection behavior.",
      items: [
        { labelAr: "إعادة التحقق قبل الإعدادات", labelEn: "Re-auth before settings", valueAr: "مفعل", valueEn: "Enabled" },
        { labelAr: "سياسة كلمة المرور", labelEn: "Password policy", valueAr: "قوية", valueEn: "Strong" },
        { labelAr: "مدة الجلسة", labelEn: "Session timeout", valueAr: "30 دقيقة", valueEn: "30 minutes" },
        { labelAr: "سجل محاولات الدخول", labelEn: "Login attempt log", valueAr: "مفعل", valueEn: "Enabled" }
      ]
    },
    {
      titleAr: "اللغة والواجهة",
      titleEn: "Language and interface",
      summaryAr: "كل ما يتعلق بالعربية والإنجليزية واتجاه الواجهة والعرض العام.",
      summaryEn: "Arabic/English switching, directionality, and overall interface behavior.",
      items: [
        { labelAr: "اللغة الافتراضية", labelEn: "Default language", valueAr: "العربية", valueEn: "Arabic" },
        { labelAr: "التبديل من القائمة", labelEn: "Language menu switch", valueAr: "مفعل", valueEn: "Enabled" },
        { labelAr: "اتجاه العربية", labelEn: "Arabic direction", valueAr: "RTL", valueEn: "RTL" },
        { labelAr: "اتجاه الإنجليزية", labelEn: "English direction", valueAr: "LTR", valueEn: "LTR" }
      ]
    },
    {
      titleAr: "تسجيل المرضى",
      titleEn: "Patient registration",
      summaryAr: "قواعد حقول التسجيل والحقول الإلزامية والحقول المخصصة.",
      summaryEn: "Control registration fields, required rules, and custom patient data.",
      items: [
        { labelAr: "الهاتف 1", labelEn: "Phone 1", valueAr: "إلزامي", valueEn: "Required" },
        { labelAr: "تاريخ الميلاد أو العمر", labelEn: "DOB or age", valueAr: "أحدهما إلزامي", valueEn: "One is required" },
        { labelAr: "الرقم الوطني", labelEn: "National ID", valueAr: "اختياري", valueEn: "Optional" },
        { labelAr: "الحقول المخصصة", labelEn: "Custom fields", valueAr: "مفعلة", valueEn: "Enabled" }
      ]
    },
    {
      titleAr: "التحويل وقاموس الأسماء",
      titleEn: "Transliteration and dictionary",
      summaryAr: "إعدادات تحويل الاسم من العربية إلى الإنجليزية والقاموس المخصص.",
      summaryEn: "Control live Arabic-to-English transliteration and the custom name dictionary.",
      items: [
        { labelAr: "التحويل المباشر", labelEn: "Live transliteration", valueAr: "مفعل", valueEn: "Enabled" },
        { labelAr: "أولوية القاموس", labelEn: "Dictionary priority", valueAr: "قبل القواعد العامة", valueEn: "Before general rules" },
        { labelAr: "السماح بالتعديل اليدوي", labelEn: "Manual edit allowed", valueAr: "نعم", valueEn: "Yes" },
        { labelAr: "عناصر القاموس", labelEn: "Dictionary entries", valueAr: "148", valueEn: "148" }
      ]
    },
    {
      titleAr: "الأجهزة والفحوصات",
      titleEn: "Modalities and exams",
      summaryAr: "إدارة الأجهزة وأنواع الفحوصات وتعليمات كل جهاز أو فحص.",
      summaryEn: "Manage modalities, exam types, and modality/exam instructions.",
      items: [
        { labelAr: "الأجهزة", labelEn: "Modalities", valueAr: "4 أجهزة", valueEn: "4 modalities" },
        { labelAr: "إضافة نوع فحص من الموعد", labelEn: "Add exam from appointment", valueAr: "مسموح", valueEn: "Allowed" },
        { labelAr: "تعليمات عامة حسب الجهاز", labelEn: "Modality instructions", valueAr: "مفعلة", valueEn: "Enabled" },
        { labelAr: "تعليمات خاصة حسب الفحص", labelEn: "Exam-specific instructions", valueAr: "مفعلة", valueEn: "Enabled" }
      ]
    },
    {
      titleAr: "الجدولة والسعة",
      titleEn: "Scheduling and capacity",
      summaryAr: "سلوك الحجز، التقويم، السعة اليومية، ومنع الحجز المكرر.",
      summaryEn: "Booking logic, daily modality capacity, calendar flow, and double-booking prevention.",
      items: [
        { labelAr: "السعة اليومية", labelEn: "Daily capacity", valueAr: "حسب الجهاز", valueEn: "Per modality" },
        { labelAr: "التقويم المعروض", labelEn: "Calendar window", valueAr: "14 يوماً + تاريخ أبعد", valueEn: "14 days + later date" },
        { labelAr: "منع التكرار", labelEn: "Double booking prevention", valueAr: "مفعل", valueEn: "Enabled" },
        { labelAr: "فوق السعة", labelEn: "Overbooking", valueAr: "للمشرف فقط", valueEn: "Supervisor only" }
      ]
    },
    {
      titleAr: "الطابور والوصول",
      titleEn: "Queue and arrival",
      summaryAr: "سلوك الوصول بالباركود وترتيب الطابور وتتبع عدم الحضور.",
      summaryEn: "Barcode arrival behavior, queue rules, and no-show visibility.",
      items: [
        { labelAr: "الدخول بالباركود", labelEn: "Barcode check-in", valueAr: "مفعل", valueEn: "Enabled" },
        { labelAr: "ترتيب الطابور", labelEn: "Queue order", valueAr: "بحسب وقت الوصول", valueEn: "By arrival time" },
        { labelAr: "إظهار عدم الحضور السابق", labelEn: "Show previous no-shows", valueAr: "نعم", valueEn: "Yes" },
        { labelAr: "تحويل الوصول للطابور", labelEn: "Arrival to queue transition", valueAr: "تلقائي", valueEn: "Automatic" }
      ]
    },
    {
      titleAr: "الطباعة والملصقات",
      titleEn: "Printing and labels",
      summaryAr: "وصل الموعد والملصقات اليومية وتعليمات الطباعة والباركود.",
      summaryEn: "Appointment slips, labels, print outputs, and barcode behavior.",
      items: [
        { labelAr: "وصل الموعد", labelEn: "Appointment slip", valueAr: "مفعل", valueEn: "Enabled" },
        { labelAr: "ملصق المريض", labelEn: "Patient label", valueAr: "مفعل", valueEn: "Enabled" },
        { labelAr: "محتوى الباركود", labelEn: "Barcode content", valueAr: "رقم الدخول", valueEn: "Accession number" },
        { labelAr: "تعليمات التحضير في الوصل", labelEn: "Print instructions on slip", valueAr: "نعم", valueEn: "Yes" }
      ]
    },
    {
      titleAr: "الوثائق والرفع",
      titleEn: "Documents and uploads",
      summaryAr: "إعدادات حفظ طلب الفحص ورفع الوثائق وربطها بالمريض والموعد.",
      summaryEn: "Document upload rules for referrals and patient-linked appointment files.",
      items: [
        { labelAr: "رفع طلب الفحص", labelEn: "Upload referral request", valueAr: "مفعل", valueEn: "Enabled" },
        { labelAr: "الأنواع المقبولة", labelEn: "Allowed file types", valueAr: "PDF, JPG, PNG", valueEn: "PDF, JPG, PNG" },
        { labelAr: "الربط", labelEn: "Linking", valueAr: "مريض + موعد", valueEn: "Patient + appointment" },
        { labelAr: "الحفظ في الخادم", labelEn: "Store on server", valueAr: "نعم", valueEn: "Yes" }
      ]
    },
    {
      titleAr: "الرئيسية والواجهة",
      titleEn: "Dashboard and UI",
      summaryAr: "ما يظهر في الشاشة الرئيسية والألوان والاختصارات والتنبيهات البصرية.",
      summaryEn: "Control dashboard cards, colors, quick actions, and visible operational widgets.",
      items: [
        { labelAr: "بطاقات الرئيسية", labelEn: "Dashboard cards", valueAr: "مفعلة", valueEn: "Enabled" },
        { labelAr: "ترميز لوني للحالات", labelEn: "Status color coding", valueAr: "مفعل", valueEn: "Enabled" },
        { labelAr: "اختصارات سريعة", labelEn: "Quick actions", valueAr: "مفعلة", valueEn: "Enabled" },
        { labelAr: "لوحة الشواغر", labelEn: "Capacity board", valueAr: "مفعلة", valueEn: "Enabled" }
      ]
    },
    {
      titleAr: "السجل والتدقيق",
      titleEn: "Audit and logging",
      summaryAr: "تتبع كل التغييرات الحساسة وتاريخ من قام بها ومتى.",
      summaryEn: "Track sensitive changes, user actions, and important system events.",
      items: [
        { labelAr: "سجل التدقيق", labelEn: "Audit trail", valueAr: "مفعل", valueEn: "Enabled" },
        { labelAr: "تغييرات الإعدادات", labelEn: "Settings change log", valueAr: "مفعل", valueEn: "Enabled" },
        { labelAr: "سجل عدم الحضور", labelEn: "No-show history", valueAr: "محفوظ", valueEn: "Stored" },
        { labelAr: "سجل الدخول", labelEn: "Login history", valueAr: "مفعل", valueEn: "Enabled" }
      ]
    }
  ],
  timeline: [
    {
      time: "08:20",
      ar: "تم تسجيل مريض جديد في استقبال الرنين",
      en: "A new patient was registered at the MRI desk",
      status: "scheduled"
    },
    {
      time: "09:05",
      ar: "تم مسح باركود موعد طبقي ووصل المريض",
      en: "A CT barcode was scanned and the patient arrived",
      status: "arrived"
    },
    {
      time: "10:15",
      ar: "تم وضع علامة عدم حضور لموعد ألتراساوند",
      en: "An ultrasound appointment was marked as no-show",
      status: "no_show"
    }
  ]
};

const copy = {
  en: {
    appName: "RISpro Reception",
    appSubtitle: "Diagnostic radiology front desk",
    topTitle: "Reception operations",
    topSubtitle: "Beautiful bilingual prototype with color-coded workflow pages for daily reception work.",
    userRole: "Reception Supervisor",
    nav: {
      dashboard: "Dashboard",
      patients: "Patient Registration",
      appointments: "Appointments",
      queue: "Queue",
      search: "Search",
      print: "Daily Print",
      settings: "Settings"
    },
    dashboard: {
      title: "Reception dashboard",
      body: "A calm home page that helps the team see today’s volume, slot pressure, queue flow, and missed appointments in one glance.",
      primary: "Register patient",
      secondary: "Create appointment",
      total: "Today appointments",
      arrived: "Arrived patients",
      waiting: "Waiting in queue",
      noShow: "No-shows",
      totalNote: "Across MRI, CT, US, and X-ray",
      arrivedNote: "Scanned from barcode slips",
      waitingNote: "Ready on the queue screen",
      noShowNote: "Shown before future booking",
      slots: "Available slots by modality",
      queue: "Queue snapshot",
      quick: "Quick actions",
      indicators: "Live timeline",
      legend: "Status legend",
      actions: [
        "Open patient registration",
        "Create a same-visit appointment",
        "Print the daily studies list",
        "Open queue and scan arrival barcode"
      ]
    },
    patients: {
      title: "Patient registration",
      body: "Register patients in Arabic, transliterate the English name immediately, and keep the workflow clean enough for fast front-desk use.",
      save: "Register patient",
      saveAndBook: "Register and create appointment",
      match: "Possible previous match",
      fields: {
        arName: "Arabic full name",
        enName: "English full name",
        dob: "Date of birth",
        age: "Age",
        sex: "Sex",
        phone1: "Phone 1",
        phone2: "Phone 2",
        address: "Address",
        nationalId: "National ID",
        notes: "Reception notes"
      }
    },
    appointments: {
      title: "Appointment creation",
      body: "Choose the modality, add exam details, and book from a clean capacity calendar with a preview of the appointment slip.",
      save: "Save appointment",
      slip: "Generate slip",
      modality: "Modality",
      examType: "Exam type",
      priority: "Reporting priority",
      notes: "Notes",
      instruction: "Preparation instruction",
      accession: "Accession number",
      calendar: "Availability calendar",
      calendarBody: "Each day shows remaining slots. Supervisor can overbook when the day is full.",
      next: "Book next available slot",
      later: "Jump to later date"
    },
    queue: {
      title: "Queue screen",
      body: "A focused page for barcode scanning and live patient flow. It is designed to stay readable on a dedicated reception screen.",
      scan: "Scan barcode",
      input: "Barcode scanner input",
      waiting: "Waiting list",
      arrived: "Recently arrived"
    },
    search: {
      title: "Patient search",
      body: "Find patients by Arabic name, English name, phone, national ID, or accession number before creating duplicates.",
      placeholder: "Search by name, phone, national ID, or accession"
    },
    print: {
      title: "Daily studies print",
      body: "Filter by date, modality, and status before printing the daily list or reception worklist.",
      date: "Date",
      modality: "Modality",
      status: "Status",
      preview: "Preview print layout",
      list: "List preview"
    },
    settings: {
      title: "Settings",
      body: "Supervisor-only setup with re-authentication before opening sensitive configuration areas.",
      reauth: "Re-authenticate",
      labels: {
        modalities: "Modalities and capacities",
        examTypes: "Exam types and instructions",
        dictionary: "Arabic-English name dictionary",
        fields: "Registration fields",
        priorities: "Reporting priorities",
        users: "User management"
      }
    },
    login: {
      title: "Reception front desk that feels calm and clear",
      body: "This refined prototype focuses on separate pages, bilingual navigation, color-coded statuses, and layouts that look closer to a real reception product.",
      signIn: "Enter prototype",
      username: "Username",
      password: "Password",
      note: "Prototype mode: this opens the interface without real backend authentication yet."
    },
    note: "Separate pages keep daily reception work faster and less cluttered.",
    previewNote: "Later, the backend can turn this live prototype into a real saved workflow without changing the screen design.",
    statuses: {
      scheduled: "Scheduled",
      arrived: "Arrived",
      waiting: "Waiting",
      completed: "Completed",
      no_show: "No-show",
      overbooked: "Overbooked",
      routine: "Routine",
      urgent: "Urgent",
      stat: "STAT"
    },
    common: {
      male: "Male",
      female: "Female",
      openRecord: "Open record",
      open: "Open",
      configured: "Configured items",
      booked: "booked",
      slotsLeft: "slots left",
      noShows: "no-shows",
      today: "Today",
      selectedPatient: "Selected patient",
      appointmentSlip: "Appointment slip preview",
      barcode: "Barcode",
      fields: "Field rules",
      required: "Required",
      optional: "Optional",
      recent: "Recent activity",
      general: "General",
      examSpecific: "Exam-specific",
      printSummary: "Print summary",
      count: "Count",
      queueToday: "Queue today",
      patientSearch: "Patient search",
      searchResults: "Search results",
      patientLabel: "Patient label preview",
      printOutputs: "Print outputs",
      appointmentList: "Appointment list",
      stickerLabel: "Sticker label",
      appointmentSlipShort: "Appointment slip"
    }
  },
  ar: {
    appName: "نظام الاستقبال RISpro",
    appSubtitle: "استقبال الأشعة التشخيصية",
    topTitle: "تشغيل الاستقبال",
    topSubtitle: "نموذج أولي جميل ثنائي اللغة مع صفحات ملوّنة وواضحة لعمل الاستقبال اليومي.",
    userRole: "مشرف الاستقبال",
    nav: {
      dashboard: "الرئيسية",
      patients: "تسجيل المريض",
      appointments: "المواعيد",
      queue: "الطابور",
      search: "البحث",
      print: "طباعة اليوم",
      settings: "الإعدادات"
    },
    dashboard: {
      title: "لوحة الاستقبال",
      body: "صفحة رئيسية هادئة تساعد الفريق على رؤية ضغط اليوم والشواغر وحركة الطابور وحالات عدم الحضور بسرعة.",
      primary: "تسجيل مريض",
      secondary: "إنشاء موعد",
      total: "مواعيد اليوم",
      arrived: "المرضى الواصلون",
      waiting: "المنتظرون في الطابور",
      noShow: "عدم الحضور",
      totalNote: "عبر الرنين والطبقي والألتراساوند والأشعة",
      arrivedNote: "بعد مسح الباركود من الوصل",
      waitingNote: "جاهزون على شاشة الطابور",
      noShowNote: "تظهر قبل الحجز القادم",
      slots: "الشواغر حسب الجهاز",
      queue: "ملخص الطابور",
      quick: "إجراءات سريعة",
      indicators: "تسلسل اليوم",
      legend: "دليل الحالات",
      actions: [
        "فتح صفحة تسجيل المريض",
        "إنشاء موعد في نفس الزيارة",
        "طباعة قائمة دراسات اليوم",
        "فتح شاشة الطابور ومسح باركود الوصول"
      ]
    },
    patients: {
      title: "تسجيل المريض",
      body: "تسجيل المرضى باللغة العربية مع تحويل الاسم إلى الإنجليزية مباشرة، مع تنظيم واضح وسريع يناسب موظف الاستقبال.",
      save: "تسجيل المريض",
      saveAndBook: "تسجيل وإنشاء موعد",
      match: "احتمال وجود سجل سابق",
      fields: {
        arName: "الاسم الكامل بالعربية",
        enName: "الاسم الكامل بالإنجليزية",
        dob: "تاريخ الميلاد",
        age: "العمر",
        sex: "الجنس",
        phone1: "الهاتف 1",
        phone2: "الهاتف 2",
        address: "العنوان",
        nationalId: "الرقم الوطني",
        notes: "ملاحظات الاستقبال"
      }
    },
    appointments: {
      title: "إنشاء موعد",
      body: "اختيار الجهاز وإضافة تفاصيل الفحص ثم الحجز من تقويم واضح للسعة اليومية مع معاينة وصل الموعد.",
      save: "حفظ الموعد",
      slip: "إصدار الوصل",
      modality: "الجهاز",
      examType: "نوع الفحص",
      priority: "أولوية التقرير",
      notes: "ملاحظات",
      instruction: "تعليمات التحضير",
      accession: "رقم الدخول",
      calendar: "تقويم الشواغر",
      calendarBody: "كل يوم يعرض عدد الشواغر المتبقية. يستطيع المشرف فقط تجاوز السعة عندما يمتلئ اليوم.",
      next: "حجز أول شاغر",
      later: "الانتقال إلى تاريخ أبعد"
    },
    queue: {
      title: "شاشة الطابور",
      body: "صفحة مركزة لمسح الباركود ومتابعة حركة المرضى مباشرة، ومصممة لتبقى واضحة حتى على شاشة استقبال منفصلة.",
      scan: "مسح باركود",
      input: "حقل ماسح الباركود",
      waiting: "قائمة الانتظار",
      arrived: "الواصلون حديثاً"
    },
    search: {
      title: "البحث عن مريض",
      body: "البحث بالاسم العربي أو الإنجليزي أو الهاتف أو الرقم الوطني أو رقم الدخول قبل إنشاء سجل مكرر.",
      placeholder: "ابحث بالاسم أو الهاتف أو الرقم الوطني أو رقم الدخول"
    },
    print: {
      title: "طباعة قائمة اليوم",
      body: "التصفية حسب التاريخ والجهاز والحالة قبل طباعة قائمة اليوم أو قائمة عمل الاستقبال.",
      date: "التاريخ",
      modality: "الجهاز",
      status: "الحالة",
      preview: "معاينة الطباعة",
      list: "معاينة القائمة"
    },
    settings: {
      title: "الإعدادات",
      body: "إعدادات خاصة بالمشرف مع إعادة إدخال كلمة المرور قبل فتح أقسام الضبط الحساسة.",
      reauth: "إعادة التحقق",
      labels: {
        modalities: "الأجهزة والسعة",
        examTypes: "أنواع الفحوصات والتعليمات",
        dictionary: "قاموس الأسماء عربي-إنجليزي",
        fields: "حقول التسجيل",
        priorities: "أولويات التقارير",
        users: "إدارة المستخدمين"
      }
    },
    login: {
      title: "واجهة استقبال واضحة ومريحة للفريق",
      body: "هذا النموذج المحسن يركز على الصفحات المنفصلة والتنقل الثنائي اللغة والحالات الملونة وتصميم أقرب إلى منتج حقيقي.",
      signIn: "دخول إلى النموذج",
      username: "اسم المستخدم",
      password: "كلمة المرور",
      note: "وضع تجريبي: هذا يفتح الواجهة بدون ربط حقيقي مع الخادم حالياً."
    },
    note: "الصفحات المنفصلة تجعل العمل اليومي في الاستقبال أسرع وأقل ازدحاماً.",
    previewNote: "لاحقاً يمكن ربط هذا النموذج الحي مع قاعدة البيانات بدون تغيير تصميم الشاشات.",
    statuses: {
      scheduled: "مجدول",
      arrived: "وصل",
      waiting: "ينتظر",
      completed: "مكتمل",
      no_show: "لم يحضر",
      overbooked: "فوق السعة",
      routine: "روتيني",
      urgent: "مستعجل",
      stat: "عاجل جداً"
    },
    common: {
      male: "ذكر",
      female: "أنثى",
      openRecord: "فتح السجل",
      open: "فتح",
      configured: "العناصر المضبوطة",
      booked: "محجوز",
      slotsLeft: "شاغر",
      noShows: "عدم حضور",
      today: "اليوم",
      selectedPatient: "المريض المحدد",
      appointmentSlip: "معاينة وصل الموعد",
      barcode: "الباركود",
      fields: "قواعد الحقول",
      required: "إلزامي",
      optional: "اختياري",
      recent: "نشاط حديث",
      general: "عام",
      examSpecific: "خاص بالفحص",
      printSummary: "ملخص الطباعة",
      count: "العدد",
      queueToday: "طابور اليوم",
      patientSearch: "البحث عن مريض",
      searchResults: "نتائج البحث",
      patientLabel: "معاينة ملصق المريض",
      printOutputs: "مخرجات الطباعة",
      appointmentList: "قائمة المواعيد",
      stickerLabel: "ملصق المريض",
      appointmentSlipShort: "وصل الموعد"
    }
  }
};

const statusStyles = {
  scheduled: "background: rgba(37,99,235,0.12); color: var(--blue);",
  arrived: "background: rgba(21,128,61,0.12); color: var(--green);",
  waiting: "background: rgba(217,119,6,0.14); color: var(--amber);",
  completed: "background: rgba(107,114,128,0.14); color: var(--gray);",
  no_show: "background: rgba(220,38,38,0.12); color: var(--red);",
  overbooked: "background: rgba(146,64,14,0.12); color: var(--brown);",
  routine: "background: rgba(37,99,235,0.12); color: var(--blue);",
  urgent: "background: rgba(234,88,12,0.14); color: #ea580c;",
  stat: "background: rgba(185,28,28,0.14); color: var(--red);"
};

function t() {
  return copy[state.language];
}

function setLanguage(language) {
  state.language = language;
  localStorage.setItem("rispro-language", language);
  render();
}

function setRoute(route) {
  state.route = route;
  localStorage.setItem("rispro-route", route);
  render();
}

function signIn() {
  state.loggedIn = true;
  localStorage.setItem("rispro-logged-in", "true");
  render();
}

function transliterateName(value) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((chunk) => dictionary[chunk] || chunk)
    .join(" ");
}

function localizedDate() {
  return new Intl.DateTimeFormat(state.language === "ar" ? "ar" : "en", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date());
}

function statusPill(status) {
  return `<span class="pill" style="${statusStyles[status]}"><span class="dot"></span>${t().statuses[status]}</span>`;
}

function priorityTag(priority) {
  return `<span class="tag" style="${statusStyles[priority]}">${t().statuses[priority]}</span>`;
}

function pageHero(title, body, actions = "", eyebrow = "") {
  return `
    <section class="hero">
      <div>
        ${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ""}
        <h1>${title}</h1>
        <p>${body}</p>
      </div>
      <div class="hero-actions">${actions}</div>
    </section>
  `;
}

function statCard(label, value, note, color) {
  return `
    <article class="surface surface-compact">
      <div class="card-label">${label}</div>
      <div class="card-value" style="color:${color}">${value}</div>
      <div class="card-note">${note}</div>
    </article>
  `;
}

function progressBar(current, total, color) {
  const percent = total ? Math.min(100, Math.round((current / total) * 100)) : 0;

  return `
    <div class="progress">
      <div class="progress-track">
        <div class="progress-fill" style="width:${percent}%; background:${color};"></div>
      </div>
      <div class="progress-caption">${percent}%</div>
    </div>
  `;
}

function infoTile(label, value, tone = "") {
  return `
    <div class="metric-tile ${tone}">
      <div class="metric-label">${label}</div>
      <div class="metric-value">${value}</div>
    </div>
  `;
}

function slipPreview() {
  const selectedPatient = state.language === "ar" ? "محمد علي السنوسي" : "Mohammad Ali Al-Senussi";
  const examName = state.language === "ar" ? "رنين دماغ بدون صبغة" : "MRI Brain without contrast";
  const instruction = state.language === "ar"
    ? "الحضور قبل الموعد بـ 20 دقيقة وإزالة جميع المعادن."
    : "Arrive 20 minutes early and remove all metal items.";

  return `
    <article class="surface slip-surface">
      <div class="slip-card">
        <div class="slip-top">
          <div>
            <div class="eyebrow">${t().common.appointmentSlip}</div>
            <div class="slip-title">${selectedPatient}</div>
            <div class="slip-subtitle">ACC-20260325-00142 • MRI • 27 Mar</div>
          </div>
          ${priorityTag("urgent")}
        </div>

        <div class="slip-grid">
          <div class="slip-info">
            <div class="slip-label">${t().appointments.examType}</div>
            <div class="slip-value">${examName}</div>
          </div>
          <div class="slip-info">
            <div class="slip-label">${t().appointments.accession}</div>
            <div class="slip-value field-en">ACC-20260325-00142</div>
          </div>
          <div class="slip-info">
            <div class="slip-label">${state.language === "ar" ? "التاريخ" : "Date"}</div>
            <div class="slip-value">27 Mar 2026</div>
          </div>
          <div class="slip-info">
            <div class="slip-label">${state.language === "ar" ? "مكان الاستقبال" : "Reception desk"}</div>
            <div class="slip-value">${state.language === "ar" ? "استقبال الرنين" : "MRI Reception"}</div>
          </div>
          <div class="slip-info full-span">
            <div class="slip-label">${t().appointments.instruction}</div>
            <div class="slip-value">${instruction}</div>
          </div>
        </div>

        <div class="barcode-block">
          <div class="slip-label">${t().common.barcode}</div>
          <div class="barcode-visual" aria-hidden="true"></div>
          <div class="barcode-text field-en">ACC2026032500142</div>
        </div>
      </div>
    </article>
  `;
}

function labelPreview() {
  const selectedPatient = state.language === "ar" ? "محمد علي السنوسي" : "Mohammad Ali Al-Senussi";

  return `
    <article class="surface">
      <h2 class="section-title">${t().common.patientLabel}</h2>
      <div class="label-card">
        <div class="label-row">
          <div class="label-strong">${selectedPatient}</div>
          <div class="chip accent">MRI</div>
        </div>
        <div class="label-row">
          <div class="label-meta">${state.language === "ar" ? "رقم الدخول" : "Accession"}</div>
          <div class="field-en label-code">ACC-20260325-00142</div>
        </div>
        <div class="label-row">
          <div class="label-meta">${state.language === "ar" ? "الجنس / الميلاد" : "Sex / DOB"}</div>
          <div>${state.language === "ar" ? "ذكر • 1984-07-11" : "Male • 1984-07-11"}</div>
        </div>
        <div class="label-strip">
          <div class="barcode-visual mini-barcode" aria-hidden="true"></div>
          <div class="barcode-text field-en compact-code">ACC2026032500142</div>
        </div>
      </div>
    </article>
  `;
}

function renderDashboard() {
  const c = t().dashboard;
  const waitingCount = data.queue.filter((entry) => entry.status === "waiting").length;
  const arrivedCount = data.queue.filter((entry) => entry.status === "arrived").length;
  const urgentCount = data.queue.filter((entry) => entry.priority === "urgent" || entry.priority === "stat").length;
  const nextPatient = data.queue.find((entry) => entry.status === "waiting") || data.queue[0];

  return `
    <div class="page">
      ${pageHero(
        c.title,
        c.body,
        `<button class="button-primary" data-route="patients">${c.primary}</button>
         <button class="button-secondary" data-route="appointments">${c.secondary}</button>`,
        t().common.today
      )}

      <section class="legend-row surface">
        <div class="section-head">
          <h2 class="section-title">${c.legend}</h2>
        </div>
        <div class="badge-row">
          ${statusPill("scheduled")}
          ${statusPill("arrived")}
          ${statusPill("waiting")}
          ${statusPill("no_show")}
        </div>
      </section>

      <section class="card-grid">
        ${statCard(c.total, data.stats.total, c.totalNote, "var(--teal)")}
        ${statCard(c.arrived, data.stats.arrived, c.arrivedNote, "var(--green)")}
        ${statCard(c.waiting, data.stats.waiting, c.waitingNote, "var(--amber)")}
        ${statCard(c.noShow, data.stats.noShow, c.noShowNote, "var(--red)")}
      </section>

      <section class="split-grid">
        <article class="surface">
          <div class="section-head">
            <h2 class="section-title">${c.slots}</h2>
            <span class="chip subtle">${localizedDate()}</span>
          </div>
          <div class="board-grid">
            ${data.modalities
              .map((item) => {
                const remaining = item.capacity - item.booked;
                return `
                  <div class="modality-board">
                    <div class="board-head">
                      <div class="item-copy">
                        <div class="item-title">${state.language === "ar" ? item.ar : item.en}</div>
                        <div class="item-subtitle">${item.code} • ${item.booked} / ${item.capacity} ${t().common.booked}</div>
                      </div>
                      <div class="chip subtle" style="color:${item.color}">
                        ${remaining} ${t().common.slotsLeft}
                      </div>
                    </div>
                    <div class="capacity-grid">
                      ${infoTile(state.language === "ar" ? "السعة" : "Capacity", item.capacity)}
                      ${infoTile(state.language === "ar" ? "محجوز" : "Booked", item.booked)}
                      ${infoTile(state.language === "ar" ? "متبقٍ" : "Remaining", remaining)}
                    </div>
                    ${progressBar(item.booked, item.capacity, item.color)}
                    <div class="board-foot">
                      <span>${state.language === "ar" ? "أقرب يوم جيد للحجز" : "Best next booking day"}</span>
                      <strong>${state.language === "ar" ? "29 مارس" : "29 Mar"}</strong>
                    </div>
                  </div>
                `;
              })
              .join("")}
          </div>
        </article>

        <article class="surface">
          <div class="section-head">
            <h2 class="section-title">${c.queue}</h2>
            <span class="chip accent">${t().common.queueToday}</span>
          </div>
          <div class="queue-summary-grid">
            ${infoTile(state.language === "ar" ? "ينتظر الآن" : "Waiting now", waitingCount, "tone-warm")}
            ${infoTile(state.language === "ar" ? "وصل اليوم" : "Arrived today", arrivedCount, "tone-good")}
            ${infoTile(state.language === "ar" ? "أولوية مرتفعة" : "High priority", urgentCount, "tone-alert")}
            ${infoTile(state.language === "ar" ? "متوسط الانتظار" : "Average wait", state.language === "ar" ? "12 د" : "12 min")}
          </div>
          <div class="queue-focus-card">
            <div class="section-head" style="margin-bottom:12px;">
              <div>
                <div class="item-subtitle">${state.language === "ar" ? "المريض التالي" : "Next patient"}</div>
                <div class="queue-focus-name">${state.language === "ar" ? nextPatient.patientAr : nextPatient.patientEn}</div>
              </div>
              ${priorityTag(nextPatient.priority)}
            </div>
            <div class="queue-focus-meta">${nextPatient.accession} • ${nextPatient.modality}</div>
            <div class="barcode-panel queue-scan-panel">
              <div class="item-subtitle">${state.language === "ar" ? "الاستقبال بالباركود" : "Barcode reception input"}</div>
              <div class="barcode-visual micro-barcode" aria-hidden="true"></div>
            </div>
          </div>
          <div class="list compact-list">
            ${data.queue
              .map(
                (entry) => `
                  <div class="item">
                    <div class="item-copy">
                      <div class="item-title">${state.language === "ar" ? entry.patientAr : entry.patientEn}</div>
                      <div class="item-subtitle">${entry.accession} • ${entry.modality}</div>
                    </div>
                    <div class="badge-row">
                      ${priorityTag(entry.priority)}
                      ${statusPill(entry.status)}
                    </div>
                  </div>
                `
              )
              .join("")}
          </div>
        </article>
      </section>

      <section class="dual-grid">
        <article class="surface">
          <div class="section-head">
            <h2 class="section-title">${c.quick}</h2>
            <span class="chip subtle">${state.language === "ar" ? "اختصارات العمل" : "Working shortcuts"}</span>
          </div>
          <div class="action-grid">
            ${c.actions
              .map(
                (item, index) => `
                  <button class="action-card ${index === 0 ? "is-primary" : ""}">
                    <span class="action-index">${String(index + 1).padStart(2, "0")}</span>
                    <span class="item-title">${item}</span>
                  </button>
                `
              )
              .join("")}
          </div>
        </article>

        <article class="surface">
          <h2 class="section-title">${c.indicators}</h2>
          <div class="timeline">
            ${data.timeline
              .map(
                (entry) => `
                  <div class="timeline-row">
                    <div class="timeline-time">${entry.time}</div>
                    <div class="timeline-content">
                      ${statusPill(entry.status)}
                      <div class="timeline-text">${state.language === "ar" ? entry.ar : entry.en}</div>
                    </div>
                  </div>
                `
              )
              .join("")}
          </div>
        </article>
      </section>
    </div>
  `;
}

function renderPatients() {
  const c = t().patients;
  const completionLabel = state.language === "ar" ? "اكتمال التسجيل" : "Registration completeness";

  return `
    <div class="page">
      ${pageHero(
        c.title,
        c.body,
        `<button class="button-primary">${c.save}</button>
         <button class="button-secondary" data-route="appointments">${c.saveAndBook}</button>`,
        t().common.selectedPatient
      )}

      <section class="split-grid">
        <article class="surface">
          <div class="section-head">
            <h2 class="section-title">${c.title}</h2>
            <div class="badge-row">
              <span class="chip success">${t().common.required}</span>
              <span class="chip subtle">${t().common.optional}</span>
            </div>
          </div>

          <div class="subsection-title">${state.language === "ar" ? "المعلومات الأساسية" : "Basic details"}</div>
          <div class="form-grid">
            <label class="field">
              <span class="label">${c.fields.arName}</span>
              <input id="arabic-name" class="input field-ar" lang="ar" dir="rtl" value="محمد علي السنوسي" />
            </label>

            <label class="field">
              <span class="label">${c.fields.enName}</span>
              <input id="english-name" class="input field-en" lang="en" dir="ltr" value="Mohammad Ali Al-Senussi" />
            </label>

            <label class="field">
              <span class="label">${c.fields.dob}</span>
              <input class="input" type="date" />
            </label>

            <label class="field">
              <span class="label">${c.fields.age}</span>
              <input class="input" />
            </label>

            <label class="field">
              <span class="label">${c.fields.sex}</span>
              <select class="select">
                <option>${t().common.male}</option>
                <option>${t().common.female}</option>
              </select>
            </label>

            <label class="field">
              <span class="label">${c.fields.nationalId}</span>
              <input class="input field-en" dir="ltr" />
            </label>
          </div>

          <div class="subsection-title">${state.language === "ar" ? "معلومات التواصل" : "Contact details"}</div>
          <div class="form-grid">
            <label class="field">
              <span class="label">${c.fields.phone1}</span>
              <input class="input field-en" dir="ltr" />
            </label>

            <label class="field">
              <span class="label">${c.fields.phone2}</span>
              <input class="input field-en" dir="ltr" />
            </label>

            <label class="field full">
              <span class="label">${c.fields.address}</span>
              <textarea class="textarea ${state.language === "ar" ? "field-ar" : ""}"></textarea>
            </label>

            <label class="field full">
              <span class="label">${c.fields.notes}</span>
              <textarea class="textarea"></textarea>
            </label>
          </div>
        </article>

        <div class="stack">
          <article class="surface">
            <div class="section-head">
              <h2 class="section-title">${completionLabel}</h2>
              <span class="chip accent">82%</span>
            </div>
            ${progressBar(82, 100, "var(--teal)")}
            <div class="info-grid" style="margin-top:16px;">
              ${infoTile(state.language === "ar" ? "الاسم" : "Name", state.language === "ar" ? "مكتمل" : "Complete", "tone-good")}
              ${infoTile(state.language === "ar" ? "الاتصال" : "Contact", state.language === "ar" ? "مكتمل" : "Complete", "tone-good")}
              ${infoTile(state.language === "ar" ? "الهوية" : "Identity", state.language === "ar" ? "اختياري" : "Optional")}
              ${infoTile(state.language === "ar" ? "الموعد التالي" : "Next step", state.language === "ar" ? "إنشاء موعد" : "Create appointment", "tone-warm")}
            </div>
          </article>

          <article class="surface">
            <h2 class="section-title">${c.match}</h2>
            <div class="list">
              <div class="item">
                <div class="item-copy">
                  <div class="item-title">${state.language === "ar" ? "محمد علي السنوسي" : "Mohammad Ali Al-Senussi"}</div>
                  <div class="item-subtitle">${state.language === "ar" ? "هاتف 0912345678 • آخر موعد منذ 12 يوماً" : "Phone 0912345678 • Last visit 12 days ago"}</div>
                </div>
                <button class="button-ghost">${t().common.openRecord}</button>
              </div>
            </div>
          </article>

          <article class="surface">
            <h2 class="section-title">${state.language === "ar" ? "التحويل إلى الإنجليزية" : "English transliteration"}</h2>
            <div class="rule-list">
              <div class="rule-item">
                <div class="item-copy">
                  <div class="item-title">${state.language === "ar" ? "محمد" : "Mohammad"}</div>
                  <div class="item-subtitle">${state.language === "ar" ? "من القاموس المخصص" : "From the custom dictionary"}</div>
                </div>
                <span class="chip success">${state.language === "ar" ? "مفعل" : "Enabled"}</span>
              </div>
              <div class="rule-item">
                <div class="item-copy">
                  <div class="item-title">${state.language === "ar" ? "السنوسي" : "Al-Senussi"}</div>
                  <div class="item-subtitle">${state.language === "ar" ? "يمكن تعديله يدوياً" : "Can still be edited manually"}</div>
                </div>
                <span class="chip subtle">${state.language === "ar" ? "مرن" : "Flexible"}</span>
              </div>
            </div>
          </article>

          <article class="surface">
            <h2 class="section-title">${t().common.fields}</h2>
            <div class="rule-list">
              <div class="rule-item">
                <div class="item-copy">
                  <div class="item-title">${c.fields.arName}</div>
                  <div class="item-subtitle">${state.language === "ar" ? "يظهر دائماً في شاشة التسجيل" : "Always visible on registration"}</div>
                </div>
                <span class="chip success">${t().common.required}</span>
              </div>
              <div class="rule-item">
                <div class="item-copy">
                  <div class="item-title">${c.fields.phone1}</div>
                  <div class="item-subtitle">${state.language === "ar" ? "الحقل الأساسي للتواصل" : "Primary contact field"}</div>
                </div>
                <span class="chip success">${t().common.required}</span>
              </div>
              <div class="rule-item">
                <div class="item-copy">
                  <div class="item-title">${c.fields.nationalId}</div>
                  <div class="item-subtitle">${state.language === "ar" ? "يمكن تركه فارغاً" : "Can stay empty"}</div>
                </div>
                <span class="chip subtle">${t().common.optional}</span>
              </div>
            </div>
          </article>

          <article class="surface">
            <h2 class="section-title">${t().common.recent}</h2>
            <div class="list compact-list">
              <div class="item">
                <div class="item-copy">
                  <div class="item-title">${state.language === "ar" ? "رنين دماغ بدون صبغة" : "MRI Brain without contrast"}</div>
                  <div class="item-subtitle">ACC-20260302-00098 • MRI</div>
                </div>
                ${statusPill("completed")}
              </div>
              <div class="item">
                <div class="item-copy">
                  <div class="item-title">${state.language === "ar" ? "مراجعة هاتف المريض" : "Reception note updated"}</div>
                  <div class="item-subtitle">${state.language === "ar" ? "منذ 3 أيام" : "3 days ago"}</div>
                </div>
                <span class="chip subtle">${state.language === "ar" ? "استقبال" : "Reception"}</span>
              </div>
            </div>
          </article>
        </div>
      </section>
    </div>
  `;
}

function renderAppointments() {
  const c = t().appointments;
  const selectedPatient = state.language === "ar" ? "محمد علي السنوسي" : "Mohammad Ali Al-Senussi";

  return `
    <div class="page">
      ${pageHero(
        c.title,
        c.body,
        `<button class="button-primary">${c.save}</button>
         <button class="button-secondary">${c.slip}</button>`,
        t().common.general
      )}

      <section class="split-grid">
        <article class="surface">
          <div class="section-head">
            <h2 class="section-title">${c.title}</h2>
            <span class="chip accent">${selectedPatient}</span>
          </div>

          <div class="form-grid">
            <label class="field">
              <span class="label">${c.modality}</span>
              <select class="select">
                <option>MRI</option>
                <option>CT</option>
                <option>Ultrasound</option>
                <option>X-Ray</option>
              </select>
            </label>

            <label class="field">
              <span class="label">${c.examType}</span>
              <select class="select">
                <option>${state.language === "ar" ? "دماغ بدون صبغة" : "Brain without contrast"}</option>
                <option>${state.language === "ar" ? "بطن وحوض" : "Abdomen and pelvis"}</option>
                <option>${state.language === "ar" ? "إضافة نوع فحص جديد" : "Add new exam type"}</option>
              </select>
            </label>

            <label class="field">
              <span class="label">${c.priority}</span>
              <div class="badge-row">
                ${priorityTag("routine")}
                ${priorityTag("urgent")}
                ${priorityTag("stat")}
              </div>
            </label>

            <label class="field">
              <span class="label">${c.accession}</span>
              <input class="input field-en" dir="ltr" value="ACC-20260325-00142" />
            </label>

            <label class="field full">
              <span class="label">${c.notes}</span>
              <textarea class="textarea"></textarea>
            </label>

            <label class="field full">
              <span class="label">${c.instruction}</span>
              <textarea class="textarea">${state.language === "ar" ? "تحضير الرنين: إزالة المعادن قبل الدخول. إذا تم اختيار فحص خاص، تظهر التعليمات الخاصة هنا." : "MRI preparation: remove metal before entry. If a specific exam is chosen, its specific instruction appears here."}</textarea>
            </label>
          </div>
        </article>

        <div class="stack">
          <article class="surface">
            <div class="section-head">
              <h2 class="section-title">${t().common.patientSearch}</h2>
              <span class="chip subtle">${t().common.searchResults}</span>
            </div>
            <div class="search-bar">
              <input class="input" placeholder="${state.language === "ar" ? "ابحث بالاسم أو الهاتف أو الرقم الوطني" : "Search by name, phone, or national ID"}" />
              <button class="button-primary">${t().nav.search}</button>
            </div>
            <div class="list compact-list" style="margin-top:16px;">
              <div class="item">
                <div class="item-copy">
                  <div class="item-title">${selectedPatient}</div>
                  <div class="item-subtitle">${state.language === "ar" ? "0912345678 • ملف سابق موجود" : "0912345678 • Existing patient record"}</div>
                </div>
                <button class="button-ghost">${t().common.open}</button>
              </div>
            </div>
          </article>

          <article class="surface">
            <h2 class="section-title">${t().common.selectedPatient}</h2>
            <div class="info-grid">
              ${infoTile(state.language === "ar" ? "الاسم" : "Name", selectedPatient)}
              ${infoTile(state.language === "ar" ? "الهاتف" : "Phone", "0912345678")}
              ${infoTile(state.language === "ar" ? "تاريخ الميلاد" : "Date of birth", "1984-07-11")}
              ${infoTile(state.language === "ar" ? "الجنس" : "Sex", state.language === "ar" ? "ذكر" : "Male")}
              ${infoTile(state.language === "ar" ? "العنوان" : "Address", state.language === "ar" ? "طرابلس - حي الأندلس" : "Tripoli - Andalus")}
              ${infoTile(state.language === "ar" ? "آخر عدم حضور" : "Last no-show", state.language === "ar" ? "لا يوجد" : "None")}
              ${infoTile(state.language === "ar" ? "الجهاز المطلوب" : "Requested modality", "MRI")}
            </div>
          </article>

          <article class="surface">
            <div class="section-head">
              <h2 class="section-title">${c.calendar}</h2>
              <span class="chip subtle">${localizedDate()}</span>
            </div>
            <div class="hint" style="margin-bottom:16px;">${c.calendarBody}</div>
            <div class="calendar">
              ${data.calendar
                .map(
                  (day) => `
                    <button class="day${day.active ? " active" : ""}">
                      <span class="day-date">${state.language === "ar" ? day.ar : day.en}</span>
                      <span class="day-value">${day.remaining}</span>
                      <span class="day-note">${day.booked} ${t().common.booked}</span>
                    </button>
                  `
                )
                .join("")}
            </div>
            <div class="badge-row" style="margin-top:18px;">
              <button class="button-ghost">${c.next}</button>
              <button class="button-ghost">${c.later}</button>
            </div>
          </article>
        </div>
      </section>

      <section class="dual-grid">
        ${slipPreview()}
        ${labelPreview()}
      </section>

      <section class="split-grid">
        <article class="surface">
          <h2 class="section-title">${state.language === "ar" ? "التعليمات المطبقة" : "Applied instructions"}</h2>
          <div class="rule-list">
            <div class="rule-item">
              <div class="item-copy">
                <div class="item-title">${t().common.general}</div>
                <div class="item-subtitle">${state.language === "ar" ? "إزالة المعادن والحضور المبكر" : "Remove metal and arrive early"}</div>
              </div>
              <span class="chip subtle">MRI</span>
            </div>
            <div class="rule-item">
              <div class="item-copy">
                <div class="item-title">${t().common.examSpecific}</div>
                <div class="item-subtitle">${state.language === "ar" ? "فحص بدون صبغة" : "Without contrast exam"}</div>
              </div>
              <span class="chip accent">${state.language === "ar" ? "نشط" : "Active"}</span>
            </div>
          </div>
        </article>
        <article class="surface">
          <h2 class="section-title">${t().common.printOutputs}</h2>
          <div class="rule-list">
            <div class="rule-item">
              <div class="item-copy">
                <div class="item-title">${t().common.appointmentSlipShort}</div>
                <div class="item-subtitle">${state.language === "ar" ? "يتضمن التعليمات والباركود ورقم الدخول" : "Includes instructions, barcode, and accession number"}</div>
              </div>
              <span class="chip accent">A5</span>
            </div>
            <div class="rule-item">
              <div class="item-copy">
                <div class="item-title">${t().common.stickerLabel}</div>
                <div class="item-subtitle">${state.language === "ar" ? "جاهز للطباعة على الملصقات" : "Ready for sticker printer output"}</div>
              </div>
              <span class="chip subtle">62 x 29mm</span>
            </div>
          </div>
        </article>
      </section>
    </div>
  `;
}

function renderQueue() {
  const c = t().queue;
  const waiting = data.queue.filter((item) => item.status === "waiting");
  const arrived = data.queue.filter((item) => item.status === "arrived");

  return `
    <div class="page">
      ${pageHero(c.title, c.body, `<button class="button-primary">${c.scan}</button>`, t().common.queueToday)}

      <section class="card-grid">
        ${statCard(state.language === "ar" ? "المنتظرون الآن" : "Waiting now", waiting.length, state.language === "ar" ? "جاهزون للنداء" : "Ready to be called", "var(--amber)")}
        ${statCard(state.language === "ar" ? "وصلوا اليوم" : "Arrived today", arrived.length, state.language === "ar" ? "بعد مسح الباركود" : "After barcode scan", "var(--green)")}
        ${statCard(state.language === "ar" ? "أعلى أولوية" : "Highest priority", "STAT", state.language === "ar" ? "تظهر بوضوح في الطابور" : "Shown clearly in the queue", "var(--red)")}
        ${statCard(state.language === "ar" ? "المسح الناجح" : "Successful scans", 19, state.language === "ar" ? "منذ بداية اليوم" : "Since the start of the day", "var(--blue)")}
      </section>

      <section class="split-grid">
        <article class="surface">
          <div class="section-head">
            <h2 class="section-title">${c.input}</h2>
            <span class="chip accent">${t().common.barcode}</span>
          </div>
          <input class="input field-en" dir="ltr" placeholder="ACC-20260325-00142" />
          <div class="barcode-panel">
            <div class="barcode-visual small-barcode" aria-hidden="true"></div>
            <div class="barcode-text field-en">ACC2026032500142</div>
          </div>
          <div class="rule-list" style="margin-top:16px;">
            <div class="rule-item">
              <div class="item-copy">
                <div class="item-title">${state.language === "ar" ? "المسح من الوصل" : "Scan from printed slip"}</div>
                <div class="item-subtitle">${state.language === "ar" ? "ينقل المريض مباشرة إلى الوصول والطابور" : "Moves the patient directly into arrived and queue status"}</div>
              </div>
            </div>
            <div class="rule-item">
              <div class="item-copy">
                <div class="item-title">${state.language === "ar" ? "قراءة يدوية" : "Manual entry"}</div>
                <div class="item-subtitle">${state.language === "ar" ? "يمكن إدخال رقم الدخول يدوياً عند الحاجة" : "Accession can still be typed manually when needed"}</div>
              </div>
            </div>
          </div>
        </article>

        <article class="surface">
          <h2 class="section-title">${c.waiting}</h2>
          <div class="list">
            ${waiting
              .map(
                (entry) => `
                  <div class="item">
                    <div class="item-copy">
                      <div class="item-title">${state.language === "ar" ? entry.patientAr : entry.patientEn}</div>
                      <div class="item-subtitle">${entry.accession} • ${entry.modality}</div>
                    </div>
                    <div class="badge-row">
                      ${priorityTag(entry.priority)}
                      ${statusPill(entry.status)}
                    </div>
                  </div>
                `
              )
              .join("")}
          </div>
        </article>
      </section>

      <section class="surface">
        <h2 class="section-title">${c.arrived}</h2>
        <div class="list">
          ${arrived
            .map(
              (entry) => `
                <div class="item">
                  <div class="item-copy">
                    <div class="item-title">${state.language === "ar" ? entry.patientAr : entry.patientEn}</div>
                    <div class="item-subtitle">${entry.accession} • ${entry.modality}</div>
                  </div>
                  <div class="badge-row">
                    ${priorityTag(entry.priority)}
                    ${statusPill(entry.status)}
                  </div>
                </div>
              `
            )
            .join("")}
        </div>
      </section>
    </div>
  `;
}

function renderSearch() {
  const c = t().search;
  const results = [
    {
      id: "P-2401",
      ar: "عائشة مختار التركي",
      en: "Aisha Mukhtar Al-Turki",
      phone: "091-2345678",
      noShows: 1
    },
    {
      id: "P-2398",
      ar: "سالم مفتاح النعاس",
      en: "Salem Miftah Al-Naas",
      phone: "092-4567812",
      noShows: 0
    }
  ];

  return `
    <div class="page">
      ${pageHero(c.title, c.body, "", t().common.recent)}
      <section class="split-grid">
        <article class="surface">
          <div class="search-bar">
            <input class="input" placeholder="${c.placeholder}" />
            <button class="button-primary">${t().nav.search}</button>
          </div>
          <div class="badge-row" style="margin-top:16px;">
            <span class="chip subtle">${state.language === "ar" ? "الاسم العربي" : "Arabic name"}</span>
            <span class="chip subtle">${state.language === "ar" ? "الاسم الإنجليزي" : "English name"}</span>
            <span class="chip subtle">${state.language === "ar" ? "الهاتف" : "Phone"}</span>
            <span class="chip subtle">${state.language === "ar" ? "رقم الدخول" : "Accession"}</span>
          </div>
          <div class="list" style="margin-top:18px;">
            ${results
              .map(
                (item) => `
                  <div class="item patient-result">
                    <div class="item-copy">
                      <div class="item-title">${state.language === "ar" ? item.ar : item.en}</div>
                      <div class="item-subtitle">${item.id} • ${item.phone}</div>
                    </div>
                    <div class="badge-row">
                      <span class="mini">${item.noShows} ${t().common.noShows}</span>
                      ${item.noShows > 0 ? statusPill("no_show") : statusPill("scheduled")}
                      <button class="button-ghost">${t().common.open}</button>
                    </div>
                  </div>
                `
              )
              .join("")}
          </div>
        </article>

        <div class="stack">
          <article class="surface">
            <h2 class="section-title">${t().common.selectedPatient}</h2>
            <div class="info-grid">
              ${infoTile(state.language === "ar" ? "الاسم" : "Name", state.language === "ar" ? results[0].ar : results[0].en)}
              ${infoTile(state.language === "ar" ? "الهاتف" : "Phone", results[0].phone)}
              ${infoTile(state.language === "ar" ? "رقم الملف" : "Patient ID", results[0].id)}
              ${infoTile(state.language === "ar" ? "عدم الحضور" : "No-show", results[0].noShows, results[0].noShows ? "tone-alert" : "")}
            </div>
          </article>

          <article class="surface">
            <h2 class="section-title">${t().common.recent}</h2>
            <div class="rule-list">
              <div class="rule-item">
                <div class="item-copy">
                  <div class="item-title">${state.language === "ar" ? "رنين دماغ" : "MRI Brain"}</div>
                  <div class="item-subtitle">ACC-20260321-00082</div>
                </div>
                ${statusPill("completed")}
              </div>
              <div class="rule-item">
                <div class="item-copy">
                  <div class="item-title">${state.language === "ar" ? "ألتراساوند بطن" : "Abdominal ultrasound"}</div>
                  <div class="item-subtitle">ACC-20260312-00049</div>
                </div>
                ${statusPill("no_show")}
              </div>
            </div>
          </article>
        </div>
      </section>
    </div>
  `;
}

function renderPrint() {
  const c = t().print;

  return `
    <div class="page">
      ${pageHero(c.title, c.body, `<button class="button-primary">${c.preview}</button>`, t().common.printSummary)}
      <section class="split-grid">
        <article class="surface">
          <div class="form-grid">
            <label class="field">
              <span class="label">${c.date}</span>
              <input class="input" type="date" />
            </label>

            <label class="field">
              <span class="label">${c.modality}</span>
              <select class="select">
                <option>MRI</option>
                <option>CT</option>
                <option>Ultrasound</option>
                <option>X-Ray</option>
              </select>
            </label>

            <label class="field full">
              <span class="label">${c.status}</span>
              <div class="badge-row">
                ${statusPill("scheduled")}
                ${statusPill("arrived")}
                ${statusPill("completed")}
                ${statusPill("no_show")}
              </div>
            </label>
          </div>

          <div class="info-grid" style="margin-top:18px;">
            ${infoTile(state.language === "ar" ? "إجمالي القائمة" : "Total list", "34")}
            ${infoTile(state.language === "ar" ? "الرنين" : "MRI", "10")}
            ${infoTile(state.language === "ar" ? "الطبقي" : "CT", "14")}
            ${infoTile(state.language === "ar" ? "عدم الحضور" : "No-show", "3")}
          </div>
        </article>

        <div class="stack">
          <article class="surface">
            <h2 class="section-title">${c.list}</h2>
            <div class="print-sheet">
              <div class="print-sheet-head">
                <div>${state.language === "ar" ? "قائمة يومية" : "Daily list"}</div>
                <div>${localizedDate()}</div>
              </div>
              <div class="print-sheet-row">
                <span>${state.language === "ar" ? "محمد علي السنوسي" : "Mohammad Ali Al-Senussi"}</span>
                <span>MRI</span>
                ${statusPill("scheduled")}
              </div>
              <div class="print-sheet-row">
                <span>${state.language === "ar" ? "فاطمة سالم العبيدي" : "Fatima Salem Al-Obaidi"}</span>
                <span>CT</span>
                ${statusPill("arrived")}
              </div>
            </div>
          </article>

          <article class="surface">
            <h2 class="section-title">${t().common.printOutputs}</h2>
            <div class="print-output-grid">
              <div class="output-card">
                <div class="output-head">
                  <div class="item-title">${t().common.appointmentSlipShort}</div>
                  <span class="chip accent">A5</span>
                </div>
                <div class="output-note">${state.language === "ar" ? "وصل مختصر للمريض مع التعليمات والباركود" : "Compact patient slip with instructions and barcode"}</div>
                <div class="output-preview">
                  <div class="mini-slip-line"></div>
                  <div class="mini-slip-line short"></div>
                  <div class="barcode-visual micro-barcode" aria-hidden="true"></div>
                </div>
              </div>

              <div class="output-card">
                <div class="output-head">
                  <div class="item-title">${t().common.stickerLabel}</div>
                  <span class="chip subtle">62 x 29mm</span>
                </div>
                <div class="output-note">${state.language === "ar" ? "ملصق صغير للطابعة أو للأنابيب والملفات" : "Small label for sticker printer, tubes, or files"}</div>
                <div class="output-preview label-preview-mini">
                  <div class="mini-slip-line"></div>
                  <div class="barcode-visual nano-barcode" aria-hidden="true"></div>
                </div>
              </div>

              <div class="output-card">
                <div class="output-head">
                  <div class="item-title">${t().common.appointmentList}</div>
                  <span class="chip subtle">A4</span>
                </div>
                <div class="output-note">${state.language === "ar" ? "قائمة تشغيل اليوم حسب الجهاز والحالة" : "Daily operational list by modality and status"}</div>
                <div class="output-preview rows-preview">
                  <div class="mini-slip-line"></div>
                  <div class="mini-slip-line"></div>
                  <div class="mini-slip-line short"></div>
                </div>
              </div>
            </div>
          </article>
        </div>
      </section>
    </div>
  `;
}

function renderSettings() {
  const c = t().settings;

  return `
    <div class="page">
      ${pageHero(c.title, c.body, `<button class="button-secondary">${c.reauth}</button>`, t().common.general)}
      <section class="card-grid">
        ${statCard(state.language === "ar" ? "الفئات" : "Categories", data.settingsCatalog.length, state.language === "ar" ? "تغطي سلوك النظام بالكامل" : "Covering the full system behavior", "var(--teal)")}
        ${statCard(state.language === "ar" ? "المستخدمون" : "Users", "4", state.language === "ar" ? "مشرفون وموظفو استقبال" : "Supervisors and receptionists", "var(--amber)")}
        ${statCard(state.language === "ar" ? "عناصر القاموس" : "Dictionary entries", "148", state.language === "ar" ? "لتحسين تحويل الأسماء" : "For name transliteration quality", "var(--blue)")}
        ${statCard(state.language === "ar" ? "إعادة التحقق" : "Re-authentication", state.language === "ar" ? "مفعل" : "Enabled", state.language === "ar" ? "قبل فتح الإعدادات الحساسة" : "Before sensitive settings access", "var(--green)")}
      </section>

      <section class="surface">
        <div class="section-head">
          <h2 class="section-title">${state.language === "ar" ? "فئات الإعدادات" : "Settings categories"}</h2>
          <span class="chip subtle">${state.language === "ar" ? "تتحكم في سلوك النظام بالكامل" : "Designed to control the whole system behavior"}</span>
        </div>
        <div class="settings-nav">
          ${data.settingsCatalog
            .map(
              (category) => `
                <span class="settings-nav-chip">
                  ${state.language === "ar" ? category.titleAr : category.titleEn}
                </span>
              `
            )
            .join("")}
        </div>
      </section>

      <section class="settings-catalog">
        ${data.settingsCatalog
          .map(
            (category) => `
              <article class="surface settings-category">
                <div class="section-head">
                  <div>
                    <h2 class="section-title">${state.language === "ar" ? category.titleAr : category.titleEn}</h2>
                    <div class="settings-summary">${state.language === "ar" ? category.summaryAr : category.summaryEn}</div>
                  </div>
                  <span class="chip accent">${category.items.length}</span>
                </div>
                <div class="settings-rows">
                  ${category.items
                    .map(
                      (item) => `
                        <div class="settings-row">
                          <div class="settings-labels">
                            <div class="item-title">${state.language === "ar" ? item.labelAr : item.labelEn}</div>
                          </div>
                          <div class="settings-value">
                            ${state.language === "ar" ? item.valueAr : item.valueEn}
                          </div>
                        </div>
                      `
                    )
                    .join("")}
                </div>
              </article>
            `
          )
          .join("")}
      </section>
    </div>
  `;
}

function renderLogin() {
  const c = t().login;

  return `
    <div class="login-shell">
      <div class="login-card">
        <section class="login-showcase">
          <div class="brand">
            <div class="brand-mark">R</div>
            <div>
              <div class="brand-title">${t().appName}</div>
              <div class="brand-subtitle">${t().appSubtitle}</div>
            </div>
          </div>
          <h1>${c.title}</h1>
          <p>${c.body}</p>
          <div class="showcase-list">
            <div class="showcase-item">${state.language === "ar" ? "لوحة رئيسية هادئة تعرض اليوم بسرعة" : "A calm dashboard that shows the day at a glance"}</div>
            <div class="showcase-item">${state.language === "ar" ? "تنقل عربي وإنجليزي مع RTL و LTR" : "Arabic and English navigation with RTL and LTR"}</div>
            <div class="showcase-item">${state.language === "ar" ? "معاينة وصل الموعد مع باركود واضح" : "Appointment slip preview with a clear barcode"}</div>
          </div>
        </section>

        <section class="login-form">
          ${languageToggle()}
          <div class="info-grid">
            ${infoTile(state.language === "ar" ? "الصفحات" : "Pages", "7")}
            ${infoTile(state.language === "ar" ? "اللغات" : "Languages", "2")}
            ${infoTile(state.language === "ar" ? "الحالات الملونة" : "Status colors", "8")}
            ${infoTile(state.language === "ar" ? "المخرجات المطبوعة" : "Print outputs", "3")}
          </div>
          <label class="field">
            <span class="label">${c.username}</span>
            <input class="input" />
          </label>
          <label class="field">
            <span class="label">${c.password}</span>
            <input class="input" type="password" />
          </label>
          <button class="button-primary" id="sign-in-button">${c.signIn}</button>
          <div class="small">${c.note}</div>
        </section>
      </div>
    </div>
  `;
}

function languageToggle() {
  return `
    <div class="toggle">
      <button class="${state.language === "ar" ? "active" : ""}" data-language="ar">العربية</button>
      <button class="${state.language === "en" ? "active" : ""}" data-language="en">English</button>
    </div>
  `;
}

function renderAppFrame(content) {
  const routeTitle = t().nav[state.route];

  return `
    <div class="shell">
      <div class="layout">
        <aside class="sidebar">
          <div class="brand">
            <div class="brand-mark">R</div>
            <div>
              <div class="brand-title">${t().appName}</div>
              <div class="brand-subtitle">${t().appSubtitle}</div>
            </div>
          </div>

          <nav class="nav">
            ${Object.entries(t().nav)
              .map(
                ([key, label], index) => `
                  <a href="#" class="nav-link ${state.route === key ? "active" : ""}" data-route="${key}">
                    <span>${label}</span>
                    <span>${String(index + 1).padStart(2, "0")}</span>
                  </a>
                `
              )
              .join("")}
          </nav>

          <div class="sidebar-note">
            <div class="sidebar-note-title">${t().common.today}</div>
            <div>${localizedDate()}</div>
            <div class="sidebar-note-copy">${t().note}</div>
          </div>
        </aside>

        <div class="content">
          <header class="topbar">
            <div>
              <div class="topbar-path">${t().nav.dashboard} / ${routeTitle}</div>
              <div class="topbar-title">${t().topTitle}</div>
              <div class="topbar-subtitle">${t().topSubtitle}</div>
            </div>

            <div class="topbar-actions">
              <div class="topbar-meta">
                <span class="chip subtle">${localizedDate()}</span>
                <span class="chip accent">${routeTitle}</span>
              </div>
              ${languageToggle()}
              <div class="user-chip">
                <div class="avatar">SA</div>
                <div>
                  <div>${state.language === "ar" ? "سراج" : "Seraj"}</div>
                  <div class="small">${t().userRole}</div>
                </div>
              </div>
            </div>
          </header>

          ${content}
        </div>
      </div>
    </div>
  `;
}

function pageContent() {
  switch (state.route) {
    case "patients":
      return renderPatients();
    case "appointments":
      return renderAppointments();
    case "queue":
      return renderQueue();
    case "search":
      return renderSearch();
    case "print":
      return renderPrint();
    case "settings":
      return renderSettings();
    default:
      return renderDashboard();
  }
}

function render() {
  document.documentElement.lang = state.language;
  document.documentElement.dir = state.language === "ar" ? "rtl" : "ltr";
  const app = document.getElementById("app");

  app.innerHTML = state.loggedIn ? renderAppFrame(pageContent()) : renderLogin();
  bindEvents();
}

function bindEvents() {
  document.querySelectorAll("[data-language]").forEach((button) => {
    button.addEventListener("click", () => setLanguage(button.dataset.language));
  });

  document.querySelectorAll("[data-route]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      setRoute(button.dataset.route);
    });
  });

  const signInButton = document.getElementById("sign-in-button");

  if (signInButton) {
    signInButton.addEventListener("click", signIn);
  }

  const arabicName = document.getElementById("arabic-name");
  const englishName = document.getElementById("english-name");

  if (arabicName && englishName) {
    arabicName.addEventListener("input", () => {
      englishName.value = transliterateName(arabicName.value);
    });
  }
}

render();
