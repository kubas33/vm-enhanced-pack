# Training History Glossary

## Training Session

A single senior team training execution captured around `TrainingAccept`. It contains the selected team-wide skill, training pool before/after, coach context, infrastructure context and per-player records.

## Training Record

One row of analytical data for one player in one training session. It stores the chosen option, trained skill, bar before/after, level before/after and delta.

## Selected Option

The per-player radio choice in senior training:

- `wybrany`: train the team-wide selected skill; costs 4 training bar points.
- `wytrz`: train stamina; costs 1 training bar point.
- `odp`: train stress resistance; costs 1 training bar point.
- `nietrenuj`: no training.

## Level Jump

A visible full-level increase listed by VM in "Efekt ostatniego treningu". This is validation data only. The complete training result comes from comparing before and after snapshots.

## Raw Training Multiplier

The estimated actual senior training multiplier from coaches and infrastructure. Ideal coaches without buildings equal `1.0`; max buildings can push this above `1.0`.

## Normalized Efficiency

Training context normalized so `1.0` means ideal coaches and max senior training infrastructure. This is the preferred field for comparing training environments.

## Training Kind

The category used to pick coach attributes and infrastructure:

- `physical`: stamina and serve power; uses physical training and gym.
- `psychological`: stress resistance; uses psychology and psychologist office.
- `technical`: all other senior skills; uses technical training and coach advisors office.
