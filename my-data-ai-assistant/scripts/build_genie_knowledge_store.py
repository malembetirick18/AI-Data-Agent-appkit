"""Rebuild semantic_layer_api/catalogs/genie_knowledge_store.json from the
CSV catalog exports located in catalog_schemas_description/.

Source files (required):
  - mv_table_description_csv.csv
  - mv_table_columns_description_csv.csv
  - functions_defined.csv

Output:
  - semantic_layer_api/catalogs/genie_knowledge_store.json

Rules:
  - Table order follows mv_table_description_csv.csv
  - Column order follows ordinal_position ascending within each table
  - Function order follows functions_defined.csv
  - return_columns are parsed from the `data_type` text
    (e.g. "(col1 STRING, col2 INT)" -> [{name, data_type}, ...])
"""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSV_DIR = ROOT / "catalog_schemas_description"
OUT = ROOT / "semantic_layer_api" / "catalogs" / "genie_knowledge_store.json"

TABLES_CSV = CSV_DIR / "mv_table_description_csv.csv"
COLUMNS_CSV = CSV_DIR / "mv_table_columns_description_csv.csv"
FUNCTIONS_CSV = CSV_DIR / "functions_defined.csv"


def _full_name(catalog: str, schema: str, name: str) -> str:
    return f"{catalog}.{schema}.{name}"


def load_tables() -> list[dict]:
    tables: list[dict] = []
    with TABLES_CSV.open("r", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            tables.append(
                {
                    "catalog": row["table_catalog"],
                    "schema": row["table_schema"],
                    "name": row["table_name"],
                    "full_name": _full_name(
                        row["table_catalog"], row["table_schema"], row["table_name"]
                    ),
                    "type": row["table_type"],
                    "description": row["comment"],
                    "columns": [],
                }
            )
    return tables


def attach_columns(tables: list[dict]) -> None:
    index = {t["full_name"]: t for t in tables}
    with COLUMNS_CSV.open("r", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            key = _full_name(
                row["table_catalog"], row["table_schema"], row["table_name"]
            )
            table = index.get(key)
            if table is None:
                continue  # column for an unknown table — skip silently
            table["columns"].append(
                {
                    "name": row["column_name"],
                    "ordinal_position": int(row["ordinal_position"]),
                    "data_type": row["data_type"],
                    "description": row["comment"],
                }
            )
    # Sort columns by ordinal_position for determinism
    for t in tables:
        t["columns"].sort(key=lambda c: c["ordinal_position"])


# Split a "(col STRING, col2 INT, col3 DECIMAL(38,2))" return signature
# into [{"name": col, "data_type": STRING}, ...].
_RETURN_COL_RE = re.compile(
    r"\s*([A-Za-z_][A-Za-z0-9_]*)\s+([A-Z]+(?:\s*\([^)]*\))?)\s*"
)


def parse_return_columns(data_type: str) -> list[dict]:
    if not data_type or not data_type.strip().startswith("("):
        return []
    body = data_type.strip()[1:-1]  # strip outer ()
    # split on commas that are NOT inside parentheses
    parts: list[str] = []
    depth = 0
    buf: list[str] = []
    for ch in body:
        if ch == "(":
            depth += 1
            buf.append(ch)
        elif ch == ")":
            depth -= 1
            buf.append(ch)
        elif ch == "," and depth == 0:
            parts.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    if buf:
        parts.append("".join(buf))

    cols: list[dict] = []
    for part in parts:
        m = _RETURN_COL_RE.fullmatch(part)
        if not m:
            continue
        cols.append(
            {"name": m.group(1), "data_type": re.sub(r"\s+", "", m.group(2))}
        )
    return cols


def load_functions() -> list[dict]:
    functions: list[dict] = []
    with FUNCTIONS_CSV.open("r", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            full_name = _full_name(
                row["routine_catalog"], row["routine_schema"], row["routine_name"]
            )
            functions.append(
                {
                    "catalog": row["routine_catalog"],
                    "schema": row["routine_schema"],
                    "name": row["routine_name"],
                    "full_name": full_name,
                    "type": row["routine_type"],
                    "return_type": row["data_type"],
                    "language": row["external_language"],
                    "definition": row["routine_definition"],
                    "description": row["comment"],
                    "created": row["created"],
                    "last_altered": row["last_altered"],
                    "return_columns": parse_return_columns(row["full_data_type"]),
                }
            )
    return functions


def main() -> None:
    tables = load_tables()
    attach_columns(tables)
    functions = load_functions()

    payload = {
        "source": "catalog_schemas_description",
        "table_count": len(tables),
        "function_count": len(functions),
        "tables": tables,
        "functions": functions,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")

    # Also refresh the mirror copy in catalog_schemas_description/
    mirror = CSV_DIR / "genie_knowledge_store.json"
    with mirror.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(
        f"wrote {OUT} — {payload['table_count']} tables, "
        f"{payload['function_count']} functions"
    )


if __name__ == "__main__":
    main()
