import { ThemePreset } from "../types/music";

export interface ThemePalette {
  id: ThemePreset;
  label: string;
  colors: string[];
  accent: string;
}

export const THEME_PALETTES: Record<Exclude<ThemePreset, "dynamic">, ThemePalette> = {
  obsidian: {
    id: "obsidian",
    label: "Obsidian",
    colors: ["#262626", "#141414", "#080808"],
    accent: "#e5e5e5",
  },
  aurora: {
    id: "aurora",
    label: "Aurora",
    colors: ["#3b82f6", "#a855f7", "#ec4899"],
    accent: "#a855f7",
  },
  sunset: {
    id: "sunset",
    label: "Sunset",
    colors: ["#f97316", "#e11d48", "#eab308"],
    accent: "#fb7185",
  },
  ocean: {
    id: "ocean",
    label: "Ocean",
    colors: ["#06b6d4", "#2563eb", "#0f766e"],
    accent: "#38bdf8",
  },
  emerald: {
    id: "emerald",
    label: "Emerald",
    colors: ["#10b981", "#14b8a6", "#064e3b"],
    accent: "#34d399",
  },
};

export const THEME_LIST: { id: ThemePreset; label: string; swatch: string }[] = [
  { id: "dynamic", label: "Dynamic Art", swatch: "linear-gradient(135deg, #38bdf8, #a855f7, #f43f5e)" },
  { id: "obsidian", label: "Obsidian", swatch: "linear-gradient(135deg, #404040, #171717)" },
  { id: "aurora", label: "Aurora", swatch: "linear-gradient(135deg, #3b82f6, #a855f7, #ec4899)" },
  { id: "sunset", label: "Sunset", swatch: "linear-gradient(135deg, #f97316, #e11d48)" },
  { id: "ocean", label: "Ocean", swatch: "linear-gradient(135deg, #06b6d4, #2563eb)" },
  { id: "emerald", label: "Emerald", swatch: "linear-gradient(135deg, #10b981, #064e3b)" },
];

const FALLBACK_PALETTES = [
  { colors: ["#2563eb", "#7c3aed", "#0f172a"], accent: "#60a5fa" },
  { colors: ["#db2777", "#9333ea", "#1e1b4b"], accent: "#f472b6" },
  { colors: ["#059669", "#0284c7", "#064e3b"], accent: "#34d399" },
  { colors: ["#ea580c", "#dc2626", "#27120b"], accent: "#fb923c" },
  { colors: ["#4f46e5", "#06b6d4", "#0f172a"], accent: "#818cf8" },
];

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    "#" +
    [clamp(r), clamp(g), clamp(b)]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      case bn:
        h = (rn - gn) / d + 4;
        break;
    }
    h /= 6;
  }
  return [h * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hn = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, hn + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, hn) * 255),
    Math.round(hue2rgb(p, q, hn - 1 / 3) * 255),
  ];
}

export async function extractColorsFromImage(
  imageUrl: string,
  fallbackKey: string
): Promise<{ colors: string[]; accent: string }> {
  const deterministic = FALLBACK_PALETTES[hashString(fallbackKey || imageUrl) % FALLBACK_PALETTES.length];
  if (!imageUrl || typeof document === "undefined") {
    return deterministic;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    let settled = false;
    const finish = (val: { colors: string[]; accent: string }) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    const timer = window.setTimeout(() => finish(deterministic), 2500);

    img.onload = () => {
      window.clearTimeout(timer);
      try {
        const size = 32;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return finish(deterministic);

        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;

        const buckets = new Map<number, { r: number; g: number; b: number; weight: number }>();

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          if (a < 128) continue;

          const [h, s, l] = rgbToHsl(r, g, b);
          if (l < 0.08 || l > 0.92) continue;

          const hueBucket = Math.floor(h / 30); // 12 hue buckets
          const weight = 0.25 + s * 2.2 * (1 - Math.abs(l - 0.5));
          const existing = buckets.get(hueBucket) || { r: 0, g: 0, b: 0, weight: 0 };
          existing.r += r * weight;
          existing.g += g * weight;
          existing.b += b * weight;
          existing.weight += weight;
          buckets.set(hueBucket, existing);
        }

        const sorted = [...buckets.values()]
          .filter((b) => b.weight > 0)
          .sort((a, b) => b.weight - a.weight);

        if (sorted.length === 0) return finish(deterministic);

        const picked = sorted.slice(0, 3).map((b) => {
          const r = b.r / b.weight;
          const g = b.g / b.weight;
          const bl = b.b / b.weight;
          const [h, s, l] = rgbToHsl(r, g, bl);
          // Clamp luminance for rich dark-mode background shader colors
          const clampedL = Math.max(0.24, Math.min(0.54, l));
          const boostedS = Math.max(0.35, Math.min(0.88, s * 1.15));
          const [nr, ng, nb] = hslToRgb(h, boostedS, clampedL);
          return rgbToHex(nr, ng, nb);
        });

        while (picked.length < 3) {
          picked.push(deterministic.colors[picked.length]);
        }

        const top = sorted[0];
        const [ah, as] = rgbToHsl(top.r / top.weight, top.g / top.weight, top.b / top.weight);
        const [ar, ag, ab] = hslToRgb(ah, Math.max(0.55, Math.min(0.95, as * 1.2)), 0.65);

        finish({
          colors: picked,
          accent: rgbToHex(ar, ag, ab),
        });
      } catch {
        finish(deterministic);
      }
    };

    img.onerror = () => {
      window.clearTimeout(timer);
      finish(deterministic);
    };

    img.src = imageUrl;
  });
}
