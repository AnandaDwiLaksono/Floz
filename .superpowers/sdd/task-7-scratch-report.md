# Task 7 Scratch Report

Reusable canonical Task filters now cover active operational buckets, Completed via `completed_at IS NOT NULL`, half-open due ranges, status, priority rank, team, assignee, search, and stable cursors. Workspace scope remains mandatory.

Limitation: KPI populations requiring metric-specific historical or denominator predicates cannot be represented by these canonical Task filters. `/reports/kpis/{metric}/items` remains deferred.
