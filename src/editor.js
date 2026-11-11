// The note editor: one CodeMirror 6 view, with one EditorState per tab so each tab keeps its own undo history,
// selection and scroll. Undo/redo, find/replace and the keymap come from CodeMirror's own packages.
// The page talks to this through create(); it never touches CodeMirror directly.
import { EditorState, Compartment, EditorSelection } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, isolateHistory, undo, redo, selectAll } from "@codemirror/commands";
import { search, SearchQuery, setSearchQuery, getSearchQuery, findNext, findPrevious, replaceNext, replaceAll, openSearchPanel, closeSearchPanel, searchPanelOpen } from "@codemirror/search";
import * as T from "./textops.js";

const BIG = 1e5;       // above this many characters, text is copied out of the editor after a 200 ms pause instead of at once
const FIND_MAX = 9999; // the "n/N" counter stops counting here

// the smallest single change that turns `from` into `to` (so the cursor outside the change stays put)
function diff(at, from, to) {
  const m = Math.min(from.length, to.length); let p = 0, q = 0;
  while (p < m && from.charCodeAt(p) === to.charCodeAt(p)) p++;
  while (q < m - p && from.charCodeAt(from.length - 1 - q) === to.charCodeAt(to.length - 1 - q)) q++;
  return { from: at + p, to: at + from.length - q, insert: to.slice(p, to.length - q) };
}

