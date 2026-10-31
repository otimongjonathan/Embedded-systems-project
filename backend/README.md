# Smart Control and Monitoring System: Database and API

Embedded Systems coursework (BSE III and CS II, 2026/2027). This folder holds the
use cases, architecture, central database, REST API and the group report.

## Folder layout

| Path | Contents |
|------|----------|
| `database/schema.sql`, `database/seed.sql` | SQLite schema and demo data |
| `api/` | FastAPI REST API (device endpoints for the ESP32, management endpoints for staff) |
| `tests/test_api.py` | 14 automated tests |
| `docs/openapi.json` | API specification, importable into Postman |
| `docs/diagrams/` | Use case, architecture, IR counter, ER and sequence diagrams (SVG + PNG, with generator scripts) |

## Run the API

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn api.main:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000/docs to try every endpoint. Demo login: `admin` / `Admin@CoCIS2026`.
ESP32 device key: `esp32-demo-key-change-me`. Change both before any real use.

## Run the tests

```bash
.venv/bin/python -m pytest -q tests
```

## Rebuild the report

Editing the .docx directly in Word is fine. To regenerate it from source instead
(this overwrites manual edits):

```bash
NODE_PATH=$(npm root -g) node docs/build_report.js && python3 docs/postprocess_report.py
```

The post-processor needs LibreOffice and Poppler, and stops if an em or en dash appears in the text.
