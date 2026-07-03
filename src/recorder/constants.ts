export const CODECS = [
  { id: "libx264", label: "H.264" },
  { id: "libx265", label: "H.265" },
  { id: "libaom-av1", label: "AV1" },
  { id: "libvpx-vp9", label: "VP9" },
];
export const CONTAINERS = ["mkv", "mp4", "webm", "mov", "avi"];
export const QUALITY = [
  { id: "high", label: "High", crf: 18 },
  { id: "balanced", label: "Balanced", crf: 22 },
  { id: "efficient", label: "Small file", crf: 26 },
];
export const FPS = [24, 30, 60, 120];
