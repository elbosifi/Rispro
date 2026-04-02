# Patient Kiosk Mode

## Overview

The Patient Kiosk is a self-service touch screen interface that allows patients to scan their accession number and join the queue automatically upon arrival at your imaging center.

## Access

The kiosk page is available at:
```
https://your-domain.com/patient-kiosk.html
```

## Features

### 🎯 Simple User Experience
- Large, clear interface suitable for touch screens
- Automatic focus on input field for barcode scanners
- Bilingual support (English/Arabic)
- Elegant visual feedback for success/error states

### 📱 Scanner Support
- Works with USB barcode scanners (plug-and-play)
- Manual input fallback
- Auto-submit on Enter key (most scanners send this)

### ✅ Confirmation Messages

**Success:**
- "Welcome! You have been added to the queue. Please wait for your turn."
- Auto-clears after 5 seconds for next patient

**Error Cases:**
- **Not Found**: Appointment not found with this accession number
- **Already Scanned**: Patient already checked in
- **Cancelled**: Appointment was cancelled
- **Wrong Date**: Only today's appointments can be scanned

## Setup Instructions

### 1. Kiosk Hardware
- Touch screen display or tablet
- USB barcode scanner (optional but recommended)
- Mount at entrance/reception area

### 2. Browser Setup
- Open `patient-kiosk.html` in Chrome/Edge in kiosk mode (F11)
- Enable auto-start on system boot
- Disable sleep/screensaver

### 3. Network
- Ensure kiosk device has network access to RISpro server
- No authentication required (public endpoint)

## Technical Details

### API Endpoint
```
POST /api/queue/kiosk-scan
Content-Type: application/json

{
  "scanValue": "20260402-001"
}
```

### Response (Success)
```json
{
  "queueEntry": { ... },
  "appointment": { ... },
  "patient": { ... },
  "modality": { ... }
}
```

### Response (Error)
```json
{
  "message": "Appointment not found."
}
```

## Security Notes

- The kiosk endpoint is public (no authentication)
- Only validates against today's appointments
- Cannot modify or cancel appointments
- Audit trail logs all scans as "kiosk-public"
- Rate limiting should be configured at reverse proxy level

## Customization

### Branding
Edit `patient-kiosk.html`:
- Change colors in CSS `:root` variables
- Replace logo text
- Modify messages in `translations` object

### Behavior
- Success message auto-hide: 5000ms (line ~435)
- Input autofocus: Always enabled for continuous scanning
- Language toggle: Top-right corner

## Troubleshooting

**Scanner not working:**
- Ensure scanner is configured for USB HID mode
- Test in Notepad first to confirm scanner works
- Check if scanner sends Enter key after barcode

**"Appointment not found":**
- Verify accession number format matches your system
- Check if appointment is for today
- Confirm appointment status is not cancelled

**Page not loading:**
- Verify server is running
- Check network connectivity
- Ensure `patient-kiosk.html` is in web root

## Best Practices

1. **Position** kiosk at eye level near entrance
2. **Display** clear instructions for patients
3. **Staff** should monitor kiosk during peak hours
4. **Test** scanner compatibility before deployment
5. **Configure** auto-start and watchdog for reliability
