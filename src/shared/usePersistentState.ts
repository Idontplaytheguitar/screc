import { useEffect, useState } from "react";

/**
 * localStorage-backed state, kept in sync across windows: the settings window
 * and the recorder widget share these keys, and `storage` events (fired in
 * every window except the writer) propagate changes live.
 */
export function usePersistentState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [key, state]);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key || e.newValue == null) return;
      try {
        setState(JSON.parse(e.newValue) as T);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);
  return [state, setState];
}
