# OBI and Cilium local rehearsal benchmark

Captured: 2026-09-26T18:31:39.169Z

Method: five samples per condition, 200 requests per sample, concurrency 20, after a 40-request warm-up. Background demo traffic was paused.

| Metric | B: Cilium + Hubble | D: Cilium + Hubble + OBI | Change |
| --- | ---: | ---: | ---: |
| Throughput median | 19.77 req/s | 19.73 req/s | -0.2% |
| p95 median | 1018 ms | 1020 ms | 2 ms |
| Failed requests | 0 / 1000 | 0 / 1000 | 0 |
| OBI CPU median | 0 | 0.013 cores | added |
| OBI working set median | 0 | 253.2 MiB | added |
| Accepted spans delta | 0 | 7210 | |
| Exported spans delta | 0 | 7210 | |
| Hubble lost events delta | 36 | 1083 | |

Local kind and kubectl port-forward rehearsal. These results are not production capacity numbers.
