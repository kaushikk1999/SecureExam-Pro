import { cp, mkdir } from "node:fs/promises";
await mkdir("public/monaco", { recursive: true });
await cp("node_modules/monaco-editor/min/vs", "public/monaco/vs", {
  recursive: true,
  force: false,
});
// MediaPipe runtime for the on-device camera detector (served from our own
// origin so the Content-Security-Policy can stay 'self').
await mkdir("public/mediapipe", { recursive: true });
await cp("node_modules/@mediapipe/tasks-vision/wasm", "public/mediapipe/wasm", {
  recursive: true,
  force: true,
});
