-- Patient-facing QR self-service settings defaults
-- Prepopulate the QR settings section so fresh installs have editable defaults.

insert into system_settings (category, setting_key, setting_value)
values (
  'patient_qr_self_service',
  'config',
  '{
    "value": {
      "enabled": true,
      "printQrOnAppointmentSlip": true,
      "allowCancellation": true,
      "allowAddToCalendar": true,
      "showPreparationInstructions": true,
      "showDocumentsChecklist": true,
      "showDepartmentContact": false,
      "showLocationDirections": false,
      "pageTitleAr": "خدمة المريض عبر رمز QR",
      "introTextAr": "يمكنك مراجعة تفاصيل الموعد والتعليمات ومعلومات القسم من هذه الصفحة.",
      "genericPreparationTextAr": "",
      "documentsChecklistAr": [
        "ورقة الإحالة",
        "إثبات الهوية",
        "صور أو تقارير سابقة إن وجدت",
        "تحاليل حديثة إذا طُلبت من القسم"
      ],
      "contact": {
        "primaryPhone": "",
        "secondaryPhone": "",
        "whatsapp": "",
        "whatsappEnabled": false,
        "workingHoursAr": "",
        "noteAr": ""
      },
      "location": {
        "centerNameAr": "المركز الوطني للأورام بنغازي",
        "departmentLocationAr": "",
        "roomUnitFloorAr": "",
        "addressAr": "",
        "arrivalInstructionsAr": "",
        "googleMapsUrl": "",
        "parkingNoteAr": ""
      }
    }
  }'::jsonb
)
on conflict (category, setting_key) do nothing;
