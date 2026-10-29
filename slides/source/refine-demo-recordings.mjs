// Rebuild the presentation edits from the original September 26 browser captures.
// Usage: node slides/source/refine-demo-recordings.mjs [raw-directory] [output-directory]
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const recordings = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../recordings');
const input = path.resolve(process.argv[2] ?? path.join(recordings, 'raw'));
const output = path.resolve(process.argv[3] ?? recordings);
const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH ?? 'ffprobe';
await fs.mkdir(output, {recursive: true});

function duration(file) {
  return Number(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], {encoding: 'utf8'}).trim());
}
function encode(args, file) {
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '25', '-movflags', '+faststart', file], {stdio: 'inherit'});
}
const successSource = path.join(input, 'demo-2-success.webm');
const denialSource = path.join(input, 'demo-3-policy-denial.webm');
if (Math.abs(duration(successSource) - 47.08) > 0.05 || Math.abs(duration(denialSource) - 38.60) > 0.05) {
  throw new Error('These edit points require the original September 26 captures. Audit new recordings before reusing them.');
}
// Keep clean, populated views. Reading holds repeat actual captured frames.
const graph = '[0:v]split=3[a][b][c];' +
  '[a]trim=start=23:end=28.16,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=2.84,trim=duration=8[a1];' +
  '[b]trim=start=28.4:end=33.2,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=7.2,trim=duration=12[b1];' +
  '[c]trim=start=37.32:end=47.08,setpts=PTS-STARTPTS[c1];' +
  '[a1][b1][c1]concat=n=3:v=1:a=0[v]';
const success = path.join(output, 'demo-2-success.mp4');
const denial = path.join(output, 'demo-3-policy-denial.mp4');
encode(['-i', successSource, '-filter_complex', graph, '-map', '[v]'], success);
encode(['-i', denialSource, '-vf', 'trim=end=19.8,setpts=PTS-STARTPTS'], denial);
for (const [file, at, name] of [[success, '0', 'demo-2-success-poster.png'], [denial, '18', 'demo-3-policy-denial-poster.png']]) {
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', at, '-i', file, '-frames:v', '1', path.join(output, name)], {stdio: 'inherit'});
}
const manifest = {
  recorded: '2026-09-26', edited: '2026-10-29',
  success: {durationSeconds: duration(success), sections: [
    {view: 'Grafana upper dashboard', output: [0, 8], source: [23, 28.16], finalFrameHoldSeconds: 2.84},
    {view: 'Grafana lower dashboard', output: [8, 20], source: [28.4, 33.2], finalFrameHoldSeconds: 7.2},
    {view: 'Hubble UI', outputStart: 20, source: [37.32, 47.08], speed: 1},
  ]},
  denial: {durationSeconds: duration(denial), view: 'Terminal only', source: [0, 19.8]},
  note: 'Reading holds repeat original UI frames. No telemetry values, verdicts, or timestamps were changed. The denial recording ends before Grafana and does not show recovery.',
};
await fs.writeFile(path.join(output, 'presentation-edits.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest));
