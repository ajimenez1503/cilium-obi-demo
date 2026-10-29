# Presentation recordings

These recordings capture the local demo on September 26, 2026. The presentation edits below were made on October 29, 2026.

| Recording | Presentation edit |
| --- | --- |
| `demo-2-success.mp4` | Upper Grafana dashboard for 8 seconds, lower dashboard for 12 seconds, then Hubble UI for 9.76 seconds at its original speed. |
| `demo-3-policy-denial.mp4` | Terminal only, ending at 19.80 seconds on the timeout and Hubble policy-denial evidence. |

The success clip repeats captured frames to give the presenter time to explain the dashboards. No telemetry values, timestamps, or verdicts were changed. Dashboard panels aggregate the selected time window and workloads; they do not describe one isolated request.

The denial clip does not show Grafana, policy removal, or recovery. The slide displays a separate Grafana still. Its added policy-denial label is marked as illustrative. The Hubble terminal output provides the actual denial reason.

The original browser captures are in `raw/`. With Node.js, FFmpeg, and ffprobe installed, rebuild the edited videos, posters, and timing manifest from the repository root:

```sh
node slides/source/refine-demo-recordings.mjs
```

See `presentation-edits.json` for the exact source ranges and reading holds. The PowerPoint deck embeds the edited MP4 files, so playback does not require these separate files.
