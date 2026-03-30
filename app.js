const BASE_DICTIONARY = {
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

const DEFAULT_CITY_OPTIONS = [
  "Tripoli",
  "Benghazi",
  "Misrata",
  "Sabha",
  "Zawiya",
  "Sirte",
  "Gharyan",
  "Zliten",
  "Tobruk",
  "Derna"
];

const NAME_DICTIONARY_CSV_EXAMPLE = `arabic_text,english_text
محمد,Mohammad
أحمد,Ahmed
عائشة,Aisha
سالم,Salem
نور,Noor
`;

function loadCityOptions() {
  try {
    const stored = JSON.parse(localStorage.getItem("rispro-city-options") || "[]");
    const merged = [...DEFAULT_CITY_OPTIONS, ...stored].map((entry) => String(entry || "").trim()).filter(Boolean);
    return Array.from(new Set(merged));
  } catch (error) {
    return [...DEFAULT_CITY_OPTIONS];
  }
}

function saveCityOptions(list) {
  localStorage.setItem("rispro-city-options", JSON.stringify(list));
}

const allowedRoutes = ["dashboard", "patients", "appointments", "calendar", "registrations", "queue", "modality", "doctor", "print", "statistics", "search", "pacs", "settings"];
const DEFAULT_ROUTE = "patients";
const state = {
  language: localStorage.getItem("rispro-language") || "ar",
  route: allowedRoutes.includes(localStorage.getItem("rispro-route")) ? localStorage.getItem("rispro-route") : DEFAULT_ROUTE,
  authChecked: false,
  session: null,
  loginForm: {
    username: "",
    password: ""
  },
  loginLoading: false,
  loginError: "",
  appError: "",
  toasts: [],
  dashboardLoading: false,
  dashboardReady: null,
  dashboardError: "",
  dashboardScheduleLoading: false,
  dashboardScheduleError: "",
  dashboardScheduleCounts: { next7: 0, next30: 0 },
  dashboardNextSlots: [],
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
  printSuccess: "",
  integrationLoading: false,
  integrationError: "",
  integrationSuccess: "",
  integrationStatus: null,
  pacsFindLoading: false,
  pacsFindError: "",
  pacsFindResults: [],
  pacsFindHasRun: false,
  pacsSearchForm: defaultPacsSearchForm(),
  pacsSearchLoading: false,
  pacsSearchError: "",
  pacsSearchResults: [],
  pacsSearchHasRun: false,
  pacsTestLoading: false,
  pacsTestError: "",
  pacsTestSuccess: "",
  pacsSettingsForm: defaultPacsSettingsForm(),
  dicomDevicesLoading: false,
  dicomDevicesError: "",
  dicomDevicesSuccess: "",
  dicomDevices: [],
  dicomDeviceForm: defaultDicomDeviceForm(),
  dicomDeviceSaving: false,
  scanPreparationLoading: false,
  printPreparationLoading: false,
  printResults: [],
  printFilters: defaultPrintFilters(),
  calendarLoading: false,
  calendarError: "",
  calendarAppointments: [],
  calendarFilters: defaultCalendarFilters(),
  calendarDisplayDate: getCalendarMonthStartDate(),
  calendarSelectedDate: getCurrentDateInputValue(),
  statisticsFilters: defaultStatisticsFilters(),
  statisticsLoading: false,
  statisticsError: "",
  statisticsSnapshot: null,
  registrationsFilters: defaultRegistrationsFilters(),
  selectedPrintAppointment: null,
  doctorLoading: false,
  doctorError: "",
  doctorResults: [],
  doctorFilters: defaultDoctorFilters(),
  doctorSelectedAppointment: null,
  doctorDocumentsLoading: false,
  doctorDocumentsError: "",
  doctorDocuments: [],
  doctorProtocolExamTypeId: "",
  doctorProtocolSaving: false,
  doctorProtocolError: "",
  doctorProtocolSuccess: "",
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
  appointmentCreatedDialogOpen: false,
  patientSuggestions: [],
  suggestionsLoading: false,
  addressOptions: loadCityOptions(),
  patientAddressMode: "select",
  patientEditAddressMode: "select",
  nameDictionary: { ...BASE_DICTIONARY },
  nameDictionaryEntries: [],
  nameDictionaryLoading: false,
  nameDictionaryError: "",
  nameDictionarySuccess: "",
  nameDictionarySavingId: "",
  examTypeSettingsEntries: [],
  examTypeSettingsModalities: [],
  examTypeSettingsLoading: false,
  examTypeSettingsError: "",
  examTypeSettingsSuccess: "",
  examTypeSettingsSavingId: "",
  examTypeSettingsForm: defaultExamTypeForm(),
  modalitySettingsEntries: [],
  modalitySettingsLoading: false,
  modalitySettingsError: "",
  modalitySettingsSuccess: "",
  modalitySettingsSavingId: "",
  modalitySettingsForm: defaultModalityForm(),
  nameDictionaryForm: {
    arabicText: "",
    englishText: "",
    isActive: true
  },
  nameDictionaryImportFile: null,
  nameDictionaryImportLoading: false,
  appointmentLookupsLoading: false,
  appointmentCalendarLoading: false,
  appointmentDaySettings: { fridayEnabled: true, saturdayEnabled: true },
  appointmentDaySettingsError: "",
  appointmentNoShowSummary: { count: 0, lastDate: "" },
  appointmentNoShowLoading: false,
  appointmentNoShowError: "",
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
  settingsSection: "menu",
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
  userSuccess: "",
  userDeletingId: null
};

const copy = {
  en: {
    appName: "National Cancer Center Benghazi",
    appNameAlternate: "المركز الوطني للأورام بنغازي",
    appSubtitle: "Reception workspace",
    topTitle: "National Cancer Center Benghazi Reception",
    topSubtitle: "Patient intake, scheduling, and supervision tools at NCCB.",
    userRoleLabel: "Signed in as",
    note: "Operations status for today’s reception shift.",
    nav: {
      dashboard: "Dashboard",
      patients: "Register patient",
      appointments: "Create appointment",
      calendar: "Calendar",
      registrations: "Registrations",
      queue: "Queue",
      modality: "Modality board",
      doctor: "Doctor home",
      print: "Printing",
      statistics: "Statistics",
      search: "Search patients",
      pacs: "PACS",
      settings: "Settings"
    },
    login: {
      title: "Welcome to RISpro Reception",
      body: "Sign in with your account to begin reception work. Sessions are secured by the backend.",
      signIn: "Sign in",
      username: "Username",
      password: "Password",
      note: "Use your supervisor or receptionist account."
    },
    dashboard: {
      title: "System dashboard",
      body: "A quick health check plus today's queue and no-show review status.",
      primary: "Register patient",
      secondary: "Search patients",
      next7Title: "Cases in next 7 days",
      next7Note: "Scheduled appointments in the coming week.",
      next30Title: "Cases in next 30 days",
      next30Note: "Scheduled appointments in the coming month.",
      avgNextSlotTitle: "Avg next slot",
      nextSlotTitle: "Next available slot by modality",
      nextSlotNote: "Days until the next open slot appears.",
      nextSlotUnavailable: "No open slots in the next 30 days",
      daysLabel: "days",
      todayLabel: "Today",
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
      plannedListTitle: "Operational reminders",
      plannedNote: "Keep an eye on queue flow, printing, and end-of-day confirmations."
    },
    patients: {
      title: "Patient registration",
      body: "Create a patient record with the required registration fields.",
      save: "Save patient",
      createAppointment: "Create appointment",
      clear: "Clear form",
      duplicates: "Check duplicates",
      success: "Patient saved successfully.",
      fields: {
        mrn: "MRN",
        arabicFullName: "Arabic full name",
        englishFullName: "English full name",
        ageYears: "Age",
        dateOfBirth: "Date of birth",
        sex: "Sex",
        nationalId: "National ID",
        nationalIdConfirmation: "Confirm National ID",
        phone1: "Phone 1",
        phone2: "Phone 2",
        address: "Address"
      },
      savedRecord: "Latest saved patient",
      possibleMatches: "Possible existing matches",
      supportNote: "Use duplicate checks before saving to keep records clean.",
      mrnAutoHint: "An MRN (six-digit patient number) is generated automatically and cannot be edited.",
      phone1Hint: "Phone 1 is required.",
      nationalIdHint: "National ID is optional."
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
      body: "Search for a patient, then choose the modality, exam, and day with availability.",
      patientSearch: "Find patient",
      patientPlaceholder: "Search by name, phone, or patient ID (national ID)",
      patientSelect: "Use this patient",
      selectedPatient: "Selected patient",
      pacsSearch: "Search PACS",
      pacsSearchHint: "Uses National ID to find prior studies.",
      pacsResultsTitle: "Previous studies",
      pacsNoResults: "No prior studies were found.",
      pacsLoading: "Searching PACS...",
      pacsMissingNationalId: "National ID is required to search PACS.",
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
      createdTitle: "Appointment created",
      createdBody: "The appointment was created successfully. You can print the appointment slip now.",
      printNow: "Print appointment slip",
      printSlip: "Print appointment slip",
      dateRequired: "Choose an appointment date before saving.",
      dateInputHint: "You can click an available day below or pick the exact date here.",
      selectedDateLabel: "Selected date",
      fullDay: "Full day",
      availableDay: "Available",
      overbookNotice: "This day is full. Supervisor overbooking is required.",
      dayDisabledFriday: "Friday appointments are disabled in settings.",
      dayDisabledSaturday: "Saturday appointments are disabled in settings.",
      previousNoShow: "Previous no-shows",
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
        pacsPatientId: "Patient ID",
        pacsModality: "Modality",
        pacsStudyDescription: "Study description",
        pacsStudyDate: "Study date",
        examNameAr: "Exam name Arabic",
        examNameEn: "Exam name English",
        specificInstructionAr: "Arabic instruction",
        specificInstructionEn: "English instruction"
      }
    },
    pacs: {
      title: "PACS search",
      body: "Search PACS studies by patient name, patient ID, accession number, or date.",
      searchButton: "Search PACS",
      resetButton: "Clear search",
      resultsTitle: "PACS studies",
      noResults: "No PACS studies were found.",
      loading: "Searching PACS...",
      testButton: "Test PACS connection",
      testSuccess: "PACS connection succeeded.",
      testFail: "PACS connection failed.",
      testHint: "Sends a basic C-ECHO to the configured PACS.",
      fields: {
        patientName: "Patient name",
        patientId: "Patient ID",
        accessionNumber: "Accession number",
        studyDate: "Study date"
      }
    },
    calendar: {
      title: "Appointment calendar",
      body: "Browse a full month, filter by modality, and print each day’s list.",
      summary: "Click a day to surface that day’s appointments and print them.",
      filtersTitle: "Calendar filters",
      clearFilters: "Clear filters",
      fields: {
        modality: "Modality"
      },
      selectedDayTitle: "Selected day",
      noSelection: "Pick a day on the calendar to view its appointments.",
      noAppointments: "No appointments for this day.",
      noAppointmentsShort: "No appointments",
      dayAppointmentsLabel: "appointments",
      dayCasesLabel: "cases",
      dayMoreLabel: "more",
      printButton: "Print day list",
      today: "Today",
      printTitlePrefix: "Daily appointments",
      monthLabelHint: "Monthly view",
      loading: "Loading calendar..."
    },
    registrations: {
      title: "Daily registrations",
      body: "View registrations by day, open one record, edit it, print its slip, or delete it.",
      filtersTitle: "Registration filters",
      listTitle: "Registered patients",
      detailsTitle: "Registration details",
      load: "Load registrations",
      delete: "Delete registration",
      noSelection: "Choose a registration from the list first."
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
      allDates: "All dates",
      dayOnly: "Single day",
      quickToday: "Today",
      quickTomorrow: "Tomorrow",
      quickNextWeek: "Next week",
      printList: "Print modality list",
      complete: "Mark completed",
      blocked: "Only modality staff or supervisors can use this page.",
      completed: "Appointment marked completed successfully."
    },
    print: {
      title: "Daily modality printing",
      body: "Load today's appointments and print daily lists by modality (CT, ultrasound, mammography, MRI, and more).",
      filtersTitle: "Daily list filters",
      date: "Date",
      dateFrom: "From",
      dateTo: "To",
      modality: "Modality",
      load: "Load list",
      quickToday: "Today",
      quickTomorrow: "Tomorrow",
      quickNextWeek: "Next 7 days",
      quickClear: "Single day",
      printDaily: "Print daily list",
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
      noAppointment: "Load the list and choose an appointment to print.",
      editAppointment: "Edit appointment",
      saveAppointment: "Save appointment changes",
      cancelAppointment: "Cancel appointment",
      cancelReason: "Cancel reason",
      appointmentUpdated: "Appointment updated successfully.",
      appointmentCancelled: "Appointment cancelled successfully.",
      fields: {
        documentType: "Document type",
        fileName: "File",
        notes: "Notes",
        slipDate: "Slip date",
        modalityInstructions: "Modality instructions",
        examInstructions: "Exam instructions"
      }
    },
    statistics: {
      title: "Appointment statistics",
      body: "Track appointment totals, modality workload, queue progress, and no-show trends for the selected period.",
      filtersTitle: "Statistics filters",
      print: "Print statistics",
      date: "Date",
      dateFrom: "From",
      dateTo: "To",
      modality: "Modality",
      load: "Load statistics",
      summaryTitle: "Summary",
      byModalityTitle: "By modality",
      byStatusTitle: "By status",
      byDayTitle: "Daily trend",
      totalAppointments: "Total appointments",
      uniquePatients: "Unique patients",
      completed: "Completed",
      noShowRate: "No-show rate",
      walkIn: "Walk-ins",
      inQueue: "In queue",
      statuses: {
        scheduled: "Scheduled",
        arrived: "Arrived",
        waiting: "Waiting",
        "in-progress": "In progress",
        completed: "Completed",
        discontinued: "Discontinued",
        "no-show": "No-show",
        cancelled: "Cancelled"
      }
    },
    doctor: {
      title: "Doctor home",
      body: "Review daily requests by modality, confirm patient demographics, view uploaded documents, and assign the protocol.",
      filtersTitle: "Request filters",
      load: "Load requests",
      dailyList: "Daily requests",
      selectedRequest: "Selected request",
      protocolTitle: "Protocol assignment",
      protocolHint: "Choose the protocol (exam type) for this request.",
      protocolSave: "Save protocol",
      protocolSaved: "Protocol updated successfully.",
      noSelection: "Pick a request from the list to view details.",
      documentsTitle: "Uploaded request documents",
      demographicsTitle: "Patient demographics"
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
      menuTitle: "Settings sections",
      menuBody: "Open one section at a time to keep settings clear and easier to manage.",
      sectionOpen: "Open section",
      sectionBack: "Back to settings menu",
      sectionUsers: "Users and access",
      sectionPatientRules: "Registration rules",
      sectionDictionary: "Custom dictionary",
      sectionExamTypes: "Exam types",
      sectionModalities: "Modalities",
      sectionCapacity: "Scheduling capacity",
      sectionPacs: "إعدادات PACS",
      sectionPacs: "PACS connection",
      sectionDicom: "DICOM gateway",
      sectionModules: "Supported modules",
      sectionCategories: "System behavior",
      sectionAudit: "Audit log",
      sectionBackup: "Backup and restore",
      modulesTitle: "Supported modules",
      modulesBody: "Active pages and the main API endpoints that power them.",
      dicomTitle: "DICOM gateway and devices",
      dicomBody: "Manage MWL and MPPS endpoint settings and map each modality device by AE Title.",
      dicomDevicesTitle: "Mapped modality devices",
      dicomDevicesEmpty: "No DICOM devices are mapped yet.",
      dicomDeviceAdd: "Add device",
      dicomDeviceSave: "Save device",
      dicomDeviceReset: "Clear form",
      dicomDeviceDelete: "Delete device",
      dicomDeviceEdit: "Edit",
      dicomDeviceSaved: "DICOM device saved successfully.",
      dicomDeviceDeleted: "DICOM device removed successfully.",
      dicomGatewaySave: "Save DICOM gateway settings",
      dicomGatewayHint: "These settings must match the sidecar gateway and DCMTK listeners.",
      capacityTitle: "Maximum appointments per modality",
      capacityBody:
        "Set the maximum number of appointments allowed per modality per day. Leave blank to use each modality capacity only.",
      capacitySave: "Save capacity settings",
      maxCasesPerModalityLabel: "Global maximum per modality/day",
      maxCasesPerModalityHint:
        "When this limit is reached, overbooking requires supervisor password confirmation and reason.",
      reauthTitle: "Supervisor confirmation",
      reauthBody: "Enter the supervisor password again before opening sensitive settings and backup tools.",
      reauthButton: "Confirm supervisor access",
      patientRulesTitle: "Registration requirements",
      patientRulesBody: "Choose which fields are mandatory during patient registration.",
      patientRulesSave: "Save registration rules",
      dictionaryTitle: "Name dictionary",
      dictionaryBody: "Add Arabic-to-English name overrides for transliteration.",
      dictionaryAdd: "Add name",
      dictionaryArabic: "Arabic name",
      dictionaryEnglish: "English name",
      dictionaryActive: "Active",
      dictionarySave: "Save entry",
      dictionaryImportTitle: "Import dictionary",
      dictionaryImportBody: "Upload an Arabic/English CSV file to batch-add dictionary entries.",
      dictionaryImportFile: "CSV file",
      dictionaryImportHint: "Each row should contain Arabic text followed by English text separated by a comma.",
      dictionaryImportExample: "Download example CSV",
      dictionaryImportSubmit: "Import CSV",
      dictionaryImportSuccess: "Dictionary imported successfully.",
      dictionaryDelete: "Remove",
      examTypesTitle: "Exam types",
      examTypesBody: "Add, edit, or remove exam types and link each one to a modality.",
      examTypesAdd: "Add exam type",
      examTypesSave: "Save exam type",
      examTypesDelete: "Delete exam type",
      examTypesModality: "Modality",
      examTypesEmpty: "No exam types have been added yet.",
      modalitiesTitle: "Modalities",
      modalitiesBody: "Add, edit, or remove modalities and set each daily capacity.",
      modalitiesAdd: "Add modality",
      modalitiesSave: "Save modality",
      modalitiesDelete: "Delete modality",
      modalitiesEmpty: "No modalities have been added yet.",
      modalitiesCode: "Modality code",
      modalitiesNameAr: "Modality name Arabic",
      modalitiesNameEn: "Modality name English",
      modalitiesDailyCapacity: "Daily capacity",
      modalitiesInstructionAr: "Arabic instruction",
      modalitiesInstructionEn: "English instruction",
      modalitiesStatus: "Status",
      users: "Users",
      addUser: "Create user",
      deleteUser: "Delete user",
      userDeleted: "User deleted successfully.",
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
      close: "Close",
      menu: "Menu",
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
      usersShown: "Users shown",
      status: "Status"
    }
  },
  ar: {
    appName: "المركز الوطني للأورام بنغازي",
    appNameAlternate: "National Cancer Center Benghazi",
    appSubtitle: "واجهة عمل الاستقبال",
    topTitle: "المركز الوطني للأورام بنغازي",
    topSubtitle: "تسجيل المرضى والتنسيق والإشراف في المركز.",
    userRoleLabel: "تم تسجيل الدخول كـ",
    note: "حالة التشغيل لدوام الاستقبال اليوم.",
    nav: {
      dashboard: "الرئيسية",
      patients: "تسجيل مريض",
      appointments: "إنشاء موعد",
      calendar: "التقويم",
      registrations: "التسجيلات",
      queue: "الطابور",
      modality: "لوحة الجهاز",
      doctor: "لوحة الطبيب",
      print: "الطباعة",
      statistics: "الإحصائيات",
      search: "البحث عن مريض",
      pacs: "PACS",
      settings: "الإعدادات"
    },
    login: {
      title: "مرحباً بك في RISpro Reception",
      body: "سجّل الدخول بحسابك لبدء عمل الاستقبال. الجلسات مؤمنة عبر الخادم.",
      signIn: "تسجيل الدخول",
      username: "اسم المستخدم",
      password: "كلمة المرور",
      note: "استخدم حساب المشرف أو الاستقبال."
    },
    dashboard: {
      title: "لوحة حالة النظام",
      body: "فحص سريع للحالة مع متابعة طابور اليوم ومراجعة عدم الحضور.",
      primary: "تسجيل مريض",
      secondary: "البحث عن مريض",
      next7Title: "الحالات خلال 7 أيام",
      next7Note: "المواعيد المجدولة خلال الأسبوع القادم.",
      next30Title: "الحالات خلال 30 يوماً",
      next30Note: "المواعيد المجدولة خلال الشهر القادم.",
      avgNextSlotTitle: "متوسط أقرب موعد",
      nextSlotTitle: "أقرب موعد متاح لكل جهاز",
      nextSlotNote: "عدد الأيام حتى أول فتحة متاحة.",
      nextSlotUnavailable: "لا توجد فتحات خلال 30 يوماً",
      daysLabel: "أيام",
      todayLabel: "اليوم",
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
      plannedListTitle: "تذكيرات تشغيلية",
      plannedNote: "تابع حركة الطابور والطباعة وتأكيدات نهاية اليوم."
    },
    patients: {
      title: "تسجيل المريض",
      body: "أنشئ سجل مريض مع حقول التسجيل المطلوبة.",
      save: "حفظ المريض",
      createAppointment: "إنشاء موعد",
      clear: "تفريغ النموذج",
      duplicates: "فحص السجلات المشابهة",
      success: "تم حفظ المريض بنجاح.",
      fields: {
        mrn: "رقم الملف",
        arabicFullName: "الاسم الكامل بالعربية",
        englishFullName: "الاسم الكامل بالإنجليزية",
        ageYears: "العمر",
        dateOfBirth: "تاريخ الميلاد",
        sex: "الجنس",
        nationalId: "الرقم الوطني",
        nationalIdConfirmation: "تأكيد الرقم الوطني",
        phone1: "الهاتف 1",
        phone2: "الهاتف 2",
        address: "العنوان"
      },
      savedRecord: "آخر مريض تم حفظه",
      possibleMatches: "سجلات محتملة موجودة",
      supportNote: "تحقق من التكرار قبل الحفظ للحفاظ على نظافة البيانات.",
      mrnAutoHint: "يتم إنشاء رقم MRN المكوّن من ستة أرقام تلقائياً ولا يمكن تغييره.",
      phone1Hint: "الهاتف 1 مطلوب.",
      nationalIdHint: "الرقم الوطني اختياري."
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
      body: "ابحث عن المريض ثم اختر الجهاز ونوع الفحص واليوم حسب التوفر.",
      patientSearch: "البحث عن مريض",
      patientPlaceholder: "ابحث بالاسم أو الهاتف أو رقم المريض (الرقم الوطني)",
      patientSelect: "اختيار هذا المريض",
      selectedPatient: "المريض المختار",
      pacsSearch: "بحث PACS",
      pacsSearchHint: "يستخدم الرقم الوطني للبحث عن الدراسات السابقة.",
      pacsResultsTitle: "الدراسات السابقة",
      pacsNoResults: "لا توجد دراسات سابقة.",
      pacsLoading: "جارٍ البحث في PACS...",
      pacsMissingNationalId: "الرقم الوطني مطلوب لبحث PACS.",
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
      createdTitle: "تم إنشاء الموعد",
      createdBody: "تم إنشاء الموعد بنجاح. يمكنك الآن طباعة وصل الموعد.",
      printNow: "طباعة وصل الموعد",
      printSlip: "طباعة وصل الموعد",
      dateRequired: "اختر تاريخ الموعد قبل الحفظ.",
      dateInputHint: "يمكنك الضغط على يوم متاح أدناه أو اختيار التاريخ مباشرة من هنا.",
      selectedDateLabel: "التاريخ المختار",
      fullDay: "اليوم ممتلئ",
      availableDay: "متاح",
      overbookNotice: "هذا اليوم ممتلئ. يلزم تجاوز السعة بواسطة مشرف.",
      dayDisabledFriday: "مواعيد يوم الجمعة غير مفعّلة في الإعدادات.",
      dayDisabledSaturday: "مواعيد يوم السبت غير مفعّلة في الإعدادات.",
      previousNoShow: "حالات عدم الحضور السابقة",
      savedCard: "آخر موعد تم حفظه",
      fields: {
        modality: "Modality",
        examType: "Exam type",
        priority: "Reporting priority",
        notes: "Notes",
        overbookingReason: "سبب تجاوز السعة",
        appointmentDate: "تاريخ الموعد",
        dailyCapacity: "السعة اليومية",
        remaining: "الشواغر المتبقية",
        booked: "المحجوز",
        slotNumber: "رقم دور الجهاز",
        accessionNumber: "رقم الدخول",
        pacsPatientId: "رقم المريض",
        pacsModality: "الجهاز",
        pacsStudyDescription: "وصف الدراسة",
        pacsStudyDate: "تاريخ الدراسة",
        examNameAr: "اسم الفحص بالعربية",
        examNameEn: "اسم الفحص بالإنجليزية",
        specificInstructionAr: "تعليمات بالعربية",
        specificInstructionEn: "تعليمات بالإنجليزية"
      }
    },
    pacs: {
      title: "بحث PACS",
      body: "ابحث في دراسات PACS باسم المريض أو رقم المريض أو رقم الدخول أو التاريخ.",
      searchButton: "بحث PACS",
      resetButton: "مسح البحث",
      resultsTitle: "دراسات PACS",
      noResults: "لم يتم العثور على دراسات في PACS.",
      loading: "جارٍ البحث في PACS...",
      testButton: "اختبار اتصال PACS",
      testSuccess: "تم نجاح الاتصال بـ PACS.",
      testFail: "فشل الاتصال بـ PACS.",
      testHint: "يرسل فحص C-ECHO إلى PACS المعرّف.",
      fields: {
        patientName: "اسم المريض",
        patientId: "رقم المريض",
        accessionNumber: "رقم الدخول",
        studyDate: "تاريخ الدراسة"
      }
    },
    calendar: {
      title: "تقويم المواعيد",
      body: "استعرض الجدول الشهري، صفّ المواعيد حسب الجهاز، واطبع قوائم اليوم.",
      summary: "اضغط على يوم لعرض مواعيد ذلك اليوم وطباعتها.",
      filtersTitle: "فلاتر التقويم",
      clearFilters: "مسح الفلاتر",
      fields: {
        modality: "الجهاز"
      },
      selectedDayTitle: "اليوم المختار",
      noSelection: "اختر يوماً من التقويم لعرض المواعيد الخاصة به.",
      noAppointments: "لا توجد مواعيد في هذا اليوم.",
      noAppointmentsShort: "لا توجد مواعيد",
      dayAppointmentsLabel: "مواعيد",
      dayCasesLabel: "حالات",
      dayMoreLabel: "أخرى",
      printButton: "طباعة قائمة اليوم",
      today: "اليوم",
      printTitlePrefix: "مواعيد يومية",
      monthLabelHint: "عرض شهري",
      loading: "جارٍ تحميل التقويم..."
    },
    registrations: {
      title: "تسجيلات اليوم",
      body: "اعرض التسجيلات حسب اليوم، وافتح السجل، وعدّله، واطبع الوصل، أو احذفه.",
      filtersTitle: "فلاتر التسجيلات",
      listTitle: "المرضى المسجلون",
      detailsTitle: "تفاصيل التسجيل",
      load: "تحميل التسجيلات",
      delete: "حذف التسجيل",
      noSelection: "اختر تسجيلاً من القائمة أولاً."
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
      allDates: "كل التواريخ",
      dayOnly: "يوم واحد",
      quickToday: "اليوم",
      quickTomorrow: "غداً",
      quickNextWeek: "الأسبوع القادم",
      printList: "طباعة قائمة الجهاز",
      complete: "تحديد كمكتمل",
      blocked: "هذه الصفحة لموظفي الأجهزة أو المشرف فقط.",
      completed: "تم تحديد الموعد كمكتمل بنجاح."
    },
    print: {
      title: "طباعة القوائم اليومية حسب الأجهزة",
      body: "حمّل مواعيد اليوم واطبع القوائم اليومية حسب كل جهاز مثل CT وUltrasound وMammography وMRI وغيرها.",
      filtersTitle: "فلاتر القائمة اليومية",
      date: "التاريخ",
      dateFrom: "من",
      dateTo: "إلى",
      modality: "Modality",
      load: "تحميل القائمة",
      quickToday: "اليوم",
      quickTomorrow: "غداً",
      quickNextWeek: "الأسبوع القادم",
      quickClear: "يوم واحد",
      printDaily: "طباعة القائمة اليومية",
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
      noAppointment: "حمّل القائمة ثم اختر موعداً للطباعة.",
      editAppointment: "تعديل الموعد",
      saveAppointment: "حفظ تعديلات الموعد",
      cancelAppointment: "إلغاء الموعد",
      cancelReason: "سبب الإلغاء",
      appointmentUpdated: "تم تحديث الموعد بنجاح.",
      appointmentCancelled: "تم إلغاء الموعد بنجاح.",
      fields: {
        documentType: "نوع الوثيقة",
        fileName: "الملف",
        notes: "ملاحظات",
        slipDate: "تاريخ الوصل",
        modalityInstructions: "تعليمات الجهاز",
        examInstructions: "تعليمات الفحص"
      }
    },
    statistics: {
      title: "إحصائيات المواعيد",
      body: "تابع إجمالي المواعيد وحمل الأجهزة وحالة الطابور واتجاه عدم الحضور خلال الفترة المحددة.",
      filtersTitle: "فلاتر الإحصائيات",
      print: "طباعة الإحصائيات",
      date: "التاريخ",
      dateFrom: "من",
      dateTo: "إلى",
      modality: "الجهاز",
      load: "تحميل الإحصائيات",
      summaryTitle: "ملخص",
      byModalityTitle: "حسب الجهاز",
      byStatusTitle: "حسب الحالة",
      byDayTitle: "الاتجاه اليومي",
      totalAppointments: "إجمالي المواعيد",
      uniquePatients: "المرضى الفريدون",
      completed: "المكتمل",
      noShowRate: "نسبة عدم الحضور",
      walkIn: "المرضى المباشرون",
      inQueue: "في الطابور",
      statuses: {
        scheduled: "مجدول",
        arrived: "وصل",
        waiting: "منتظر",
        "in-progress": "بدأ الفحص",
        completed: "مكتمل",
        discontinued: "تم إيقافه",
        "no-show": "عدم حضور",
        cancelled: "ملغي"
      }
    },
    doctor: {
      title: "لوحة الطبيب",
      body: "استعرض طلبات اليوم حسب الجهاز، وتحقق من بيانات المريض، واطلع على الوثائق المرفوعة، وحدد البروتوكول.",
      filtersTitle: "فلاتر الطلبات",
      load: "تحميل الطلبات",
      dailyList: "طلبات اليوم",
      selectedRequest: "الطلب المختار",
      protocolTitle: "تحديد البروتوكول",
      protocolHint: "اختر البروتوكول (نوع الفحص) لهذا الطلب.",
      protocolSave: "حفظ البروتوكول",
      protocolSaved: "تم تحديث البروتوكول بنجاح.",
      noSelection: "اختر طلباً من القائمة لعرض التفاصيل.",
      documentsTitle: "وثائق الطلب المرفوعة",
      demographicsTitle: "بيانات المريض"
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
      menuTitle: "أقسام الإعدادات",
      menuBody: "افتح كل قسم بشكل منفصل ليكون الضبط أوضح وأسهل في الإدارة.",
      sectionOpen: "فتح القسم",
      sectionBack: "العودة لقائمة الإعدادات",
      sectionUsers: "المستخدمون والصلاحيات",
      sectionPatientRules: "قواعد التسجيل",
      sectionDictionary: "القاموس المخصص",
      sectionExamTypes: "أنواع الفحوصات",
      sectionModalities: "الأجهزة",
      sectionCapacity: "سعة الجدولة",
      sectionDicom: "بوابة DICOM",
      sectionModules: "الوحدات المدعومة",
      sectionCategories: "سلوك النظام",
      sectionAudit: "سجل التدقيق",
      sectionBackup: "النسخ الاحتياطي والاستعادة",
      modulesTitle: "الوحدات المدعومة",
      modulesBody: "الصفحات النشطة ونقاط الـ API الأساسية التي تعتمد عليها.",
      dicomTitle: "بوابة DICOM والأجهزة",
      dicomBody: "إدارة إعدادات MWL وMPPS وربط كل جهاز حسب AE Title.",
      dicomDevicesTitle: "أجهزة التصوير المرتبطة",
      dicomDevicesEmpty: "لا توجد أجهزة DICOM مرتبطة بعد.",
      dicomDeviceAdd: "إضافة جهاز",
      dicomDeviceSave: "حفظ الجهاز",
      dicomDeviceReset: "مسح النموذج",
      dicomDeviceDelete: "حذف الجهاز",
      dicomDeviceEdit: "تعديل",
      dicomDeviceSaved: "تم حفظ جهاز DICOM بنجاح.",
      dicomDeviceDeleted: "تم حذف جهاز DICOM بنجاح.",
      dicomGatewaySave: "حفظ إعدادات بوابة DICOM",
      dicomGatewayHint: "يجب أن تطابق هذه الإعدادات البوابة الجانبية ومستمعات DCMTK.",
      capacityTitle: "الحد الأقصى للمواعيد لكل جهاز",
      capacityBody:
        "حدد الحد الأقصى لعدد المواعيد المسموح بها لكل جهاز في اليوم. اتركه فارغاً لاستخدام سعة كل جهاز فقط.",
      capacitySave: "حفظ إعدادات السعة",
      maxCasesPerModalityLabel: "الحد العام لكل جهاز/يوم",
      maxCasesPerModalityHint:
        "عند الوصول لهذا الحد، يلزم تأكيد كلمة مرور المشرف وسبب التجاوز.",
      reauthTitle: "تأكيد المشرف",
      reauthBody: "أدخل كلمة مرور المشرف مرة أخرى قبل فتح الإعدادات الحساسة وأدوات النسخ الاحتياطي.",
      reauthButton: "تأكيد صلاحية المشرف",
      patientRulesTitle: "متطلبات التسجيل",
      patientRulesBody: "اختر الحقول الإلزامية عند تسجيل المريض.",
      patientRulesSave: "حفظ متطلبات التسجيل",
      dictionaryTitle: "قاموس الأسماء",
      dictionaryBody: "أضف تحويلات مخصصة من العربية إلى الإنجليزية.",
      dictionaryAdd: "إضافة اسم",
      dictionaryArabic: "الاسم بالعربية",
      dictionaryEnglish: "الاسم بالإنجليزية",
      dictionaryActive: "مفعّل",
      dictionarySave: "حفظ المدخل",
      dictionaryImportTitle: "استيراد القاموس",
      dictionaryImportBody: "ارفع ملف CSV عربي/إنجليزي لإضافة مدخلات القاموس دفعة واحدة.",
      dictionaryImportFile: "ملف CSV",
      dictionaryImportHint: "يجب أن تحتوي كل سطر على الاسم العربي ثم الاسم الإنجليزي مفصولاً بفاصلة.",
      dictionaryImportExample: "تنزيل مثال CSV",
      dictionaryImportSubmit: "استيراد CSV",
      dictionaryImportSuccess: "تم استيراد القاموس بنجاح.",
      dictionaryDelete: "حذف",
      examTypesTitle: "أنواع الفحوصات",
      examTypesBody: "أضف أو عدّل أو احذف أنواع الفحوصات واربط كل نوع بالجهاز المناسب.",
      examTypesAdd: "إضافة نوع فحص",
      examTypesSave: "حفظ نوع الفحص",
      examTypesDelete: "حذف نوع الفحص",
      examTypesModality: "الجهاز",
      examTypesEmpty: "لا توجد أنواع فحوصات مضافة بعد.",
      modalitiesTitle: "الأجهزة",
      modalitiesBody: "أضف أو عدّل أو احذف الأجهزة واضبط سعة كل جهاز يومياً.",
      modalitiesAdd: "إضافة جهاز",
      modalitiesSave: "حفظ الجهاز",
      modalitiesDelete: "حذف الجهاز",
      modalitiesEmpty: "لا توجد أجهزة مضافة بعد.",
      modalitiesCode: "رمز الجهاز",
      modalitiesNameAr: "اسم الجهاز بالعربية",
      modalitiesNameEn: "اسم الجهاز بالإنجليزية",
      modalitiesDailyCapacity: "السعة اليومية",
      modalitiesInstructionAr: "تعليمات بالعربية",
      modalitiesInstructionEn: "تعليمات بالإنجليزية",
      modalitiesStatus: "الحالة",
      users: "المستخدمون",
      addUser: "إنشاء مستخدم",
      deleteUser: "حذف المستخدم",
      userDeleted: "تم حذف المستخدم بنجاح.",
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
      close: "إغلاق",
      menu: "القائمة",
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
      usersShown: "عدد المستخدمين المعروضين",
      status: "الحالة"
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
  pacs_connection: {
    titleEn: "PACS connection",
    titleAr: "إعدادات ربط PACS",
    summaryEn: "Connect to PACS for C-FIND study lookups.",
    summaryAr: "ربط نظام PACS للبحث عن الدراسات السابقة.",
    fields: {
      enabled: { en: "PACS enabled", ar: "تفعيل PACS" },
      host: { en: "PACS host", ar: "عنوان PACS" },
      port: { en: "PACS port", ar: "منفذ PACS" },
      called_ae_title: { en: "Called AE Title", ar: "AE Title المستهدف" },
      calling_ae_title: { en: "Calling AE Title", ar: "AE Title المرسل" },
      timeout_seconds: { en: "Timeout seconds", ar: "مهلة الاتصال بالثواني" }
    }
  },
  dicom_gateway: {
    titleEn: "DICOM gateway",
    titleAr: "بوابة DICOM",
    summaryEn: "MWL and MPPS sidecar paths, ports, and callback settings.",
    summaryAr: "مسارات ومنافذ وإعدادات الاستدعاء الخاصة ببوابة MWL وMPPS.",
    fields: {
      enabled: { en: "Gateway enabled", ar: "تفعيل البوابة" },
      bind_host: { en: "Bind host", ar: "عنوان الاستماع" },
      mwl_ae_title: { en: "MWL AE Title", ar: "AE Title للـ MWL" },
      mwl_port: { en: "MWL port", ar: "منفذ MWL" },
      mpps_ae_title: { en: "MPPS AE Title", ar: "AE Title للـ MPPS" },
      mpps_port: { en: "MPPS port", ar: "منفذ MPPS" },
      worklist_output_dir: { en: "Worklist output dir", ar: "مجلد ملفات العمل النهائي" },
      worklist_source_dir: { en: "Worklist source dir", ar: "مجلد ملفات العمل المصدرية" },
      mpps_inbox_dir: { en: "MPPS inbox dir", ar: "مجلد وارد MPPS" },
      mpps_processed_dir: { en: "MPPS processed dir", ar: "مجلد MPPS المعالج" },
      mpps_failed_dir: { en: "MPPS failed dir", ar: "مجلد MPPS الفاشل" },
      callback_secret: { en: "Callback secret", ar: "سر الاستدعاء" },
      rebuild_behavior: { en: "Rebuild behavior", ar: "سلوك إعادة البناء" },
      dump2dcm_command: { en: "dump2dcm command", ar: "أمر dump2dcm" },
      dcmdump_command: { en: "dcmdump command", ar: "أمر dcmdump" }
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
      overbooking_reason_required: { en: "Require overbooking reason", ar: "إلزام سبب تجاوز السعة" },
      max_cases_per_modality: { en: "Max cases per modality/day", ar: "الحد الأقصى لكل جهاز/يوم" },
      allow_friday_appointments: { en: "Allow Friday appointments", ar: "السماح بمواعيد يوم الجمعة" },
      allow_saturday_appointments: { en: "Allow Saturday appointments", ar: "السماح بمواعيد يوم السبت" }
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
    arabicFullName: "",
    englishFullName: "",
    ageYears: "",
    estimatedDateOfBirth: "",
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

function defaultModalityForm() {
  return {
    code: "",
    nameAr: "",
    nameEn: "",
    dailyCapacity: "",
    generalInstructionAr: "",
    generalInstructionEn: "",
    isActive: "enabled"
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
    dateFrom: "",
    dateTo: "",
    modalityId: "",
    query: ""
  };
}

function defaultStatisticsFilters() {
  return {
    date: getCurrentDateInputValue(),
    dateFrom: "",
    dateTo: "",
    modalityId: ""
  };
}

function defaultRegistrationsFilters() {
  return {
    date: getCurrentDateInputValue(),
    dateFrom: "",
    dateTo: "",
    modalityId: "",
    query: ""
  };
}

function defaultDoctorFilters() {
  return {
    date: getCurrentDateInputValue(),
    modalityId: ""
  };
}

function defaultCalendarFilters() {
  return {
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

function defaultPacsSettingsForm() {
  return {
    enabled: "enabled",
    host: "192.9.101.164",
    port: "103",
    calledAeTitle: "osirixr",
    callingAeTitle: "RISPRO",
    timeoutSeconds: "10"
  };
}

function defaultDicomDeviceForm() {
  return {
    deviceId: "",
    modalityId: "",
    deviceName: "",
    modalityAeTitle: "",
    scheduledStationAeTitle: "",
    stationName: "",
    stationLocation: "",
    sourceIp: "",
    mwlEnabled: "enabled",
    mppsEnabled: "enabled",
    isActive: "enabled"
  };
}

function defaultPacsSearchForm() {
  return {
    patientName: "",
    patientId: "",
    accessionNumber: "",
    studyDate: ""
  };
}

function defaultModalityFilters() {
  return {
    date: getCurrentDateInputValue(),
    modalityId: "",
    scope: "day"
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

function formatDateInput(date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Tripoli",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = formatter.formatToParts(date).reduce((accumulator, part) => {
    if (part.type !== "literal") {
      accumulator[part.type] = part.value;
    }

    return accumulator;
  }, {});

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDaysToDateInput(dateString, days) {
  const value = dateString || getCurrentDateInputValue();
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return formatDateInput(date);
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
    prepare_scan: { en: "Prepare scan", ar: "تجهيز مسح" },
    pacs_cfind: { en: "PACS C-FIND", ar: "بحث PACS" },
    pacs_echo: { en: "PACS C-ECHO", ar: "اختبار PACS" },
    mpps_start: { en: "MPPS start", ar: "بداية MPPS" },
    mpps_complete: { en: "MPPS complete", ar: "اكتمال MPPS" },
    mpps_discontinue: { en: "MPPS discontinue", ar: "إيقاف MPPS" },
    create_dicom_device: { en: "Create DICOM device", ar: "إنشاء جهاز DICOM" },
    update_dicom_device: { en: "Update DICOM device", ar: "تعديل جهاز DICOM" },
    delete_dicom_device: { en: "Delete DICOM device", ar: "حذف جهاز DICOM" }
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

function ensureRequiredSettingsDefaults(catalog) {
  const nextCatalog = { ...(catalog || {}) };
  const requiredByCategory = {
    scheduling_and_capacity: [
      { key: "max_cases_per_modality", value: "" },
      { key: "allow_friday_appointments", value: "enabled" },
      { key: "allow_saturday_appointments", value: "enabled" }
    ],
    pacs_connection: [
      { key: "enabled", value: "enabled" },
      { key: "host", value: "192.9.101.164" },
      { key: "port", value: "103" },
      { key: "called_ae_title", value: "osirixr" },
      { key: "calling_ae_title", value: "RISPRO" },
      { key: "timeout_seconds", value: "10" }
    ],
    dicom_gateway: [
      { key: "enabled", value: "enabled" },
      { key: "bind_host", value: "0.0.0.0" },
      { key: "mwl_ae_title", value: "RISPRO_MWL" },
      { key: "mwl_port", value: "11112" },
      { key: "mpps_ae_title", value: "RISPRO_MPPS" },
      { key: "mpps_port", value: "11113" },
      { key: "worklist_output_dir", value: "storage/dicom/worklists" },
      { key: "worklist_source_dir", value: "storage/dicom/worklist-source" },
      { key: "mpps_inbox_dir", value: "storage/dicom/mpps/inbox" },
      { key: "mpps_processed_dir", value: "storage/dicom/mpps/processed" },
      { key: "mpps_failed_dir", value: "storage/dicom/mpps/failed" },
      { key: "callback_secret", value: "change-me-dicom-callback" },
      { key: "rebuild_behavior", value: "incremental_on_write" },
      { key: "dump2dcm_command", value: "dump2dcm" },
      { key: "dcmdump_command", value: "dcmdump" }
    ]
  };

  Object.entries(requiredByCategory).forEach(([category, requiredEntries]) => {
    const existingEntries = Array.isArray(nextCatalog[category]) ? [...nextCatalog[category]] : [];

    for (const required of requiredEntries) {
      const hasEntry = existingEntries.some((entry) => entry.setting_key === required.key);

      if (!hasEntry) {
        existingEntries.push({
          category,
          setting_key: required.key,
          setting_value: { value: required.value },
          updated_at: null
        });
      }
    }

    existingEntries.sort((left, right) => String(left.setting_key).localeCompare(String(right.setting_key)));
    nextCatalog[category] = existingEntries;
  });

  return nextCatalog;
}

function hydratePacsSettingsForm(catalog) {
  const nextCatalog = catalog || state.settingsCatalog;

  state.pacsSettingsForm = {
    enabled: getSettingsFieldValue(
      (nextCatalog.pacs_connection || []).find((entry) => entry.setting_key === "enabled") || { setting_value: { value: "enabled" } }
    ),
    host: getSettingsFieldValue(
      (nextCatalog.pacs_connection || []).find((entry) => entry.setting_key === "host") || { setting_value: { value: "192.9.101.164" } }
    ),
    port: getSettingsFieldValue(
      (nextCatalog.pacs_connection || []).find((entry) => entry.setting_key === "port") || { setting_value: { value: "103" } }
    ),
    calledAeTitle: getSettingsFieldValue(
      (nextCatalog.pacs_connection || []).find((entry) => entry.setting_key === "called_ae_title") || { setting_value: { value: "osirixr" } }
    ),
    callingAeTitle: getSettingsFieldValue(
      (nextCatalog.pacs_connection || []).find((entry) => entry.setting_key === "calling_ae_title") || { setting_value: { value: "RISPRO" } }
    ),
    timeoutSeconds: getSettingsFieldValue(
      (nextCatalog.pacs_connection || []).find((entry) => entry.setting_key === "timeout_seconds") || { setting_value: { value: "10" } }
    )
  };
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
    .map((chunk) => state.nameDictionary[chunk] || chunk)
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

function formatDicomDate(value) {
  const clean = String(value || "").trim();
  if (!clean) {
    return "";
  }

  const iso = /^\d{8}$/.test(clean)
    ? `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`
    : clean;
  const parsed = new Date(iso);

  if (Number.isNaN(parsed.getTime())) {
    return clean;
  }

  return formatDisplayDate(parsed.toISOString());
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

function getTripoliWeekday(isoDate) {
  if (!isoDate) {
    return "";
  }

  const date = new Date(`${isoDate}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Tripoli", weekday: "long" })
    .format(date)
    .toLowerCase();
}

function getDisabledAppointmentDayMessage(isoDate) {
  if (!isoDate) {
    return "";
  }

  const weekday = getTripoliWeekday(isoDate);

  if (weekday === "friday" && !state.appointmentDaySettings.fridayEnabled) {
    return t().appointments.dayDisabledFriday;
  }

  if (weekday === "saturday" && !state.appointmentDaySettings.saturdayEnabled) {
    return t().appointments.dayDisabledSaturday;
  }

  return "";
}

function deriveDobFromNationalId(value) {
  const digits = String(value || "").replace(/\D/g, "");

  if (digits.length < 5) {
    return "";
  }

  const extracted = digits.slice(0, 5);
  const year = extracted.length === 5 ? extracted.slice(-4) : extracted;

  if (!/^\d{4}$/.test(year)) {
    return "";
  }

  return `${year}-01-01`;
}

function getCurrentDateInputValue() {
  return formatDateInput(new Date());
}

function getCalendarMonthStartDate() {
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
}

function formatIsoDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate()
  ).padStart(2, "0")}`;
}

function parseIsoDate(value) {
  const [year, month, day] = String(value || "").split("-").map((part) => Number(part));
  if (!year || !month || !day) {
    return new Date(NaN);
  }
  return new Date(Date.UTC(year, month - 1, day));
}

function addUtcDays(date, offset) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + offset));
}

function addUtcMonths(date, offset) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
}

function getCalendarMonthRange(date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return { start, end };
}

function getCalendarGridStart(date) {
  const firstDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const dayOfWeek = firstDay.getUTCDay();
  return new Date(Date.UTC(firstDay.getUTCFullYear(), firstDay.getUTCMonth(), 1 - dayOfWeek));
}

function getCalendarWeekdayLabels() {
  const formatter = new Intl.DateTimeFormat(state.language === "ar" ? "ar-LY" : "en-GB", {
    weekday: "short"
  });
  const labels = [];
  for (let index = 0; index < 7; index += 1) {
    const current = new Date(Date.UTC(2023, 0, 1 + index));
    labels.push(formatter.format(current));
  }
  return labels;
}

function formatCalendarMonthLabel(date) {
  return new Intl.DateTimeFormat(state.language === "ar" ? "ar-LY" : "en-GB", {
    month: "long",
    year: "numeric"
  }).format(date);
}

function groupCalendarAppointments() {
  const result = {};
  const filterModality = state.calendarFilters.modalityId ? String(state.calendarFilters.modalityId) : "";

  for (const appointment of state.calendarAppointments) {
    if (filterModality && String(appointment.modality_id) !== filterModality) {
      continue;
    }

    const dayKey = normalizeDateText(appointment.appointment_date);
    if (!result[dayKey]) {
      result[dayKey] = [];
    }
    result[dayKey].push(appointment);
  }

  return result;
}

function getCalendarAppointmentsForDate(date) {
  if (!date) {
    return [];
  }

  const grouped = groupCalendarAppointments();
  return grouped[date] || [];
}

function formatSex(value) {
  if (value === "female") {
    return t().common.female;
  }

  return t().common.male;
}

function rebuildNameDictionary(entries) {
  state.nameDictionary = {
    ...BASE_DICTIONARY,
    ...(entries || []).reduce((accumulator, entry) => {
      if (entry?.arabic_text && entry?.english_text && entry?.is_active !== false) {
        accumulator[entry.arabic_text] = entry.english_text;
      }
      return accumulator;
    }, {})
  };
}

function formatModalityName(entry) {
  return (
    entry?.name_en ||
    entry?.modality_name_en ||
    entry?.name_ar ||
    entry?.modality_name_ar ||
    ""
  );
}

function normalizeModalityKey(entry) {
  const code = String(entry?.code || entry?.modality_code || "").trim().toLowerCase();
  const name = formatModalityName(entry).trim().toLowerCase().replace(/\s+/g, " ");
  return `${code}|${name}`;
}

function normalizeModalities(modalities, { activeOnly = false } = {}) {
  const list = Array.isArray(modalities) ? modalities : [];
  const seen = new Set();
  const result = [];

  for (const entry of list) {
    if (!entry) {
      continue;
    }

    if (activeOnly && entry.is_active === false) {
      continue;
    }

    const key = normalizeModalityKey(entry);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(entry);
  }

  return result;
}

function formatExamName(entry) {
  return (
    entry?.name_en ||
    entry?.exam_name_en ||
    entry?.name_ar ||
    entry?.exam_name_ar ||
    "—"
  );
}

function formatPriorityName(entry) {
  return (
    entry?.name_en ||
    entry?.priority_name_en ||
    entry?.name_ar ||
    entry?.priority_name_ar ||
    "—"
  );
}

function formatAppointmentStatus(status) {
  return t().statistics?.statuses?.[status] || status || "—";
}

function formatPercent(value, total) {
  if (!total) {
    return "0%";
  }

  return `${Math.round((Number(value || 0) / Number(total || 1)) * 100)}%`;
}

const CODE39_PATTERNS = {
  "0": "nnnwwnwnn",
  "1": "wnnwnnnnw",
  "2": "nnwwnnnnw",
  "3": "wnwwnnnnn",
  "4": "nnnwwnnnw",
  "5": "wnnwwnnnn",
  "6": "nnwwwnnnn",
  "7": "nnnwnnwnw",
  "8": "wnnwnnwnn",
  "9": "nnwwnnwnn",
  A: "wnnnnwnnw",
  B: "nnwnnwnnw",
  C: "wnwnnwnnn",
  D: "nnnnwwnnw",
  E: "wnnnwwnnn",
  F: "nnwnwwnnn",
  G: "nnnnnwwnw",
  H: "wnnnnwwnn",
  I: "nnwnnwwnn",
  J: "nnnnwwwnn",
  K: "wnnnnnnww",
  L: "nnwnnnnww",
  M: "wnwnnnnwn",
  N: "nnnnwnnww",
  O: "wnnnwnnwn",
  P: "nnwnwnnwn",
  Q: "nnnnnnwww",
  R: "wnnnnnwwn",
  S: "nnwnnnwwn",
  T: "nnnnwnwwn",
  U: "wwnnnnnnw",
  V: "nwwnnnnnw",
  W: "wwwnnnnnn",
  X: "nwnnwnnnw",
  Y: "wwnnwnnnn",
  Z: "nwwnwnnnn",
  "-": "nwnnnnwnw",
  ".": "wwnnnnwnn",
  " ": "nwwnnnwnn",
  $: "nwnwnwnnn",
  "/": "nwnwnnnwn",
  "+": "nwnnnwnwn",
  "%": "nnnwnwnwn",
  "*": "nwnnwnwnn"
};

function buildCode39Svg(value) {
  const cleanValue = String(value || "")
    .toUpperCase()
    .split("")
    .map((char) => (CODE39_PATTERNS[char] ? char : "-"))
    .join("");
  const encoded = `*${cleanValue}*`;
  const height = 72;
  const narrowWidth = 2;
  const wideWidth = 6;
  let x = 0;
  const rects = [];

  for (const character of encoded || "**") {
    const pattern = CODE39_PATTERNS[character];
    if (!pattern) {
      continue;
    }

    for (let index = 0; index < pattern.length; index += 1) {
      const isBar = index % 2 === 0;
      const width = pattern[index] === "w" ? wideWidth : narrowWidth;

      if (isBar) {
        rects.push(`<rect x="${x}" y="0" width="${width}" height="${height}" fill="#111827"></rect>`);
      }

      x += width;
    }

    x += narrowWidth;
  }

  return `<svg class="barcode-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.max(x, 1)} ${height}" role="img" aria-label="${escapeHtml(`Barcode ${cleanValue || "-"}`)}">${rects.join("")}</svg>`;
}

function buildAppointmentSlipData(source) {
  if (!source) {
    return null;
  }

  const appointment = source.appointment || source;
  const patient = source.patient || source;
  const modality = source.modality || appointment;
  const examType = source.examType || appointment;
  const language = state.language;

  const modalityInstruction =
    language === "ar"
      ? modality?.general_instruction_ar || appointment?.general_instruction_ar || ""
      : modality?.general_instruction_en || appointment?.general_instruction_en || "";

  const examInstruction =
    language === "ar"
      ? examType?.specific_instruction_ar || appointment?.specific_instruction_ar || ""
      : examType?.specific_instruction_en || appointment?.specific_instruction_en || "";

  return {
    accessionNumber: source.barcodeValue || appointment.accession_number || "",
    appointmentDate: normalizeDateText(appointment.appointment_date),
    registrationDate: appointment.created_at || null,
    patientArabicName: patient?.arabic_full_name || appointment?.arabic_full_name || "",
    patientEnglishName: patient?.english_full_name || appointment?.english_full_name || "",
    modalityName: formatModalityName(modality),
    examName: formatExamName(examType),
    notes: appointment.notes || "",
    modalityInstruction,
    examInstruction
  };
}

function openAppointmentSlipPrint(source) {
  const slip = buildAppointmentSlipData(source);

  if (!slip) {
    return;
  }

  const printWindow = window.open("", "_blank", "width=900,height=700");

  if (!printWindow) {
    throw new Error(state.language === "ar" ? "تعذر فتح نافذة الطباعة." : "Unable to open the print window.");
  }

  const patientArabic = slip.patientArabicName || "—";
  const patientEnglish = slip.patientEnglishName || "—";
  const modalityInstruction = slip.modalityInstruction || "—";
  const examInstruction = slip.examInstruction || "—";
  const registrationDate = slip.registrationDate ? formatDisplayDate(slip.registrationDate) : "—";
  const registrationDateLabel =
    state.language === "ar"
      ? "تاريخ التسجيل (تاريخ حجز الموعد وليس تاريخ الفحص)"
      : "Registration date (date the appointment was booked, not exam date)";
  const barcodeMarkup = buildCode39Svg(slip.accessionNumber);

  printWindow.document.write(`
    <!doctype html>
    <html lang="${escapeHtml(state.language)}">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(slip.accessionNumber)}</title>
        <style>
          @page { size: A5 portrait; margin: 10mm; }
          body { font-family: Arial, sans-serif; margin: 0; color: #1f2937; }
          .sheet { width: 100%; border: 1px solid #d1d5db; border-radius: 12px; padding: 18px; box-sizing: border-box; }
          .top { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 18px; }
          .eyebrow { font-size: 12px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.08em; }
          .title { font-size: 28px; font-weight: 700; margin: 8px 0 4px; }
          .subtitle { color: #4b5563; font-size: 15px; }
          .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-bottom: 18px; }
          .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; }
          .card.full { grid-column: 1 / -1; }
          .label { font-size: 12px; color: #6b7280; margin-bottom: 6px; }
          .value { font-size: 16px; font-weight: 600; }
          .value.small { font-size: 14px; font-weight: 500; line-height: 1.5; }
          .barcode { margin-top: 24px; border: 1px dashed #9ca3af; border-radius: 10px; padding: 16px; text-align: center; }
          .barcode-lines { margin-bottom: 10px; background: #fff; padding: 6px; display: flex; justify-content: center; }
          .barcode-svg { display: block; height: 72px; width: min(540px, 100%); }
          .barcode-text { font-size: 18px; font-weight: 700; letter-spacing: 0.08em; }
          .footnote { margin-top: 10px; font-size: 11px; color: #6b7280; text-align: left; line-height: 1.45; }
        </style>
      </head>
      <body>
        <div class="sheet">
          <div class="top">
            <div>
              <div class="eyebrow">${escapeHtml(t().print.slipPreview)}</div>
              <div class="title">${escapeHtml(slip.accessionNumber)}</div>
              <div class="subtitle">${escapeHtml(formatDisplayDate(slip.appointmentDate))}</div>
            </div>
          </div>
          <div class="grid">
            <div class="card">
              <div class="label">${escapeHtml(t().patients.fields.arabicFullName)}</div>
              <div class="value">${escapeHtml(patientArabic)}</div>
            </div>
            <div class="card">
              <div class="label">${escapeHtml(t().patients.fields.englishFullName)}</div>
              <div class="value">${escapeHtml(patientEnglish)}</div>
            </div>
            <div class="card">
              <div class="label">${escapeHtml(t().appointments.fields.appointmentDate)}</div>
              <div class="value">${escapeHtml(formatDisplayDate(slip.appointmentDate))}</div>
            </div>
            <div class="card">
              <div class="label">${escapeHtml(appointmentFieldLabel("modality"))}</div>
              <div class="value">${escapeHtml(slip.modalityName)}</div>
            </div>
            <div class="card">
              <div class="label">${escapeHtml(appointmentFieldLabel("examType"))}</div>
              <div class="value">${escapeHtml(slip.examName)}</div>
            </div>
          </div>
          <div class="grid">
            <div class="card full">
              <div class="label">${escapeHtml(t().print.fields.modalityInstructions)}</div>
              <div class="value small">${escapeHtml(modalityInstruction)}</div>
            </div>
            <div class="card full">
              <div class="label">${escapeHtml(t().print.fields.examInstructions)}</div>
              <div class="value small">${escapeHtml(examInstruction)}</div>
            </div>
          </div>
          ${
            slip.notes
              ? `
          <div class="grid">
            <div class="card full">
              <div class="label">${escapeHtml(appointmentFieldLabel("notes"))}</div>
              <div class="value small">${escapeHtml(slip.notes)}</div>
            </div>
          </div>`
              : ""
          }
          <div class="barcode">
            <div class="label">${escapeHtml(t().appointments.fields.accessionNumber)}</div>
            <div class="barcode-lines">${barcodeMarkup}</div>
            <div class="barcode-text">${escapeHtml(slip.accessionNumber)}</div>
            <div class="footnote">${escapeHtml(`${registrationDateLabel}: ${registrationDate}`)}</div>
          </div>
        </div>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function openDailyListPrint(appointments, title) {
  if (!appointments.length) {
    throw new Error(state.language === "ar" ? "لا توجد مواعيد للطباعة." : "No appointments available to print.");
  }

  const printWindow = window.open("", "_blank", "width=1100,height=800");

  if (!printWindow) {
    throw new Error(state.language === "ar" ? "تعذر فتح نافذة الطباعة." : "Unable to open the print window.");
  }

  const tableRows = appointments
    .map(
      (appointment) => `
        <tr>
          <td>${escapeHtml(appointment.accession_number || "")}</td>
          <td>${escapeHtml(appointment.arabic_full_name || "")}</td>
          <td>${escapeHtml(appointment.english_full_name || "")}</td>
          <td>${escapeHtml(formatExamName(appointment))}</td>
          <td>${escapeHtml(formatDisplayDate(appointment.appointment_date))}</td>
          <td>${escapeHtml(appointment.status || "")}</td>
        </tr>
      `
    )
    .join("");

  printWindow.document.write(`
    <!doctype html>
    <html lang="${escapeHtml(state.language)}">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          body { font-family: Arial, sans-serif; margin: 0; color: #1f2937; }
          .wrap { padding: 4mm 0; }
          .head { margin-bottom: 12px; }
          .title { font-size: 22px; font-weight: 700; }
          .meta { font-size: 12px; color: #4b5563; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #d1d5db; padding: 7px; text-align: left; vertical-align: top; }
          th { background: #f3f4f6; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="head">
            <div class="title">${escapeHtml(title)}</div>
            <div class="meta">${escapeHtml(formatDisplayDate(new Date()))}</div>
          </div>
          <table>
            <thead>
              <tr>
                <th>${escapeHtml(t().appointments.fields.accessionNumber)}</th>
                <th>${escapeHtml(t().patients.fields.arabicFullName)}</th>
                <th>${escapeHtml(t().patients.fields.englishFullName)}</th>
                <th>${escapeHtml(appointmentFieldLabel("examType"))}</th>
                <th>${escapeHtml(t().appointments.fields.appointmentDate)}</th>
                <th>${escapeHtml(t().common.status)}</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      </body>
    </html>
  `);

  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function openStatisticsPrint(snapshot, filters = {}) {
  const summary = snapshot?.summary || {};
  const modalityBreakdown = snapshot?.modalityBreakdown || [];
  const statusBreakdown = snapshot?.statusBreakdown || [];
  const dailyBreakdown = snapshot?.dailyBreakdown || [];
  const totalAppointments = Number(summary.total_appointments || 0);

  if (!totalAppointments && !modalityBreakdown.length && !statusBreakdown.length && !dailyBreakdown.length) {
    throw new Error(state.language === "ar" ? "لا توجد إحصائيات للطباعة." : "No statistics available to print.");
  }

  const printWindow = window.open("", "_blank", "width=1100,height=800");

  if (!printWindow) {
    throw new Error(state.language === "ar" ? "تعذر فتح نافذة الطباعة." : "Unable to open the print window.");
  }

  const selectedModality = state.appointmentLookups.modalities.find(
    (entry) => String(entry.id) === String(filters.modalityId || "")
  );
  const modalityLabel = selectedModality ? formatModalityName(selectedModality) : t().common.optional;
  const rangeText =
    filters.dateFrom || filters.dateTo
      ? `${filters.dateFrom || filters.dateTo} → ${filters.dateTo || filters.dateFrom}`
      : filters.date || "";

  const modalityRows = modalityBreakdown
    .map((entry) => {
      const total = Number(entry.total_count || 0);
      const noShowRate = formatPercent(entry.no_show_count, total);
      return `
        <tr>
          <td>${escapeHtml(formatModalityName(entry) || `#${entry.modality_id}`)}</td>
          <td>${escapeHtml(String(total))}</td>
          <td>${escapeHtml(String(entry.completed_count || 0))}</td>
          <td>${escapeHtml(noShowRate)}</td>
        </tr>
      `;
    })
    .join("");

  const statusRows = statusBreakdown
    .map(
      (entry) => `
        <tr>
          <td>${escapeHtml(formatAppointmentStatus(entry.status))}</td>
          <td>${escapeHtml(String(entry.total_count || 0))}</td>
          <td>${escapeHtml(formatPercent(entry.total_count, totalAppointments))}</td>
        </tr>
      `
    )
    .join("");

  const dailyRows = dailyBreakdown
    .map((entry) => {
      const total = Number(entry.total_count || 0);
      const noShowRate = formatPercent(entry.no_show_count, total);
      return `
        <tr>
          <td>${escapeHtml(normalizeDateText(entry.appointment_date))}</td>
          <td>${escapeHtml(String(total))}</td>
          <td>${escapeHtml(String(entry.completed_count || 0))}</td>
          <td>${escapeHtml(noShowRate)}</td>
        </tr>
      `;
    })
    .join("");

  printWindow.document.write(`
    <!doctype html>
    <html lang="${escapeHtml(state.language)}">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(t().statistics.title)}</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          body { font-family: Arial, sans-serif; margin: 0; color: #1f2937; }
          .wrap { padding: 4mm 0; }
          .head { margin-bottom: 16px; }
          .title { font-size: 22px; font-weight: 700; }
          .meta { font-size: 12px; color: #4b5563; margin-top: 4px; }
          .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 16px; }
          .card { border: 1px solid #d1d5db; border-radius: 8px; padding: 10px; }
          .card .label { color: #6b7280; font-size: 11px; margin-bottom: 6px; }
          .card .value { font-size: 18px; font-weight: 700; }
          h2 { margin: 20px 0 8px; font-size: 15px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #d1d5db; padding: 7px; text-align: left; vertical-align: top; }
          th { background: #f3f4f6; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="head">
            <div class="title">${escapeHtml(t().statistics.title)}</div>
            <div class="meta">${escapeHtml(`${t().print.date}: ${rangeText || "—"}`)}</div>
            <div class="meta">${escapeHtml(`${t().statistics.modality}: ${modalityLabel}`)}</div>
          </div>

          <div class="summary">
            <div class="card">
              <div class="label">${escapeHtml(t().statistics.totalAppointments)}</div>
              <div class="value">${escapeHtml(String(totalAppointments))}</div>
            </div>
            <div class="card">
              <div class="label">${escapeHtml(t().statistics.uniquePatients)}</div>
              <div class="value">${escapeHtml(String(summary.unique_patients || 0))}</div>
            </div>
            <div class="card">
              <div class="label">${escapeHtml(t().statistics.noShowRate)}</div>
              <div class="value">${escapeHtml(formatPercent(summary.no_show_count, totalAppointments))}</div>
            </div>
          </div>

          <h2>${escapeHtml(t().statistics.byModalityTitle)}</h2>
          <table>
            <thead>
              <tr>
                <th>${escapeHtml(t().statistics.modality)}</th>
                <th>${escapeHtml(t().statistics.totalAppointments)}</th>
                <th>${escapeHtml(t().statistics.completed)}</th>
                <th>${escapeHtml(t().statistics.noShowRate)}</th>
              </tr>
            </thead>
            <tbody>${modalityRows || `<tr><td colspan="4">${escapeHtml(t().common.noData)}</td></tr>`}</tbody>
          </table>

          <h2>${escapeHtml(t().statistics.byStatusTitle)}</h2>
          <table>
            <thead>
              <tr>
                <th>${escapeHtml(t().common.status)}</th>
                <th>${escapeHtml(t().statistics.totalAppointments)}</th>
                <th>${escapeHtml(t().statistics.noShowRate)}</th>
              </tr>
            </thead>
            <tbody>${statusRows || `<tr><td colspan="3">${escapeHtml(t().common.noData)}</td></tr>`}</tbody>
          </table>

          <h2>${escapeHtml(t().statistics.byDayTitle)}</h2>
          <table>
            <thead>
              <tr>
                <th>${escapeHtml(t().print.date)}</th>
                <th>${escapeHtml(t().statistics.totalAppointments)}</th>
                <th>${escapeHtml(t().statistics.completed)}</th>
                <th>${escapeHtml(t().statistics.noShowRate)}</th>
              </tr>
            </thead>
            <tbody>${dailyRows || `<tr><td colspan="4">${escapeHtml(t().common.noData)}</td></tr>`}</tbody>
          </table>
        </div>
      </body>
    </html>
  `);

  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function appointmentFieldLabel(key) {
  if (state.language === "ar" && ["modality", "examType", "priority", "notes"].includes(key)) {
    return copy.en.appointments.fields[key] || t().appointments.fields[key] || key;
  }

  return t().appointments.fields[key] || key;
}

function isKnownCity(value) {
  return state.addressOptions.some((entry) => entry.toLowerCase() === String(value || "").toLowerCase());
}

function updateAddressForm(form, target, modeKey) {
  if (target.name === "addressSelect") {
    if (target.value === "__custom") {
      if (modeKey) {
        state[modeKey] = "custom";
      }
      form.address = isKnownCity(form.address) ? "" : form.address || "";
    } else {
      if (modeKey) {
        state[modeKey] = "select";
      }
      form.address = target.value;
    }
    return;
  }

  if (target.name === "addressCustom") {
    if (modeKey) {
      state[modeKey] = "custom";
    }
    form.address = target.value;
  }
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

function normalizeAppointmentFormSelections() {
  const modalities = state.appointmentLookups.modalities || [];
  const priorities = state.appointmentLookups.priorities || [];
  const firstModalityId = modalities[0] ? String(modalities[0].id) : "";
  const hasSelectedModality = modalities.some(
    (modality) => String(modality.id) === String(state.appointmentForm.modalityId)
  );

  if (!hasSelectedModality) {
    state.appointmentForm.modalityId = firstModalityId;
  }

  const validExamTypeIds = new Set(
    state.appointmentLookups.examTypes
      .filter((examType) => String(examType.modality_id) === String(state.appointmentForm.modalityId))
      .map((examType) => String(examType.id))
  );

  if (!validExamTypeIds.has(String(state.appointmentForm.examTypeId || ""))) {
    state.appointmentForm.examTypeId = "";
  }

  const hasSelectedPriority =
    !state.appointmentForm.reportingPriorityId ||
    priorities.some((priority) => String(priority.id) === String(state.appointmentForm.reportingPriorityId));

  if (!hasSelectedPriority) {
    state.appointmentForm.reportingPriorityId = "";
  }

  state.examTypeForm.modalityId = state.appointmentForm.modalityId || "";

  const queueHasSelectedModality = modalities.some(
    (modality) => String(modality.id) === String(state.queueWalkInForm.modalityId)
  );

  if (!queueHasSelectedModality) {
    state.queueWalkInForm.modalityId = firstModalityId;
  }

  const validQueueExamTypeIds = new Set(
    state.appointmentLookups.examTypes
      .filter((examType) => String(examType.modality_id) === String(state.queueWalkInForm.modalityId))
      .map((examType) => String(examType.id))
  );

  if (!validQueueExamTypeIds.has(String(state.queueWalkInForm.examTypeId || ""))) {
    state.queueWalkInForm.examTypeId = "";
  }
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

function setLanguage(language) {
  state.language = language;
  localStorage.setItem("rispro-language", language);
  render();
}

function setRoute(route) {
  state.route = allowedRoutes.includes(route) ? route : DEFAULT_ROUTE;
  if (state.route === "settings") {
    state.settingsSection = "menu";
  }
  localStorage.setItem("rispro-route", state.route);
  render();
  void hydrateRoute();
}

function setPrintRange(range) {
  const today = getCurrentDateInputValue();

  if (range === "today") {
    state.printFilters.dateFrom = today;
    state.printFilters.dateTo = today;
    state.printFilters.date = today;
  }

  if (range === "tomorrow") {
    const tomorrow = addDaysToDateInput(today, 1);
    state.printFilters.dateFrom = tomorrow;
    state.printFilters.dateTo = tomorrow;
    state.printFilters.date = tomorrow;
  }

  if (range === "next_week") {
    state.printFilters.dateFrom = today;
    state.printFilters.dateTo = addDaysToDateInput(today, 7);
    state.printFilters.date = today;
  }

  if (range === "clear") {
    state.printFilters.dateFrom = "";
    state.printFilters.dateTo = "";
    state.printFilters.date = today;
  }

  render();
}

function setModalityQuickDate(range) {
  const today = getCurrentDateInputValue();
  let value = today;

  if (range === "tomorrow") {
    value = addDaysToDateInput(today, 1);
  }

  if (range === "next_week") {
    value = addDaysToDateInput(today, 7);
  }

  state.modalityFilters.scope = "day";
  state.modalityFilters.date = value;
  render();
}

function resetPatientForm() {
  state.patientForm = defaultPatientForm();
  state.patientAddressMode = "select";
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
  const { timeoutMs = 15000, headers: optionHeaders, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;

  try {
    response = await fetch(path, {
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(optionHeaders || {})
      },
      signal: controller.signal,
      ...fetchOptions
    });
  } catch (error) {
    clearTimeout(timer);

    if (error.name === "AbortError") {
      throw new Error("The server took too long to respond.");
    }

    throw error;
  }

  clearTimeout(timer);
  const contentType = response.headers.get("content-type") || "";
  let payload = null;

  if (response.status !== 204) {
    payload = contentType.includes("application/json") ? await response.json() : await response.text();
  }

  if (!response.ok) {
    const isHtmlPayload = typeof payload === "string" && /<html|<!doctype html/i.test(payload);
    const message =
      typeof payload === "string"
        ? isHtmlPayload
          ? response.status === 502
            ? "PACS test failed because the server returned a gateway error."
            : `Request failed with status ${response.status}.`
          : payload
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

async function loadDashboardSchedule() {
  state.dashboardScheduleLoading = true;
  state.dashboardScheduleError = "";
  render();

  try {
    const today = new Date();
    const dateFrom = formatIsoDate(today);
    const dateTo7 = formatIsoDate(addUtcDays(today, 7));
    const dateTo30 = formatIsoDate(addUtcDays(today, 30));

    const result = await api(`/api/appointments?dateFrom=${dateFrom}&dateTo=${dateTo30}`, { method: "GET" });
    const appointments = result.appointments || [];
    const next7Count = appointments.filter((appointment) => {
      const appointmentDate = normalizeDateText(appointment.appointment_date);
      return appointmentDate >= dateFrom && appointmentDate <= dateTo7;
    }).length;

    const modalityList = state.appointmentLookups.modalities || [];
    const availabilityResults = await Promise.all(
      modalityList.map(async (modality) => {
        try {
          const availability = await api(
            `/api/appointments/availability?modalityId=${encodeURIComponent(modality.id)}&days=30`,
            { method: "GET" }
          );
          const openDay = (availability.availability || []).find((day) => day.remaining_capacity > 0);
          if (!openDay) {
            return {
              modality,
              nextDate: null,
              daysUntil: null
            };
          }
          const dateText = normalizeDateText(openDay.appointment_date);
          const daysUntil = Math.max(
            0,
            Math.round((parseIsoDate(dateText).getTime() - parseIsoDate(dateFrom).getTime()) / 86400000)
          );
          return {
            modality,
            nextDate: dateText,
            daysUntil
          };
        } catch (error) {
          return {
            modality,
            nextDate: null,
            daysUntil: null
          };
        }
      })
    );

    const availableDays = availabilityResults.map((slot) => slot.daysUntil).filter((value) => value != null);
    const averageNextSlot =
      availableDays.length ? Math.round(availableDays.reduce((sum, value) => sum + value, 0) / availableDays.length) : null;

    state.dashboardScheduleCounts = { next7: next7Count, next30: appointments.length, averageNextSlot };
    state.dashboardNextSlots = availabilityResults;
  } catch (error) {
    state.dashboardScheduleError = error.message;
  } finally {
    state.dashboardScheduleLoading = false;
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

    if (state.modalityFilters.scope === "all") {
      params.set("scope", "all");
    } else {
      params.set("date", state.modalityFilters.date);
    }

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
    if (state.printFilters.dateFrom || state.printFilters.dateTo) {
      if (state.printFilters.dateFrom) {
        params.set("dateFrom", state.printFilters.dateFrom);
      }
      if (state.printFilters.dateTo) {
        params.set("dateTo", state.printFilters.dateTo);
      }
    } else {
      params.set("date", state.printFilters.date);
    }

    if (state.printFilters.modalityId) {
      params.set("modalityId", state.printFilters.modalityId);
    }

    if (state.printFilters.query.trim()) {
      params.set("q", state.printFilters.query.trim());
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

async function loadCalendarAppointments() {
  state.calendarLoading = true;
  state.calendarError = "";
  render();

  try {
    const { start, end } = getCalendarMonthRange(state.calendarDisplayDate);
    const params = new URLSearchParams();
    params.set("dateFrom", formatIsoDate(start));
    params.set("dateTo", formatIsoDate(end));

    if (state.calendarFilters.modalityId) {
      params.set("modalityId", state.calendarFilters.modalityId);
    }

    const result = await api(`/api/appointments?${params.toString()}`, { method: "GET" });
    state.calendarAppointments = result.appointments || [];

    const startKey = formatIsoDate(start);
    const endKey = formatIsoDate(end);
    const selected = state.calendarSelectedDate || startKey;

    if (selected < startKey || selected > endKey) {
      state.calendarSelectedDate = startKey;
    }
  } catch (error) {
    state.calendarError = error.message;
  } finally {
    state.calendarLoading = false;
    render();
  }
}

async function loadStatistics() {
  state.statisticsLoading = true;
  state.statisticsError = "";
  render();

  try {
    const params = new URLSearchParams();
    if (state.statisticsFilters.dateFrom || state.statisticsFilters.dateTo) {
      if (state.statisticsFilters.dateFrom) {
        params.set("dateFrom", state.statisticsFilters.dateFrom);
      }
      if (state.statisticsFilters.dateTo) {
        params.set("dateTo", state.statisticsFilters.dateTo);
      }
    } else {
      params.set("date", state.statisticsFilters.date);
    }

    if (state.statisticsFilters.modalityId) {
      params.set("modalityId", state.statisticsFilters.modalityId);
    }

    const result = await api(`/api/appointments/statistics?${params.toString()}`, { method: "GET" });
    state.statisticsSnapshot = result;
  } catch (error) {
    state.statisticsError = error.message;
  } finally {
    state.statisticsLoading = false;
    render();
  }
}

async function loadRegistrations() {
  state.printLoading = true;
  state.printError = "";
  render();

  try {
    const params = new URLSearchParams();
    if (state.registrationsFilters.dateFrom || state.registrationsFilters.dateTo) {
      if (state.registrationsFilters.dateFrom) {
        params.set("dateFrom", state.registrationsFilters.dateFrom);
      }
      if (state.registrationsFilters.dateTo) {
        params.set("dateTo", state.registrationsFilters.dateTo);
      }
    } else {
      params.set("date", state.registrationsFilters.date);
    }

    if (state.registrationsFilters.modalityId) {
      params.set("modalityId", state.registrationsFilters.modalityId);
    }

    if (state.registrationsFilters.query.trim()) {
      params.set("q", state.registrationsFilters.query.trim());
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
    }
  } catch (error) {
    state.printError = error.message;
  } finally {
    state.printLoading = false;
    render();
  }
}

async function loadDoctorRequests() {
  state.doctorLoading = true;
  state.doctorError = "";
  render();

  try {
    const params = new URLSearchParams();
    params.set("date", state.doctorFilters.date);

    if (state.doctorFilters.modalityId) {
      params.set("modalityId", state.doctorFilters.modalityId);
    }

    const result = await api(`/api/appointments?${params.toString()}`, { method: "GET" });
    state.doctorResults = result.appointments || [];

    if (
      state.doctorSelectedAppointment &&
      !state.doctorResults.some((appointment) => appointment.id === state.doctorSelectedAppointment.id)
    ) {
      state.doctorSelectedAppointment = null;
      state.doctorDocuments = [];
    }

    if (!state.doctorSelectedAppointment && state.doctorResults[0]) {
      state.doctorSelectedAppointment = state.doctorResults[0];
      state.doctorProtocolExamTypeId = String(state.doctorSelectedAppointment.exam_type_id || "");
      await loadDoctorDocuments(state.doctorSelectedAppointment.id);
    }
  } catch (error) {
    state.doctorError = error.message;
  } finally {
    state.doctorLoading = false;
    render();
  }
}

async function loadDoctorDocuments(appointmentId) {
  if (!appointmentId) {
    state.doctorDocuments = [];
    render();
    return;
  }

  state.doctorDocumentsLoading = true;
  state.doctorDocumentsError = "";
  render();

  try {
    const result = await api(`/api/documents?appointmentId=${encodeURIComponent(appointmentId)}`, { method: "GET" });
    state.doctorDocuments = result.documents || [];
  } catch (error) {
    state.doctorDocumentsError = error.message;
  } finally {
    state.doctorDocumentsLoading = false;
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

async function loadNameDictionary() {
  state.nameDictionaryLoading = true;
  state.nameDictionaryError = "";
  render();

  try {
    const endpoint =
      isSupervisor() && hasRecentSupervisorReauth()
        ? "/api/name-dictionary?includeInactive=true"
        : "/api/name-dictionary";
    const result = await api(endpoint, { method: "GET" });
    state.nameDictionaryEntries = result.entries || [];
    rebuildNameDictionary(state.nameDictionaryEntries);
    state.nameDictionaryImportFile = null;
  } catch (error) {
    state.nameDictionaryError = error.message;
  } finally {
    state.nameDictionaryLoading = false;
    render();
  }
}

async function loadExamTypeSettings() {
  if (!isSupervisor() || !hasRecentSupervisorReauth()) {
    return;
  }

  state.examTypeSettingsLoading = true;
  state.examTypeSettingsError = "";
  render();

  try {
    const result = await api("/api/settings/exam-types", { method: "GET" });
    const normalizedModalities = normalizeModalities(result.modalities);
    state.examTypeSettingsEntries = result.examTypes || [];
    state.examTypeSettingsModalities = normalizedModalities;

    state.appointmentLookups = {
      ...state.appointmentLookups,
      modalities: normalizedModalities.length ? normalizedModalities : state.appointmentLookups.modalities,
      examTypes: result.examTypes || state.appointmentLookups.examTypes
    };

    if (!state.examTypeSettingsForm.modalityId && state.examTypeSettingsModalities[0]) {
      state.examTypeSettingsForm.modalityId = String(state.examTypeSettingsModalities[0].id);
    }
  } catch (error) {
    state.examTypeSettingsError = error.message;
  } finally {
    state.examTypeSettingsLoading = false;
    render();
  }
}

async function loadModalitySettings() {
  if (!isSupervisor() || !hasRecentSupervisorReauth()) {
    return;
  }

  state.modalitySettingsLoading = true;
  state.modalitySettingsError = "";
  render();

  try {
    const result = await api("/api/settings/modalities?includeInactive=true", { method: "GET" });
    state.modalitySettingsEntries = result.modalities || [];

    const activeModalities = normalizeModalities(state.modalitySettingsEntries, { activeOnly: true });
    state.appointmentLookups = {
      ...state.appointmentLookups,
      modalities: activeModalities
    };
    state.examTypeSettingsModalities = activeModalities;
    normalizeAppointmentFormSelections();

    if (!state.modalitySettingsForm.code && state.modalitySettingsEntries[0]) {
      state.modalitySettingsForm = {
        ...defaultModalityForm(),
        isActive: "enabled"
      };
    }
  } catch (error) {
    state.modalitySettingsError = error.message;
  } finally {
    state.modalitySettingsLoading = false;
    render();
  }
}

async function loadDicomDevices() {
  if (!isSupervisor() || !hasRecentSupervisorReauth()) {
    return;
  }

  state.dicomDevicesLoading = true;
  state.dicomDevicesError = "";
  render();

  try {
    const result = await api("/api/settings/dicom-devices?includeInactive=true", { method: "GET" });
    state.dicomDevices = result.devices || [];

    if (!state.dicomDeviceForm.modalityId && state.appointmentLookups.modalities[0]) {
      state.dicomDeviceForm.modalityId = String(state.appointmentLookups.modalities[0].id);
    }
  } catch (error) {
    state.dicomDevicesError = error.message;
  } finally {
    state.dicomDevicesLoading = false;
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
    const normalizedModalities = normalizeModalities(result.modalities);
    state.appointmentLookups = {
      modalities: normalizedModalities,
      examTypes: result.examTypes || [],
      priorities: result.priorities || []
    };
    normalizeAppointmentFormSelections();
    await loadAppointmentDaySettings();

    if (!state.dicomDeviceForm.modalityId && state.appointmentLookups.modalities[0]) {
      state.dicomDeviceForm.modalityId = String(state.appointmentLookups.modalities[0].id);
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

async function loadAppointmentDaySettings() {
  state.appointmentDaySettingsError = "";

  try {
    const result = await api("/api/appointments/day-settings", { method: "GET" });
    state.appointmentDaySettings = {
      fridayEnabled: Boolean(result.fridayEnabled),
      saturdayEnabled: Boolean(result.saturdayEnabled)
    };
  } catch (error) {
    state.appointmentDaySettingsError = error.message;
  } finally {
    render();
  }
}

async function loadAppointmentNoShowSummary(patientId) {
  if (!patientId) {
    state.appointmentNoShowSummary = { count: 0, lastDate: "" };
    return;
  }

  state.appointmentNoShowLoading = true;
  state.appointmentNoShowError = "";
  render();

  try {
    const result = await api(`/api/patients/${encodeURIComponent(patientId)}/no-show`, { method: "GET" });
    state.appointmentNoShowSummary = {
      count: Number(result.noShowCount || 0),
      lastDate: result.lastNoShowDate ? String(result.lastNoShowDate).slice(0, 10) : ""
    };
  } catch (error) {
    state.appointmentNoShowError = error.message;
    state.appointmentNoShowSummary = { count: 0, lastDate: "" };
  } finally {
    state.appointmentNoShowLoading = false;
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
    state.settingsCatalog = ensureRequiredSettingsDefaults(result.settings || {});
    hydratePacsSettingsForm(state.settingsCatalog);
    await loadDicomDevices();
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
    await loadAppointmentLookups();
    await Promise.all([loadDashboardStatus(), loadQueueSnapshot(), loadDashboardSchedule()]);
    return;
  }

  if (state.route === "settings") {
    if (hasRecentSupervisorReauth()) {
      await Promise.all([
        loadUsers(),
        loadSettings(),
        loadAuditEntries(),
        loadNameDictionary(),
        loadModalitySettings(),
        loadExamTypeSettings(),
        loadDicomDevices(),
        loadAppointmentLookups()
      ]);
    }
    return;
  }

  if (state.route === "appointments") {
    await loadAppointmentLookups();
    return;
  }

  if (state.route === "calendar") {
    await Promise.all([loadAppointmentLookups(), loadCalendarAppointments()]);
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

  if (state.route === "doctor") {
    await Promise.all([loadAppointmentLookups(), loadDoctorRequests()]);
    return;
  }

  if (state.route === "print") {
    await Promise.all([loadAppointmentLookups(), loadPrintAppointments()]);
    return;
  }

  if (state.route === "statistics") {
    await Promise.all([loadAppointmentLookups(), loadStatistics()]);
    return;
  }

  if (state.route === "registrations") {
    await Promise.all([loadAppointmentLookups(), loadRegistrations()]);
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
    state.route = DEFAULT_ROUTE;
    localStorage.setItem("rispro-route", state.route);
    await loadNameDictionary();
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
    state.userDeletingId = null;
    state.settingsCatalog = {};
    state.settingsSection = "menu";
    state.settingsSuccess = "";
    state.nameDictionaryEntries = [];
    state.nameDictionary = { ...BASE_DICTIONARY };
    state.nameDictionaryError = "";
    state.nameDictionarySuccess = "";
    state.nameDictionarySavingId = "";
    state.nameDictionaryForm = { arabicText: "", englishText: "", isActive: true };
    state.nameDictionaryImportFile = null;
    state.nameDictionaryImportLoading = false;
    state.examTypeSettingsEntries = [];
    state.examTypeSettingsModalities = [];
    state.examTypeSettingsError = "";
    state.examTypeSettingsSuccess = "";
    state.examTypeSettingsSavingId = "";
    state.examTypeSettingsForm = defaultExamTypeForm();
    state.modalitySettingsEntries = [];
    state.modalitySettingsError = "";
    state.modalitySettingsSuccess = "";
    state.modalitySettingsSavingId = "";
    state.modalitySettingsForm = defaultModalityForm();
    state.appointmentLookups = { modalities: [], examTypes: [], priorities: [] };
    state.appointmentCalendar = [];
    state.appointmentDaySettings = { fridayEnabled: true, saturdayEnabled: true };
    state.appointmentDaySettingsError = "";
    state.appointmentNoShowSummary = { count: 0, lastDate: "" };
    state.appointmentNoShowLoading = false;
    state.appointmentNoShowError = "";
    state.selectedAppointmentPatient = null;
    state.appointmentPatientResults = [];
    state.appointmentPatientQuery = "";
    state.appointmentForm = defaultAppointmentForm();
    state.appointmentCreatedDialogOpen = false;
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
    state.printSuccess = "";
    state.integrationStatus = null;
    state.integrationError = "";
    state.integrationSuccess = "";
    state.integrationLoading = false;
    state.dicomDevices = [];
    state.dicomDevicesError = "";
    state.dicomDevicesSuccess = "";
    state.dicomDeviceForm = defaultDicomDeviceForm();
    state.scanPreparationLoading = false;
    state.printPreparationLoading = false;
    state.calendarLoading = false;
    state.calendarError = "";
    state.calendarAppointments = [];
    state.calendarFilters = defaultCalendarFilters();
    state.calendarDisplayDate = getCalendarMonthStartDate();
    state.calendarSelectedDate = getCurrentDateInputValue();
    state.printFilters = defaultPrintFilters();
    state.statisticsFilters = defaultStatisticsFilters();
    state.statisticsError = "";
    state.statisticsSnapshot = null;
    state.registrationsFilters = defaultRegistrationsFilters();
    state.selectedPrintAppointment = null;
    state.appointmentDocuments = [];
    state.doctorFilters = defaultDoctorFilters();
    state.doctorResults = [];
    state.doctorSelectedAppointment = null;
    state.doctorDocuments = [];
    state.doctorProtocolExamTypeId = "";
    state.doctorProtocolError = "";
    state.doctorProtocolSuccess = "";
    state.doctorError = "";
    state.uploadForm = defaultUploadForm();
    state.uploadSuccess = "";
    state.searchSelectedPatient = null;
    state.patientEditForm = defaultPatientForm();
    state.patientAddressMode = "select";
    state.patientEditAddressMode = "select";
    state.mergeSourcePatient = null;
    state.mergeTargetPatient = null;
    state.mergeConfirmationText = "";
    state.appointmentEditForm = defaultAppointmentEditForm();
    state.cancelReason = "";
    state.searchResults = [];
    state.searchQuery = "";
    state.route = DEFAULT_ROUTE;
    localStorage.setItem("rispro-route", state.route);
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
      arabicFullName: state.patientForm.arabicFullName,
      englishFullName: state.patientForm.englishFullName,
      ageYears: state.patientForm.ageYears,
      estimatedDateOfBirth: state.patientForm.estimatedDateOfBirth,
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
    pushToast("success", state.patientSuccess);
    state.patientForm = defaultPatientForm();
    state.patientAddressMode = "select";
    state.manualEnglishName = false;
    state.patientSuggestions = [];
  } catch (error) {
    state.patientError = error.message;
    pushToast("error", state.patientError);
  } finally {
    state.patientSaving = false;
    render();
  }
}

async function startAppointmentForPatient(patient) {
  if (!patient) {
    return;
  }

  state.selectedAppointmentPatient = patient;
  state.appointmentPatientQuery = "";
  state.appointmentPatientResults = [];
  state.appointmentError = "";
  state.appointmentSuccess = "";
  state.appointmentNoShowSummary = { count: 0, lastDate: "" };
  state.appointmentNoShowError = "";
  state.route = "appointments";
  localStorage.setItem("rispro-route", state.route);

  if (!state.appointmentLookups.modalities.length) {
    await loadAppointmentLookups();
  }

  render();
  void loadAppointmentNoShowSummary(patient.id);
  if (getAppointmentPacsPatientId(patient)) {
    void searchPacsStudies();
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
        ? "أدخل اسماً أو هاتفاً أو رقم المريض (الرقم الوطني) للبحث عن المريض."
        : "Enter a name, phone number, or patient ID (national ID) to search for a patient.";
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

async function deleteUser(userId) {
  if (!userId) {
    return;
  }

  state.userDeletingId = Number(userId);
  state.userError = "";
  state.userSuccess = "";
  render();

  try {
    await api(`/api/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
    state.userSuccess = t().settings.userDeleted;
    await loadUsers();
  } catch (error) {
    state.userError = error.message;
  } finally {
    state.userDeletingId = null;
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
    await Promise.all([loadUsers(), loadSettings(), loadAuditEntries(), loadExamTypeSettings()]);
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

function isSupervisorReauthNeededForOverbooking(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("password confirmation is required") && message.includes("overbook");
}

async function requestSupervisorOverbookingReauth() {
  if (!isSupervisor()) {
    return false;
  }

  const promptText =
    state.language === "ar"
      ? "أدخل كلمة مرور المشرف لتأكيد تجاوز السعة:"
      : "Enter supervisor password to confirm overbooking:";
  const password = window.prompt(promptText, "");

  if (!password || !password.trim()) {
    return false;
  }

  await api("/api/auth/re-auth", {
    method: "POST",
    body: JSON.stringify({ password })
  });
  await refreshSession();
  return true;
}

async function saveAppointment() {
  normalizeAppointmentFormSelections();

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

  const disabledDayMessage = getDisabledAppointmentDayMessage(state.appointmentForm.appointmentDate);
  if (disabledDayMessage) {
    state.appointmentError = disabledDayMessage;
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
      appointmentDate: state.appointmentForm.appointmentDate,
      notes: state.appointmentForm.notes,
      overbookingReason: state.appointmentForm.overbookingReason,
      isWalkIn: state.appointmentForm.isWalkIn
    };
    let result;

    try {
      result = await api("/api/appointments", {
        method: "POST",
        body: JSON.stringify(payload)
      });
    } catch (error) {
      if (isSupervisorReauthNeededForOverbooking(error) && (await requestSupervisorOverbookingReauth())) {
        result = await api("/api/appointments", {
          method: "POST",
          body: JSON.stringify(payload)
        });
      } else {
        throw error;
      }
    }

    state.appointmentSuccess = t().appointments.appointmentSaved;
    pushToast("success", state.appointmentSuccess);
    state.savedAppointment = result;
    state.appointmentCreatedDialogOpen = true;
    state.appointmentForm = {
      ...defaultAppointmentForm(),
      modalityId: state.appointmentForm.modalityId
    };
    await loadAppointmentAvailability();
  } catch (error) {
    state.appointmentError = error.message;
    pushToast("error", state.appointmentError);
  } finally {
    state.appointmentSaving = false;
    render();
  }
}

async function scanQueueAccession() {
  const scanValue = state.queueScanValue.trim();

  if (!scanValue) {
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
      body: JSON.stringify({ scanValue })
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
    const payload = {
      patientId: state.queueSelectedPatient.id,
      modalityId: state.queueWalkInForm.modalityId,
      examTypeId: state.queueWalkInForm.examTypeId,
      reportingPriorityId: state.queueWalkInForm.reportingPriorityId,
      notes: state.queueWalkInForm.notes,
      overbookingReason: state.queueWalkInForm.overbookingReason
    };

    try {
      await api("/api/queue/walk-in", {
        method: "POST",
        body: JSON.stringify(payload)
      });
    } catch (error) {
      if (isSupervisorReauthNeededForOverbooking(error) && (await requestSupervisorOverbookingReauth())) {
        await api("/api/queue/walk-in", {
          method: "POST",
          body: JSON.stringify(payload)
        });
      } else {
        throw error;
      }
    }

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

async function prepareAppointmentSlipFromCreation() {
  if (!state.savedAppointment?.appointment) {
    state.appointmentError =
      state.language === "ar" ? "احفظ الموعد أولاً للطباعة." : "Save the appointment before printing.";
    render();
    return;
  }

  state.printPreparationLoading = true;
  state.appointmentError = "";
  state.appointmentSuccess = "";
  render();

  try {
    openAppointmentSlipPrint(state.savedAppointment);
    state.appointmentCreatedDialogOpen = false;
  } catch (error) {
    state.appointmentError = error.message;
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

function getAppointmentPacsPatientId(patient) {
  if (!patient) {
    return "";
  }

  return String(patient.national_id || "").trim();
}

async function searchPacsStudies() {
  if (!state.selectedAppointmentPatient) {
    state.pacsFindError = t().appointments.noneSelected;
    render();
    return;
  }

  const patientId = getAppointmentPacsPatientId(state.selectedAppointmentPatient);

  if (!patientId) {
    state.pacsFindError = t().appointments.pacsMissingNationalId;
    render();
    return;
  }

  state.pacsFindLoading = true;
  state.pacsFindError = "";
  state.pacsFindResults = [];
  render();

  try {
    const result = await api("/api/integrations/pacs-search", {
      method: "POST",
      body: JSON.stringify({ patientId }),
      timeoutMs: 20000
    });
    state.pacsFindResults = result.studies || [];
  } catch (error) {
    state.pacsFindError = error.message;
  } finally {
    state.pacsFindLoading = false;
    state.pacsFindHasRun = true;
    render();
  }
}

async function searchPacsDirectory() {
  const hasCriteria = Object.values(state.pacsSearchForm).some((value) => String(value || "").trim());

  if (!hasCriteria) {
    state.pacsSearchError =
      state.language === "ar"
        ? "أدخل اسماً أو رقم مريض أو رقم دخول أو تاريخاً للبحث في PACS."
        : "Enter a patient name, patient ID, accession number, or date to search PACS.";
    state.pacsSearchResults = [];
    state.pacsSearchHasRun = false;
    render();
    return;
  }

  state.pacsSearchLoading = true;
  state.pacsSearchError = "";
  state.pacsSearchResults = [];
  render();

  try {
    const result = await api("/api/integrations/pacs-search", {
      method: "POST",
      body: JSON.stringify(state.pacsSearchForm),
      timeoutMs: 20000
    });
    state.pacsSearchResults = result.studies || [];
    state.pacsSearchHasRun = true;
  } catch (error) {
    state.pacsSearchError = error.message;
    state.pacsSearchHasRun = true;
  } finally {
    state.pacsSearchLoading = false;
    render();
  }
}

function resetPacsSearch() {
  state.pacsSearchForm = defaultPacsSearchForm();
  state.pacsSearchError = "";
  state.pacsSearchResults = [];
  state.pacsSearchHasRun = false;
  render();
}

async function testPacsConnection() {
  const pacs = state.pacsSettingsForm;

  state.pacsTestLoading = true;
  state.pacsTestError = "";
  state.pacsTestSuccess = "";
  render();

  try {
    await api("/api/integrations/pacs-test", {
      method: "POST",
      body: JSON.stringify({
        enabled: pacs.enabled || "enabled",
        host: String(pacs.host || "").trim(),
        port: String(pacs.port || "").trim() || "104",
        calledAeTitle: String(pacs.calledAeTitle || "").trim(),
        callingAeTitle: String(pacs.callingAeTitle || "").trim() || "RISPRO",
        timeoutSeconds: String(pacs.timeoutSeconds || "").trim() || "10"
      }),
      timeoutMs: 20000
    });
    state.pacsTestSuccess = t().pacs.testSuccess;
  } catch (error) {
    state.pacsTestError = error.message || t().pacs.testFail;
  } finally {
    state.pacsTestLoading = false;
    render();
  }
}

function fillPatientEditForm(patient) {
  state.patientEditForm = {
    arabicFullName: patient.arabic_full_name || "",
    englishFullName: patient.english_full_name || "",
    ageYears: String(patient.age_years || ""),
    estimatedDateOfBirth: String(patient.estimated_date_of_birth || "").slice(0, 10),
    sex: patient.sex || "male",
    nationalId: patient.national_id || "",
    nationalIdConfirmation: patient.national_id || "",
    phone1: patient.phone_1 || "",
    phone2: patient.phone_2 || "",
    address: patient.address || ""
  };
  state.patientEditAddressMode = patient.address && !isKnownCity(patient.address) ? "custom" : "select";
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
    try {
      await api(`/api/appointments/${encodeURIComponent(state.selectedPrintAppointment.id)}`, {
        method: "PUT",
        body: JSON.stringify(state.appointmentEditForm)
      });
    } catch (error) {
      if (isSupervisorReauthNeededForOverbooking(error) && (await requestSupervisorOverbookingReauth())) {
        await api(`/api/appointments/${encodeURIComponent(state.selectedPrintAppointment.id)}`, {
          method: "PUT",
          body: JSON.stringify(state.appointmentEditForm)
        });
      } else {
        throw error;
      }
    }

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

async function saveDoctorProtocol() {
  if (!state.doctorSelectedAppointment) {
    state.doctorProtocolError = t().doctor.noSelection;
    render();
    return;
  }

  state.doctorProtocolSaving = true;
  state.doctorProtocolError = "";
  state.doctorProtocolSuccess = "";
  render();

  try {
    const result = await api(`/api/appointments/${encodeURIComponent(state.doctorSelectedAppointment.id)}/protocol`, {
      method: "PUT",
      body: JSON.stringify({
        examTypeId: state.doctorProtocolExamTypeId || null
      })
    });

    if (result?.appointment) {
      state.doctorSelectedAppointment = result.appointment;
      state.doctorProtocolExamTypeId = String(result.appointment.exam_type_id || "");
      state.doctorResults = state.doctorResults.map((appointment) =>
        appointment.id === result.appointment.id ? result.appointment : appointment
      );
    }

    state.doctorProtocolSuccess = t().doctor.protocolSaved;
  } catch (error) {
    state.doctorProtocolError = error.message;
  } finally {
    state.doctorProtocolSaving = false;
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
    pushToast("success", state.settingsSuccess);
    await loadSettings();
    await loadAppointmentDaySettings();
  } catch (error) {
    state.settingsError = error.message;
    pushToast("error", state.settingsError);
  } finally {
    state.settingsSavingCategory = "";
    render();
  }
}

async function savePacsSettings() {
  const pacs = state.pacsSettingsForm;

  state.settingsSavingCategory = "pacs_connection";
  state.settingsError = "";
  state.settingsSuccess = "";
  state.pacsTestError = "";
  state.pacsTestSuccess = "";
  render();

  try {
    await api("/api/settings/pacs_connection", {
      method: "PUT",
      body: JSON.stringify({
        entries: [
          { key: "enabled", value: { value: pacs.enabled || "enabled" } },
          { key: "host", value: { value: String(pacs.host || "").trim() || "192.9.101.164" } },
          { key: "port", value: { value: String(pacs.port || "").trim() || "103" } },
          { key: "called_ae_title", value: { value: String(pacs.calledAeTitle || "").trim() || "osirixr" } },
          { key: "calling_ae_title", value: { value: String(pacs.callingAeTitle || "").trim() || "RISPRO" } },
          { key: "timeout_seconds", value: { value: String(pacs.timeoutSeconds || "").trim() || "10" } }
        ]
      })
    });

    state.settingsSuccess =
      state.language === "ar"
        ? `تم حفظ فئة ${getSettingsCategoryTitle("pacs_connection")} بنجاح.`
        : `${getSettingsCategoryTitle("pacs_connection")} was saved successfully.`;
    pushToast("success", state.settingsSuccess);
    await loadSettings();
  } catch (error) {
    state.settingsError = error.message;
    pushToast("error", state.settingsError);
  } finally {
    state.settingsSavingCategory = "";
    render();
  }
}

async function saveDicomDevice() {
  const form = state.dicomDeviceForm;

  if (!form.modalityId || !form.deviceName.trim() || !form.modalityAeTitle.trim() || !form.scheduledStationAeTitle.trim()) {
    state.dicomDevicesError =
      state.language === "ar"
        ? "أدخل الجهاز وAE Title وScheduled Station AE Title."
        : "Enter the modality, device name, AE Title, and Scheduled Station AE Title.";
    render();
    return;
  }

  state.dicomDeviceSaving = true;
  state.dicomDevicesError = "";
  state.dicomDevicesSuccess = "";
  render();

  try {
    const payload = {
      modalityId: form.modalityId,
      deviceName: form.deviceName,
      modalityAeTitle: form.modalityAeTitle,
      scheduledStationAeTitle: form.scheduledStationAeTitle,
      stationName: form.stationName,
      stationLocation: form.stationLocation,
      sourceIp: form.sourceIp,
      mwlEnabled: form.mwlEnabled,
      mppsEnabled: form.mppsEnabled,
      isActive: form.isActive
    };

    if (form.deviceId) {
      await api(`/api/settings/dicom-devices/${encodeURIComponent(form.deviceId)}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
    } else {
      await api("/api/settings/dicom-devices", {
        method: "POST",
        body: JSON.stringify(payload)
      });
    }

    state.dicomDevicesSuccess = t().settings.dicomDeviceSaved;
    state.dicomDeviceForm = {
      ...defaultDicomDeviceForm(),
      modalityId: form.modalityId
    };
    await loadDicomDevices();
    await loadSettings();
  } catch (error) {
    state.dicomDevicesError = error.message;
  } finally {
    state.dicomDeviceSaving = false;
    render();
  }
}

async function deleteDicomDevice(deviceId) {
  if (!deviceId) {
    return;
  }

  state.dicomDeviceSaving = true;
  state.dicomDevicesError = "";
  state.dicomDevicesSuccess = "";
  render();

  try {
    await api(`/api/settings/dicom-devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" });
    state.dicomDevicesSuccess = t().settings.dicomDeviceDeleted;
    if (String(state.dicomDeviceForm.deviceId || "") === String(deviceId)) {
      state.dicomDeviceForm = defaultDicomDeviceForm();
    }
    await loadDicomDevices();
    await loadSettings();
  } catch (error) {
    state.dicomDevicesError = error.message;
  } finally {
    state.dicomDeviceSaving = false;
    render();
  }
}

function startEditingDicomDevice(deviceId) {
  const device = state.dicomDevices.find((entry) => String(entry.id) === String(deviceId));

  if (!device) {
    return;
  }

  state.dicomDeviceForm = {
    deviceId: String(device.id),
    modalityId: String(device.modality_id || ""),
    deviceName: device.device_name || "",
    modalityAeTitle: device.modality_ae_title || "",
    scheduledStationAeTitle: device.scheduled_station_ae_title || "",
    stationName: device.station_name || "",
    stationLocation: device.station_location || "",
    sourceIp: device.source_ip || "",
    mwlEnabled: device.mwl_enabled ? "enabled" : "disabled",
    mppsEnabled: device.mpps_enabled ? "enabled" : "disabled",
    isActive: device.is_active ? "enabled" : "disabled"
  };

  state.dicomDevicesError = "";
  state.dicomDevicesSuccess = "";
  render();
}

function getSettingsEntryValue(category, key, fallback = "") {
  const entry = (state.settingsCatalog[category] || []).find((item) => item.setting_key === key);
  return entry ? getSettingsFieldValue(entry) : fallback;
}

async function createNameDictionaryEntry() {
  if (!state.nameDictionaryForm.arabicText.trim() || !state.nameDictionaryForm.englishText.trim()) {
    state.nameDictionaryError =
      state.language === "ar" ? "أدخل الاسم العربي والإنجليزي." : "Enter both the Arabic and English names.";
    render();
    return;
  }

  state.nameDictionarySavingId = "new";
  state.nameDictionaryError = "";
  state.nameDictionarySuccess = "";
  render();

  try {
    const result = await api("/api/name-dictionary", {
      method: "POST",
      body: JSON.stringify(state.nameDictionaryForm)
    });
    const entry = result.entry;
    const entries = [entry, ...state.nameDictionaryEntries.filter((item) => item.id !== entry.id)];
    state.nameDictionaryEntries = entries;
    rebuildNameDictionary(entries);
    state.nameDictionaryForm = { arabicText: "", englishText: "", isActive: true };
    state.nameDictionarySuccess =
      state.language === "ar" ? "تم حفظ القاموس بنجاح." : "Dictionary entry saved successfully.";
  } catch (error) {
    state.nameDictionaryError = error.message;
  } finally {
    state.nameDictionarySavingId = "";
    render();
  }
}

function parseDictionaryCsv(text) {
  const rows = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const entries = [];

  for (const row of rows) {
    const cleaned = row.replace(/^\uFEFF/, "");
    const lowercase = cleaned.toLowerCase();

    if (lowercase.includes("arabic") && lowercase.includes("english")) {
      continue;
    }

    const [arabic, ...rest] = cleaned.split(",");
    const arabicText = String(arabic || "").trim();
    const englishText = String(rest.join(",") || "").trim();

    if (!arabicText || !englishText) {
      continue;
    }

    entries.push({
      arabicText,
      englishText,
      isActive: true
    });
  }

  return entries;
}

function downloadDictionaryExample() {
  const blob = new Blob([NAME_DICTIONARY_CSV_EXAMPLE], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "rispro-name-dictionary-example.csv";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function importNameDictionaryCsv() {
  if (!state.nameDictionaryImportFile) {
    state.nameDictionaryError = state.language === "ar" ? "اختر ملف CSV للاستيراد." : "Select a CSV file to import.";
    render();
    return;
  }

  state.nameDictionaryImportLoading = true;
  state.nameDictionaryError = "";
  state.nameDictionarySuccess = "";
  render();

  try {
    const csv = await state.nameDictionaryImportFile.text();
    const entries = parseDictionaryCsv(csv);

    if (!entries.length) {
      throw new Error(state.language === "ar" ? "لم يتم العثور على أي مدخلات في ملف CSV." : "No entries were detected in the CSV file.");
    }

    await api("/api/name-dictionary/import", {
      method: "POST",
      body: JSON.stringify({ entries })
    });

    state.nameDictionaryImportFile = null;
    state.nameDictionarySuccess = t().settings.dictionaryImportSuccess;
    await loadNameDictionary();
  } catch (error) {
    state.nameDictionaryError = error.message;
  } finally {
    state.nameDictionaryImportLoading = false;
    render();
  }
}

async function updateNameDictionaryEntry(entryId) {
  const entry = state.nameDictionaryEntries.find((item) => String(item.id) === String(entryId));

  if (!entry) {
    return;
  }

  state.nameDictionarySavingId = String(entryId);
  state.nameDictionaryError = "";
  state.nameDictionarySuccess = "";
  render();

  try {
    const result = await api(`/api/name-dictionary/${encodeURIComponent(entryId)}`, {
      method: "PUT",
      body: JSON.stringify({
        englishText: entry.english_text,
        isActive: entry.is_active
      })
    });
    const updated = result.entry;
    state.nameDictionaryEntries = state.nameDictionaryEntries.map((item) =>
      item.id === updated.id ? updated : item
    );
    rebuildNameDictionary(state.nameDictionaryEntries);
    state.nameDictionarySuccess =
      state.language === "ar" ? "تم تحديث القاموس بنجاح." : "Dictionary entry updated successfully.";
  } catch (error) {
    state.nameDictionaryError = error.message;
  } finally {
    state.nameDictionarySavingId = "";
    render();
  }
}

async function deleteNameDictionaryEntry(entryId) {
  state.nameDictionarySavingId = `delete-${entryId}`;
  state.nameDictionaryError = "";
  state.nameDictionarySuccess = "";
  render();

  try {
    await api(`/api/name-dictionary/${encodeURIComponent(entryId)}`, { method: "DELETE" });
    state.nameDictionaryEntries = state.nameDictionaryEntries.filter((item) => String(item.id) !== String(entryId));
    rebuildNameDictionary(state.nameDictionaryEntries);
    state.nameDictionarySuccess =
      state.language === "ar" ? "تم حذف المدخل من القاموس." : "Dictionary entry deleted.";
  } catch (error) {
    state.nameDictionaryError = error.message;
  } finally {
    state.nameDictionarySavingId = "";
    render();
  }
}

async function createSettingsExamType() {
  const payload = {
    modalityId: state.examTypeSettingsForm.modalityId,
    nameAr: state.examTypeSettingsForm.nameAr,
    nameEn: state.examTypeSettingsForm.nameEn,
    specificInstructionAr: state.examTypeSettingsForm.specificInstructionAr,
    specificInstructionEn: state.examTypeSettingsForm.specificInstructionEn
  };

  state.examTypeSettingsSavingId = "new";
  state.examTypeSettingsError = "";
  state.examTypeSettingsSuccess = "";
  render();

  try {
    const result = await api("/api/settings/exam-types", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    state.examTypeSettingsEntries = [result.examType, ...state.examTypeSettingsEntries];
    state.appointmentLookups.examTypes = [result.examType, ...state.appointmentLookups.examTypes];
    state.examTypeSettingsForm = {
      ...defaultExamTypeForm(),
      modalityId: state.examTypeSettingsModalities[0] ? String(state.examTypeSettingsModalities[0].id) : ""
    };
    state.examTypeSettingsSuccess =
      state.language === "ar" ? "تمت إضافة نوع الفحص بنجاح." : "Exam type added successfully.";
    pushToast("success", state.examTypeSettingsSuccess);
  } catch (error) {
    state.examTypeSettingsError = error.message;
    pushToast("error", state.examTypeSettingsError);
  } finally {
    state.examTypeSettingsSavingId = "";
    render();
  }
}

async function updateSettingsExamType(entryId) {
  const entry = state.examTypeSettingsEntries.find((item) => String(item.id) === String(entryId));

  if (!entry) {
    return;
  }

  state.examTypeSettingsSavingId = String(entryId);
  state.examTypeSettingsError = "";
  state.examTypeSettingsSuccess = "";
  render();

  try {
    const result = await api(`/api/settings/exam-types/${encodeURIComponent(entryId)}`, {
      method: "PUT",
      body: JSON.stringify({
        modalityId: entry.modality_id,
        nameAr: entry.name_ar,
        nameEn: entry.name_en,
        specificInstructionAr: entry.specific_instruction_ar,
        specificInstructionEn: entry.specific_instruction_en
      })
    });

    state.examTypeSettingsEntries = state.examTypeSettingsEntries.map((item) =>
      String(item.id) === String(entryId) ? result.examType : item
    );
    state.appointmentLookups.examTypes = state.appointmentLookups.examTypes.map((item) =>
      String(item.id) === String(entryId) ? result.examType : item
    );
    state.examTypeSettingsSuccess =
      state.language === "ar" ? "تم تحديث نوع الفحص بنجاح." : "Exam type updated successfully.";
    pushToast("success", state.examTypeSettingsSuccess);
  } catch (error) {
    state.examTypeSettingsError = error.message;
    pushToast("error", state.examTypeSettingsError);
  } finally {
    state.examTypeSettingsSavingId = "";
    render();
  }
}

async function deleteSettingsExamType(entryId) {
  state.examTypeSettingsSavingId = `delete-${entryId}`;
  state.examTypeSettingsError = "";
  state.examTypeSettingsSuccess = "";
  render();

  try {
    await api(`/api/settings/exam-types/${encodeURIComponent(entryId)}`, { method: "DELETE" });
    state.examTypeSettingsEntries = state.examTypeSettingsEntries.filter((item) => String(item.id) !== String(entryId));
    state.appointmentLookups.examTypes = state.appointmentLookups.examTypes.filter(
      (item) => String(item.id) !== String(entryId)
    );
    if (String(state.appointmentForm.examTypeId) === String(entryId)) {
      state.appointmentForm.examTypeId = "";
    }
    state.examTypeSettingsSuccess =
      state.language === "ar" ? "تم حذف نوع الفحص." : "Exam type deleted.";
    pushToast("success", state.examTypeSettingsSuccess);
  } catch (error) {
    state.examTypeSettingsError = error.message;
    pushToast("error", state.examTypeSettingsError);
  } finally {
    state.examTypeSettingsSavingId = "";
    render();
  }
}

function syncModalitySettingsLookups(modalities) {
  const activeModalities = normalizeModalities(modalities, { activeOnly: true });
  state.appointmentLookups = {
    ...state.appointmentLookups,
    modalities: activeModalities
  };
  state.examTypeSettingsModalities = activeModalities;
  normalizeAppointmentFormSelections();
}

async function createSettingsModality() {
  const payload = {
    code: state.modalitySettingsForm.code,
    nameAr: state.modalitySettingsForm.nameAr,
    nameEn: state.modalitySettingsForm.nameEn,
    dailyCapacity: state.modalitySettingsForm.dailyCapacity,
    generalInstructionAr: state.modalitySettingsForm.generalInstructionAr,
    generalInstructionEn: state.modalitySettingsForm.generalInstructionEn,
    isActive: state.modalitySettingsForm.isActive
  };

  state.modalitySettingsSavingId = "new";
  state.modalitySettingsError = "";
  state.modalitySettingsSuccess = "";
  render();

  try {
    const result = await api("/api/settings/modalities", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    state.modalitySettingsEntries = [result.modality, ...state.modalitySettingsEntries];
    syncModalitySettingsLookups(state.modalitySettingsEntries);
    state.modalitySettingsForm = defaultModalityForm();
    state.modalitySettingsSuccess =
      state.language === "ar" ? "تمت إضافة الجهاز بنجاح." : "Modality added successfully.";
    pushToast("success", state.modalitySettingsSuccess);
  } catch (error) {
    state.modalitySettingsError = error.message;
    pushToast("error", state.modalitySettingsError);
  } finally {
    state.modalitySettingsSavingId = "";
    render();
  }
}

async function updateSettingsModality(entryId) {
  const entry = state.modalitySettingsEntries.find((item) => String(item.id) === String(entryId));

  if (!entry) {
    return;
  }

  state.modalitySettingsSavingId = String(entryId);
  state.modalitySettingsError = "";
  state.modalitySettingsSuccess = "";
  render();

  try {
    const result = await api(`/api/settings/modalities/${encodeURIComponent(entryId)}`, {
      method: "PUT",
      body: JSON.stringify({
        code: entry.code,
        nameAr: entry.name_ar,
        nameEn: entry.name_en,
        dailyCapacity: entry.daily_capacity,
        generalInstructionAr: entry.general_instruction_ar,
        generalInstructionEn: entry.general_instruction_en,
        isActive: entry.is_active ? "enabled" : "disabled"
      })
    });

    state.modalitySettingsEntries = state.modalitySettingsEntries.map((item) =>
      String(item.id) === String(entryId) ? result.modality : item
    );
    syncModalitySettingsLookups(state.modalitySettingsEntries);
    state.modalitySettingsSuccess =
      state.language === "ar" ? "تم تحديث الجهاز بنجاح." : "Modality updated successfully.";
    pushToast("success", state.modalitySettingsSuccess);
  } catch (error) {
    state.modalitySettingsError = error.message;
    pushToast("error", state.modalitySettingsError);
  } finally {
    state.modalitySettingsSavingId = "";
    render();
  }
}

async function deleteSettingsModality(entryId) {
  state.modalitySettingsSavingId = `delete-${entryId}`;
  state.modalitySettingsError = "";
  state.modalitySettingsSuccess = "";
  render();

  try {
    await api(`/api/settings/modalities/${encodeURIComponent(entryId)}`, { method: "DELETE" });
    state.modalitySettingsEntries = state.modalitySettingsEntries.filter((item) => String(item.id) !== String(entryId));
    syncModalitySettingsLookups(state.modalitySettingsEntries);
    if (String(state.appointmentForm.modalityId) === String(entryId)) {
      state.appointmentForm.modalityId = "";
    }
    state.modalitySettingsSuccess =
      state.language === "ar" ? "تم حذف الجهاز." : "Modality deleted.";
    pushToast("success", state.modalitySettingsSuccess);
  } catch (error) {
    state.modalitySettingsError = error.message;
    pushToast("error", state.modalitySettingsError);
  } finally {
    state.modalitySettingsSavingId = "";
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

function bannerCard(label, value, note, color) {
  return `
    <article class="surface banner-card">
      <div class="banner-label">${escapeHtml(label)}</div>
      <div class="banner-value" style="color:${escapeHtml(color)}">${escapeHtml(value)}</div>
      <div class="banner-note">${escapeHtml(note)}</div>
    </article>
  `;
}

function formatDaysUntilLabel(daysUntil) {
  if (daysUntil == null) {
    return t().dashboard.nextSlotUnavailable;
  }

  if (daysUntil === 0) {
    return t().dashboard.todayLabel;
  }

  return `${daysUntil} ${t().dashboard.daysLabel}`;
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

function pushToast(kind, message, durationMs = 4500) {
  if (!message) {
    return;
  }

  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  state.toasts = [...state.toasts, { id, kind, message }];
  render();

  window.setTimeout(() => {
    dismissToast(id);
  }, durationMs);
}

function dismissToast(id) {
  const nextToasts = state.toasts.filter((toast) => toast.id !== id);
  if (nextToasts.length === state.toasts.length) {
    return;
  }

  state.toasts = nextToasts;
  render();
}

function renderToasts() {
  if (!state.toasts.length) {
    return "";
  }

  return `
    <div class="toast-stack" role="status" aria-live="polite">
      ${state.toasts
        .map(
          (toast) => `
            <div class="toast toast-${escapeHtml(toast.kind)}">
              <div class="toast-message">${escapeHtml(toast.message)}</div>
              <button class="toast-close" type="button" data-action="dismiss-toast" data-toast-id="${escapeHtml(toast.id)}">×</button>
            </div>
          `
        )
        .join("")}
    </div>
  `;
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
            <img class="brand-logo" src="/assets/nccb-logo.png" alt="National Cancer Center Benghazi logo" />
            <div class="brand-text">
              <div class="brand-title">${escapeHtml(t().appName)}</div>
              <div class="brand-title-alt">${escapeHtml(t().appNameAlternate)}</div>
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
  const scheduleCounts = state.dashboardScheduleCounts || { next7: 0, next30: 0 };
  const scheduleLoading = state.dashboardScheduleLoading;
  const scheduleSlots = state.dashboardNextSlots || [];

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
      ${alertMarkup("error", state.dashboardScheduleError)}
      ${alertMarkup("success", state.queueSuccess)}

      <section class="banner-strip surface">
        <div class="banner-metric">
          <div class="banner-icon">7</div>
          <div>
            <div class="banner-label">${escapeHtml(t().dashboard.next7Title)}</div>
            <div class="banner-value">${escapeHtml(scheduleLoading ? t().common.loading : String(scheduleCounts.next7))}</div>
            <div class="banner-note">${escapeHtml(t().dashboard.next7Note)}</div>
          </div>
        </div>
        <div class="banner-divider"></div>
        <div class="banner-metric">
          <div class="banner-icon">30</div>
          <div>
            <div class="banner-label">${escapeHtml(t().dashboard.next30Title)}</div>
            <div class="banner-value">${escapeHtml(scheduleLoading ? t().common.loading : String(scheduleCounts.next30))}</div>
            <div class="banner-note">${escapeHtml(t().dashboard.next30Note)}</div>
          </div>
        </div>
        <div class="banner-divider"></div>
        <div class="banner-metric">
          <div class="banner-icon">AVG</div>
          <div>
            <div class="banner-label">${escapeHtml(t().dashboard.avgNextSlotTitle)}</div>
            <div class="banner-value">${escapeHtml(
              scheduleLoading ? t().common.loading : formatDaysUntilLabel(scheduleCounts.averageNextSlot)
            )}</div>
            <div class="banner-note">${escapeHtml(t().dashboard.nextSlotNote)}</div>
          </div>
        </div>
      </section>

      <section class="card-grid dashboard-cards">
        ${statCard(t().dashboard.db, readinessLabel, state.dashboardReady ? t().dashboard.ready : t().dashboard.notReady, "var(--teal)")}
        ${statCard(t().dashboard.session, formatRole(state.session.role), state.session.fullName, "var(--amber)")}
        ${statCard(t().dashboard.waiting, String(summary.waiting_count || 0), `${queueEntries.length} ${t().queue.waitingList}`, "var(--blue)")}
        ${statCard(t().dashboard.noShowReview, String(noShowCandidates.length), `${t().dashboard.reviewStarts} ${reviewTime}`, "var(--red)")}
        ${statCard(t().dashboard.date, localizedDate(), t().common.environment + `: ${state.dashboardLoading || state.queueLoading ? t().common.loading : "API"}`, "var(--green)")}
      </section>

      <section class="dual-grid">
        <article class="surface">
          <div class="section-head">
            <h2 class="section-title">${escapeHtml(t().dashboard.nextSlotTitle)}</h2>
            <span class="chip ${scheduleLoading ? "subtle" : "accent"}">${escapeHtml(
              scheduleLoading ? t().common.loading : t().common.active
            )}</span>
          </div>
          <div class="settings-summary">${escapeHtml(t().dashboard.nextSlotNote)}</div>
          ${
            scheduleLoading
              ? `<div class="empty">${escapeHtml(t().common.loading)}</div>`
              : scheduleSlots.length
                ? `<div class="availability-grid">
                    ${scheduleSlots
                      .map(
                        (slot) => `
                          <div class="availability-card">
                            <div class="availability-icon">${escapeHtml(initials(formatModalityName(slot.modality)))}</div>
                            <div class="availability-copy">
                              <div class="availability-label">${escapeHtml(formatModalityName(slot.modality))}</div>
                              <div class="availability-value">${escapeHtml(formatDaysUntilLabel(slot.daysUntil))}</div>
                              <div class="availability-note">${escapeHtml(
                                slot.nextDate ? formatDisplayDate(slot.nextDate) : t().dashboard.nextSlotUnavailable
                              )}</div>
                            </div>
                          </div>
                        `
                      )
                      .join("")}
                  </div>`
                : `<div class="empty">${escapeHtml(t().common.noData)}</div>`
          }
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
                              formatModalityName(entry)
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
                                formatModalityName(candidate)
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
        <div class="badge-row">
          <span class="chip success">#${escapeHtml(state.savedPatient.id)}</span>
          <button class="button-secondary" type="button" data-action="create-appointment-for-saved-patient">${escapeHtml(
            t().patients.createAppointment
          )}</button>
        </div>
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

function renderAddressField(value, target) {
  const mode = target === "patient" ? state.patientAddressMode : state.patientEditAddressMode;
  const isCustom = mode === "custom" || (value && !isKnownCity(value));
  const selectValue = isCustom ? "__custom" : value || "";

  return `
    <label class="field full">
      <span class="label">${escapeHtml(t().patients.fields.address)}</span>
      <div class="stack address-stack">
        <select class="select" name="addressSelect" data-address-target="${escapeHtml(target)}">
          <option value="">${escapeHtml(t().common.optional)}</option>
          ${state.addressOptions
            .map(
              (entry) => `
                <option value="${escapeHtml(entry)}" ${entry === value ? "selected" : ""}>${escapeHtml(entry)}</option>
              `
            )
            .join("")}
          <option value="__custom" ${selectValue === "__custom" ? "selected" : ""}>${escapeHtml(
            state.language === "ar" ? "إضافة مدينة" : "Add a city"
          )}</option>
        </select>
        ${
          selectValue === "__custom"
            ? `<div class="inline-field">
                <input class="input field-en" name="addressCustom" data-address-target="${escapeHtml(target)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(
                  state.language === "ar" ? "أدخل المدينة" : "Enter city"
                )}" />
                <button class="button-ghost" type="button" data-action="add-city-option" data-city="${escapeHtml(value)}">${escapeHtml(
                  state.language === "ar" ? "إضافة للقائمة" : "Add to list"
                )}</button>
              </div>`
            : ""
        }
      </div>
    </label>
  `;
}

function renderPatients() {
  return `
    <div class="page">
      ${pageHero(t().patients.title, t().patients.body, "", t().common.required)}
      ${alertMarkup("error", state.patientError)}
      ${alertMarkup("success", state.patientSuccess)}

      <section class="split-grid patient-grid">
        <article class="surface">
          <form id="patient-form" class="stack">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().patients.title)}</h2>
              <div class="badge-row">
                <span class="chip success">${escapeHtml(t().common.required)}</span>
                <span class="chip subtle">${escapeHtml(t().common.optional)}</span>
              </div>
              <p class="small">${escapeHtml(t().patients.mrnAutoHint)}</p>
            </div>

            <div class="form-grid">
              <label class="field full">
                <span class="label">${escapeHtml(t().patients.fields.arabicFullName)}</span>
                <input class="input field-ar" lang="ar" dir="rtl" name="arabicFullName" value="${escapeHtml(state.patientForm.arabicFullName)}" />
              </label>

              <label class="field">
                <span class="label">${escapeHtml(t().patients.fields.ageYears)}</span>
                <input class="input field-en" name="ageYears" value="${escapeHtml(state.patientForm.ageYears)}" inputmode="numeric" />
              </label>

              <label class="field">
                <span class="label">${escapeHtml(t().patients.fields.dateOfBirth)}</span>
                <input
                  class="input field-en"
                  type="date"
                  name="estimatedDateOfBirth"
                  value="${escapeHtml(state.patientForm.estimatedDateOfBirth)}"
                />
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
                <div class="small">${escapeHtml(t().patients.phone1Hint)}</div>
              </label>

              <label class="field">
                <span class="label">${escapeHtml(t().patients.fields.phone2)}</span>
                <input class="input field-en" name="phone2" value="${escapeHtml(state.patientForm.phone2)}" inputmode="numeric" maxlength="10" autocomplete="off" />
              </label>

              <label class="field">
                <span class="label">${escapeHtml(t().patients.fields.nationalId)}</span>
                <input class="input field-en" name="nationalId" value="${escapeHtml(state.patientForm.nationalId)}" inputmode="numeric" maxlength="11" autocomplete="off" />
                <div class="small">${escapeHtml(t().patients.nationalIdHint)}</div>
              </label>

              <label class="field">
                <span class="label">${escapeHtml(t().patients.fields.nationalIdConfirmation)}</span>
                <input class="input field-en" name="nationalIdConfirmation" value="${escapeHtml(state.patientForm.nationalIdConfirmation)}" inputmode="numeric" maxlength="11" autocomplete="off" data-prevent-paste="true" />
              </label>
              ${renderAddressField(state.patientForm.address, "patient")}
            </div>

            <div class="form-actions">
              <button class="button-primary" type="submit">${escapeHtml(state.patientSaving ? t().common.loading : t().patients.save)}</button>
              <button class="button-secondary" type="button" data-action="check-duplicates">${escapeHtml(state.suggestionsLoading ? t().common.loading : t().patients.duplicates)}</button>
              <button class="button-ghost" type="button" data-action="clear-patient-form">${escapeHtml(t().patients.clear)}</button>
            </div>
          </form>
        </article>

        <div class="stack patient-side">
          <article class="surface surface-compact">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().patients.savedRecord)}</h2>
              <span class="chip accent">${escapeHtml(t().common.latest)}</span>
            </div>
            ${renderSavedPatient()}
          </article>

          <article class="surface surface-compact">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().patients.possibleMatches)}</h2>
              <span class="chip subtle">${escapeHtml(String(state.patientSuggestions.length))}</span>
            </div>
            ${renderPatientResults(
              state.patientSuggestions,
              state.suggestionsLoading ? t().common.loading : t().common.noData
            )}
          </article>

          <article class="surface surface-compact">
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

function renderPacsFindResults() {
  if (state.pacsFindLoading) {
    return `<div class="empty">${escapeHtml(t().appointments.pacsLoading)}</div>`;
  }

  if (!state.pacsFindHasRun) {
    return "";
  }

  if (!state.pacsFindResults.length) {
    return `<div class="empty">${escapeHtml(t().appointments.pacsNoResults)}</div>`;
  }

  return `
    <div class="list">
      ${state.pacsFindResults
        .map((study) => {
          const patientId = study.patientId || "—";
          const patientName = study.patientName || "—";
          const accessionNumber = study.accessionNumber || "—";
          const modality = study.modality || "—";
          const description = study.studyDescription || "—";
          const studyDate = study.studyDate ? formatDicomDate(study.studyDate) : "—";

          return `
            <div class="item">
              <div class="item-copy">
                <div class="item-title">${escapeHtml(description || patientName)}</div>
                <div class="item-subtitle">${escapeHtml(
                  `${patientName} • ${t().appointments.fields.pacsPatientId}: ${patientId} • ${accessionNumber} • ${t().appointments.fields.pacsModality}: ${modality} • ${t().appointments.fields.pacsStudyDate}: ${studyDate}`
                )}</div>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderPacsSearchResults() {
  if (state.pacsSearchLoading) {
    return `<div class="empty">${escapeHtml(t().pacs.loading)}</div>`;
  }

  if (!state.pacsSearchHasRun) {
    return "";
  }

  if (!state.pacsSearchResults.length) {
    return `<div class="empty">${escapeHtml(t().pacs.noResults)}</div>`;
  }

  return `
    <div class="list">
      ${state.pacsSearchResults
        .map((study) => {
          const patientName = study.patientName || "—";
          const patientId = study.patientId || "—";
          const accessionNumber = study.accessionNumber || "—";
          const modality = study.modality || "—";
          const description = study.studyDescription || "—";
          const studyDate = study.studyDate ? formatDicomDate(study.studyDate) : "—";

          return `
            <div class="item">
              <div class="item-copy">
                <div class="item-title">${escapeHtml(patientName)}</div>
                <div class="item-subtitle">${escapeHtml(
                  `${t().appointments.fields.pacsPatientId}: ${patientId} • ${accessionNumber} • ${modality} • ${description} • ${studyDate}`
                )}</div>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderPacsFindPanel(patient) {
  if (!patient) {
    return "";
  }

  const patientId = getAppointmentPacsPatientId(patient);
  const hasPatientId = Boolean(patientId);
  const buttonLabel = state.pacsFindLoading ? t().appointments.pacsLoading : t().appointments.pacsSearch;

  return `
    <div class="stack">
      <div class="section-head">
        <h3 class="section-title">${escapeHtml(t().appointments.pacsResultsTitle)}</h3>
        <span class="chip subtle">${escapeHtml(String(state.pacsFindResults.length))}</span>
      </div>
      <div class="small">${escapeHtml(t().appointments.pacsSearchHint)}</div>
      ${!hasPatientId ? `<div class="small">${escapeHtml(t().appointments.pacsMissingNationalId)}</div>` : ""}
      ${alertMarkup("error", state.pacsFindError)}
      <div class="form-actions">
        <button class="button-secondary" type="button" data-action="pacs-cfind" ${!hasPatientId || state.pacsFindLoading ? "disabled" : ""}>
          ${escapeHtml(buttonLabel)}
        </button>
      </div>
      ${renderPacsFindResults()}
    </div>
  `;
}

function renderSelectedAppointmentPatient() {
  if (!state.selectedAppointmentPatient) {
    return `<div class="empty">${escapeHtml(t().appointments.noneSelected)}</div>`;
  }

  const patient = state.selectedAppointmentPatient;
  const noShowCount = state.appointmentNoShowSummary.count || 0;
  const lastNoShow = state.appointmentNoShowSummary.lastDate
    ? formatDisplayDate(state.appointmentNoShowSummary.lastDate)
    : "";
  const noShowMessage = noShowCount
    ? `${t().appointments.previousNoShow}: ${noShowCount}${lastNoShow ? ` • ${lastNoShow}` : ""}`
    : "";

  return `
    <div class="stack">
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
      ${state.appointmentNoShowLoading ? `<div class="small">${escapeHtml(t().common.loading)}</div>` : ""}
      ${noShowMessage ? `<div class="alert alert-error">${escapeHtml(noShowMessage)}</div>` : ""}
      ${renderPacsFindPanel(patient)}
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
          <div class="item-subtitle">${escapeHtml(formatDisplayDate(result.appointment.appointment_date))} • ${escapeHtml(formatModalityName(result.modality))}</div>
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

function renderAppointmentCreatedDialog() {
  if (!state.appointmentCreatedDialogOpen || !state.savedAppointment?.appointment) {
    return "";
  }

  return `
    <section class="surface modal-surface">
      <div class="stack">
        <div class="section-head">
          <h2 class="section-title">${escapeHtml(t().appointments.createdTitle)}</h2>
          <button class="button-ghost" type="button" data-action="close-appointment-created-dialog">×</button>
        </div>
        <p class="settings-summary">${escapeHtml(t().appointments.createdBody)}</p>
        ${renderSavedAppointment()}
        <div class="form-actions">
          <button class="button-secondary" type="button" data-action="close-appointment-created-dialog">${escapeHtml(
            t().common.close
          )}</button>
          <button class="button-primary" type="button" data-action="print-created-appointment-slip">${escapeHtml(
            t().appointments.printNow
          )}</button>
        </div>
      </div>
    </section>
  `;
}

function renderAppointments() {
  const modality = currentAppointmentModality();
  const examTypes = filteredExamTypes();
  const selectedDay = selectedAppointmentDay();
  const selectedDateValue = normalizeDateText(state.appointmentForm.appointmentDate);
  const disabledDayMessage = getDisabledAppointmentDayMessage(selectedDateValue);

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
                  <span class="chip accent">${escapeHtml(modality ? formatModalityName(modality) : t().appointments.lookupsLoading)}</span>
                </div>
              </div>

              <div class="form-grid">
                <label class="field">
                  <span class="label">${escapeHtml(appointmentFieldLabel("modality"))}</span>
                  <select class="select" name="modalityId">
                    ${state.appointmentLookups.modalities
                      .map(
                        (entry) => `
                          <option value="${escapeHtml(String(entry.id))}" ${String(entry.id) === String(state.appointmentForm.modalityId) ? "selected" : ""}>
                            ${escapeHtml(formatModalityName(entry))}
                          </option>
                        `
                      )
                      .join("")}
                  </select>
                </label>

                <label class="field">
                  <span class="label">${escapeHtml(appointmentFieldLabel("examType"))}</span>
                  <select class="select" name="examTypeId">
                    <option value="">${escapeHtml(t().common.optional)}</option>
                    ${examTypes
                      .map(
                        (entry) => `
                          <option value="${escapeHtml(String(entry.id))}" ${String(entry.id) === String(state.appointmentForm.examTypeId) ? "selected" : ""}>
                            ${escapeHtml(formatExamName(entry))}
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
                  <span class="label">${escapeHtml(appointmentFieldLabel("notes"))}</span>
                  <textarea class="textarea field-en" name="notes">${escapeHtml(state.appointmentForm.notes)}</textarea>
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

              ${disabledDayMessage ? `<div class="alert alert-error">${escapeHtml(disabledDayMessage)}</div>` : ""}

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
            ${disabledDayMessage ? `<div class="alert alert-error">${escapeHtml(disabledDayMessage)}</div>` : ""}
            ${selectedDay?.is_full ? `<div class="alert alert-error">${escapeHtml(t().appointments.overbookNotice)}</div>` : ""}
            ${renderAppointmentCalendar()}
          </article>
        </div>
      </section>

      ${renderExamTypeModal()}
      ${renderAppointmentCreatedDialog()}
    </div>
  `;
}

function renderPacsPage() {
  return `
    <div class="page">
      ${pageHero(t().pacs.title, t().pacs.body, "", t().common.required)}
      ${alertMarkup("error", state.pacsSearchError)}
      <section class="split-grid">
        <article class="surface">
          <form id="pacs-search-form" class="stack">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().pacs.title)}</h2>
              <span class="chip accent">${escapeHtml(t().common.required)}</span>
            </div>

            <div class="form-grid">
              <label class="field">
                <span class="label">${escapeHtml(t().pacs.fields.patientName)}</span>
                <input class="input ${state.language === "ar" ? "field-ar" : "field-en"}" name="patientName" value="${escapeHtml(state.pacsSearchForm.patientName)}" />
              </label>

              <label class="field">
                <span class="label">${escapeHtml(t().pacs.fields.patientId)}</span>
                <input class="input field-en" name="patientId" value="${escapeHtml(state.pacsSearchForm.patientId)}" />
              </label>

              <label class="field">
                <span class="label">${escapeHtml(t().pacs.fields.accessionNumber)}</span>
                <input class="input field-en" name="accessionNumber" value="${escapeHtml(state.pacsSearchForm.accessionNumber)}" />
              </label>

              <label class="field">
                <span class="label">${escapeHtml(t().pacs.fields.studyDate)}</span>
                <input class="input field-en" type="date" name="studyDate" value="${escapeHtml(state.pacsSearchForm.studyDate)}" />
              </label>
            </div>

            <div class="form-actions">
              <button class="button-secondary" type="button" data-action="reset-pacs-search">${escapeHtml(t().pacs.resetButton)}</button>
              <button class="button-primary" type="submit">${escapeHtml(
                state.pacsSearchLoading ? t().pacs.loading : t().pacs.searchButton
              )}</button>
            </div>
          </form>
        </article>

        <article class="surface">
          <div class="section-head">
            <h2 class="section-title">${escapeHtml(t().pacs.resultsTitle)}</h2>
            <span class="chip subtle">${escapeHtml(String(state.pacsSearchResults.length))}</span>
          </div>
          ${renderPacsSearchResults()}
        </article>
      </section>
    </div>
  `;
}

function renderCalendarDayList(appointments) {
  if (!appointments.length) {
    return `<div class="empty">${escapeHtml(t().calendar.noAppointments)}</div>`;
  }

  return `
    <div class="list">
      ${appointments
        .map(
          (appointment) => `
            <div class="item patient-result">
              <div class="item-copy">
                <div class="item-title">${escapeHtml(appointment.accession_number)} • ${escapeHtml(
                  state.language === "ar" ? appointment.arabic_full_name : appointment.english_full_name
                )}</div>
                <div class="item-subtitle">
                  ${escapeHtml(formatModalityName(appointment))} • ${escapeHtml(formatExamName(appointment))} • ${escapeHtml(
                    formatDisplayDate(appointment.appointment_date)
                  )}
                </div>
              </div>
              <span class="chip ${appointment.status === "completed" ? "success" : "subtle"}">${escapeHtml(
                formatAppointmentStatus(appointment.status)
              )}</span>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function summarizeCalendarDay(appointments) {
  const counts = new Map();

  for (const appointment of appointments) {
    const label = formatModalityName(appointment) || t().common.noData;
    counts.set(label, (counts.get(label) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

function scrollCalendarDayListIntoView() {
  requestAnimationFrame(() => {
    const target = document.getElementById("calendar-day-list");
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
}

function renderCalendar() {
  const monthLabel = formatCalendarMonthLabel(state.calendarDisplayDate);
  const weekdayLabels = getCalendarWeekdayLabels();
  const groupedAppointments = groupCalendarAppointments();
  const selectedDate = state.calendarSelectedDate || formatIsoDate(state.calendarDisplayDate);
  const selectedAppointments = groupedAppointments[selectedDate] || [];
  const monthStart = getCalendarGridStart(state.calendarDisplayDate);
  const gridDays = [];

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), monthStart.getUTCDate() + index));
    const iso = formatIsoDate(date);
    const dayAppointments = groupedAppointments[iso] || [];
    gridDays.push({
      iso,
      dayNumber: date.getUTCDate(),
      isCurrentMonth: date.getUTCMonth() === state.calendarDisplayDate.getUTCMonth(),
      count: dayAppointments.length,
      isSelected: iso === selectedDate,
      summary: summarizeCalendarDay(dayAppointments)
    });
  }

  const filterModality = state.calendarFilters.modalityId
    ? state.appointmentLookups.modalities.find((entry) => String(entry.id) === String(state.calendarFilters.modalityId))
    : null;

  const filterChip = filterModality ? `<span class="chip subtle">${escapeHtml(formatModalityName(filterModality))}</span>` : "";
  const heroActions = `<button class="button-secondary" type="button" data-action="calendar-today">${
    escapeHtml(t().calendar.today)
  }</button>`;

  const calendarContent = state.calendarLoading
    ? `<div class="empty">${escapeHtml(t().calendar.loading)}</div>`
    : `
      <div class="calendar-weekdays">
        ${weekdayLabels.map((label) => `<div class="calendar-weekday">${escapeHtml(label)}</div>`).join("")}
      </div>
      <div class="calendar-month-grid">
        ${gridDays
          .map(
            (day) => `
              <button
                type="button"
                class="calendar-day ${day.isCurrentMonth ? "" : "calendar-day--ghost"} ${
              day.count ? "" : "calendar-day--empty"
            } ${day.isSelected ? "calendar-day--active" : ""}"
                data-action="select-calendar-day"
                data-date="${escapeHtml(day.iso)}"
              >
                <div class="calendar-day-number">${escapeHtml(String(day.dayNumber))}</div>
                <div class="calendar-day-count">${escapeHtml(String(day.count))}</div>
                <div class="calendar-day-note">${escapeHtml(
                  day.count ? t().calendar.dayAppointmentsLabel : t().calendar.noAppointmentsShort
                )}</div>
                ${day.count ? `<div class="calendar-day-meta">${escapeHtml(t().calendar.dayCasesLabel)}</div>` : ""}
                ${
                  day.count
                    ? `
                      <div class="calendar-day-summary">
                        ${day.summary
                          .slice(0, 3)
                          .map(
                            (item) => `
                              <div class="calendar-day-item">
                                <span>${escapeHtml(item.label)}</span>
                                <span>${escapeHtml(String(item.count))}</span>
                              </div>
                            `
                          )
                          .join("")}
                        ${
                          day.summary.length > 3
                            ? `<div class="calendar-day-more">+${escapeHtml(String(day.summary.length - 3))} ${escapeHtml(
                                t().calendar.dayMoreLabel
                              )}</div>`
                            : ""
                        }
                      </div>
                    `
                    : ""
                }
              </button>
            `
          )
          .join("")}
      </div>
    `;

  const dayListContent = state.calendarLoading
    ? `<div class="empty">${escapeHtml(t().common.loading)}</div>`
    : renderCalendarDayList(selectedAppointments);

  return `
    <div class="page calendar-page">
      ${pageHero(t().calendar.title, t().calendar.body, heroActions, t().calendar.summary)}
      ${alertMarkup("error", state.calendarError)}

      <section class="calendar-top-grid">
        <article class="surface calendar-filter-card">
          <div class="section-head">
            <h2 class="section-title">${escapeHtml(t().calendar.filtersTitle)}</h2>
          </div>
          <form id="calendar-filter-form" class="stack">
            <div class="form-grid">
              <label class="field">
                <span class="label">${escapeHtml(t().calendar.fields.modality)}</span>
                <select class="select" name="modalityId">
                  <option value="">${escapeHtml(t().common.optional)}</option>
                  ${state.appointmentLookups.modalities
                    .map(
                      (entry) => `
                        <option value="${escapeHtml(String(entry.id))}" ${
                        String(entry.id) === String(state.calendarFilters.modalityId) ? "selected" : ""
                      }>
                          ${escapeHtml(formatModalityName(entry))}
                        </option>
                      `
                    )
                    .join("")}
                </select>
              </label>
            </div>
            <div class="form-actions">
              <button class="button-secondary" type="button" data-action="calendar-clear-filter">${escapeHtml(
                t().calendar.clearFilters
              )}</button>
              <button class="button-primary" type="submit">${escapeHtml(t().common.refresh)}</button>
            </div>
          </form>
        </article>

        <article class="surface calendar-panel-wrapper">
          <div class="calendar-panel">
            <div class="calendar-panel-header">
              <button class="button-ghost" type="button" data-action="calendar-prev-month">‹</button>
              <div>
                <div class="calendar-month-label">${escapeHtml(monthLabel)}</div>
                <div class="small">${escapeHtml(t().calendar.monthLabelHint)}</div>
              </div>
              <button class="button-ghost" type="button" data-action="calendar-next-month">›</button>
            </div>
            ${calendarContent}
          </div>
        </article>
      </section>

      <article class="surface calendar-day-panel" id="calendar-day-list">
        <div class="section-head">
          <h2 class="section-title">${escapeHtml(t().calendar.selectedDayTitle)}</h2>
          <div class="hero-actions">
            ${filterChip}
            <span class="chip accent">${escapeHtml(selectedDate ? formatDisplayDate(selectedDate) : t().common.noData)}</span>
          </div>
        </div>
        ${dayListContent}
        <div class="form-actions">
          <button
            class="button-primary"
            type="button"
            data-action="calendar-print-day"
            data-date="${escapeHtml(selectedDate)}"
            ${selectedAppointments.length ? "" : "disabled"}
          >
            ${escapeHtml(t().calendar.printButton)}
          </button>
        </div>
      </article>
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
                  formatModalityName(entry)
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
                  formatModalityName(candidate)
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
                  <span class="label">${escapeHtml(appointmentFieldLabel("modality"))}</span>
                  <select class="select" name="modalityId">
                    <option value="">${escapeHtml(t().common.required)}</option>
                    ${state.appointmentLookups.modalities
                      .map(
                        (entry) => `
                          <option value="${escapeHtml(String(entry.id))}" ${String(entry.id) === String(state.queueWalkInForm.modalityId) ? "selected" : ""}>
                            ${escapeHtml(formatModalityName(entry))}
                          </option>
                        `
                      )
                      .join("")}
                  </select>
                </label>

                <label class="field">
                  <span class="label">${escapeHtml(appointmentFieldLabel("examType"))}</span>
                  <select class="select" name="examTypeId">
                    <option value="">${escapeHtml(t().common.optional)}</option>
                    ${walkInExamTypes
                      .map(
                        (entry) => `
                          <option value="${escapeHtml(String(entry.id))}" ${String(entry.id) === String(state.queueWalkInForm.examTypeId) ? "selected" : ""}>
                            ${escapeHtml(formatExamName(entry))}
                          </option>
                        `
                      )
                      .join("")}
                  </select>
                </label>

                <label class="field">
                  <span class="label">${escapeHtml(appointmentFieldLabel("priority"))}</span>
                  <select class="select" name="reportingPriorityId">
                    <option value="">${escapeHtml(t().common.optional)}</option>
                    ${state.appointmentLookups.priorities
                      .map(
                        (entry) => `
                          <option value="${escapeHtml(String(entry.id))}" ${String(entry.id) === String(state.queueWalkInForm.reportingPriorityId) ? "selected" : ""}>
                            ${escapeHtml(formatPriorityName(entry))}
                          </option>
                        `
                      )
                      .join("")}
                  </select>
                </label>

                <label class="field full">
                  <span class="label">${escapeHtml(appointmentFieldLabel("notes"))}</span>
                  <textarea class="textarea field-en" name="notes">${escapeHtml(state.queueWalkInForm.notes)}</textarea>
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
          (appointment) => {
            const showDate = Boolean(state.printFilters.dateFrom || state.printFilters.dateTo);
            const dateNote = showDate ? ` • ${escapeHtml(formatDisplayDate(appointment.appointment_date))}` : "";
            return `
            <div class="item patient-result">
              <div class="item-copy">
                <div class="item-title">${escapeHtml(appointment.accession_number)} • ${escapeHtml(
                  state.language === "ar" ? appointment.arabic_full_name : appointment.english_full_name
                )}</div>
                <div class="item-subtitle">${escapeHtml(
                  formatModalityName(appointment)
                )} • ${escapeHtml(state.language === "ar" ? "البروتوكول" : "Protocol")}: ${escapeHtml(
                  formatExamName(appointment)
                )}${dateNote}</div>
              </div>
              <button class="button-secondary" type="button" data-action="select-print-appointment" data-appointment-id="${escapeHtml(String(appointment.id))}">
                ${escapeHtml(t().common.open)}
              </button>
            </div>
          `;
          }
        )
        .join("")}
    </div>
  `;
}

function renderPrintGroupedByModality() {
  if (state.printLoading) {
    return `<div class="empty">${escapeHtml(t().common.loading)}</div>`;
  }

  if (!state.printResults.length) {
    return `<div class="empty">${escapeHtml(t().common.noData)}</div>`;
  }

  const grouped = state.printResults.reduce((accumulator, appointment) => {
    const key = String(appointment.modality_id || "unknown");
    const modalityName = formatModalityName(appointment) || (state.language === "ar" ? "جهاز غير محدد" : "Unknown modality");

    if (!accumulator[key]) {
      accumulator[key] = { modalityId: key, modalityName, appointments: [] };
    }

    accumulator[key].appointments.push(appointment);
    return accumulator;
  }, {});

  return `
    <div class="stack">
      ${Object.values(grouped)
        .map(
          (group) => `
            <article class="surface surface-compact">
              <div class="section-head">
                <h3 class="section-title">${escapeHtml(group.modalityName)}</h3>
                <div class="hero-actions">
                  <span class="chip subtle">${escapeHtml(String(group.appointments.length))}</span>
                  <button class="button-secondary" type="button" data-action="print-modality-list" data-modality-id="${escapeHtml(group.modalityId)}">
                    ${escapeHtml(t().modality.printList)}
                  </button>
                </div>
              </div>
              <div class="list">
                ${group.appointments
                  .map(
                    (appointment) => `
                      <div class="item patient-result">
                        <div class="item-copy">
                          <div class="item-title">${escapeHtml(appointment.accession_number)} • ${escapeHtml(
                            state.language === "ar" ? appointment.arabic_full_name : appointment.english_full_name
                          )}</div>
                          <div class="item-subtitle">${escapeHtml(formatExamName(appointment))} • ${escapeHtml(
                            formatDisplayDate(appointment.appointment_date)
                          )}</div>
                        </div>
                        <span class="chip accent">${escapeHtml(appointment.status || "")}</span>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            </article>
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

  const language = state.language;
  const modalityInstruction =
    language === "ar" ? appointment.general_instruction_ar || "" : appointment.general_instruction_en || "";
  const examInstruction =
    language === "ar"
      ? appointment.specific_instruction_ar || ""
      : appointment.specific_instruction_en || "";
  const noteContent = String(appointment.notes || "").trim();
  const registrationDate = appointment.created_at ? formatDisplayDate(appointment.created_at) : "—";
  const registrationDateLabel =
    state.language === "ar"
      ? "تاريخ التسجيل (تاريخ حجز الموعد وليس تاريخ الفحص)"
      : "Registration date (date the appointment was booked, not exam date)";
  const barcodeMarkup = buildCode39Svg(appointment.accession_number);

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
          <div>${escapeHtml(appointment.arabic_full_name || "—")}</div>
        </div>
        <div class="slip-info">
          <div class="label">${escapeHtml(t().patients.fields.englishFullName)}</div>
          <div>${escapeHtml(appointment.english_full_name || "—")}</div>
        </div>
        <div class="slip-info">
          <div class="label">${escapeHtml(t().appointments.fields.appointmentDate)}</div>
          <div>${escapeHtml(formatDisplayDate(appointment.appointment_date))}</div>
        </div>
        <div class="slip-info">
          <div class="label">${escapeHtml(appointmentFieldLabel("modality"))}</div>
          <div>${escapeHtml(formatModalityName(appointment)) || "—"}</div>
        </div>
        <div class="slip-info">
          <div class="label">${escapeHtml(appointmentFieldLabel("examType"))}</div>
          <div>${escapeHtml(formatExamName(appointment))}</div>
        </div>
        <div class="slip-info full-span">
          <div class="label">${escapeHtml(t().print.fields.modalityInstructions)}</div>
          <div>${escapeHtml(modalityInstruction || "—")}</div>
        </div>
        <div class="slip-info full-span">
          <div class="label">${escapeHtml(t().print.fields.examInstructions)}</div>
          <div>${escapeHtml(examInstruction || "—")}</div>
        </div>
        ${
          noteContent
            ? `
        <div class="slip-info full-span">
          <div class="label">${escapeHtml(appointmentFieldLabel("notes"))}</div>
          <div>${escapeHtml(noteContent)}</div>
        </div>`
            : ""
        }
      </div>

      <div class="barcode-block">
        <div class="label">${escapeHtml(t().appointments.fields.accessionNumber)}</div>
        <div class="barcode-visual">${barcodeMarkup}</div>
        <div class="barcode-text">${escapeHtml(appointment.accession_number)}</div>
        <div class="small">${escapeHtml(`${registrationDateLabel}: ${registrationDate}`)}</div>
      </div>
    </div>
  `;
}

function renderPrintLabelPreview() {
  const appointment = state.selectedPrintAppointment;

  if (!appointment) {
    return `<div class="empty">${escapeHtml(t().print.noAppointment)}</div>`;
  }

  const barcodeMarkup = buildCode39Svg(appointment.accession_number);

  return `
    <div class="label-card">
      <div class="item-title">${escapeHtml(appointment.arabic_full_name)}</div>
      <div class="item-subtitle">${escapeHtml(appointment.english_full_name)}</div>
      <div class="barcode-panel">
        <div class="barcode-visual small-barcode">${barcodeMarkup}</div>
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
  const dicomGateway = state.integrationStatus.dicomGateway || null;

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
          <span class="chip ${scanner.bridgeReady ? "success" : "subtle"}">${escapeHtml(humanizeAuditValue(scanner.scannerBridgeMode))}</span>
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

      ${
        dicomGateway
          ? `
            <article class="surface surface-compact">
              <div class="section-head">
                <h3 class="section-title">${escapeHtml(state.language === "ar" ? "بوابة DICOM" : "DICOM gateway")}</h3>
                <span class="chip ${dicomGateway.enabled ? "success" : "subtle"}">${escapeHtml(
                  dicomGateway.enabled ? t().common.active : t().common.inactive
                )}</span>
              </div>
              <div class="stack">
                <div class="info-grid">
                  ${infoTile("MWL", `${dicomGateway.mwlAeTitle || "RISPRO_MWL"} • ${dicomGateway.mwlPort || "11112"}`, "tone-good")}
                  ${infoTile("MPPS", `${dicomGateway.mppsAeTitle || "RISPRO_MPPS"} • ${dicomGateway.mppsPort || "11113"}`, "tone-warm")}
                </div>
                <div class="small">${escapeHtml(
                  state.language === "ar"
                    ? `الأجهزة المرتبطة: ${dicomGateway.deviceCount || 0} • الرسائل المعالجة: ${dicomGateway.processedMessageCount || 0}`
                    : `Mapped devices: ${dicomGateway.deviceCount || 0} • Processed messages: ${dicomGateway.processedMessageCount || 0}`
                )}</div>
              </div>
            </article>
          `
          : ""
      }
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
              <div class="badge-row">
                ${
                  document.id
                    ? `<a class="button-secondary" href="/api/documents/${escapeHtml(String(document.id))}/view" target="_blank" rel="noopener">${escapeHtml(t().common.open)}</a>`
                    : ""
                }
                <span class="chip subtle">${escapeHtml(document.mime_type || "file")}</span>
              </div>
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
          (appointment) => {
            const showDate = state.modalityFilters.scope === "all";
            const dateLabel = showDate ? ` • ${escapeHtml(formatDisplayDate(appointment.appointment_date))}` : "";
            return `
            <div class="item patient-result">
              <div class="item-copy">
                <div class="item-title">#${escapeHtml(String(appointment.modality_slot_number || "—"))} • ${escapeHtml(
                  state.language === "ar" ? appointment.arabic_full_name : appointment.english_full_name
                )}</div>
                <div class="item-subtitle">${escapeHtml(appointment.accession_number)} • ${escapeHtml(
                  formatModalityName(appointment)
                )} • ${escapeHtml(formatExamName(appointment))}${dateLabel}</div>
                <div class="item-subtitle">${escapeHtml(
                  `${t().patients.fields.nationalId}: ${appointment.national_id || "—"} • ${t().patients.fields.ageYears}: ${
                    appointment.age_years || "—"
                  } • ${t().appointments.fields.priority}: ${formatPriorityName(appointment)}`
                )}</div>
              </div>
              ${
                ["waiting", "arrived", "in-progress"].includes(appointment.status)
                  ? `<button class="button-secondary" type="button" data-action="complete-appointment" data-appointment-id="${escapeHtml(String(appointment.id))}">${escapeHtml(t().modality.complete)}</button>`
                  : appointment.status === "completed"
                    ? `<span class="chip success">${escapeHtml(appointment.status)}</span>`
                    : `<span class="chip subtle">${escapeHtml(appointment.status)}</span>`
              }
            </div>
          `;
          }
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

  const waitingCount = state.modalityResults.filter((item) => item.status === "waiting").length;
  const arrivedCount = state.modalityResults.filter((item) => item.status === "arrived").length;
  const completedCount = state.modalityResults.filter((item) => item.status === "completed").length;

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

      <section class="card-grid">
        ${statCard(t().dashboard.waiting, String(waitingCount), t().modality.title, "var(--amber)")}
        ${statCard(state.language === "ar" ? "وصلوا" : "Arrived", String(arrivedCount), t().modality.filtersTitle, "var(--teal)")}
        ${statCard(state.language === "ar" ? "مكتمل" : "Completed", String(completedCount), t().modality.complete, "var(--green)")}
      </section>

      <section class="surface">
        <form id="modality-filter-form" class="stack">
          <div class="section-head">
            <h2 class="section-title">${escapeHtml(t().modality.filtersTitle)}</h2>
            <span class="chip accent">${escapeHtml(t().modality.load)}</span>
          </div>
          <div class="form-grid">
            <label class="field">
              <span class="label">${escapeHtml(t().print.date)}</span>
              <input class="input field-en" type="date" name="date" value="${escapeHtml(state.modalityFilters.date)}" ${state.modalityFilters.scope === "all" ? "disabled" : ""} />
            </label>
            <label class="field">
              <span class="label">${escapeHtml(appointmentFieldLabel("modality"))}</span>
              <select class="select" name="modalityId">
                <option value="">${escapeHtml(t().common.optional)}</option>
                ${state.appointmentLookups.modalities
                  .map(
                    (entry) => `
                      <option value="${escapeHtml(String(entry.id))}" ${String(entry.id) === String(state.modalityFilters.modalityId) ? "selected" : ""}>
                        ${escapeHtml(formatModalityName(entry))}
                      </option>
                    `
                  )
                  .join("")}
              </select>
            </label>
            <label class="field">
              <span class="label">${escapeHtml(t().modality.filtersTitle)}</span>
              <div class="pill-row">
                <button class="button-ghost ${state.modalityFilters.scope === "day" ? "active-pill" : ""}" type="button" data-action="set-modality-scope" data-scope="day">${escapeHtml(
                  t().modality.dayOnly
                )}</button>
                <button class="button-ghost ${state.modalityFilters.scope === "all" ? "active-pill" : ""}" type="button" data-action="set-modality-scope" data-scope="all">${escapeHtml(
                  t().modality.allDates
                )}</button>
              </div>
            </label>
          </div>
          <div class="form-actions">
            <div class="quick-actions">
              <button class="button-ghost" type="button" data-action="set-modality-quick-date" data-range="today">${escapeHtml(t().modality.quickToday)}</button>
              <button class="button-ghost" type="button" data-action="set-modality-quick-date" data-range="tomorrow">${escapeHtml(t().modality.quickTomorrow)}</button>
              <button class="button-ghost" type="button" data-action="set-modality-quick-date" data-range="next_week">${escapeHtml(t().modality.quickNextWeek)}</button>
            </div>
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

function renderDoctorList() {
  if (state.doctorLoading) {
    return `<div class="empty">${escapeHtml(t().common.loading)}</div>`;
  }

  if (!state.doctorResults.length) {
    return `<div class="empty">${escapeHtml(t().common.noData)}</div>`;
  }

  return `
    <div class="list">
      ${state.doctorResults
        .map(
          (appointment) => `
            <div class="item patient-result">
              <div class="item-copy">
                <div class="item-title">${escapeHtml(appointment.accession_number)} • ${escapeHtml(
                  state.language === "ar" ? appointment.arabic_full_name : appointment.english_full_name
                )}</div>
                <div class="item-subtitle">${escapeHtml(
                  formatModalityName(appointment)
                )} • ${escapeHtml(formatExamName(appointment))}</div>
              </div>
              <button class="button-secondary" type="button" data-action="select-doctor-appointment" data-appointment-id="${escapeHtml(String(appointment.id))}">
                ${escapeHtml(t().common.open)}
              </button>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderDoctorDocumentsList() {
  if (state.doctorDocumentsLoading) {
    return `<div class="empty">${escapeHtml(t().common.loading)}</div>`;
  }

  if (!state.doctorDocuments.length) {
    return `<div class="empty">${escapeHtml(t().common.noData)}</div>`;
  }

  return `
    <div class="list">
      ${state.doctorDocuments
        .map(
          (document) => `
            <div class="item">
              <div class="item-copy">
                <div class="item-title">${escapeHtml(document.original_filename)}</div>
                <div class="item-subtitle">${escapeHtml(document.document_type)} • ${escapeHtml(String(document.file_size || 0))} bytes</div>
              </div>
              <div class="badge-row">
                ${
                  document.id
                    ? `<a class="button-secondary" href="/api/documents/${escapeHtml(String(document.id))}/view" target="_blank" rel="noopener">${escapeHtml(t().common.open)}</a>`
                    : ""
                }
                <span class="chip subtle">${escapeHtml(document.mime_type || "file")}</span>
              </div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderDoctorDetails() {
  const appointment = state.doctorSelectedAppointment;

  if (!appointment) {
    return `<div class="empty">${escapeHtml(t().doctor.noSelection)}</div>`;
  }

  const protocolOptions = state.appointmentLookups.examTypes.filter(
    (entry) => String(entry.modality_id) === String(appointment.modality_id)
  );

  return `
    <div class="stack">
      <article class="surface">
        <div class="section-head">
          <h2 class="section-title">${escapeHtml(t().doctor.demographicsTitle)}</h2>
          <span class="chip accent">${escapeHtml(appointment.mrn || `#${appointment.patient_id}`)}</span>
        </div>
        <div class="info-grid">
          ${infoTile(t().patients.fields.arabicFullName, appointment.arabic_full_name || "—", "tone-good")}
          ${infoTile(t().patients.fields.englishFullName, appointment.english_full_name || "—", "")}
          ${infoTile(t().patients.fields.nationalId, appointment.national_id || "—", "")}
          ${infoTile(t().patients.fields.ageYears, appointment.age_years ? `${appointment.age_years}` : "—", "")}
          ${infoTile(t().patients.fields.sex, appointment.sex ? formatSex(appointment.sex) : "—", "")}
          ${infoTile(t().patients.fields.phone1, appointment.phone_1 || "—", "")}
          ${infoTile(t().patients.fields.address, appointment.address || "—", "")}
        </div>
      </article>

      <article class="surface">
        <form id="doctor-protocol-form" class="stack">
          <div class="section-head">
            <h2 class="section-title">${escapeHtml(t().doctor.protocolTitle)}</h2>
            <span class="chip subtle">${escapeHtml(appointment.accession_number)}</span>
          </div>
          <div class="small">${escapeHtml(t().doctor.protocolHint)}</div>
          ${alertMarkup("error", state.doctorProtocolError)}
          ${alertMarkup("success", state.doctorProtocolSuccess)}
          <div class="form-grid">
            <label class="field">
              <span class="label">${escapeHtml(appointmentFieldLabel("examType"))}</span>
              <select class="select" name="protocolExamTypeId">
                <option value="">${escapeHtml(t().common.optional)}</option>
                ${protocolOptions
                  .map(
                    (entry) => `
                      <option value="${escapeHtml(String(entry.id))}" ${String(entry.id) === String(state.doctorProtocolExamTypeId) ? "selected" : ""}>
                        ${escapeHtml(formatExamName(entry))}
                      </option>
                    `
                  )
                  .join("")}
              </select>
            </label>
          </div>
          <div class="form-actions">
            <button class="button-primary" type="submit">${escapeHtml(
              state.doctorProtocolSaving ? t().common.loading : t().doctor.protocolSave
            )}</button>
          </div>
        </form>
      </article>

      <article class="surface">
        <div class="section-head">
          <h2 class="section-title">${escapeHtml(t().doctor.documentsTitle)}</h2>
          <span class="chip subtle">${escapeHtml(String(state.doctorDocuments.length))}</span>
        </div>
        ${alertMarkup("error", state.doctorDocumentsError)}
        ${renderDoctorDocumentsList()}
      </article>
    </div>
  `;
}

function renderDoctor() {
  return `
    <div class="page">
      ${pageHero(
        t().doctor.title,
        t().doctor.body,
        `<button class="button-secondary" type="button" data-action="refresh-doctor">${escapeHtml(t().common.refresh)}</button>`,
        t().doctor.selectedRequest
      )}
      ${alertMarkup("error", state.doctorError)}

      <section class="split-grid">
        <div class="stack">
          <article class="surface">
            <form id="doctor-filter-form" class="stack">
              <div class="section-head">
                <h2 class="section-title">${escapeHtml(t().doctor.filtersTitle)}</h2>
                <span class="chip accent">${escapeHtml(t().doctor.load)}</span>
              </div>
              <div class="form-grid">
                <label class="field">
                  <span class="label">${escapeHtml(t().print.date)}</span>
                  <input class="input field-en" type="date" name="date" value="${escapeHtml(state.doctorFilters.date)}" />
                </label>
                <label class="field">
                  <span class="label">${escapeHtml(appointmentFieldLabel("modality"))}</span>
                  <select class="select" name="modalityId">
                    <option value="">${escapeHtml(t().common.optional)}</option>
                    ${state.appointmentLookups.modalities
                      .map(
                        (entry) => `
                          <option value="${escapeHtml(String(entry.id))}" ${String(entry.id) === String(state.doctorFilters.modalityId) ? "selected" : ""}>
                            ${escapeHtml(formatModalityName(entry))}
                          </option>
                        `
                      )
                      .join("")}
                  </select>
                </label>
              </div>
              <div class="form-actions">
                <button class="button-primary" type="submit">${escapeHtml(state.doctorLoading ? t().common.loading : t().doctor.load)}</button>
              </div>
            </form>
          </article>

          <article class="surface">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().doctor.dailyList)}</h2>
              <span class="chip subtle">${escapeHtml(String(state.doctorResults.length))}</span>
            </div>
            ${renderDoctorList()}
          </article>
        </div>

        ${renderDoctorDetails()}
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
        `<button class="button-secondary" type="button" data-action="print-daily-list">${escapeHtml(t().print.printDaily)}</button>`,
        t().print.dailyList
      )}
      ${alertMarkup("error", state.printError)}
      ${alertMarkup("success", state.printSuccess || state.integrationSuccess)}

      <section class="stack">
        <article class="surface">
          <form id="print-filter-form" class="stack">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().print.filtersTitle)}</h2>
              <span class="chip accent">${escapeHtml(t().print.load)}</span>
            </div>
            <div class="form-grid">
              <label class="field full">
                <span class="label">${escapeHtml(t().search.placeholder)}</span>
                <input class="input ${state.language === "ar" ? "field-ar" : ""}" name="query" value="${escapeHtml(state.printFilters.query)}" placeholder="${escapeHtml(
                  t().appointments.patientPlaceholder
                )}" />
              </label>
              <label class="field">
                <span class="label">${escapeHtml(t().print.date)}</span>
                <input class="input field-en" type="date" name="date" value="${escapeHtml(state.printFilters.date)}" />
              </label>
              <label class="field">
                <span class="label">${escapeHtml(t().print.dateFrom)}</span>
                <input class="input field-en" type="date" name="dateFrom" value="${escapeHtml(state.printFilters.dateFrom)}" />
              </label>
              <label class="field">
                <span class="label">${escapeHtml(t().print.dateTo)}</span>
                <input class="input field-en" type="date" name="dateTo" value="${escapeHtml(state.printFilters.dateTo)}" />
              </label>
              <label class="field">
                <span class="label">${escapeHtml(t().print.modality)}</span>
                <select class="select" name="modalityId">
                  <option value="">${escapeHtml(t().common.optional)}</option>
                  ${state.appointmentLookups.modalities
                    .map(
                      (entry) => `
                        <option value="${escapeHtml(String(entry.id))}" ${String(entry.id) === String(state.printFilters.modalityId) ? "selected" : ""}>
                          ${escapeHtml(formatModalityName(entry))}
                        </option>
                      `
                    )
                    .join("")}
                </select>
              </label>
            </div>
            <div class="form-actions">
              <div class="quick-actions">
                <button class="button-ghost" type="button" data-action="set-print-range" data-range="today">${escapeHtml(t().print.quickToday)}</button>
                <button class="button-ghost" type="button" data-action="set-print-range" data-range="tomorrow">${escapeHtml(t().print.quickTomorrow)}</button>
                <button class="button-ghost" type="button" data-action="set-print-range" data-range="next_week">${escapeHtml(t().print.quickNextWeek)}</button>
                <button class="button-ghost" type="button" data-action="set-print-range" data-range="clear">${escapeHtml(t().print.quickClear)}</button>
              </div>
              <button class="button-primary" type="submit">${escapeHtml(state.printLoading ? t().common.loading : t().print.load)}</button>
            </div>
          </form>
        </article>

        <article class="surface">
          <div class="section-head">
            <h2 class="section-title">${escapeHtml(t().print.dailyList)}</h2>
            <span class="chip subtle">${escapeHtml(String(state.printResults.length))}</span>
          </div>
          ${renderPrintGroupedByModality()}
        </article>
      </section>
    </div>
  `;
}

function renderStatisticsStatusBreakdown(statusBreakdown, totalAppointments) {
  if (!statusBreakdown.length) {
    return `<div class="empty">${escapeHtml(t().common.noData)}</div>`;
  }

  return `
    <div class="statistics-status-grid">
      ${statusBreakdown
        .map(
          (entry) => `
            <div class="statistics-status-pill">
              <div class="item-copy">
                <div class="item-title">${escapeHtml(formatAppointmentStatus(entry.status))}</div>
                <div class="item-subtitle">${escapeHtml(formatPercent(entry.total_count, totalAppointments))}</div>
              </div>
              <span class="chip accent">${escapeHtml(String(entry.total_count || 0))}</span>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderStatisticsModalityBreakdown(modalityBreakdown) {
  if (!modalityBreakdown.length) {
    return `<div class="empty">${escapeHtml(t().common.noData)}</div>`;
  }

  return `
    <div class="statistics-table">
      <div class="statistics-row statistics-head">
        <span>${escapeHtml(t().statistics.modality)}</span>
        <span>${escapeHtml(t().statistics.totalAppointments)}</span>
        <span>${escapeHtml(t().statistics.completed)}</span>
        <span>${escapeHtml(t().statistics.noShowRate)}</span>
      </div>
      ${modalityBreakdown
        .map((entry) => {
          const total = Number(entry.total_count || 0);
          const noShowRate = formatPercent(entry.no_show_count, total);

          return `
            <div class="statistics-row">
              <span>${escapeHtml(formatModalityName(entry) || `#${entry.modality_id}`)}</span>
              <span>${escapeHtml(String(total))}</span>
              <span>${escapeHtml(String(entry.completed_count || 0))}</span>
              <span>${escapeHtml(noShowRate)}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderStatisticsDailyBreakdown(dailyBreakdown) {
  if (!dailyBreakdown.length) {
    return `<div class="empty">${escapeHtml(t().common.noData)}</div>`;
  }

  return `
    <div class="statistics-table">
      <div class="statistics-row statistics-head">
        <span>${escapeHtml(t().print.date)}</span>
        <span>${escapeHtml(t().statistics.totalAppointments)}</span>
        <span>${escapeHtml(t().statistics.completed)}</span>
        <span>${escapeHtml(t().statistics.noShowRate)}</span>
      </div>
      ${dailyBreakdown
        .map((entry) => {
          const total = Number(entry.total_count || 0);
          const noShowRate = formatPercent(entry.no_show_count, total);

          return `
            <div class="statistics-row">
              <span>${escapeHtml(normalizeDateText(entry.appointment_date))}</span>
              <span>${escapeHtml(String(total))}</span>
              <span>${escapeHtml(String(entry.completed_count || 0))}</span>
              <span>${escapeHtml(noShowRate)}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderStatistics() {
  const snapshot = state.statisticsSnapshot || {};
  const summary = snapshot.summary || {};
  const totalAppointments = Number(summary.total_appointments || 0);
  const noShowRate = formatPercent(summary.no_show_count, totalAppointments);
  const completionRate = formatPercent(summary.completed_count, totalAppointments);

  return `
    <div class="page">
      ${pageHero(
        t().statistics.title,
        t().statistics.body,
        `<button class="button-secondary" type="button" data-action="refresh-statistics">${escapeHtml(t().common.refresh)}</button>
         <button class="button-primary" type="button" data-action="print-statistics">${escapeHtml(t().statistics.print)}</button>`,
        t().statistics.summaryTitle
      )}
      ${alertMarkup("error", state.statisticsError)}

      <section class="surface">
        <form id="statistics-filter-form" class="stack">
          <div class="section-head">
            <h2 class="section-title">${escapeHtml(t().statistics.filtersTitle)}</h2>
            <span class="chip accent">${escapeHtml(t().statistics.load)}</span>
          </div>
          <div class="form-grid">
            <label class="field">
              <span class="label">${escapeHtml(t().statistics.date)}</span>
              <input class="input field-en" type="date" name="date" value="${escapeHtml(state.statisticsFilters.date)}" />
            </label>
            <label class="field">
              <span class="label">${escapeHtml(t().statistics.dateFrom)}</span>
              <input class="input field-en" type="date" name="dateFrom" value="${escapeHtml(state.statisticsFilters.dateFrom)}" />
            </label>
            <label class="field">
              <span class="label">${escapeHtml(t().statistics.dateTo)}</span>
              <input class="input field-en" type="date" name="dateTo" value="${escapeHtml(state.statisticsFilters.dateTo)}" />
            </label>
            <label class="field">
              <span class="label">${escapeHtml(t().statistics.modality)}</span>
              <select class="select" name="modalityId">
                <option value="">${escapeHtml(t().common.optional)}</option>
                ${state.appointmentLookups.modalities
                  .map(
                    (entry) => `
                      <option value="${escapeHtml(String(entry.id))}" ${String(entry.id) === String(state.statisticsFilters.modalityId) ? "selected" : ""}>
                        ${escapeHtml(formatModalityName(entry))}
                      </option>
                    `
                  )
                  .join("")}
              </select>
            </label>
          </div>
          <div class="form-actions">
            <button class="button-primary" type="submit">${escapeHtml(state.statisticsLoading ? t().common.loading : t().statistics.load)}</button>
          </div>
        </form>
      </section>

      <section class="card-grid">
        ${statCard(t().statistics.totalAppointments, String(totalAppointments), t().statistics.summaryTitle, "var(--blue)")}
        ${statCard(t().statistics.uniquePatients, String(summary.unique_patients || 0), t().statistics.summaryTitle, "var(--teal)")}
        ${statCard(t().statistics.completed, `${summary.completed_count || 0} (${completionRate})`, t().statistics.byStatusTitle, "var(--green)")}
        ${statCard(t().statistics.noShowRate, noShowRate, `${summary.no_show_count || 0} ${formatAppointmentStatus("no-show")}`, "var(--red)")}
        ${statCard(t().statistics.walkIn, String(summary.walk_in_count || 0), t().statistics.byStatusTitle, "var(--amber)")}
        ${statCard(t().statistics.inQueue, String(summary.in_queue_count || 0), formatAppointmentStatus("arrived"), "var(--brown)")}
      </section>

      <section class="statistics-grid">
        <article class="surface">
          <div class="section-head">
            <h2 class="section-title">${escapeHtml(t().statistics.byModalityTitle)}</h2>
            <span class="chip subtle">${escapeHtml(String((snapshot.modalityBreakdown || []).length))}</span>
          </div>
          ${renderStatisticsModalityBreakdown(snapshot.modalityBreakdown || [])}
        </article>

        <article class="surface">
          <div class="section-head">
            <h2 class="section-title">${escapeHtml(t().statistics.byStatusTitle)}</h2>
            <span class="chip subtle">${escapeHtml(String((snapshot.statusBreakdown || []).length))}</span>
          </div>
          ${renderStatisticsStatusBreakdown(snapshot.statusBreakdown || [], totalAppointments)}
        </article>
      </section>

      <section class="surface">
        <div class="section-head">
          <h2 class="section-title">${escapeHtml(t().statistics.byDayTitle)}</h2>
          <span class="chip subtle">${escapeHtml(String((snapshot.dailyBreakdown || []).length))}</span>
        </div>
        ${renderStatisticsDailyBreakdown(snapshot.dailyBreakdown || [])}
      </section>
    </div>
  `;
}

function renderRegistrationsList() {
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
                <div class="item-title">${escapeHtml(
                  state.language === "ar" ? appointment.arabic_full_name : appointment.english_full_name
                )}</div>
                <div class="item-subtitle">${escapeHtml(appointment.accession_number)} • ${escapeHtml(
                  formatDisplayDate(appointment.appointment_date)
                )} • ${escapeHtml(formatModalityName(appointment))}</div>
              </div>
              <button class="button-secondary" type="button" data-action="select-registration" data-appointment-id="${escapeHtml(String(appointment.id))}">
                ${escapeHtml(t().common.open)}
              </button>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderRegistrations() {
  return `
    <div class="page">
      ${pageHero(t().registrations.title, t().registrations.body, "", t().registrations.detailsTitle)}
      ${alertMarkup("error", state.printError || state.appointmentEditError)}
      ${alertMarkup("success", state.printSuccess || state.appointmentEditSuccess)}

      <section class="split-grid">
        <div class="stack">
          <article class="surface">
            <form id="registrations-filter-form" class="stack">
              <div class="section-head">
                <h2 class="section-title">${escapeHtml(t().registrations.filtersTitle)}</h2>
                <span class="chip accent">${escapeHtml(t().registrations.load)}</span>
              </div>
              <div class="form-grid">
                <label class="field full">
                  <span class="label">${escapeHtml(t().search.placeholder)}</span>
                  <input class="input ${state.language === "ar" ? "field-ar" : ""}" name="query" value="${escapeHtml(state.registrationsFilters.query)}" placeholder="${escapeHtml(
                    t().appointments.patientPlaceholder
                  )}" />
                </label>
                <label class="field">
                  <span class="label">${escapeHtml(t().print.date)}</span>
                  <input class="input field-en" type="date" name="date" value="${escapeHtml(state.registrationsFilters.date)}" />
                </label>
                <label class="field">
                  <span class="label">${escapeHtml(t().print.dateFrom)}</span>
                  <input class="input field-en" type="date" name="dateFrom" value="${escapeHtml(state.registrationsFilters.dateFrom)}" />
                </label>
                <label class="field">
                  <span class="label">${escapeHtml(t().print.dateTo)}</span>
                  <input class="input field-en" type="date" name="dateTo" value="${escapeHtml(state.registrationsFilters.dateTo)}" />
                </label>
                <label class="field">
                  <span class="label">${escapeHtml(t().print.modality)}</span>
                  <select class="select" name="modalityId">
                    <option value="">${escapeHtml(t().common.optional)}</option>
                    ${state.appointmentLookups.modalities
                      .map(
                        (entry) => `
                          <option value="${escapeHtml(String(entry.id))}" ${String(entry.id) === String(state.registrationsFilters.modalityId) ? "selected" : ""}>
                            ${escapeHtml(formatModalityName(entry))}
                          </option>
                        `
                      )
                      .join("")}
                  </select>
                </label>
              </div>
              <div class="form-actions">
                <button class="button-primary" type="submit">${escapeHtml(state.printLoading ? t().common.loading : t().registrations.load)}</button>
              </div>
            </form>
          </article>

          <article class="surface">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().registrations.listTitle)}</h2>
              <span class="chip subtle">${escapeHtml(String(state.printResults.length))}</span>
            </div>
            ${renderRegistrationsList()}
          </article>
        </div>

        <div class="stack">
          <article class="surface slip-surface">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().print.slipPreview)}</h2>
              <button class="button-primary" type="button" data-action="browser-print">${escapeHtml(t().appointments.printNow)}</button>
            </div>
            ${renderPrintSlipPreview()}
          </article>

          <article class="surface">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(t().registrations.detailsTitle)}</h2>
              <span class="chip subtle">${escapeHtml(state.selectedPrintAppointment?.accession_number || t().common.noData)}</span>
            </div>
            ${
              state.selectedPrintAppointment
                ? `<form id="appointment-edit-form" class="stack">
                    <div class="form-grid">
                      <label class="field">
                        <span class="label">${escapeHtml(appointmentFieldLabel("modality"))}</span>
                        <select class="select" name="modalityId">
                          ${state.appointmentLookups.modalities
                            .map(
                              (entry) => `
                                <option value="${escapeHtml(String(entry.id))}" ${String(entry.id) === String(state.appointmentEditForm.modalityId) ? "selected" : ""}>
                                  ${escapeHtml(formatModalityName(entry))}
                                </option>
                              `
                            )
                            .join("")}
                        </select>
                      </label>
                      <label class="field">
                        <span class="label">${escapeHtml(appointmentFieldLabel("examType"))}</span>
                        <select class="select" name="examTypeId">
                          <option value="">${escapeHtml(t().common.optional)}</option>
                          ${state.appointmentLookups.examTypes
                            .filter((entry) => String(entry.modality_id) === String(state.appointmentEditForm.modalityId))
                            .map(
                              (entry) => `
                                <option value="${escapeHtml(String(entry.id))}" ${String(entry.id) === String(state.appointmentEditForm.examTypeId) ? "selected" : ""}>
                                  ${escapeHtml(formatExamName(entry))}
                                </option>
                              `
                            )
                            .join("")}
                        </select>
                      </label>
                      <label class="field">
                        <span class="label">${escapeHtml(appointmentFieldLabel("priority"))}</span>
                        <select class="select" name="reportingPriorityId">
                          <option value="">${escapeHtml(t().common.optional)}</option>
                          ${state.appointmentLookups.priorities
                            .map(
                              (entry) => `
                                <option value="${escapeHtml(String(entry.id))}" ${String(entry.id) === String(state.appointmentEditForm.reportingPriorityId) ? "selected" : ""}>
                                  ${escapeHtml(formatPriorityName(entry))}
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
                        <span class="label">${escapeHtml(appointmentFieldLabel("notes"))}</span>
                        <textarea class="textarea field-en" name="notes">${escapeHtml(state.appointmentEditForm.notes)}</textarea>
                      </label>
                      <label class="field full">
                        <span class="label">${escapeHtml(t().appointments.fields.overbookingReason)}</span>
                        <textarea class="textarea ${state.language === "ar" ? "field-ar" : ""}" name="overbookingReason">${escapeHtml(state.appointmentEditForm.overbookingReason)}</textarea>
                      </label>
                    </div>
                    <div class="form-actions">
                      <button class="button-primary" type="submit">${escapeHtml(state.appointmentEditSaving ? t().common.loading : t().print.saveAppointment)}</button>
                      <button class="button-secondary" type="button" data-action="browser-print">${escapeHtml(t().appointments.printNow)}</button>
                    </div>
                  </form>
                  <form id="appointment-cancel-form" class="stack">
                    <label class="field">
                      <span class="label">${escapeHtml(t().print.cancelReason)}</span>
                      <textarea class="textarea ${state.language === "ar" ? "field-ar" : ""}" name="cancelReason">${escapeHtml(state.cancelReason)}</textarea>
                    </label>
                    <div class="form-actions">
                      <button class="button-secondary" type="submit">${escapeHtml(state.appointmentCancelSaving ? t().common.loading : t().registrations.delete)}</button>
                    </div>
                  </form>`
                : `<div class="empty">${escapeHtml(t().registrations.noSelection)}</div>`
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
                      <label class="field full">
                        <span class="label">${escapeHtml(t().patients.fields.arabicFullName)}</span>
                        <input class="input field-ar" name="arabicFullName" value="${escapeHtml(state.patientEditForm.arabicFullName)}" />
                      </label>
                      <label class="field">
                        <span class="label">${escapeHtml(t().patients.fields.ageYears)}</span>
                        <input class="input field-en" name="ageYears" value="${escapeHtml(state.patientEditForm.ageYears)}" inputmode="numeric" />
                      </label>
                      <label class="field">
                        <span class="label">${escapeHtml(t().patients.fields.dateOfBirth)}</span>
                        <input
                          class="input field-en"
                          type="date"
                          name="estimatedDateOfBirth"
                          value="${escapeHtml(state.patientEditForm.estimatedDateOfBirth)}"
                        />
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
                      ${renderAddressField(state.patientEditForm.address, "edit")}
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
              <div class="badge-row">
                <span class="chip ${user.is_active ? "success" : "subtle"}">${escapeHtml(
                  user.is_active ? t().common.active : t().common.inactive
                )}</span>
                <button
                  class="button-ghost"
                  type="button"
                  data-action="delete-user"
                  data-user-id="${escapeHtml(String(user.id))}"
                  ${(state.userDeletingId === user.id || (state.session?.id && Number(state.session.id) === Number(user.id)))
                    ? "disabled"
                    : ""}
                >
                  ${escapeHtml(state.userDeletingId === user.id ? t().common.loading : t().settings.deleteUser)}
                </button>
              </div>
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

  const categories = Object.keys(state.settingsCatalog).filter(
    (category) => !["pacs_connection", "dicom_gateway", "modalities_and_exams"].includes(category)
  );

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

function renderPatientRegistrationRules() {
  if (!state.settingsCatalog.patient_registration?.length) {
    return `<div class="empty">${escapeHtml(t().common.noData)}</div>`;
  }

  const phoneRule = getSettingsEntryValue("patient_registration", "phone1_required");
  const dobRule = getSettingsEntryValue("patient_registration", "dob_or_age_rule");
  const nationalIdRule = getSettingsEntryValue("patient_registration", "national_id_required");
  const phoneLabel = state.language === "ar" ? "الهاتف 1" : "Phone 1";
  const dobLabel = state.language === "ar" ? "العمر / تاريخ الميلاد" : "Age / DOB";
  const nationalLabel = state.language === "ar" ? "الرقم الوطني" : "National ID";

  return `
    <form class="stack" data-settings-form="patient_registration">
      <div class="form-grid">
        <label class="field">
          <span class="label">${escapeHtml(phoneLabel)}</span>
          <select class="select" data-setting-field="true" data-setting-category="patient_registration" data-setting-key="phone1_required">
            <option value="required" ${phoneRule === "required" ? "selected" : ""}>${escapeHtml(
              state.language === "ar" ? "إلزامي" : "Required"
            )}</option>
            <option value="optional" ${phoneRule === "optional" ? "selected" : ""}>${escapeHtml(
              state.language === "ar" ? "اختياري" : "Optional"
            )}</option>
          </select>
        </label>

        <label class="field">
          <span class="label">${escapeHtml(dobLabel)}</span>
          <select class="select" data-setting-field="true" data-setting-category="patient_registration" data-setting-key="dob_or_age_rule">
            <option value="age_or_dob_required" ${dobRule === "age_or_dob_required" ? "selected" : ""}>${escapeHtml(
              state.language === "ar" ? "العمر أو تاريخ الميلاد" : "Age or DOB required"
            )}</option>
            <option value="age_required" ${dobRule === "age_required" ? "selected" : ""}>${escapeHtml(
              state.language === "ar" ? "العمر فقط" : "Age required"
            )}</option>
            <option value="dob_required" ${dobRule === "dob_required" ? "selected" : ""}>${escapeHtml(
              state.language === "ar" ? "تاريخ الميلاد فقط" : "DOB required"
            )}</option>
          </select>
        </label>

        <label class="field">
          <span class="label">${escapeHtml(nationalLabel)}</span>
          <select class="select" data-setting-field="true" data-setting-category="patient_registration" data-setting-key="national_id_required">
            <option value="required_with_confirmation" ${nationalIdRule === "required_with_confirmation" ? "selected" : ""}>${escapeHtml(
              state.language === "ar" ? "إلزامي مع تأكيد" : "Required with confirmation"
            )}</option>
            <option value="required" ${nationalIdRule === "required" ? "selected" : ""}>${escapeHtml(
              state.language === "ar" ? "إلزامي" : "Required"
            )}</option>
            <option value="optional" ${nationalIdRule === "optional" ? "selected" : ""}>${escapeHtml(
              state.language === "ar" ? "اختياري" : "Optional"
            )}</option>
          </select>
        </label>
      </div>
      <div class="form-actions">
        <button class="button-primary" type="submit">${escapeHtml(
          state.settingsSavingCategory === "patient_registration" ? t().common.loading : t().settings.patientRulesSave
        )}</button>
      </div>
    </form>
  `;
}

function renderNameDictionaryAddForm() {
  return `
    <form id="name-dictionary-form" class="stack">
      <div class="form-grid">
        <label class="field">
          <span class="label">${escapeHtml(t().settings.dictionaryArabic)}</span>
          <input class="input field-ar" name="arabicText" data-name-dictionary-new-field="true" value="${escapeHtml(state.nameDictionaryForm.arabicText)}" />
        </label>
        <label class="field">
          <span class="label">${escapeHtml(t().settings.dictionaryEnglish)}</span>
          <input class="input field-en" name="englishText" data-name-dictionary-new-field="true" value="${escapeHtml(state.nameDictionaryForm.englishText)}" />
        </label>
        <label class="field">
          <span class="label">${escapeHtml(t().settings.dictionaryActive)}</span>
          <input type="checkbox" name="isActive" data-name-dictionary-new-field="true" ${state.nameDictionaryForm.isActive ? "checked" : ""} />
        </label>
      </div>
      <div class="form-actions">
        <button class="button-primary" type="submit">${escapeHtml(
          state.nameDictionarySavingId === "new" ? t().common.loading : t().settings.dictionaryAdd
        )}</button>
      </div>
    </form>
  `;
}

function renderNameDictionaryImportForm() {
  const fileName = state.nameDictionaryImportFile ? state.nameDictionaryImportFile.name : t().print.fileNone;

  return `
    <form id="name-dictionary-import-form" class="stack">
      <div class="section-head">
        <h3 class="section-title">${escapeHtml(t().settings.dictionaryImportTitle)}</h3>
        <span class="chip subtle">${escapeHtml(t().settings.dictionaryImportBody)}</span>
      </div>
      <label class="field">
        <span class="label">${escapeHtml(t().settings.dictionaryImportFile)}</span>
        <input class="input" type="file" accept=".csv,text/csv" />
      </label>
      <div class="small">${escapeHtml(t().settings.dictionaryImportHint)}</div>
      <div class="small">${escapeHtml(fileName)}</div>
      <div class="form-actions">
        <button class="button-primary" type="submit">${escapeHtml(
          state.nameDictionaryImportLoading ? t().common.loading : t().settings.dictionaryImportSubmit
        )}</button>
        <button class="button-ghost" type="button" data-action="download-dictionary-example">${escapeHtml(
          t().settings.dictionaryImportExample
        )}</button>
      </div>
    </form>
  `;
}

function renderNameDictionaryList() {
  if (state.nameDictionaryLoading) {
    return `<div class="empty">${escapeHtml(t().common.loading)}</div>`;
  }

  if (!state.nameDictionaryEntries.length) {
    return `<div class="empty">${escapeHtml(t().common.noData)}</div>`;
  }

  return `
    <div class="list">
      ${state.nameDictionaryEntries
        .map(
          (entry) => `
            <div class="item dictionary-item">
              <div class="item-copy">
                <div class="item-title">${escapeHtml(entry.arabic_text)}</div>
                <input
                  class="input field-en"
                  name="english_text"
                  data-name-dictionary-field="true"
                  data-dictionary-id="${escapeHtml(String(entry.id))}"
                  value="${escapeHtml(entry.english_text)}"
                />
              </div>
              <div class="dictionary-actions">
                <label class="field-inline">
                  <span class="label">${escapeHtml(t().settings.dictionaryActive)}</span>
                  <input
                    type="checkbox"
                    name="is_active"
                    data-name-dictionary-field="true"
                    data-dictionary-id="${escapeHtml(String(entry.id))}"
                    ${entry.is_active ? "checked" : ""}
                  />
                </label>
                <button class="button-secondary" type="button" data-action="save-dictionary-entry" data-dictionary-id="${escapeHtml(String(entry.id))}">
                  ${escapeHtml(state.nameDictionarySavingId === String(entry.id) ? t().common.loading : t().settings.dictionarySave)}
                </button>
                <button class="button-ghost" type="button" data-action="delete-dictionary-entry" data-dictionary-id="${escapeHtml(String(entry.id))}">
                  ${escapeHtml(state.nameDictionarySavingId === `delete-${entry.id}` ? t().common.loading : t().settings.dictionaryDelete)}
                </button>
              </div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderExamTypeSettings() {
  if (state.examTypeSettingsLoading) {
    return `<div class="empty">${escapeHtml(t().common.loading)}</div>`;
  }

  const modalityOptions = state.examTypeSettingsModalities
    .map(
      (modality) => `
        <option
          value="${escapeHtml(String(modality.id))}"
          ${String(modality.id) === String(state.examTypeSettingsForm.modalityId) ? "selected" : ""}
        >
          ${escapeHtml(formatModalityName(modality))}
        </option>
      `
    )
    .join("");

  return `
    ${alertMarkup("error", state.examTypeSettingsError)}
    ${alertMarkup("success", state.examTypeSettingsSuccess)}
    <form id="exam-type-settings-form" class="stack">
      <div class="form-grid">
        <label class="field">
          <span class="label">${escapeHtml(t().settings.examTypesModality)}</span>
          <select class="select" name="modalityId" data-exam-type-settings-new-field="true">
            ${modalityOptions}
          </select>
        </label>

        <label class="field">
          <span class="label">${escapeHtml(t().appointments.fields.examNameAr)}</span>
          <input
            class="input field-ar"
            name="nameAr"
            data-exam-type-settings-new-field="true"
            value="${escapeHtml(state.examTypeSettingsForm.nameAr)}"
          />
        </label>

        <label class="field">
          <span class="label">${escapeHtml(t().appointments.fields.examNameEn)}</span>
          <input
            class="input field-en"
            name="nameEn"
            data-exam-type-settings-new-field="true"
            value="${escapeHtml(state.examTypeSettingsForm.nameEn)}"
          />
        </label>

        <label class="field full">
          <span class="label">${escapeHtml(t().appointments.fields.specificInstructionAr)}</span>
          <textarea
            class="textarea field-ar"
            name="specificInstructionAr"
            data-exam-type-settings-new-field="true"
          >${escapeHtml(state.examTypeSettingsForm.specificInstructionAr)}</textarea>
        </label>

        <label class="field full">
          <span class="label">${escapeHtml(t().appointments.fields.specificInstructionEn)}</span>
          <textarea
            class="textarea field-en"
            name="specificInstructionEn"
            data-exam-type-settings-new-field="true"
          >${escapeHtml(state.examTypeSettingsForm.specificInstructionEn)}</textarea>
        </label>
      </div>

      <div class="form-actions">
        <button class="button-primary" type="submit">${escapeHtml(
          state.examTypeSettingsSavingId === "new" ? t().common.loading : t().settings.examTypesAdd
        )}</button>
      </div>
    </form>

    ${
      state.examTypeSettingsEntries.length
        ? `
          <div class="list">
            ${state.examTypeSettingsEntries
              .map(
                (entry) => `
                  <div class="item dictionary-item">
                    <div class="item-copy" style="width:100%;">
                      <div class="form-grid">
                        <label class="field">
                          <span class="label">${escapeHtml(t().settings.examTypesModality)}</span>
                          <select
                            class="select"
                            name="modality_id"
                            data-exam-type-settings-field="true"
                            data-exam-type-id="${escapeHtml(String(entry.id))}"
                          >
                            ${state.examTypeSettingsModalities
                              .map(
                                (modality) => `
                                  <option value="${escapeHtml(String(modality.id))}" ${
                                    String(modality.id) === String(entry.modality_id) ? "selected" : ""
                                  }>
                                    ${escapeHtml(formatModalityName(modality))}
                                  </option>
                                `
                              )
                              .join("")}
                          </select>
                        </label>

                        <label class="field">
                          <span class="label">${escapeHtml(t().appointments.fields.examNameAr)}</span>
                          <input
                            class="input field-ar"
                            name="name_ar"
                            data-exam-type-settings-field="true"
                            data-exam-type-id="${escapeHtml(String(entry.id))}"
                            value="${escapeHtml(entry.name_ar)}"
                          />
                        </label>

                        <label class="field">
                          <span class="label">${escapeHtml(t().appointments.fields.examNameEn)}</span>
                          <input
                            class="input field-en"
                            name="name_en"
                            data-exam-type-settings-field="true"
                            data-exam-type-id="${escapeHtml(String(entry.id))}"
                            value="${escapeHtml(entry.name_en)}"
                          />
                        </label>

                        <label class="field full">
                          <span class="label">${escapeHtml(t().appointments.fields.specificInstructionAr)}</span>
                          <textarea
                            class="textarea field-ar"
                            name="specific_instruction_ar"
                            data-exam-type-settings-field="true"
                            data-exam-type-id="${escapeHtml(String(entry.id))}"
                          >${escapeHtml(entry.specific_instruction_ar || "")}</textarea>
                        </label>

                        <label class="field full">
                          <span class="label">${escapeHtml(t().appointments.fields.specificInstructionEn)}</span>
                          <textarea
                            class="textarea field-en"
                            name="specific_instruction_en"
                            data-exam-type-settings-field="true"
                            data-exam-type-id="${escapeHtml(String(entry.id))}"
                          >${escapeHtml(entry.specific_instruction_en || "")}</textarea>
                        </label>
                      </div>
                    </div>
                    <div class="dictionary-actions">
                      <button
                        class="button-secondary"
                        type="button"
                        data-action="save-exam-type-entry"
                        data-exam-type-id="${escapeHtml(String(entry.id))}"
                      >
                        ${escapeHtml(
                          state.examTypeSettingsSavingId === String(entry.id) ? t().common.loading : t().settings.examTypesSave
                        )}
                      </button>
                      <button
                        class="button-ghost"
                        type="button"
                        data-action="delete-exam-type-entry"
                        data-exam-type-id="${escapeHtml(String(entry.id))}"
                      >
                        ${escapeHtml(
                          state.examTypeSettingsSavingId === `delete-${entry.id}`
                            ? t().common.loading
                            : t().settings.examTypesDelete
                        )}
                      </button>
                    </div>
                  </div>
                `
              )
              .join("")}
          </div>
        `
        : `<div class="empty">${escapeHtml(t().settings.examTypesEmpty)}</div>`
    }
  `;
}

function renderModalitySettings() {
  if (state.modalitySettingsLoading) {
    return `<div class="empty">${escapeHtml(t().common.loading)}</div>`;
  }

  return `
    ${alertMarkup("error", state.modalitySettingsError)}
    ${alertMarkup("success", state.modalitySettingsSuccess)}
    <form id="modality-settings-form" class="stack">
      <div class="form-grid">
        <label class="field">
          <span class="label">${escapeHtml(t().settings.modalitiesCode)}</span>
          <input
            class="input field-en"
            name="code"
            data-modality-settings-new-field="true"
            value="${escapeHtml(state.modalitySettingsForm.code)}"
          />
        </label>

        <label class="field">
          <span class="label">${escapeHtml(t().settings.modalitiesNameAr)}</span>
          <input
            class="input field-ar"
            name="nameAr"
            data-modality-settings-new-field="true"
            value="${escapeHtml(state.modalitySettingsForm.nameAr)}"
          />
        </label>

        <label class="field">
          <span class="label">${escapeHtml(t().settings.modalitiesNameEn)}</span>
          <input
            class="input field-en"
            name="nameEn"
            data-modality-settings-new-field="true"
            value="${escapeHtml(state.modalitySettingsForm.nameEn)}"
          />
        </label>

        <label class="field">
          <span class="label">${escapeHtml(t().settings.modalitiesDailyCapacity)}</span>
          <input
            class="input field-en"
            inputmode="numeric"
            min="0"
            step="1"
            name="dailyCapacity"
            data-modality-settings-new-field="true"
            value="${escapeHtml(state.modalitySettingsForm.dailyCapacity)}"
            placeholder="12"
          />
        </label>

        <label class="field full">
          <span class="label">${escapeHtml(t().settings.modalitiesInstructionAr)}</span>
          <textarea
            class="textarea field-ar"
            name="generalInstructionAr"
            data-modality-settings-new-field="true"
          >${escapeHtml(state.modalitySettingsForm.generalInstructionAr)}</textarea>
        </label>

        <label class="field full">
          <span class="label">${escapeHtml(t().settings.modalitiesInstructionEn)}</span>
          <textarea
            class="textarea field-en"
            name="generalInstructionEn"
            data-modality-settings-new-field="true"
          >${escapeHtml(state.modalitySettingsForm.generalInstructionEn)}</textarea>
        </label>

        <label class="field">
          <span class="label">${escapeHtml(t().settings.modalitiesStatus)}</span>
          <select class="select" name="isActive" data-modality-settings-new-field="true">
            <option value="enabled" ${state.modalitySettingsForm.isActive === "enabled" ? "selected" : ""}>${escapeHtml(
              t().common.active
            )}</option>
            <option value="disabled" ${state.modalitySettingsForm.isActive === "disabled" ? "selected" : ""}>${escapeHtml(
              t().common.inactive
            )}</option>
          </select>
        </label>
      </div>

      <div class="form-actions">
        <button class="button-primary" type="submit">${escapeHtml(
          state.modalitySettingsSavingId === "new" ? t().common.loading : t().settings.modalitiesAdd
        )}</button>
      </div>
    </form>

    ${
      state.modalitySettingsEntries.length
        ? `
          <div class="list">
            ${state.modalitySettingsEntries
              .map(
                (entry) => `
                  <div class="item dictionary-item">
                    <div class="item-copy" style="width:100%;">
                      <div class="form-grid">
                        <label class="field">
                          <span class="label">${escapeHtml(t().settings.modalitiesCode)}</span>
                          <input
                            class="input field-en"
                            name="code"
                            data-modality-settings-field="true"
                            data-modality-id="${escapeHtml(String(entry.id))}"
                            value="${escapeHtml(entry.code)}"
                          />
                        </label>

                        <label class="field">
                          <span class="label">${escapeHtml(t().settings.modalitiesNameAr)}</span>
                          <input
                            class="input field-ar"
                            name="name_ar"
                            data-modality-settings-field="true"
                            data-modality-id="${escapeHtml(String(entry.id))}"
                            value="${escapeHtml(entry.name_ar)}"
                          />
                        </label>

                        <label class="field">
                          <span class="label">${escapeHtml(t().settings.modalitiesNameEn)}</span>
                          <input
                            class="input field-en"
                            name="name_en"
                            data-modality-settings-field="true"
                            data-modality-id="${escapeHtml(String(entry.id))}"
                            value="${escapeHtml(entry.name_en)}"
                          />
                        </label>

                        <label class="field">
                          <span class="label">${escapeHtml(t().settings.modalitiesDailyCapacity)}</span>
                          <input
                            class="input field-en"
                            inputmode="numeric"
                            min="0"
                            step="1"
                            name="daily_capacity"
                            data-modality-settings-field="true"
                            data-modality-id="${escapeHtml(String(entry.id))}"
                            value="${escapeHtml(String(entry.daily_capacity ?? ""))}"
                          />
                        </label>

                        <label class="field full">
                          <span class="label">${escapeHtml(t().settings.modalitiesInstructionAr)}</span>
                          <textarea
                            class="textarea field-ar"
                            name="general_instruction_ar"
                            data-modality-settings-field="true"
                            data-modality-id="${escapeHtml(String(entry.id))}"
                          >${escapeHtml(entry.general_instruction_ar || "")}</textarea>
                        </label>

                        <label class="field full">
                          <span class="label">${escapeHtml(t().settings.modalitiesInstructionEn)}</span>
                          <textarea
                            class="textarea field-en"
                            name="general_instruction_en"
                            data-modality-settings-field="true"
                            data-modality-id="${escapeHtml(String(entry.id))}"
                          >${escapeHtml(entry.general_instruction_en || "")}</textarea>
                        </label>

                        <label class="field">
                          <span class="label">${escapeHtml(t().settings.modalitiesStatus)}</span>
                          <select
                            class="select"
                            name="is_active"
                            data-modality-settings-field="true"
                            data-modality-id="${escapeHtml(String(entry.id))}"
                          >
                            <option value="enabled" ${entry.is_active ? "selected" : ""}>${escapeHtml(t().common.active)}</option>
                            <option value="disabled" ${!entry.is_active ? "selected" : ""}>${escapeHtml(t().common.inactive)}</option>
                          </select>
                        </label>
                      </div>
                    </div>
                    <div class="dictionary-actions">
                      <button
                        class="button-secondary"
                        type="button"
                        data-action="save-modality-entry"
                        data-modality-id="${escapeHtml(String(entry.id))}"
                      >
                        ${escapeHtml(
                          state.modalitySettingsSavingId === String(entry.id) ? t().common.loading : t().settings.modalitiesSave
                        )}
                      </button>
                      <button
                        class="button-ghost"
                        type="button"
                        data-action="delete-modality-entry"
                        data-modality-id="${escapeHtml(String(entry.id))}"
                      >
                        ${escapeHtml(
                          state.modalitySettingsSavingId === `delete-${entry.id}`
                            ? t().common.loading
                            : t().settings.modalitiesDelete
                        )}
                      </button>
                    </div>
                  </div>
                `
              )
              .join("")}
          </div>
        `
        : `<div class="empty">${escapeHtml(t().settings.modalitiesEmpty)}</div>`
    }
  `;
}

function renderSettingsMenu() {
  const sections = [
    {
      id: "users",
      title: t().settings.sectionUsers,
      body: t().settings.body,
      count: `${t().common.usersShown}: ${state.users.length}`
    },
    {
      id: "patient-rules",
      title: t().settings.sectionPatientRules,
      body: t().settings.patientRulesBody,
      count: t().common.required
    },
    {
      id: "dictionary",
      title: t().settings.sectionDictionary,
      body: t().settings.dictionaryBody,
      count: String(state.nameDictionaryEntries.length)
    },
    {
      id: "exam-types",
      title: t().settings.sectionExamTypes,
      body: t().settings.examTypesBody,
      count: String(state.examTypeSettingsEntries.length)
    },
    {
      id: "modalities",
      title: t().settings.sectionModalities,
      body: t().settings.modalitiesBody,
      count: String(state.modalitySettingsEntries.length)
    },
    {
      id: "capacity",
      title: t().settings.sectionCapacity,
      body: t().settings.capacityBody,
      count: getSettingsEntryValue("scheduling_and_capacity", "max_cases_per_modality", "—") || "—"
    },
    {
      id: "pacs",
      title: t().settings.sectionPacs,
      body: t().pacs.testHint,
      count: state.pacsSettingsForm.enabled === "enabled" ? t().common.active : t().common.inactive
    },
    {
      id: "dicom",
      title: t().settings.sectionDicom,
      body: t().settings.dicomBody,
      count: String(state.dicomDevices.length)
    },
    {
      id: "modules",
      title: t().settings.sectionModules,
      body: t().settings.modulesBody,
      count: String(allowedRoutes.length)
    },
    {
      id: "categories",
      title: t().settings.sectionCategories,
      body: t().settings.body,
      count: `${Object.keys(state.settingsCatalog).length}`
    },
    {
      id: "audit",
      title: t().settings.sectionAudit,
      body: t().settings.auditFilters,
      count: `${t().settings.auditRows}: ${state.auditEntries.length}`
    },
    {
      id: "backup",
      title: t().settings.sectionBackup,
      body: t().settings.backupTitle,
      count: t().common.required
    }
  ];

  return `
    <section class="surface">
      <div class="section-head">
        <h2 class="section-title">${escapeHtml(t().settings.menuTitle)}</h2>
        <span class="chip accent">${escapeHtml(String(sections.length))}</span>
      </div>
      <div class="settings-summary">${escapeHtml(t().settings.menuBody)}</div>
      <div class="action-grid">
        ${sections
          .map(
            (section, index) => `
              <button class="action-card" type="button" data-action="set-settings-section" data-section="${escapeHtml(section.id)}">
                <span class="action-index">${escapeHtml(`${String(index + 1).padStart(2, "0")}`)}</span>
                <span class="item-title">${escapeHtml(section.title)}</span>
                <span class="item-subtitle">${escapeHtml(section.body)}</span>
                <span class="chip subtle">${escapeHtml(section.count)}</span>
                <span class="small">${escapeHtml(t().settings.sectionOpen)}</span>
              </button>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderSettingsUsersSection() {
  return `
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
  `;
}

function renderSettingsCapacitySection() {
  const currentLimit = getSettingsEntryValue("scheduling_and_capacity", "max_cases_per_modality", "");
  const fridaySetting = getSettingsEntryValue("scheduling_and_capacity", "allow_friday_appointments", "enabled");
  const saturdaySetting = getSettingsEntryValue("scheduling_and_capacity", "allow_saturday_appointments", "enabled");

  return `
    <section class="surface">
      <div class="section-head">
        <h2 class="section-title">${escapeHtml(t().settings.capacityTitle)}</h2>
        <span class="chip accent">${escapeHtml(t().common.required)}</span>
      </div>
      <div class="settings-summary">${escapeHtml(t().settings.capacityBody)}</div>
      <form class="stack" data-settings-form="scheduling_and_capacity">
        <div class="form-grid">
          <label class="field">
            <span class="label">${escapeHtml(t().settings.maxCasesPerModalityLabel)}</span>
            <input
              class="input field-en"
              inputmode="numeric"
              min="1"
              step="1"
              data-setting-field="true"
              data-setting-category="scheduling_and_capacity"
              data-setting-key="max_cases_per_modality"
              value="${escapeHtml(currentLimit)}"
              placeholder="12"
              autocomplete="off"
            />
            <span class="small">${escapeHtml(t().settings.maxCasesPerModalityHint)}</span>
          </label>

          <label class="field">
            <span class="label">${escapeHtml(getSettingsFieldLabel("scheduling_and_capacity", "allow_friday_appointments"))}</span>
            <select
              class="select"
              data-setting-field="true"
              data-setting-category="scheduling_and_capacity"
              data-setting-key="allow_friday_appointments"
            >
              <option value="enabled" ${fridaySetting === "enabled" ? "selected" : ""}>${escapeHtml(t().common.active)}</option>
              <option value="disabled" ${fridaySetting === "disabled" ? "selected" : ""}>${escapeHtml(t().common.inactive)}</option>
            </select>
          </label>

          <label class="field">
            <span class="label">${escapeHtml(getSettingsFieldLabel("scheduling_and_capacity", "allow_saturday_appointments"))}</span>
            <select
              class="select"
              data-setting-field="true"
              data-setting-category="scheduling_and_capacity"
              data-setting-key="allow_saturday_appointments"
            >
              <option value="enabled" ${saturdaySetting === "enabled" ? "selected" : ""}>${escapeHtml(t().common.active)}</option>
              <option value="disabled" ${saturdaySetting === "disabled" ? "selected" : ""}>${escapeHtml(t().common.inactive)}</option>
            </select>
          </label>
        </div>
        <div class="form-actions">
          <button class="button-primary" type="submit">${escapeHtml(
            state.settingsSavingCategory === "scheduling_and_capacity" ? t().common.loading : t().settings.capacitySave
          )}</button>
        </div>
      </form>
    </section>
  `;
}

function renderSettingsPacsSection() {
  const pacs = state.pacsSettingsForm;

  return `
    <section class="surface">
      <div class="section-head">
        <h2 class="section-title">${escapeHtml(t().settings.sectionPacs)}</h2>
        <span class="chip accent">${escapeHtml(t().common.required)}</span>
      </div>
      <div class="settings-summary">${escapeHtml(t().pacs.testHint)}</div>
      ${alertMarkup("error", state.pacsTestError)}
      ${alertMarkup("success", state.pacsTestSuccess)}
      <form id="pacs-settings-form" class="stack">
        <div class="form-grid">
          <label class="field">
            <span class="label">${escapeHtml(getSettingsFieldLabel("pacs_connection", "enabled"))}</span>
            <select
              class="select"
              name="enabled"
              data-pacs-setting-field="true"
            >
              <option value="enabled" ${pacs.enabled === "enabled" ? "selected" : ""}>${escapeHtml(t().common.active)}</option>
              <option value="disabled" ${pacs.enabled === "disabled" ? "selected" : ""}>${escapeHtml(t().common.inactive)}</option>
            </select>
          </label>

          <label class="field">
            <span class="label">${escapeHtml(getSettingsFieldLabel("pacs_connection", "host"))}</span>
            <input
              class="input field-en"
              name="host"
              data-pacs-setting-field="true"
              value="${escapeHtml(pacs.host)}"
              autocomplete="off"
            />
          </label>

          <label class="field">
            <span class="label">${escapeHtml(getSettingsFieldLabel("pacs_connection", "port"))}</span>
            <input
              class="input field-en"
              inputmode="numeric"
              name="port"
              data-pacs-setting-field="true"
              value="${escapeHtml(pacs.port)}"
              autocomplete="off"
            />
          </label>

          <label class="field">
            <span class="label">${escapeHtml(getSettingsFieldLabel("pacs_connection", "called_ae_title"))}</span>
            <input
              class="input field-en"
              name="calledAeTitle"
              data-pacs-setting-field="true"
              value="${escapeHtml(pacs.calledAeTitle)}"
              autocomplete="off"
            />
          </label>

          <label class="field">
            <span class="label">${escapeHtml(getSettingsFieldLabel("pacs_connection", "calling_ae_title"))}</span>
            <input
              class="input field-en"
              name="callingAeTitle"
              data-pacs-setting-field="true"
              value="${escapeHtml(pacs.callingAeTitle)}"
              autocomplete="off"
            />
          </label>

          <label class="field">
            <span class="label">${escapeHtml(getSettingsFieldLabel("pacs_connection", "timeout_seconds"))}</span>
            <input
              class="input field-en"
              inputmode="numeric"
              name="timeoutSeconds"
              data-pacs-setting-field="true"
              value="${escapeHtml(pacs.timeoutSeconds)}"
              autocomplete="off"
            />
          </label>
        </div>

        <div class="form-actions">
          <button class="button-secondary" type="button" data-action="pacs-test-connection">
            ${escapeHtml(state.pacsTestLoading ? t().common.loading : t().pacs.testButton)}
          </button>
          <button class="button-primary" type="submit">
            ${escapeHtml(state.settingsSavingCategory === "pacs_connection" ? t().common.loading : t().settings.saveCategory)}
          </button>
        </div>
      </form>
    </section>
  `;
}

function renderSettingsDicomSection() {
  const gatewayEntries = state.settingsCatalog.dicom_gateway || [];
  const modalities = state.appointmentLookups.modalities || [];
  const form = state.dicomDeviceForm;

  return `
    <section class="stack">
      <article class="surface">
        <div class="section-head">
          <h2 class="section-title">${escapeHtml(t().settings.dicomTitle)}</h2>
          <span class="chip accent">${escapeHtml(String(gatewayEntries.length || 0))}</span>
        </div>
        <div class="settings-summary">${escapeHtml(t().settings.dicomGatewayHint)}</div>
        <form class="stack" data-settings-form="dicom_gateway">
          <div class="settings-rows">
            ${gatewayEntries
              .map(
                (entry) => `
                  <label class="field">
                    <span class="label">${escapeHtml(getSettingsFieldLabel("dicom_gateway", entry.setting_key))}</span>
                    <input
                      class="input field-en"
                      data-setting-field="true"
                      data-setting-category="dicom_gateway"
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
              ${escapeHtml(state.settingsSavingCategory === "dicom_gateway" ? t().common.loading : t().settings.dicomGatewaySave)}
            </button>
          </div>
        </form>
      </article>

      <article class="surface">
        <div class="section-head">
          <h2 class="section-title">${escapeHtml(t().settings.dicomDevicesTitle)}</h2>
          <span class="chip subtle">${escapeHtml(String(state.dicomDevices.length))}</span>
        </div>
        ${alertMarkup("error", state.dicomDevicesError)}
        ${alertMarkup("success", state.dicomDevicesSuccess)}
        <div class="split-grid">
          <div class="surface surface-compact">
            ${renderDicomDevicesList()}
          </div>
          <div class="surface surface-compact">
            <form id="dicom-device-form" class="stack">
              <div class="section-head">
                <h3 class="section-title">${escapeHtml(form.deviceId ? t().settings.dicomDeviceEdit : t().settings.dicomDeviceAdd)}</h3>
                <span class="chip accent">${escapeHtml(form.deviceId ? `#${form.deviceId}` : t().common.required)}</span>
              </div>
              <div class="form-grid">
                <label class="field">
                  <span class="label">${escapeHtml(t().appointments.fields.modality)}</span>
                  <select class="select" name="modalityId" data-dicom-device-field="true">
                    ${modalities
                      .map(
                        (entry) => `
                          <option value="${escapeHtml(String(entry.id))}" ${String(entry.id) === String(form.modalityId) ? "selected" : ""}>
                            ${escapeHtml(formatModalityName(entry))}
                          </option>
                        `
                      )
                      .join("")}
                  </select>
                </label>
                <label class="field">
                  <span class="label">${escapeHtml(state.language === "ar" ? "اسم الجهاز" : "Device name")}</span>
                  <input class="input ${state.language === "ar" ? "field-ar" : ""}" name="deviceName" data-dicom-device-field="true" value="${escapeHtml(form.deviceName)}" />
                </label>
                <label class="field">
                  <span class="label">${escapeHtml(state.language === "ar" ? "Modality AE Title" : "Modality AE Title")}</span>
                  <input class="input field-en" name="modalityAeTitle" data-dicom-device-field="true" value="${escapeHtml(form.modalityAeTitle)}" />
                </label>
                <label class="field">
                  <span class="label">${escapeHtml(state.language === "ar" ? "Scheduled Station AE Title" : "Scheduled Station AE Title")}</span>
                  <input class="input field-en" name="scheduledStationAeTitle" data-dicom-device-field="true" value="${escapeHtml(form.scheduledStationAeTitle)}" />
                </label>
                <label class="field">
                  <span class="label">${escapeHtml(state.language === "ar" ? "Station name" : "Station name")}</span>
                  <input class="input ${state.language === "ar" ? "field-ar" : ""}" name="stationName" data-dicom-device-field="true" value="${escapeHtml(form.stationName)}" />
                </label>
                <label class="field">
                  <span class="label">${escapeHtml(state.language === "ar" ? "Station location" : "Station location")}</span>
                  <input class="input ${state.language === "ar" ? "field-ar" : ""}" name="stationLocation" data-dicom-device-field="true" value="${escapeHtml(form.stationLocation)}" />
                </label>
                <label class="field">
                  <span class="label">${escapeHtml(state.language === "ar" ? "Source IP" : "Source IP")}</span>
                  <input class="input field-en" name="sourceIp" data-dicom-device-field="true" value="${escapeHtml(form.sourceIp)}" />
                </label>
                <label class="field">
                  <span class="label">${escapeHtml("MWL")}</span>
                  <select class="select" name="mwlEnabled" data-dicom-device-field="true">
                    <option value="enabled" ${form.mwlEnabled === "enabled" ? "selected" : ""}>${escapeHtml(t().common.active)}</option>
                    <option value="disabled" ${form.mwlEnabled === "disabled" ? "selected" : ""}>${escapeHtml(t().common.inactive)}</option>
                  </select>
                </label>
                <label class="field">
                  <span class="label">${escapeHtml("MPPS")}</span>
                  <select class="select" name="mppsEnabled" data-dicom-device-field="true">
                    <option value="enabled" ${form.mppsEnabled === "enabled" ? "selected" : ""}>${escapeHtml(t().common.active)}</option>
                    <option value="disabled" ${form.mppsEnabled === "disabled" ? "selected" : ""}>${escapeHtml(t().common.inactive)}</option>
                  </select>
                </label>
                <label class="field">
                  <span class="label">${escapeHtml(state.language === "ar" ? "الحالة" : "Status")}</span>
                  <select class="select" name="isActive" data-dicom-device-field="true">
                    <option value="enabled" ${form.isActive === "enabled" ? "selected" : ""}>${escapeHtml(t().common.active)}</option>
                    <option value="disabled" ${form.isActive === "disabled" ? "selected" : ""}>${escapeHtml(t().common.inactive)}</option>
                  </select>
                </label>
              </div>
              <div class="form-actions">
                <button class="button-secondary" type="button" data-action="reset-dicom-device-form">${escapeHtml(t().settings.dicomDeviceReset)}</button>
                <button class="button-primary" type="submit">${escapeHtml(state.dicomDeviceSaving ? t().common.loading : t().settings.dicomDeviceSave)}</button>
              </div>
            </form>
          </div>
        </div>
      </article>
    </section>
  `;
}

function renderDicomDevicesList() {
  if (state.dicomDevicesLoading) {
    return `<div class="empty">${escapeHtml(t().common.loading)}</div>`;
  }

  if (!state.dicomDevices.length) {
    return `<div class="empty">${escapeHtml(t().settings.dicomDevicesEmpty)}</div>`;
  }

  return `
    <div class="list">
      ${state.dicomDevices
        .map(
          (device) => `
            <div class="item">
              <div class="item-copy">
                <div class="item-title">${escapeHtml(device.device_name || `#${device.id}`)}</div>
                <div class="item-subtitle">
                  ${escapeHtml(`${formatModalityName(device)} • ${device.modality_ae_title} • ${device.scheduled_station_ae_title}`)}
                </div>
                <div class="small">${escapeHtml(device.source_ip || "—")}</div>
              </div>
              <div class="form-actions">
                <button class="button-ghost" type="button" data-action="edit-dicom-device" data-device-id="${escapeHtml(String(device.id))}">
                  ${escapeHtml(t().settings.dicomDeviceEdit)}
                </button>
                <button class="button-secondary" type="button" data-action="delete-dicom-device" data-device-id="${escapeHtml(String(device.id))}">
                  ${escapeHtml(t().settings.dicomDeviceDelete)}
                </button>
              </div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderSettingsModulesSection() {
  return `
    <section class="surface">
      <div class="section-head">
        <h2 class="section-title">${escapeHtml(t().settings.modulesTitle)}</h2>
        <span class="chip accent">${escapeHtml(String(allowedRoutes.length))}</span>
      </div>
      <div class="settings-summary">${escapeHtml(t().settings.modulesBody)}</div>
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
    </section>
  `;
}

function renderSettingsSectionContent() {
  switch (state.settingsSection) {
    case "users":
      return renderSettingsUsersSection();
    case "patient-rules":
      return `
        <section class="surface">
          <div class="section-head">
            <h2 class="section-title">${escapeHtml(t().settings.patientRulesTitle)}</h2>
            <span class="chip accent">${escapeHtml(t().common.required)}</span>
          </div>
          <div class="settings-summary">${escapeHtml(t().settings.patientRulesBody)}</div>
          ${renderPatientRegistrationRules()}
        </section>
      `;
    case "dictionary":
      return `
        <section class="surface">
          <div class="section-head">
            <h2 class="section-title">${escapeHtml(t().settings.dictionaryTitle)}</h2>
            <span class="chip subtle">${escapeHtml(String(state.nameDictionaryEntries.length))}</span>
          </div>
          <div class="settings-summary">${escapeHtml(t().settings.dictionaryBody)}</div>
          ${alertMarkup("error", state.nameDictionaryError)}
          ${alertMarkup("success", state.nameDictionarySuccess)}
          ${renderNameDictionaryAddForm()}
          ${renderNameDictionaryImportForm()}
          ${renderNameDictionaryList()}
        </section>
      `;
    case "exam-types":
      return `
        <section class="surface">
          <div class="section-head">
            <h2 class="section-title">${escapeHtml(t().settings.examTypesTitle)}</h2>
            <span class="chip subtle">${escapeHtml(String(state.examTypeSettingsEntries.length))}</span>
          </div>
          <div class="settings-summary">${escapeHtml(t().settings.examTypesBody)}</div>
          ${renderExamTypeSettings()}
        </section>
      `;
    case "modalities":
      return `
        <section class="surface">
          <div class="section-head">
            <h2 class="section-title">${escapeHtml(t().settings.modalitiesTitle)}</h2>
            <span class="chip subtle">${escapeHtml(String(state.modalitySettingsEntries.length))}</span>
          </div>
          <div class="settings-summary">${escapeHtml(t().settings.modalitiesBody)}</div>
          ${renderModalitySettings()}
        </section>
      `;
    case "capacity":
      return renderSettingsCapacitySection();
    case "pacs":
      return renderSettingsPacsSection();
    case "dicom":
      return renderSettingsDicomSection();
    case "modules":
      return renderSettingsModulesSection();
    case "categories":
      return `
        <section class="surface">
          <div class="section-head">
            <h2 class="section-title">${escapeHtml(t().settings.categories)}</h2>
            <span class="chip subtle">${escapeHtml(`${Object.keys(state.settingsCatalog).length} categories`)}</span>
          </div>
          ${renderSettingsCatalog()}
        </section>
      `;
    case "audit":
      return `
        <section class="surface">
          <div class="section-head">
            <h2 class="section-title">${escapeHtml(t().settings.auditTitle)}</h2>
            <span class="chip subtle">${escapeHtml(`${t().settings.auditRows}: ${state.auditEntries.length}`)}</span>
          </div>
          ${alertMarkup("error", state.auditError)}
          ${renderAuditFilters()}
          ${renderAuditList()}
        </section>
      `;
    case "backup":
      return `
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
      `;
    default:
      return renderSettingsMenu();
  }
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

  const isMenu = state.settingsSection === "menu";
  const heroBody = isMenu ? t().settings.menuBody : t().settings.body;
  const heroActions = `
    <button class="button-secondary" type="button" data-action="refresh-settings">${escapeHtml(t().settings.refreshAll)}</button>
    ${!isMenu ? `<button class="button-ghost" type="button" data-action="settings-home">${escapeHtml(t().settings.sectionBack)}</button>` : ""}
  `;

  return `
    <div class="page">
      ${pageHero(t().settings.title, heroBody, heroActions, t().common.required)}
      ${alertMarkup("error", state.settingsError || state.userError)}
      ${alertMarkup("success", state.settingsSuccess || state.userSuccess)}
      ${renderSettingsSectionContent()}
    </div>
  `;
}

function renderPage() {
  switch (state.route) {
    case "patients":
      return renderPatients();
    case "appointments":
      return renderAppointments();
    case "calendar":
      return renderCalendar();
    case "registrations":
      return renderRegistrations();
    case "queue":
      return renderQueue();
    case "modality":
      return renderModality();
    case "doctor":
      return renderDoctor();
    case "print":
      return renderPrint();
    case "statistics":
      return renderStatistics();
    case "search":
      return renderSearch();
    case "pacs":
      return renderPacsPage();
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
        <header class="appbar">
          <div class="brand">
            <img class="brand-logo" src="/assets/nccb-logo.png" alt="National Cancer Center Benghazi logo" />
            <div class="brand-text">
              <div class="brand-title">${escapeHtml(t().appName)}</div>
              <div class="brand-title-alt">${escapeHtml(t().appNameAlternate)}</div>
              <div class="brand-subtitle">${escapeHtml(t().appSubtitle)}</div>
            </div>
          </div>
        </header>
        <nav class="top-nav-row">
          ${allowedRoutes
            .map(
              (route) => `
                <button class="top-nav-button ${state.route === route ? "active" : ""}" type="button" data-route="${route}">
                  ${escapeHtml(t().nav[route])}
                </button>
              `
            )
            .join("")}
        </nav>

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
    ${renderToasts()}
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

  try {
    app.innerHTML = state.session ? renderAppFrame(renderPage()) : renderLogin();
  } catch (error) {
    state.authChecked = true;
    state.appError = error?.message || "The page failed to render.";
    app.innerHTML = state.session ? renderAppFrame("") : renderLogin();
  }
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

    if (target.dataset.addressTarget === "patient") {
      updateAddressForm(state.patientForm, target, "patientAddressMode");
      return;
    }

    state.patientForm[target.name] = target.value;

    if (target.name === "nationalId") {
      const derivedDob = deriveDobFromNationalId(target.value);
      if (derivedDob) {
        state.patientForm.estimatedDateOfBirth = derivedDob;
        const dobInput = document.querySelector('#patient-form [name="estimatedDateOfBirth"]');
        if (dobInput) {
          dobInput.value = derivedDob;
        }
      }
    }

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

    if (target.dataset.addressTarget === "edit") {
      updateAddressForm(state.patientEditForm, target, "patientEditAddressMode");
      return;
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
    if (target.name === "date") {
      state.printFilters.dateFrom = "";
      state.printFilters.dateTo = "";
    }
    return;
  }

  if (target.closest("#calendar-filter-form")) {
    state.calendarFilters[target.name] = target.value;
    return;
  }

  if (target.closest("#statistics-filter-form")) {
    state.statisticsFilters[target.name] = target.value;
    if (target.name === "date") {
      state.statisticsFilters.dateFrom = "";
      state.statisticsFilters.dateTo = "";
    }
    return;
  }

  if (target.closest("#registrations-filter-form")) {
    state.registrationsFilters[target.name] = target.value;
    if (target.name === "date") {
      state.registrationsFilters.dateFrom = "";
      state.registrationsFilters.dateTo = "";
    }
    return;
  }

  if (target.closest("#doctor-filter-form")) {
    state.doctorFilters[target.name] = target.value;
    return;
  }

  if (target.closest("#pacs-search-form")) {
    state.pacsSearchForm[target.name] = target.value;
    state.pacsSearchError = "";
    return;
  }

  if (target.closest("#modality-filter-form")) {
    state.modalityFilters[target.name] = target.value;
    if (target.name === "date") {
      state.modalityFilters.scope = "day";
    }
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

  if (target.closest("#doctor-protocol-form")) {
    state.doctorProtocolExamTypeId = target.value;
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

  if (target.hasAttribute("data-pacs-setting-field")) {
    state.pacsSettingsForm[target.name] = target.value;
    state.settingsSuccess = "";
    state.settingsError = "";
    state.pacsTestError = "";
    state.pacsTestSuccess = "";
    return;
  }

  if (target.hasAttribute("data-dicom-device-field")) {
    state.dicomDeviceForm[target.name] = target.value;
    state.dicomDevicesError = "";
    state.dicomDevicesSuccess = "";
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

  if (target.closest("#name-dictionary-import-form")) {
    if (target instanceof HTMLInputElement && target.type === "file") {
      state.nameDictionaryImportFile = target.files?.[0] || null;
    }
    return;
  }

  if (target.hasAttribute("data-name-dictionary-new-field")) {
    state.nameDictionaryForm[target.name] = target.type === "checkbox" ? target.checked : target.value;
    return;
  }

  if (target.hasAttribute("data-exam-type-settings-new-field")) {
    state.examTypeSettingsForm[target.name] = target.value;
    return;
  }

  if (target.hasAttribute("data-modality-settings-new-field")) {
    state.modalitySettingsForm[target.name] = target.value;
    return;
  }

  if (target.hasAttribute("data-name-dictionary-field")) {
    const entryId = target.dataset.dictionaryId;
    if (!entryId) {
      return;
    }

    state.nameDictionaryEntries = state.nameDictionaryEntries.map((entry) =>
      String(entry.id) === String(entryId)
        ? {
            ...entry,
            [target.name]: target.type === "checkbox" ? target.checked : target.value
          }
        : entry
    );
    return;
  }

  if (target.hasAttribute("data-exam-type-settings-field")) {
    const entryId = target.dataset.examTypeId;
    if (!entryId) {
      return;
    }

    state.examTypeSettingsEntries = state.examTypeSettingsEntries.map((entry) =>
      String(entry.id) === String(entryId)
        ? {
            ...entry,
            [target.name]: target.value
          }
        : entry
    );
    return;
  }

  if (target.hasAttribute("data-modality-settings-field")) {
    const entryId = target.dataset.modalityId;
    if (!entryId) {
      return;
    }

    state.modalitySettingsEntries = state.modalitySettingsEntries.map((entry) =>
      String(entry.id) === String(entryId)
        ? {
            ...entry,
            [target.name]:
              target.name === "is_active"
                ? target.value === "enabled"
                : target.value
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

  if (target.dataset.action === "dismiss-toast") {
    event.preventDefault();
    const toastId = target.dataset.toastId;
    if (toastId) {
      dismissToast(toastId);
    }
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

  if (target.dataset.action === "create-appointment-for-saved-patient") {
    event.preventDefault();
    void startAppointmentForPatient(state.savedPatient);
    return;
  }

  if (target.dataset.action === "select-appointment-patient") {
    event.preventDefault();
    const patientId = target.dataset.patientId;
    state.selectedAppointmentPatient = state.appointmentPatientResults.find(
      (patient) => String(patient.id) === String(patientId)
    ) || null;
    state.appointmentError = "";
    state.pacsFindResults = [];
    state.pacsFindError = "";
    state.pacsFindHasRun = false;
    render();
    if (state.selectedAppointmentPatient) {
      void loadAppointmentNoShowSummary(state.selectedAppointmentPatient.id);
    } else {
      state.appointmentNoShowSummary = { count: 0, lastDate: "" };
    }
    if (getAppointmentPacsPatientId(state.selectedAppointmentPatient)) {
      void searchPacsStudies();
    }
    return;
  }

  if (target.dataset.action === "pacs-cfind") {
    event.preventDefault();
    void searchPacsStudies();
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

  if (target.dataset.action === "calendar-prev-month") {
    event.preventDefault();
    state.calendarDisplayDate = addUtcMonths(state.calendarDisplayDate, -1);
    state.calendarSelectedDate = formatIsoDate(state.calendarDisplayDate);
    state.calendarError = "";
    void loadCalendarAppointments();
    return;
  }

  if (target.dataset.action === "calendar-next-month") {
    event.preventDefault();
    state.calendarDisplayDate = addUtcMonths(state.calendarDisplayDate, 1);
    state.calendarSelectedDate = formatIsoDate(state.calendarDisplayDate);
    state.calendarError = "";
    void loadCalendarAppointments();
    return;
  }

  if (target.dataset.action === "calendar-today") {
    event.preventDefault();
    state.calendarDisplayDate = getCalendarMonthStartDate();
    state.calendarSelectedDate = getCurrentDateInputValue();
    state.calendarError = "";
    void loadCalendarAppointments();
    return;
  }

  if (target.dataset.action === "select-calendar-day") {
    event.preventDefault();
    state.calendarSelectedDate = target.dataset.date || "";
    state.calendarError = "";
    render();
    scrollCalendarDayListIntoView();
    return;
  }

  if (target.dataset.action === "calendar-clear-filter") {
    event.preventDefault();
    state.calendarFilters = defaultCalendarFilters();
    state.calendarError = "";
    void loadCalendarAppointments();
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

  if (target.dataset.action === "select-registration") {
    event.preventDefault();
    const appointmentId = target.dataset.appointmentId;
    state.selectedPrintAppointment = state.printResults.find(
      (appointment) => String(appointment.id) === String(appointmentId)
    ) || null;
    state.printError = "";
    state.printSuccess = "";
    state.appointmentEditError = "";
    state.appointmentEditSuccess = "";
    state.cancelReason = "";
    if (state.selectedPrintAppointment) {
      fillAppointmentEditForm(state.selectedPrintAppointment);
    }
    render();
    return;
  }

  if (target.dataset.action === "select-doctor-appointment") {
    event.preventDefault();
    const appointmentId = target.dataset.appointmentId;
    state.doctorSelectedAppointment = state.doctorResults.find(
      (appointment) => String(appointment.id) === String(appointmentId)
    ) || null;
    state.doctorProtocolError = "";
    state.doctorProtocolSuccess = "";
    state.doctorDocumentsError = "";
    if (state.doctorSelectedAppointment) {
      state.doctorProtocolExamTypeId = String(state.doctorSelectedAppointment.exam_type_id || "");
    } else {
      state.doctorProtocolExamTypeId = "";
    }
    void loadDoctorDocuments(appointmentId);
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

  if (target.dataset.action === "delete-user") {
    event.preventDefault();
    void deleteUser(target.dataset.userId);
    return;
  }

  if (target.dataset.action === "refresh-settings") {
    event.preventDefault();
    void Promise.all([
      loadUsers(),
      loadSettings(),
      loadAuditEntries(),
      loadNameDictionary(),
      loadModalitySettings(),
      loadExamTypeSettings(),
      loadDicomDevices(),
      loadAppointmentLookups()
    ]);
    return;
  }

  if (target.dataset.action === "set-settings-section") {
    event.preventDefault();
    state.settingsSection = target.dataset.section || "menu";
    render();
    return;
  }

  if (target.dataset.action === "settings-home") {
    event.preventDefault();
    state.settingsSection = "menu";
    render();
    return;
  }

  if (target.dataset.action === "pacs-test-connection") {
    event.preventDefault();
    void testPacsConnection();
    return;
  }

  if (target.dataset.action === "edit-dicom-device") {
    event.preventDefault();
    startEditingDicomDevice(target.dataset.deviceId);
    return;
  }

  if (target.dataset.action === "delete-dicom-device") {
    event.preventDefault();
    void deleteDicomDevice(target.dataset.deviceId);
    return;
  }

  if (target.dataset.action === "reset-dicom-device-form") {
    event.preventDefault();
    state.dicomDeviceForm = defaultDicomDeviceForm();
    state.dicomDevicesError = "";
    state.dicomDevicesSuccess = "";
    render();
    return;
  }

  if (target.dataset.action === "reset-pacs-search") {
    event.preventDefault();
    resetPacsSearch();
    return;
  }

  if (target.dataset.action === "save-exam-type-entry") {
    event.preventDefault();
    void updateSettingsExamType(target.dataset.examTypeId);
    return;
  }

  if (target.dataset.action === "delete-exam-type-entry") {
    event.preventDefault();
    void deleteSettingsExamType(target.dataset.examTypeId);
    return;
  }

  if (target.dataset.action === "save-modality-entry") {
    event.preventDefault();
    void updateSettingsModality(target.dataset.modalityId);
    return;
  }

  if (target.dataset.action === "delete-modality-entry") {
    event.preventDefault();
    void deleteSettingsModality(target.dataset.modalityId);
    return;
  }

  if (target.dataset.action === "refresh-queue") {
    event.preventDefault();
    void loadQueueSnapshot();
    return;
  }

  if (target.dataset.action === "refresh-statistics") {
    event.preventDefault();
    void loadStatistics();
    return;
  }

  if (target.dataset.action === "print-statistics") {
    event.preventDefault();
    try {
      state.statisticsError = "";
      openStatisticsPrint(state.statisticsSnapshot, state.statisticsFilters);
    } catch (error) {
      state.statisticsError = error.message;
    }
    render();
    return;
  }

  if (target.dataset.action === "refresh-modality") {
    event.preventDefault();
    void loadModalityWorklist();
    return;
  }

  if (target.dataset.action === "set-modality-scope") {
    event.preventDefault();
    state.modalityFilters.scope = target.dataset.scope || "day";
    render();
    return;
  }

  if (target.dataset.action === "set-modality-quick-date") {
    event.preventDefault();
    setModalityQuickDate(target.dataset.range);
    return;
  }

  if (target.dataset.action === "refresh-doctor") {
    event.preventDefault();
    void loadDoctorRequests();
    return;
  }

  if (target.dataset.action === "browser-print") {
    event.preventDefault();
    if (!state.selectedPrintAppointment) {
      state.printError = t().print.noAppointment;
      render();
      return;
    }

    try {
      state.printError = "";
      state.printSuccess = "";
      openAppointmentSlipPrint(state.selectedPrintAppointment);
      state.printSuccess =
        state.language === "ar" ? "تم فتح وصل الموعد للطباعة." : "The appointment slip was opened for printing.";
      pushToast("success", state.printSuccess);
    } catch (error) {
      state.printError = error.message;
      pushToast("error", state.printError);
    }
    render();
    return;
  }

  if (target.dataset.action === "print-daily-list") {
    event.preventDefault();
    try {
      state.printError = "";
      const title =
        state.language === "ar" ? "القائمة اليومية حسب الأجهزة" : "Daily modality appointment list";
      openDailyListPrint(state.printResults, title);
    } catch (error) {
      state.printError = error.message;
    }
    render();
    return;
  }

  if (target.dataset.action === "print-modality-list") {
    event.preventDefault();
    try {
      state.printError = "";
      const modalityId = target.dataset.modalityId;
      const modalityAppointments = state.printResults.filter(
        (appointment) => String(appointment.modality_id || "") === String(modalityId || "")
      );
      const modalityName = modalityAppointments[0] ? formatModalityName(modalityAppointments[0]) : "";
      const fallback = state.language === "ar" ? "قائمة جهاز" : "Modality list";
      openDailyListPrint(modalityAppointments, modalityName || fallback);
    } catch (error) {
      state.printError = error.message;
    }
    render();
    return;
  }

  if (target.dataset.action === "calendar-print-day") {
    event.preventDefault();
    state.calendarError = "";
    const date = target.dataset.date;
    const appointments = getCalendarAppointmentsForDate(date);

    if (!appointments.length) {
      state.calendarError = t().calendar.noAppointments;
      render();
      return;
    }

    try {
      const title =
        state.language === "ar"
          ? `${t().calendar.printTitlePrefix} • ${formatDisplayDate(date)}`
          : `${formatDisplayDate(date)} • ${t().calendar.printTitlePrefix}`;
      openDailyListPrint(appointments, title);
    } catch (error) {
      state.calendarError = error.message;
    }
    render();
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

  if (target.dataset.action === "prepare-appointment-slip") {
    event.preventDefault();
    void prepareAppointmentSlipFromCreation();
    return;
  }

  if (target.dataset.action === "close-appointment-created-dialog") {
    event.preventDefault();
    state.appointmentCreatedDialogOpen = false;
    render();
    return;
  }

  if (target.dataset.action === "print-created-appointment-slip") {
    event.preventDefault();
    void prepareAppointmentSlipFromCreation();
    return;
  }

  if (target.dataset.action === "set-print-range") {
    event.preventDefault();
    setPrintRange(target.dataset.range);
    return;
  }

  if (target.dataset.action === "add-city-option") {
    event.preventDefault();
    const city = String(target.dataset.city || "").trim();
    const value = city || state.patientForm.address || state.patientEditForm.address || "";
    if (value && !isKnownCity(value)) {
      state.addressOptions = [...state.addressOptions, value];
      saveCityOptions(state.addressOptions);
      state.patientSuccess =
        state.language === "ar" ? "تمت إضافة المدينة إلى القائمة." : "City added to the list.";
    }
    render();
    return;
  }

  if (target.dataset.action === "save-dictionary-entry") {
    event.preventDefault();
    void updateNameDictionaryEntry(target.dataset.dictionaryId);
    return;
  }

  if (target.dataset.action === "delete-dictionary-entry") {
    event.preventDefault();
    void deleteNameDictionaryEntry(target.dataset.dictionaryId);
    return;
  }

  if (target.dataset.action === "download-dictionary-example") {
    event.preventDefault();
    downloadDictionaryExample();
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

  if (event.target.id === "calendar-filter-form") {
    event.preventDefault();
    void loadCalendarAppointments();
    return;
  }

  if (event.target.id === "statistics-filter-form") {
    event.preventDefault();
    void loadStatistics();
    return;
  }

  if (event.target.id === "registrations-filter-form") {
    event.preventDefault();
    void loadRegistrations();
    return;
  }

  if (event.target.id === "doctor-filter-form") {
    event.preventDefault();
    void loadDoctorRequests();
    return;
  }

  if (event.target.id === "pacs-search-form") {
    event.preventDefault();
    void searchPacsDirectory();
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

  if (event.target.id === "doctor-protocol-form") {
    event.preventDefault();
    void saveDoctorProtocol();
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

  if (event.target.id === "name-dictionary-form") {
    event.preventDefault();
    void createNameDictionaryEntry();
    return;
  }

  if (event.target.id === "name-dictionary-import-form") {
    event.preventDefault();
    void importNameDictionaryCsv();
    return;
  }

  if (event.target.id === "exam-type-settings-form") {
    event.preventDefault();
    void createSettingsExamType();
    return;
  }

  if (event.target.id === "modality-settings-form") {
    event.preventDefault();
    void createSettingsModality();
    return;
  }

  if (event.target.id === "user-form") {
    event.preventDefault();
    void createUser();
    return;
  }

  if (event.target.id === "pacs-settings-form") {
    event.preventDefault();
    void savePacsSettings();
    return;
  }

  if (event.target.id === "dicom-device-form") {
    event.preventDefault();
    void saveDicomDevice();
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
  try {
    await refreshSession();

    if (state.session) {
      await loadNameDictionary();
      await hydrateRoute();
    }
  } catch (error) {
    state.authChecked = true;
    state.appError = error?.message || "The application failed to load.";
  }

  render();
}

render();
void bootstrap();
