"""Finishing touches on the report after build_report.js:

* writes cached numbers into the SEQ caption fields, so captions read
  'Figure 1', 'Table 2' even before Word refreshes its fields;
* puts paragraph-border elements in the order the OOXML schema requires
  (docx-js writes top, bottom, left, right; Word expects top, left, bottom, right);
* pre-fills the Table of Contents, List of Figures and List of Tables with
  entries and page numbers taken from a LibreOffice rendering, so the lists are
  never empty (Word still refreshes them when the document is opened);
* refuses to finish if an em dash or en dash is found anywhere in the text.

Run after build_report.js:  python3 docs/postprocess_report.py
Needs LibreOffice (soffice) and Poppler (pdftotext) on the PATH."""
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from html import escape, unescape
from pathlib import Path

DOCX = Path(__file__).with_name("CoCIS_Smart_System_Report.docx")
BORDER_ORDER = ["top", "left", "start", "bottom", "right", "end", "between", "bar"]
RIGHT_TAB = 9026  # text width of an A4 page with 1" margins, in twentieths of a point


def read_parts(path):
    with zipfile.ZipFile(path) as z:
        return [(i, z.read(i.filename)) for i in z.infolist()]


def black_styles(styles):
    """docx-js writes its own blue Heading styles and then ours with the same ids.
    Keep only the last definition of each style, and make the remaining text black."""
    blocks = list(re.finditer(r'<w:style [^>]*w:styleId="([^"]+)".*?</w:style>', styles, re.S))
    last = {m.group(1): m.start() for m in blocks}
    for m in reversed(blocks):
        if last[m.group(1)] != m.start():
            styles = styles[:m.start()] + styles[m.end():]
    return re.sub(r'<w:color w:val="[0-9A-Fa-f]{6}"/>', '<w:color w:val="000000"/>', styles)


def write_parts(path, parts, document_xml):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for info, data in parts:
            if info.filename == "word/document.xml":
                data = document_xml.encode()
            elif info.filename == "word/styles.xml":
                data = black_styles(data.decode()).encode()
            z.writestr(info, data)


def number_captions(xml):
    counters = {"Figure": 0, "Table": 0}

    def fill(m):
        counters[m.group(1)] += 1
        return f"{m.group(0)}<w:t>{counters[m.group(1)]}</w:t>"

    xml = re.sub(r'SEQ (Figure|Table)</w:instrText><w:fldChar w:fldCharType="separate"/>', fill, xml)
    return xml, counters


def reorder_borders(xml):
    def fix(m):
        elems = re.findall(r"<w:(\w+) [^>]*/>", m.group(1))
        parts = dict(zip(elems, re.findall(r"<w:\w+ [^>]*/>", m.group(1))))
        return "<w:pBdr>" + "".join(parts[k] for k in BORDER_ORDER if k in parts) + "</w:pBdr>"
    return re.sub(r"<w:pBdr>(.*?)</w:pBdr>", fix, xml)


def para_text(p):
    return unescape("".join(re.findall(r"<w:t(?: [^>]*)?>([^<]*)</w:t>", p)))


def collect_entries(xml):
    """Headings (level 1-3) and captions, in document order."""
    entries = []
    for p in re.findall(r"<w:p>.*?</w:p>|<w:p .*?</w:p>", xml):
        style = re.search(r'<w:pStyle w:val="([^"]+)"/>', p)
        if not style:
            continue
        s = style.group(1)
        if s in ("Heading1", "Heading2", "Heading3"):
            entries.append(("toc", int(s[-1]), para_text(p)))
        elif s == "Caption":
            text = para_text(p)
            entries.append(("Figure" if text.startswith("Figure") else "Table", 0, text))
    return entries


def page_numbers(docx_path, entries):
    """Render to PDF and find the printed page number of each entry."""
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", tmp, str(docx_path)],
                       check=True, capture_output=True)
        pdf = Path(tmp) / (docx_path.stem + ".pdf")
        pages = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], capture_output=True, text=True,
                               check=True).stdout.split("\f")
    norm = [re.sub(r"\s+", " ", p) for p in pages]
    printed = []
    for p in norm:  # body pages carry "Page N of M"; front matter has roman numerals
        m = re.search(r"Page (\d+) of \d+", p)
        printed.append(m.group(1) if m else "")
    roman = ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"]
    for i in range(1, len(printed)):  # page 0 is the cover; front matter follows until "Page 1"
        if printed[i]:
            break
        printed[i] = roman[i] if i < len(roman) else ""
    result, cursor = [], 0
    for kind, level, text in entries:
        key = re.sub(r"\s+", " ", text).strip()[:60]
        found = next((i for i in range(cursor, len(norm)) if key in norm[i]), None)
        if found is None:
            found = next((i for i in range(len(norm)) if key in norm[i]), cursor)
        cursor = max(cursor, found)
        result.append((kind, level, text, printed[found]))
    return result


def entry_xml(text, page, level=1, bold=False):
    indent = {1: 0, 2: 300, 3: 600}[level]
    b = "<w:b/>" if bold else ""
    return (f'<w:p><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="{RIGHT_TAB}"/></w:tabs>'
            f'<w:spacing w:before="{100 if bold else 20}" w:after="20"/><w:ind w:left="{indent}"/></w:pPr>'
            f'<w:r><w:rPr>{b}</w:rPr><w:t xml:space="preserve">{escape(text)}</w:t></w:r>'
            f'<w:r><w:tab/></w:r><w:r><w:rPr>{b}</w:rPr><w:t>{page}</w:t></w:r></w:p>')


def fill_lists(xml, located):
    groups = {
        r'TOC \\h \\o &quot;1-3&quot;': [entry_xml(t, pg, lv, lv == 1) for k, lv, t, pg in located if k == "toc"],
        r'TOC \\c &quot;Figure&quot; \\h': [entry_xml(t, pg) for k, _, t, pg in located if k == "Figure"],
        r'TOC \\c &quot;Table&quot; \\h': [entry_xml(t, pg) for k, _, t, pg in located if k == "Table"],
    }
    for instr, paras in groups.items():
        pattern = (f'({instr}</w:instrText><w:fldChar w:fldCharType="separate"/></w:r></w:p>)'
                   r'(<w:p><w:r><w:fldChar w:fldCharType="end"/>)')
        xml, n = re.subn(pattern, lambda m: m.group(1) + "".join(paras) + m.group(2), xml, count=1)
        if n != 1:
            sys.exit(f"Could not find the field {instr}")
    return xml


parts = read_parts(DOCX)
xml = next(d for i, d in parts if i.filename == "word/document.xml").decode()

dashes = len(re.findall("[\u2013\u2014]", xml))
if dashes:
    sys.exit(f"Found {dashes} em/en dash(es) in the report text; remove them from build_report.js")

xml, counters = number_captions(xml)
xml = reorder_borders(xml)
write_parts(DOCX, parts, xml)                     # numbered version, used for page layout

located = page_numbers(DOCX, collect_entries(xml))
write_parts(DOCX, parts, fill_lists(xml, located))
missing = [t for _, _, t, pg in located if not pg]
print("captions numbered:", counters, "| list entries:", len(located), "| no em or en dashes")
if missing:
    print("entries without a page number:", missing)
