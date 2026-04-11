# Appointments V2 Project Brief

## Purpose

Appointments V2 is a replacement for the current legacy appointments/scheduling module.

The existing module has become too monolithic and fragile because it mixes:
- availability calculation
- scheduling rules
- overbooking and overrides
- appointment writes
- settings persistence
- frontend display assumptions

Appointments V2 will replace that architecture with a cleaner modular design.

## Current project reality

- The system is **not in production**
- There is **no live patient data**
- There are **no live end users to preserve**
- The current users are developers/testers only

Because of that, the project should optimize for:
- correctness
- architecture quality
- maintainability
- explicit behavior
- reduced long-term technical debt

It does **not** need to optimize for backward compatibility with a live deployment.

## Primary goal

Build a new scheduling and booking module that is:
- modular
- testable
- explicit
- backend-driven
- safe under concurrency
- easy to reason about
- suitable for radiology scheduling complexity

## What Appointments V2 must support

### Core booking capability
- create appointment
- reschedule appointment
- cancel appointment
- release capacity correctly on cancellation/reschedule
- explicit booking decision responses

### Scheduling capability
- availability queries
- next available suggestions
- blocked dates
- exam-type restrictions
- category-based limits
- override-required states
- special quota logic if retained in V2 scope

### Admin capability
- create and edit scheduling rules
- version or publish rule configuration
- audit changes
- preview rule impact where practical

### UI capability
- explicit statuses only:
  - `available`
  - `restricted`
  - `blocked`
- no frontend inference from missing fields
- clean separation between booking UI and admin configuration UI

## Non-goals

Appointments V2 should **not**:
- continue extending the legacy scheduling engine
- preserve legacy implementation quirks
- reuse broken settings persistence patterns
- mix business-rule evaluation with frontend assumptions
- depend on silent fallback behavior

## High-level product decision

Appointments V2 is one product module, but internally divided into smaller bounded parts:
- catalog
- scheduler
- rules
- booking
- admin config
- API/presentation layer

## Transition approach

The project will:
1. freeze the legacy appointments module
2. build Appointments V2 in parallel
3. validate V2
4. wire a new V2 frontend
5. switch over to V2
6. deprecate/remove legacy appointments code

Because there is no production dependency, the project may use a **hard cutover after validation** rather than a prolonged compatibility phase.

## Quality requirements

Appointments V2 should be built with:
- explicit rule precedence
- side-effect-free decision logic
- transactional write safety
- deterministic API responses
- focused tests
- minimal ambiguity in configuration behavior

## Working rule for contributors and coding agents

When asked to implement new appointment or scheduling functionality:
- default to Appointments V2
- do not add features to legacy appointments unless explicitly instructed