import { useEffect, useRef, useState } from "react";
import { ThemePreset } from "./types/music";
import { THEME_LIST } from "./utils/colors";
import { getSafeWindow, isTauri } from "./utils/tauri";

interface TitleBarProps {
  activeView: "home" | "now-playing";
  onChangeView: (view: "home" | "now-playing") => void;
  hasTrack: boolean;
  theme: ThemePreset;
  onChangeTheme: (theme: ThemePreset) => void;
  showDots: boolean;
  onToggleDots: () => void;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  queueCount: number;
  onOpenShortcuts: () => void;
}

export default function TitleBar({
  activeView,
  onChangeView,
  hasTrack,
  theme,
  onChangeTheme,
  showDots,
  onToggleDots,
  drawerOpen,
  onToggleDrawer,
  queueCount,
  onOpenShortcuts,
}: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const themeMenuRef = useRef<HTMLDivElement>(null);
  const inTauri = isTauri();
  const isMobile =
    typeof navigator !== "undefined" &&
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  useEffect(() => {
    const win = getSafeWindow();
    if (!win) return;

    let unlisten: (() => void) | undefined;
    win.isMaximized().then(setIsMaximized).catch(() => {});
    win
      .onResized(async () => {
        try {
          setIsMaximized(await win.isMaximized());
        } catch {
          // ignore
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (themeMenuRef.current && !themeMenuRef.current.contains(e.target as Node)) {
        setThemeMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const handleMinimize = () => getSafeWindow()?.minimize().catch(() => {});
  const handleToggleMax = async () => {
    const win = getSafeWindow();
    if (!win) return;
    try {
      await win.toggleMaximize();
      setIsMaximized(await win.isMaximized());
    } catch {
      // ignore
    }
  };
  const handleClose = () => getSafeWindow()?.close().catch(() => {});

  return (
    <div
      data-tauri-drag-region
      className="relative shrink-0 h-9 flex justify-between items-center z-50 bg-black/35 backdrop-blur-xl border-b border-white/10 select-none"
    >
      {/* Left Brand + View Toggle */}
      <div className="flex items-center h-full gap-3 px-3 min-w-0">
        <div
          data-tauri-drag-region
          className="text-[11px] font-bold text-white/75 tracking-[0.18em] uppercase h-full flex items-center gap-2 shrink-0"
        >
          <img src="/logo.png" alt="PulsePlay" className="w-4 h-4 object-contain" />
          <span>PulsePlay</span>
        </div>

        {hasTrack && (
          <div className="flex items-center bg-white/5 border border-white/10 rounded-full p-0.5 ml-2">
            <button
              type="button"
              onClick={() => onChangeView("home")}
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-all ${
                activeView === "home"
                  ? "bg-white/15 text-white shadow-sm"
                  : "text-white/55 hover:text-white"
              }`}
            >
              Home
            </button>
            <button
              type="button"
              onClick={() => onChangeView("now-playing")}
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-all ${
                activeView === "now-playing"
                  ? "bg-white/15 text-white shadow-sm"
                  : "text-white/55 hover:text-white"
              }`}
            >
              Now Playing
            </button>
          </div>
        )}
      </div>

      {/* Drag Spacer */}
      <div data-tauri-drag-region className="flex-1 h-full" />

      {/* Right Utility Controls + Window Controls */}
      <div className="flex items-center h-full shrink-0 gap-1 pr-1">
        {/* Theme Picker */}
        <div ref={themeMenuRef} className="relative flex items-center">
          <button
            type="button"
            onClick={() => setThemeMenuOpen((prev) => !prev)}
            className="h-7 px-2.5 rounded-full flex items-center gap-1.5 text-[11px] font-medium text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            title="Ambient Theme"
          >
            <span className="material-symbols-outlined text-[15px]">palette</span>
            <span className="hidden sm:inline capitalize">{theme}</span>
          </button>

          {themeMenuOpen && (
            <div className="absolute right-0 top-9 w-64 rounded-2xl border border-white/15 bg-[#0f1015]/95 backdrop-blur-2xl shadow-[0_24px_64px_rgba(0,0,0,0.8)] p-3 z-[80]">
              <p className="px-1 pb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">
                Appearance
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {THEME_LIST.map((item) => {
                  const active = theme === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onChangeTheme(item.id);
                        setThemeMenuOpen(false);
                      }}
                      className={`h-9 px-2.5 rounded-xl flex items-center gap-2 text-xs transition-all ${
                        active
                          ? "bg-white/15 ring-1 ring-white/25 text-white font-semibold"
                          : "bg-white/[0.04] text-white/75 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      <span
                        className="w-3.5 h-3.5 rounded-full border border-white/25 shrink-0"
                        style={{ background: item.swatch }}
                      />
                      <span className="flex-1 text-left truncate">{item.label}</span>
                      {active && (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          className="w-3.5 h-3.5 text-white shrink-0"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="my-2.5 border-t border-white/10" />

              <button
                type="button"
                onClick={onToggleDots}
                className="w-full h-9 px-2.5 rounded-xl flex items-center justify-between gap-2 text-xs text-white/80 hover:bg-white/8 hover:text-white transition-colors"
              >
                <span className="font-medium">Dot Matrix</span>
                <span
                  className={`w-8 h-4.5 rounded-full p-0.5 flex items-center transition-colors ${
                    showDots ? "bg-white/90 justify-end" : "bg-white/15 justify-start"
                  }`}
                >
                  <span className={`w-3.5 h-3.5 rounded-full transition-colors ${showDots ? "bg-black" : "bg-white/70"}`} />
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Queue / Library Drawer Button */}
        <button
          type="button"
          onClick={onToggleDrawer}
          className={`h-7 px-2.5 rounded-full flex items-center gap-1.5 text-[11px] font-medium transition-colors ${
            drawerOpen
              ? "bg-white/20 text-white"
              : "text-white/70 hover:text-white hover:bg-white/10"
          }`}
          title="Queue & Library (Q)"
        >
          <span className="material-symbols-outlined text-[16px]">queue_music</span>
          <span className="hidden sm:inline">Queue</span>
          {queueCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-white/15 text-[10px] font-mono text-white/90">
              {queueCount}
            </span>
          )}
        </button>

        {/* Keyboard Shortcuts */}
        <button
          type="button"
          onClick={onOpenShortcuts}
          className="w-7 h-7 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          title="Keyboard Shortcuts (?)"
        >
          <span className="material-symbols-outlined text-[16px]">keyboard</span>
        </button>

        {/* Window Controls (Tauri Desktop) */}
        {inTauri && !isMobile && (
          <div className="flex h-full shrink-0 ml-1 border-l border-white/10">
            <button
              type="button"
              onClick={handleMinimize}
              aria-label="Minimize"
              className="w-11 h-full flex items-center justify-center hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
              </svg>
            </button>
            <button
              type="button"
              onClick={handleToggleMax}
              aria-label={isMaximized ? "Restore" : "Maximize"}
              className="w-11 h-full flex items-center justify-center hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            >
              {isMaximized ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V5a2 2 0 012-2h9a2 2 0 012 2v9a2 2 0 01-2 2h-2M5 9h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2v-8a2 2 0 012-2z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              className="w-11 h-full flex items-center justify-center hover:bg-red-500 text-white/60 hover:text-white transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
