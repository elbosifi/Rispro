update system_settings
set setting_value = jsonb_build_object(
  'value',
  coalesce(setting_value->'value', '{}'::jsonb) ||
  jsonb_build_object(
    'webPushAppointmentReminder24hTitleAr', 'تذكير بالموعد',
    'webPushAppointmentReminder24hBodyAr', 'لديك موعد قريب. افتح صفحة الموعد للاطلاع على التفاصيل.',
    'webPushAppointmentRescheduledTitleAr', 'تم تحديث الموعد',
    'webPushAppointmentRescheduledBodyAr', 'تم تغيير تاريخ أو وقت الموعد. افتح صفحة الموعد للاطلاع على التفاصيل.',
    'webPushAppointmentCancelledTitleAr', 'تم إلغاء الموعد',
    'webPushAppointmentCancelledBodyAr', 'تم إلغاء موعدك. افتح صفحة الموعد للاطلاع على التفاصيل.',
    'webPushAppointmentChangedTitleAr', 'تم تحديث الموعد',
    'webPushAppointmentChangedBodyAr', 'تم تحديث تفاصيل الموعد. افتح صفحة الموعد للاطلاع على التفاصيل.',
    'webPushReportReadyTitleAr', 'التقرير جاهز',
    'webPushReportReadyBodyAr', 'تقريرك جاهز. افتح صفحة الموعد للاطلاع على خيارات الوصول.',
    'webPushImageReadyTitleAr', 'الصور جاهزة',
    'webPushImageReadyBodyAr', 'صورك جاهزة. افتح صفحة الموعد للاطلاع على خيارات الوصول.',
    'webPushTestTitleAr', 'تم تفعيل التنبيهات',
    'webPushTestBodyAr', 'تم تفعيل تنبيهات المتصفح لهذا الموعد.'
  )
)
where category = 'patient_qr_self_service'
  and setting_key = 'config';
