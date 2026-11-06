// Desktop build only: replaces the in-browser Tailwind CDN compiler. Colours read the CSS variables set by src/themes.js.
const K = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const scale = p => Object.fromEntries(K.map(k => [k, `rgb(var(--${p}${k}) / <alpha-value>)`]));
module.exports = {
  content: ["./index.html", "./src/**/*.js"],
  darkMode: "class",
  theme: { extend: { colors: { slate: scale("n"), violet: scale("a") }, fontFamily: { sans: ["Figtree", "system-ui", "sans-serif"], mono: ['"Spline Sans Mono"', "ui-monospace", "Menlo", "monospace"] } } },
};
