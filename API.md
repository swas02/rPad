# rPad APIs

rPad is a plain-text notepad. This file lists every interface a script, the OS or the page can use.

## 1. Command line (Open API)

| Command | Result |
|---|---|
| `rpad <path>...` | Opens each file in place. A folder joins the Library and is selected (like "Open folder"). |
| `rpad` | Starts rPad, or focuses the running window. |
| `rpad <file>:<line>[:<col>]` | Opens the file and puts the cursor on the line (and column). |
| `rpad -n`, `rpad --new` | Opens a new empty note. |
| `rpad -w <path>`, `rpad --new-window <path>` | Starts a new rPad process (its own window) and opens the paths there. It does not use the running window. |
| `rpad -` | Opens a new note with the text from stdin: `type a.txt \| rpad -`. |
| `rpad -V`, `rpad --version` | Prints the version. |
| `rpad -h`, `rpad --help` | Prints the help. |

- A path can be relative (to the folder where you run the command) or absolute.
- A path that does not exist is skipped without a message.
- Any other argument that starts with `-` is ignored, so later versions can add options.
- If rPad is already open, the paths go to the running window. No second window opens (single-instance).
- A folder gives access to its files, not its subfolders. A file gives access to its folder.
- `rpad` works in a terminal when the install folder is on `PATH`. The installer adds it (`src-tauri/installer-hooks.nsh`); open a new terminal after the install.

### Windows shell

`tauri.conf.json` sets file associations (`bundle.fileAssociations`) for: txt, text, log, md, markdown, csv, ini, cfg, conf, json, yml, yaml.
This lists rPad in "Open with". Double-click and "Open with" use the same Open API as the command line. It takes effect from an installer build.

## 2. Rust commands

Called from the page with `invoke`. Source: `src-tauri/src/lib.rs`.

| Command | Arguments | Result |
|---|---|---|
| `caption` | `color` ("#rrggbb") | Paints the native title bar. |
| `pick_files` | none | Shows the Open file dialog. Returns full paths. The folders of the picked files get access. |
| `history_add` | `path` (array of parts) | Adds a closed file to `history.json`. |
| `history_remove` | `path?` | Removes one entry, or all entries when no path is given. |
| `take_open` | none | Returns and clears the items waiting from the Open API: `{ kind: "file" \| "folder", path, line?, col? }`, `{ kind: "new" }` or `{ kind: "text", text }`. |

## 3. Events

| Event | Sent by | Meaning |
|---|---|---|
| `open-paths` | Rust | New paths are waiting. The page calls `take_open`. |

## 4. JS wrapper (`window.TauriAPI`)

Source: `src/tauri.js`.

| Name | Use |
|---|---|
| `title(s)` | Window title (also taskbar and Alt+Tab). |
| `caption(color)` | Title bar colour. |
| `reveal()` | Shows the window (it starts hidden). |
| `pin(on)` | Keep on top. |
| `pickFiles()` | Open file dialog. |
| `logClosed(path)`, `unlogClosed(path?)` | Write or remove History entries. |
| `onOpen(cb)` | `cb([item])` (items as in `take_open`) for the items of this start and each later start. |
| `fs`, `dialog` (`open`, `ask`), `path` (`join`), `opener` (`revealItemInDir`), `os` (`platform`) | Tauri plugin wrappers. |

## 5. Tauri plugins and permissions

Plugins: dialog, fs, persisted-scope, opener, os, single-instance (first).
Permissions are in `src-tauri/capabilities/default.json`. The fs scope starts empty. Only folders the user picks, or paths given to the Open API, are added.

## 6. Text actions (`src/textops.js`)

| Export | Keys |
|---|---|
| `LINES` | `in`, `out`, `e` |
| `INSERT` | `c`, `x`, `b`, `n`, `d`, `q`, `h` |
| `CLEAN` | `join`, `plain`, `trim`, `blank`, `sort`, `dedupe`, `lo`, `up`, `ti`, `se` |
| Helpers | `continueList`, `markOf`, `LRE`, `title` |

Plain text only. There are no rich-text styles.

## 7. Editor engine (`src/editor.js`, built to `editor.js`)

Methods: `goto(line, col)`, `dom`, `measure`, `hasFocus`, `text`, `open`, `keepOnly`, `set`, `remeasure`, `undo`, `selectAll`, `selText`, `replaceSel`, `select`, `sel`, `format`, `cleanup`.
Callbacks: `onText`, `onSelect`, `onFind`.

## 8. Themes (`src/themes.js`, on `window`)

`THEMES`, `themeColors`, `applyPalette`, `paletteHex`, `accentHex`, `bootDone`.
