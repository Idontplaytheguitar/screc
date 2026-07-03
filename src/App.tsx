import { useEffect, useState } from "react";
import { Editor } from "@/views/Editor";
import { Widget } from "@/views/Widget";
import { RegionSelector } from "@/views/RegionSelector";
import { RecorderSettings } from "@/views/RecorderSettings";

function route() {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash.startsWith("editor")) return "editor";
  if (hash.startsWith("region")) return "region";
  if (hash.startsWith("settings")) return "settings";
  return "widget";
}

export default function App() {
  const [r, setR] = useState(route());

  useEffect(() => {
    const onHash = () => setR(route());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.body.classList.add("dark");
    // Overlay windows (widget/region) must have a transparent body so the
    // frameless window chrome shows through; the editor keeps its bg.
    const isOverlay = r === "widget" || r === "region" || r === "settings";
    document.body.style.background = isOverlay ? "transparent" : "";
    document.documentElement.style.background = isOverlay ? "transparent" : "";
  }, [r]);

  if (r === "widget") return <Widget />;
  if (r === "region") return <RegionSelector />;
  if (r === "settings") return <RecorderSettings />;

  return (
    <div className="h-full w-full flex flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
      <Editor />
    </div>
  );
}
