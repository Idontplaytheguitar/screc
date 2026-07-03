import { convertFileSrc } from "@tauri-apps/api/core";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Convert a local filesystem path to a URL the webview can load (asset protocol). */
export function fileUrl(path: string): string {
  if (!path) return "";
  if (/^https?:\/\//.test(path)) return path;
  return convertFileSrc(path);
}

export function formatTime(seconds: number, withMs = false): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);
  const pad = (n: number, l = 2) => n.toString().padStart(l, "0");
  const base = h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return withMs ? `${base}.${pad(ms, 3)}` : base;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
