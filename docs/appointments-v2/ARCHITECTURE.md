# Appointments V2 Architecture

## Architectural intent

Appointments V2 replaces the legacy monolithic appointments/scheduling implementation with a modular backend-first architecture.

The design separates:
1. canonical scheduling data
2. rule evaluation
3. transactional booking writes
4. admin configuration
5. frontend-specific response shaping

## Design principles

- explicit over implicit
- backend owns booking truth
- frontend consumes explicit states
- configuration is authoritative
- side-effect-free evaluation before transactional writes
- modular internal structure
- test critical logic directly

## Proposed module structure

```text
src/modules/appointments-v2/
  api/
  booking/
  rules/
  scheduler/
  catalog/
  admin/
  shared/