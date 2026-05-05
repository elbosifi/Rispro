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
    'webPushTestBodyAr', 'تم تفعيل تنبيهات المتصفح لهذا الموعد.',
    'webPushIosHelpButtonAr', 'طريقة التفعيل على iPhone',
    'webPushIosHelpButtonEn', 'How to enable on iPhone',
    'webPushIosHelpTitleAr', 'لتفعيل التنبيهات على iPhone',
    'webPushIosHelpTitleEn', 'To enable notifications on iPhone',
    'webPushIosHelpBodyAr', 'افتح هذه الصفحة في Safari، اضغط زر المشاركة، اختر إضافة إلى الشاشة الرئيسية، ثم افتح RISpro من الأيقونة الجديدة وفعّل التنبيهات من هناك. يتطلب ذلك iOS 16.4 أو أحدث.',
    'webPushIosHelpBodyEn', 'Open this page in Safari, tap Share, choose Add to Home Screen, then open RISpro from the new icon and enable notifications there. This requires iOS 16.4 or later.'
  )
)
where category = 'patient_qr_self_service'
  and setting_key = 'config';
