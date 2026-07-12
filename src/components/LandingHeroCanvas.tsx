import { useEffect, useState } from "react";

export type LandingPointerState = { x: number; y: number };

function useLightTheme(): boolean {
  const [light, setLight] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setLight(!root.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return light;
}

export function LandingHeroCanvas({
  pointer,
  reduced,
}: {
  pointer: LandingPointerState;
  reduced: boolean;
}) {
  const light = useLightTheme();
  const x = reduced ? 0 : pointer.x * 10;
  const y = reduced ? 0 : pointer.y * 7;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <img
        src="/hero-signal-wave.png"
        alt=""
        draggable={false}
        className={
          "landing-signal-art absolute inset-0 h-full w-full select-none object-cover object-center " +
          (light ? "landing-signal-art-light" : "")
        }
        style={{ transform: `translate3d(${x}px, ${y}px, 0) scale(1.035)` }}
      />
    </div>
  );
}
