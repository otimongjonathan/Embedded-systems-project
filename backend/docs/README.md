# Report and Documentation

| Path | Contents |
|------|----------|
| `CoCIS_Smart_System_Report.docx` | The group report |
| `openapi.json` | API specification (import into Postman) |
| `diagrams/` | Architecture, use case, ER, sequence, IR counter and wiring diagrams, with generator scripts |
| `screenshots/` | Screenshots of Wokwi, the dashboard, Swagger UI and the virtual ESP32 |
| `build_report.js`, `postprocess_report.py` | Rebuild the report from source |

## Editing

Editing the .docx in Word is fine. After editing, right-click the table of contents and choose
**Update Field**, then **Update entire table** (same for the lists of figures and tables).

## Rebuilding from source (macOS or Linux)

```bash
NODE_PATH=$(npm root -g) node docs/build_report.js && python3 docs/postprocess_report.py
```

Needs Node.js with the `docx` package, LibreOffice and Poppler. This overwrites edits made in Word.
The post-processor refuses to finish if an em or en dash appears.

Diagrams: `python3 docs/diagrams/make_<name>.py`, then `rsvg-convert` to PNG.
Terminal images: `python3 docs/diagrams/make_terminals.py`.
