# ADR 0001: Senior training history export

## Status

Accepted.

## Context

The senior training view shows the selected team-wide skill, per-player training choices, training bar and hidden skill values. The response after `TrainingAccept` also shows "Efekt ostatniego treningu", but that section lists only visible level jumps, not every trained player and not unchanged results.

To estimate a future training efficiency formula, we need a durable dataset where every training attempt is represented, including attempts with no visible level change.

## Decision

Create a dedicated userscript that stores senior training history locally in the browser and exports it as JSON/CSV.

The script records:

- a before snapshot when `TrainingAccept` is triggered;
- an after snapshot when the refreshed training view appears;
- one normalized record per player and performed training choice;
- a session-level context snapshot for coaches and infrastructure.

The canonical local store is IndexedDB. JSON export preserves sessions and context. CSV export is a flat analytical table where one row equals one player in one training session.

XLSX is intentionally not part of v1. A future XLSX exporter can generate `all_records` plus filtered sheets per trained attribute from the same JSON/CSV model.

## Training Efficiency

Senior training efficiency is stored in two forms:

- `raw_training_multiplier`: actual multiplier relative to ideal coaches without infrastructure.
- `normalized_efficiency`: normalized to `100%` for ideal coaches plus max senior training infrastructure.

For senior training:

```text
coach_type_score =
  0.60 * main_training_attribute
  + 0.20 * discipline
  + 0.20 * adaptability

coach_score =
  2/3 * head_coach_type_score
  + 1/3 * assistant_coach_type_score

coach_component = coach_score / 30

infrastructure_multiplier =
  1 + (training_hall_level + kind_building_level) / 100

raw_training_multiplier =
  coach_component * infrastructure_multiplier

normalized_efficiency =
  raw_training_multiplier / 1.20
```

The `1.20` denominator assumes max senior training infrastructure is `Hala treningowa 5` plus the matching kind building at level `15`.

## Consequences

- The exporter can measure "no change" because it compares before/after values rather than trusting only the effect list.
- The local file cannot be silently appended on disk by a userscript; downloads are explicit exports.
- CSV remains easy to analyze and diff; JSON keeps enough context to regenerate richer formats later.
