# RISpro Reception Prototype

This is a frontend-first prototype for a diagnostic radiology reception module.

## What is included

- Arabic and English interface switching
- RTL and LTR layout support
- Home dashboard
- Patient registration
- Appointment creation
- Queue screen
- Patient search
- Daily print screen
- Settings screen with user management

## How to open it

Open `index.html` in your browser.

The prototype is built as a static web app, so it does not need installation to review the interface.

## Backend foundation

The project now also includes a real backend foundation for the next phase:

- Express API
- PostgreSQL migration script
- authentication routes
- user management routes
- patient routes
- settings routes

### Basic backend setup

1. Copy `.env.example` to `.env`
2. Set your PostgreSQL connection in `.env`
3. Run `npm install`
4. Run `npm run migrate`
5. Run `npm run seed:supervisor`
6. Run `npm run dev`

### Important note

The sandbox used during development here blocks opening local ports, so the backend server could not be started inside this environment.

The code and syntax checks are complete, but the live server should be started on your machine or deployment container.

## Current status

This version is a visual and workflow prototype.

It does not yet save data to a database.

## Final V1 documents

Use these two documents as the source of truth before backend implementation:

- `docs/v1-specification.md`
- `docs/backend-handoff.md`

## Next implementation step

Use the V1 decisions in `docs/backend-handoff.md` to connect this prototype to:

- PostgreSQL
- backend APIs
- real authentication
- saved patients and appointments
