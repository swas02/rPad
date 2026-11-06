// Desktop build only: replaces the in-browser Tailwind CDN compiler. Colours read the CSS variables set by src/themes.js.
const K = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const scale = p => Object.fromEntries(K.map(k => [k, `rgb(var(--${p}${k}) / <alpha-value>)`]));
// Folder colours are built at runtime (`bg-${c}-500`), which the scanner can't see, so safelist them.
const C = ["slate", "blue", "red", "amber", "green", "pink", "violet", "cyan", "orange"];
module.exports = {
  content: ["./index.html", "./src/**/*.js"],
  safelist: C.flatMap(c => [`bg-${c}-500`, `text-${c}-600`, `dark:text-${c}-400`]),
  darkMode: "class",
  theme: { extend: { colors: { slate: scale("n"), violet: scale("a") }, fontFamily: { sans: ["Figtree", "system-ui", "sans-serif"], mono: ['"Spline Sans Mono"', "ui-monospace", "Menlo", "monospace"] } } },
};
