interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS: { keys: string[]; action: string }[] = [
  { keys: ["Space"], action: "Play / Pause" },
  { keys: ["Ctrl", "K"], action: "Focus Search (or /)" },
  { keys: ["←", "→"], action: "Seek -5s / +5s" },
  { keys: ["↑", "↓"], action: "Volume Up / Down" },
  { keys: ["M"], action: "Mute / Unmute" },
  { keys: ["N", "P"], action: "Next / Previous Track" },
  { keys: ["S"], action: "Toggle Shuffle" },
  { keys: ["R"], action: "Cycle Repeat (Off / All / One)" },
  { keys: ["L"], action: "Like / Unlike Current Track" },
  { keys: ["Q"], action: "Toggle Queue & Library Drawer" },
  { keys: ["H"], action: "Toggle Home / Now Playing" },
  { keys: ["?"], action: "Show / Hide Shortcuts" },
  { keys: ["Esc"], action: "Close Modals & Dropdowns" },
];

export default function ShortcutsModal({ open, onClose }: ShortcutsModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div className="relative z-10 w-full max-w-md rounded-[28px] border border-white/15 bg-[#121218]/95 backdrop-blur-3xl shadow-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-white/80">keyboard</span>
            <h3 className="text-lg font-bold text-white">Keyboard Shortcuts</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="space-y-2 max-h-[60vh] overflow-y-auto custom-scrollbar pr-1">
          {SHORTCUTS.map((item) => (
            <div
              key={item.action}
              className="flex items-center justify-between gap-4 py-1.5 px-2 rounded-xl hover:bg-white/5"
            >
              <span className="text-xs text-white/75">{item.action}</span>
              <div className="flex items-center gap-1 shrink-0">
                {item.keys.map((k) => (
                  <kbd
                    key={k}
                    className="px-2 py-0.5 rounded-md bg-white/10 border border-white/15 text-[11px] font-mono text-white/90"
                  >
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
