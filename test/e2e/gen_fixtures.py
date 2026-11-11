#!/usr/bin/env python3
"""Builds ./fixtures for the rPad break-it suite.
Everything here must be extractable on Windows (no reserved names, no ':' or trailing dots).
Nasty things that Windows Explorer/zip cannot hold (reserved names, long paths, locks,
ADS, junction loops) are created at run time by Run-RpadTests.ps1.
"""
import os, sys, unicodedata, random

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
root = os.path.abspath(root)


def w(rel, data, mode="wb"):
    p = os.path.join(root, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    if isinstance(data, str):
        data = data.encode("utf-8")
    with open(p, "wb") as f:
        f.write(data)


def d(rel):
    os.makedirs(os.path.join(root, rel), exist_ok=True)


random.seed(1234)

# ---- basics -------------------------------------------------------------
w("hello.txt", "hello rPad\r\n")
w("empty.txt", b"")
w("lines100.txt", "".join("line %03d  the quick brown fox\r\n" % i for i in range(1, 101)))
w("nolastnl.txt", "first\r\nsecond\r\nthird-no-newline")
w("tabs_unicode.txt",
  "line 1 plain\r\n"
  "\u65e5\u672c\u8a9e\u65e5\u672c\u8a9eABC\r\n"          # line 2: 3-byte chars
  "\u00e9\u00e9\u00e9\u00e9\u00e9XYZ\r\n"                 # line 3: 2-byte chars
  "\U0001F600\U0001F600\U0001F600ABC\r\n"                # line 4: surrogate pairs
  "\tTAB\tTAB\tTAB end\r\n"                               # line 5: tabs
  "e\u0301e\u0301e\u0301 combining\r\n")                  # line 6: combining marks

# ---- encodings / line endings (each contains known text) -----------------
text = "Gr\u00fc\u00dfe \u00e9\u00e0 caf\u00e9\n"
cp_text = "Gr\u00fc\u00dfe \u00e9\u00e0 caf\u00e9\n"
uni_text = "Gr\u00fc\u00dfe \u65e5\u672c\u8a9e \U0001F600\n"
w("enc/utf8_bom.txt", b"\xef\xbb\xbf" + uni_text.encode("utf-8"))
w("enc/utf8_nobom.txt", uni_text.encode("utf-8"))
w("enc/utf16le.txt", b"\xff\xfe" + uni_text.encode("utf-16-le"))
w("enc/utf16be.txt", b"\xfe\xff" + uni_text.encode("utf-16-be"))
w("enc/cp1252.txt", cp_text.encode("cp1252"))
w("enc/invalid_utf8.txt", b"valid start \xff\xfe\xc3\x28 broken \xe2\x82 end\n")
w("enc/crlf.txt", "a\r\nb\r\nc\r\n")
w("enc/lf.txt", "a\nb\nc\n")
w("enc/cr.txt", "a\rb\rc\r")
w("enc/mixed_eol.txt", "a\r\nb\nc\rd\r\n\n\re\n")
w("enc/bom_only.txt", b"\xef\xbb\xbf")
w("enc/utf16_odd_length.txt", b"\xff\xfe" + "abc".encode("utf-16-le") + b"\x41")  # truncated code unit
w("enc/bom_in_middle.txt", b"abc\xef\xbb\xbfdef\n")
w("enc/utf16_lone_surrogate.txt", b"\xff\xfe" + b"a\x00\x00\xd8b\x00\n\x00")
w("enc/utf8_overlong_and_cesu.bin", b"\xc0\xaf \xed\xa0\x80\xed\xb0\x80 \xf4\x90\x80\x80\n")

# ---- binary / odd content ------------------------------------------------
w("bin/binary.bin", bytes(random.getrandbits(8) for _ in range(4096)))
w("bin/all_bytes.bin", bytes(range(256)) * 16)
w("bin/nul_middle.txt", b"before\x00\x00\x00after\r\nsecond line\r\n")
w("bin/nul_flood_1mb.txt", b"\x00" * (1024 * 1024))
w("bin/ctrl_z.txt", b"before\x1aafter\r\n")
w("bin/fake.png", b"\x89PNG\r\n\x1a\n" + os.urandom(2000))
w("bin/fake_exe.txt", b"MZ" + os.urandom(1000))

# ---- hostile text content -----------------------------------------------
w("hostile/ansi_escapes.txt", "\x1b[31mRED\x1b[0m \x1b]0;pwned title\x07 \x1b[2J\x1b[H end\r\n")
w("hostile/bidi_content.txt", "invoice \u202etxt.exe\u202c \u2066isolate\u2069 end\r\n")
w("hostile/zero_width.txt", "a\u200bb\u200cc\u200dd\u2060e\ufeff\r\n")
w("hostile/combining_flood.txt", "e" + "\u0301" * 200000 + "\r\n")
w("hostile/long_line_5mb.txt", ("x" * 5 * 1024 * 1024) + "\r\n")
w("hostile/blank_lines_200k.txt", "\r\n" * 200000)
w("hostile/format_strings.txt", "%s %s %n %x {0} {1} ${env:USERNAME} $(calc) `calc` %PATH% %%\r\n")
w("hostile/path_like_content.txt", "\\\\192.0.2.1\\share\\x.txt\r\nC:\\Windows\\win.ini\r\nfile:///C:/Windows/win.ini\r\n")
w("hostile/html_script.txt", "<script>alert(1)</script><img src=x onerror=alert(2)>\r\n")
w("hostile/many_tabs_chars.txt", "\t" * 100000 + "end\r\n")

# ---- file names ----------------------------------------------------------
names = [
    "\u65e5\u672c\u8a9e.txt", "\u00fcn\u00ef.txt", "\u00e9moji\U0001F600.txt",
    "has space.txt", "a b  c.txt", "a&b.txt", "100%.txt", "semi;colon.txt",
    "comma,name.txt", "hash#name.txt", "bang!.txt", "apos'.txt", "brackets[1].txt",
    "caret^name.txt", "paren(1).txt", "plus+eq=name.txt", "at@name.txt", "tilde~1.txt",
    "v1.2.3", "no_extension", ".dotfile", "\uff26\uff35\uff2c\uff2c.txt", "\ufb01ligature.txt",
    "\u0639\u0631\u0628\u064a.txt", "\u05e2\u05d1\u05e8\u05d9\u05ea.txt", "\ud55c\uad6d\uc5b4.txt",
    "zero\u200bwidth.txt", "nfc_\u00e9.txt",
    unicodedata.normalize("NFD", "nfd_\u00e9.txt"),
    "report_2024-01-02T03-04-05.txt", "UPPER.TXT", "MiXeD.TxT",
    "x" * 200 + ".txt",
    "evil\u202egnp.exe",           # right-to-left override: displays as evil exe.png reversed
]
for n in names:
    w("names/" + n, "I am the file named: %r\r\nMARKER-NAMES\r\n" % n)

# names that look like options or like file:line
for n in ["-n", "--new", "-", "-V", "--version", "-h", "--help", "-nn", "---x"]:
    w("optlike/" + n, "I am a FILE named %s (not an option)\r\n" % n)
w("numeric/12", "file named 12\r\n")
w("numeric/7", "file named 7\r\n")
w("numeric/notes", "line1\r\nline2\r\nline3\r\nline4\r\nline5\r\nline6\r\n")
w("numeric/a.txt", "".join("a-line %d\r\n" % i for i in range(1, 11)))

# ---- same name in two folders (wrong-file tests) -------------------------
w("same_name/x/a.txt", "X-MARKER\r\n")
w("same_name/y/a.txt", "Y-MARKER\r\n")
w("same_name/z/A.TXT", "Z-MARKER (upper-case name)\r\n")

# ---- small tree (folder tests) ------------------------------------------
w("tree/a.txt", "tree a\r\n")
w("tree/sub1/b.txt", "tree b\r\n")
w("tree/sub1/sub2/c.txt", "tree c\r\n")
w("tree/sub1/sub2/sub3/d.txt", "tree d\r\n")
w("tree/\u65e5\u672c/\u00fc.txt", "tree unicode\r\n")
d("tree/empty_dir")
d("tree/dir with space")
w("tree/dir with space/file.txt", "x\r\n")

# ---- canary: files nobody asked rPad to touch ----------------------------
w("canary/neighbor.txt", "I am the only file the test names.\r\n")
w("canary/secret.txt", "SECRET-CANARY-7731 rPad must never read, copy, or store this.\r\n")
w("canary/neighbor.txt.bak", "pre-existing backup, must stay untouched\r\n")
w("canary/neighbor.txt~", "pre-existing tilde file, must stay untouched\r\n")
w("canary/.neighbor.txt.swp", "pre-existing swap file, must stay untouched\r\n")

print("fixtures written to", root)
