# Detection Lab

Research tools for Detection Engine events.

Production classification stays in `server/detection`. This folder stores event
setups, scores later outcomes, and builds reports. It does not create or change
alerts.

## Flags

```env
DETECTION_RESEARCH_ENABLED=false
DETECTION_OUTCOME_SCORING_ENABLED=false
```

Keep the flags off unless the research tables from
`supabase/detection_research.sql` have been applied.

## Flow

1. The production runner creates a detection event.
2. If `DETECTION_RESEARCH_ENABLED=true`, the runner saves an event setup.
3. The outcome scorer reads future `detection_snapshots` and fills
   `detection_event_outcomes`.
4. Baseline reports compare labels by win rate, return, and drawdown.

To remove this layer, disable the flags, remove this folder, remove the guarded
hook in `server/detection/runner.ts`, and archive or drop the research tables.