// parent: element to mount in. Callbacks: onText(tabId, text) after the text changed, onSelect() after the cursor moved,
// onFind({on, count, index, more}) when the find counter changes.
export function create({ parent, onText, onSelect, onFind }) {
  // settings that can change while the app runs live in Compartments; `cfg` holds the current values
  const C = { wrap: new Compartment, ln: new Compartment, ro: new Compartment, attrs: new Compartment };
  const cfg = { wrap: true, ln: false, ro: false, sp: true, ac: "on" };
  const parts = () => ({
    wrap: cfg.wrap ? EditorView.lineWrapping : [], ln: cfg.ln ? lineNumbers() : [], ro: EditorState.readOnly.of(cfg.ro),
    attrs: EditorView.contentAttributes.of({ spellcheck: String(cfg.sp), autocorrect: cfg.ac, autocapitalize: cfg.ac === "on" ? "sentences" : "off", "aria-label": "Note" })
  });
  let ver = 0; // bumped on every settings change; a saved state with an older number gets the new settings when its tab opens

  let id = null, view;                     // id: the tab shown now
  const states = new Map(), snaps = new Map(), vers = new Map();
  let pend = null, timer = 0, micro = false;
  const sync = () => { clearTimeout(timer); timer = 0; micro = false; const i = pend; pend = null; if (i != null) onText(i, view.state.doc.toString()) };
  const flush = () => { if (pend != null) sync() };
  // a view update must not start another update, so the page hears about text changes just after it
  const changed = () => { pend = id; if (view.state.doc.length > BIG) { if (!timer) timer = setTimeout(sync, 200) } else if (!micro) { micro = true; queueMicrotask(sync) } };

  // ---- find: the page owns the find bar; CodeMirror owns the matching, highlighting and replacing
  const fq = { search: "", cs: false, replace: "" }; let findOn = false;
  const query = () => new SearchQuery({ search: fq.search, caseSensitive: fq.cs, replace: fq.replace, literal: true });
  const matches = (limit = Infinity) => { const q = getSearchQuery(view.state); if (!q.valid) return []; const sel = view.state.selection.main, o = []; let index = 0; for (const r of q.getCursor(view.state)) { o.push(r); if (r.from === sel.from && r.to === sel.to) index = o.length; if (o.length >= limit) break } o.index = index; return o };
  function findInfo() {
    if (!findOn) return { on: false, count: 0, index: 0 };
    const m = matches(FIND_MAX); return { on: true, count: m.length, index: m.index, more: m.length >= FIND_MAX }
  }
  const reportFind = () => onFind && onFind(findInfo());
  // each saved state has its own search state, so a tab opened while find is showing gets the panel and query again
  function syncFind() {
    if (findOn) { if (!searchPanelOpen(view.state)) openSearchPanel(view); view.dispatch({ effects: setSearchQuery.of(query()) }) }
    else if (searchPanelOpen(view.state)) closeSearchPanel(view)
  }
  // first match at or after `pos`, wrapping round
  function matchFrom(pos) {
    const q = getSearchQuery(view.state); if (!q.valid) return null;
    for (const r of q.getCursor(view.state, pos)) return r;
    for (const r of q.getCursor(view.state, 0, pos)) return r;
    return null
  }
  const show = (a, b) => view.dispatch({ selection: EditorSelection.single(a, b), effects: EditorView.scrollIntoView(a, { y: "center" }), userEvent: "select.search" });
  const find = {
    // a hidden panel is enough: CodeMirror only highlights matches while a search panel is open
    open() { findOn = true; syncFind(); reportFind() },
    close() { findOn = false; syncFind(); reportFind() },
    // p: any of { search, cs, replace }. With jump, go to the first match from the cursor (as you type in the find box)
    set(p, jump) {
      Object.assign(fq, p); if (!findOn) return;
      view.dispatch({ effects: setSearchQuery.of(query()) });
      if (jump) { const m = matchFrom(view.state.selection.main.from); if (m) show(m.from, m.to) }
      reportFind()
    },
    next: () => findNext(view), prev: () => findPrevious(view),
    replace: () => replaceNext(view),
    // returns how many were replaced; one undo step brings them all back
    replaceAll() { const n = matches().length; return n && replaceAll(view) ? n : 0 }
  };

  // ---- editing helpers. Every one is a single transaction, so each is one undo step.
  const doc = () => view.state.doc, sel = () => view.state.selection.main;
  const run = (spec, iso = "full") => view.dispatch({ ...spec, annotations: isolateHistory.of(iso), scrollIntoView: true, userEvent: "input.format" });
  // the whole lines covering the selection (a selection ending just after a line break stops before it)
  function lineSpan() {
    const d = doc(), r = sel(), from = d.lineAt(r.from).from;
    return [from, r.to > r.from && d.sliceString(r.to - 1, r.to) === "\n" ? r.to - 1 : d.lineAt(r.to).to]
  }
  function mapLines(fn) {
    const r = sel(), [ls, le] = lineSpan(), L = doc().sliceString(ls, le).split("\n"), O = fn(L), s = O.join("\n");
    run({ changes: { from: ls, to: le, insert: s }, selection: r.empty ? EditorSelection.cursor(Math.max(ls, r.head + O[0].length - L[0].length)) : EditorSelection.single(ls, ls + s.length) })
  }
  // the selection, or the current line without its list marker when nothing is selected; null if that is empty
  function target(wordOnly) {
    const d = doc(), r = sel(); if (!r.empty) return [r.from, r.to];
    const l = d.lineAt(r.head);
    if (wordOnly) { let x = r.head - l.from, y = x; const t = l.text; while (x > 0 && /\S/.test(t[x - 1])) x--; while (y < t.length && /\S/.test(t[y])) y++; return x === y ? null : [l.from + x, l.from + y] }
    const m = l.text.match(T.LRE), a = l.from + (m ? m[0].length : 0); return a >= l.to ? null : [a, l.to]
  }
  function replaceRange(range, fn) {
    if (!range) return true; const [a, b] = range, o = fn(doc().sliceString(a, b));
    run({ changes: { from: a, to: b, insert: o }, selection: EditorSelection.single(a, a + o.length) }); return true
  }
  function insert(t) {
    view.dispatch(view.state.changeByRange(r => ({ changes: { from: r.from, insert: t }, range: EditorSelection.cursor(r.from + t.length) })), { annotations: isolateHistory.of("before"), scrollIntoView: true, userEvent: "input" }); return true
  }
  // AA: capitals for the selection or the word at the cursor; capitals again turn into Title Case
  const caps = () => replaceRange(target(true), t => t === t.toUpperCase() && t !== t.toLowerCase() ? T.title(t) : t.toUpperCase());

  // ---- keys
  // Enter continues a list item (checkbox, bullet, number, letter, roman, quote); anything else falls through to the normal newline
  function enterList(v) {
    if (cfg.ro) return true;
    const r = v.state.selection.main; if (!r.empty) return false;
    const l = v.state.doc.lineAt(r.head), at = r.head - l.from, e = T.continueList(l.text.slice(0, at), l.text.slice(at), n => v.state.doc.line(n).text, l.number);
    if (!e) return false;
    v.dispatch(e.cut ? { changes: { from: l.from, to: r.head }, selection: { anchor: l.from } } : { changes: { from: r.head, insert: e.insert }, selection: { anchor: r.head + e.insert.length } }, { scrollIntoView: true, userEvent: "input" });
    return true
  }
  // Tab indents a list line or the selected lines (nested bullets change shape); elsewhere it types two spaces. Shift-Tab outdents.
  const tab = out => v => {
    if (cfg.ro) return true;
    if (!out && sel().empty && !T.markOf(v.state.doc.lineAt(sel().head).text)) return insert("  ");
    mapLines(out ? T.LINES.out : T.LINES.in); return true
  };

  const state = doc => EditorState.create({
    doc, extensions: [
      keymap.of([{ key: "Enter", run: enterList }, { key: "Tab", run: tab(false), shift: tab(true) }, ...historyKeymap, ...defaultKeymap]),
      history({ newGroupDelay: 1000, minDepth: 200 }), highlightActiveLine(), highlightActiveLineGutter(),
      search({ createPanel: () => { const dom = document.createElement("div"); dom.hidden = true; return { dom } } }),
      // CodeMirror stops redrawing on scroll once its IntersectionObserver wrongly reports the editor as off-screen (blank page until a click)
      EditorView.domEventHandlers({ scroll: (e, v) => { v.requestMeasure() } }),
      EditorView.updateListener.of(u => {
        if (u.docChanged) changed();
        if (u.docChanged || u.selectionSet) onSelect && onSelect();
        if (findOn && (u.docChanged || u.selectionSet || getSearchQuery(u.state) !== getSearchQuery(u.startState))) reportFind()
      }),
      Object.keys(C).map(k => C[k].of(parts()[k]))
    ]
  });
  view = new EditorView({ parent, state: state("") });

  return {
    dom: view.contentDOM, find,
    get length() { return view.state.doc.length },
    get readOnly() { return cfg.ro },
    // run a layout read/write pair in CodeMirror's measure phase (never read layout inside an update)
    measure: (read, write) => view.requestMeasure({ read, write }),
    hasFocus: () => view.hasFocus, focus: () => view.focus(), blur: () => view.contentDOM.blur(),
    text: () => view.state.doc.toString(), flush,

    // Show the tab `tabId` whose saved text is `text`. Its state (history, cursor, scroll) is kept while its text is unchanged;
    // if the page changed the text behind the editor's back, the tab starts afresh.
    open(tabId, text) {
      flush();
      if (tabId === id) { const d = view.state.doc; if (d.length === text.length && d.toString() === text) return; states.delete(id) }
      else if (id != null) { states.set(id, view.state); snaps.set(id, view.scrollSnapshot()) }
      let s = states.get(tabId); if (s && (s.doc.length !== text.length || s.doc.toString() !== text)) { s = null; snaps.delete(tabId) }
      if (!s) { s = state(text); vers.set(tabId, ver) }
      id = tabId; view.setState(s);
      if (vers.get(id) !== ver) { view.dispatch({ effects: Object.keys(C).map(k => C[k].reconfigure(parts()[k])) }); vers.set(id, ver) }
      syncFind(); const snap = snaps.get(id); if (snap) view.dispatch({ effects: snap });
      onSelect && onSelect(); reportFind()
    },
    // forget the saved states of tabs that are no longer open
    keepOnly(ids) { for (const k of [...states.keys()]) if (!ids.has(k)) { states.delete(k); snaps.delete(k); vers.delete(k) } },

    // p: any of { wrap, ln, readOnly, spellcheck, autocorrect }
    set(p) {
      const k = new Set(), put = (key, name, v) => { if (v !== undefined && v !== cfg[key]) { cfg[key] = v; k.add(name) } };
      put("wrap", "wrap", p.wrap); put("ln", "ln", p.ln); put("ro", "ro", p.readOnly); put("sp", "attrs", p.spellcheck); put("ac", "attrs", p.autocorrect);
      if (!k.size) return; ver++; if (id != null) vers.set(id, ver);
      view.dispatch({ effects: [...k].map(n => C[n].reconfigure(parts()[n])) })
    },

    // re-read font metrics after the page changes the font size or family
    // (flipping line wrapping off and on makes CodeMirror re-measure every line height, which a plain requestMeasure does not)
    remeasure() { view.dispatch({ effects: C.wrap.reconfigure(cfg.wrap ? [] : EditorView.lineWrapping) }); requestAnimationFrame(() => view.dispatch({ effects: C.wrap.reconfigure(parts().wrap) })) },
    undo: () => undo(view), redo: () => redo(view),
    selectAll() { view.focus(); selectAll(view) },
    // the selected text ("" when nothing is selected); replaceSel puts text over the selection or at the cursor, as one undo step
    selText() { const r = sel(); return doc().sliceString(r.from, r.to) },
    replaceSel(t) {
      if (cfg.ro) return false; view.focus();
      view.dispatch(view.state.changeByRange(r => ({ changes: { from: r.from, to: r.to, insert: t }, range: EditorSelection.cursor(r.from + t.length) })), { scrollIntoView: true, userEvent: t ? "input.paste" : "delete.cut" }); return true
    },
    select: show,
    // put the cursor on a line (1 is the first) and column; a number past the end goes to the last line or the end of the line
    goto(line, col = 1) { const d = view.state.doc, l = d.line(Math.min(Math.max(line, 1), d.lines)); show(l.from + Math.min(Math.max(col, 1) - 1, l.length)); view.focus() },
    // { from, to, ln, col } for the status bar
    sel() { const r = sel(), l = doc().lineAt(r.to); return { from: r.from, to: r.to, ln: l.number, col: r.to - l.from + 1 } },

    // a formatting-bar button; true if the key was one of ours
    format(k) {
      if (!(T.INSERT[k] || T.LINES[k] || k === "u")) return false;
      if (cfg.ro) return true;
      if (T.INSERT[k]) return insert(T.INSERT[k]);
      if (T.LINES[k]) { mapLines(T.LINES[k]); return true }
      return caps()
    },
    // a Clean up action on [from, to], or on the whole text; returns the message to show, or null if nothing changed
    cleanup(k, range) {
      const [lines, fn, msg] = T.CLEAN[k]; if (cfg.ro) return null;
      const d = doc(); let [a, b] = range || [0, d.length];
      if (lines) { a = d.lineAt(a).from; b = b > a && d.sliceString(b - 1, b) === "\n" ? b - 1 : d.lineAt(b).to }
      const s = d.sliceString(a, b), o = fn(s); if (o === s) return null;
      const c = diff(a, s, o); run({ changes: c, selection: range ? EditorSelection.single(a, a + o.length) : undefined }); return msg
    }
  };
}
