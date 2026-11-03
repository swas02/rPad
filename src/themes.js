// Colour themes. Each theme sets the neutral scale (`n`, used as Tailwind "slate") and the accent scale (`a`, used as "violet").
// Light/dark mode is separate (Settings > Appearance); every theme works in both.
// To add a theme: add an entry to THEMES. Give explicit scales, or just a hue (+ optional saturation) and they are generated.
(function () {
  const K = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
  const hsl = (h, s, l) => { s /= 100; l /= 100; const a = s * Math.min(l, 1 - l), f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)) }; return [f(0), f(8), f(4)].map(x => Math.round(x * 255)) };
  const gen = (h, S, L) => Object.fromEntries(K.map((k, i) => [k, hsl(h, S[i], L[i])]));
  const hex = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [1, 3, 5].map(i => parseInt(v.slice(i, i + 2), 16))]));
  const NL = [98, 96, 92, 85, 66, 45, 32, 24, 16, 11, 5], NS = [30, 35, 30, 25, 20, 19, 22, 24, 28, 32, 40];
  const AL = [97, 94, 87, 77, 66, 56, 48, 40, 33, 27, 18], AS = [90, 88, 86, 85, 84, 83, 82, 78, 74, 70, 70];
  const fam = (name, nh, ah, ns = 1) => ({ name, n: gen(nh, NS.map(x => x * ns), NL), a: gen(ah, AS, AL) });

  const THEMES = {
    violet: {
      name: "Violet",
      n: hex({ 50: "#f9f8fc", 100: "#f4f1f9", 200: "#e7e2f0", 300: "#d3cbe1", 400: "#a194b8", 500: "#72648b", 600: "#534769", 700: "#3f3355", 800: "#291e3b", 900: "#190f2a", 950: "#0a0217" }),
      a: hex({ 50: "#f5f3ff", 100: "#ede9fe", 200: "#ddd6fe", 300: "#c4b5fd", 400: "#a78bfa", 500: "#8b5cf6", 600: "#7c3aed", 700: "#6d28d9", 800: "#5b21b6", 900: "#4c1d95", 950: "#2e1065" })
    },
    ocean: fam("Ocean", 215, 217),
    forest: fam("Forest", 150, 152),
    rose: fam("Rose", 340, 346),
    amber: fam("Amber", 35, 32),
    graphite: fam("Graphite", 220, 190, 0.15)
  };

  const rgb = c => c.join(" ");
  const cur = id => THEMES[id] || THEMES.violet;

  // Writes the palette into CSS variables. Tailwind colours and the few hand-written styles read these.
  function applyPalette(id) {
    const t = cur(id), r = document.documentElement.style;
    K.forEach(k => { r.setProperty("--n" + k, rgb(t.n[k])); r.setProperty("--a" + k, rgb(t.a[k])) });
  }
  const scale = p => Object.fromEntries(K.map(k => [k, `rgb(var(--${p}${k}) / <alpha-value>)`]));
  const hexOf = c => "#" + c.map(x => x.toString(16).padStart(2, "0")).join("");

  window.THEMES = THEMES;
  window.themeColors = { slate: scale("n"), violet: scale("a") };
  window.applyPalette = applyPalette;
  window.paletteHex = (id, k) => hexOf(cur(id).n[k]);
  window.accentHex = (id, k) => hexOf(cur(id).a[k]);
  applyPalette((function () { try { return JSON.parse(localStorage.getItem("sp-m1")).pal } catch (e) { } })());
})();
