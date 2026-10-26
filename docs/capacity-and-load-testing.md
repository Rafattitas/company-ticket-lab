# Capacity and load testing

There is no measured 5,000-concurrent-user capacity claim for TicketDesk.
The current production Compose settings allocate 0.5 CPU / 256 MB to one backend,
1 CPU / 1 GB to PostgreSQL, and 0.5 CPU / 128 MB to the frontend. The backend DB
pool defaults to ten connections. This is a connection reuse limit, not a limit
of ten users. The VM host's own capacity/network/storage also matters.

Five thousand registered employees, 5,000 open browser tabs, and 5,000 simultaneous
uploads/requests are different workloads. Idle tabs do not continuously perform
work. Concurrent logins, searches, reporting queries, and image uploads stress
different resources. The present small single-VM setup is not certified for
5,000 active users; heavy load may increase latency, exhaust memory, or fail
requests. Functional tests and container health do not establish capacity.

## Staging-only read workload

`tests/load/knowledge.js` is a k6 scenario for public knowledge-page/search reads.
It defaults to 50 virtual users with five seconds of think time and ramps up
before holding the target. It requires explicit `STAGING_ONLY=true` and
`BASE_URL`. Do not point it at the live VM. Use a separate instance with synthetic
articles and production-like resource limits/data volumes. Install k6 from its
official distribution, then start small:

```bash
k6 run -e STAGING_ONLY=true -e BASE_URL=http://staging-host:8080 -e MAX_VUS=50 tests/load/knowledge.js
```

Increase gradually (50 → 100 → 500 → 1,000 → 5,000) while observing CPU, memory,
restarts, DB connections/waits, disk latency, request rate, and p95/p99 latency.
The script's proposed thresholds are <1% failed requests, >99% successful checks,
and p95 <1 second. They are acceptance targets, not measured results. Ensure the
load-generator machine is not the bottleneck.

This scenario does not simulate browser asset downloads, login, ticket writes,
attachments, authenticated reports, or real email. Passing it alone cannot
certify the whole system for 5,000 users. Add a realistic mixed workload including
those actions in isolated staging, with mail delivery to a capture server.
No load test was run against production for this feature.

## Changes to evaluate after measurements

Tune CPU/RAM and SQL/query indexes from measured bottlenecks. Consider full-text
article search at larger content volumes, stable caching for appropriate public
resources, bounded ingress/upload controls, and separate backend replicas behind
a load balancer. Replicas need coordinated migrations, shared mail encryption
keys, and careful DB-pool sizing. Do not blindly set the pool to 5,000; PostgreSQL
has its own connection/memory budget. The current single-instance migration
startup needs review before concurrent replica rollout. Add off-host backups and
monitoring before treating a larger installation as production-ready.
