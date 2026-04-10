import csv
import json
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
CATALOG_DIR = ROOT_DIR / 'catalog_schemas_description'
TABLE_DESCRIPTION_FILE = CATALOG_DIR / 'mv_table_description_csv.csv'
TABLE_COLUMNS_FILE = CATALOG_DIR / 'mv_table_columns_description_csv.csv'
FUNCTIONS_FILE = CATALOG_DIR / 'functions_defined.csv'
OUTPUT_FILE = CATALOG_DIR / 'genie_knowledge_store.json'
SEMANTIC_LAYER_OUTPUT = ROOT_DIR / 'semantic_layer_api' / 'catalogs' / 'genie_knowledge_store.json'


def load_tables() -> dict[str, dict]:
    tables: dict[str, dict] = {}

    with TABLE_DESCRIPTION_FILE.open('r', encoding='utf-8', newline='') as file_handle:
        for row in csv.DictReader(file_handle):
            full_name = '.'.join([row['table_catalog'], row['table_schema'], row['table_name']])
            tables[full_name] = {
                'catalog': row['table_catalog'],
                'schema': row['table_schema'],
                'name': row['table_name'],
                'full_name': full_name,
                'type': row.get('table_type') or '',
                'description': row.get('comment') or '',
                'columns': [],
            }

    with TABLE_COLUMNS_FILE.open('r', encoding='utf-8', newline='') as file_handle:
        for row in csv.DictReader(file_handle):
            full_name = '.'.join([row['table_catalog'], row['table_schema'], row['table_name']])
            if full_name not in tables:
                tables[full_name] = {
                    'catalog': row['table_catalog'],
                    'schema': row['table_schema'],
                    'name': row['table_name'],
                    'full_name': full_name,
                    'type': '',
                    'description': '',
                    'columns': [],
                }

            tables[full_name]['columns'].append({
                'name': row['column_name'],
                'ordinal_position': int(row['ordinal_position']) if row['ordinal_position'] else None,
                'data_type': row.get('data_type') or '',
                'description': row.get('comment') or '',
            })

    for table in tables.values():
        table['columns'].sort(key=lambda column: (column['ordinal_position'] is None, column['ordinal_position']))

    return tables


def _split_columns(inner: str) -> list[str]:
    """Split column definitions on commas, respecting parenthesized types like DECIMAL(38,2)."""
    parts: list[str] = []
    depth = 0
    current: list[str] = []
    for char in inner:
        if char == '(':
            depth += 1
            current.append(char)
        elif char == ')':
            depth -= 1
            current.append(char)
        elif char == ',' and depth == 0:
            parts.append(''.join(current).strip())
            current = []
        else:
            current.append(char)
    remainder = ''.join(current).strip()
    if remainder:
        parts.append(remainder)
    return parts


def _parse_return_columns(full_data_type: str) -> list[dict]:
    """Parse TABLE_TYPE full_data_type like '(col1 STRING, col2 DECIMAL(38,2))' into column dicts."""
    text = full_data_type.strip()
    if not (text.startswith('(') and text.endswith(')')):
        return []
    inner = text[1:-1]
    columns: list[dict] = []
    for part in _split_columns(inner):
        if not part:
            continue
        # Split on first space: "col_name DATA_TYPE(...)"
        tokens = part.split(None, 1)
        if len(tokens) == 2:
            columns.append({'name': tokens[0], 'data_type': tokens[1]})
    return columns


def load_functions() -> list[dict]:
    functions: list[dict] = []

    with FUNCTIONS_FILE.open('r', encoding='utf-8', newline='') as file_handle:
        for row in csv.DictReader(file_handle):
            full_name = '.'.join([row['routine_catalog'], row['routine_schema'], row['routine_name']])
            data_type = row.get('data_type') or ''
            func: dict = {
                'catalog': row['routine_catalog'],
                'schema': row['routine_schema'],
                'name': row['routine_name'],
                'full_name': full_name,
                'type': row.get('routine_type') or '',
                'return_type': data_type,
                'language': row.get('routine_body') or '',
                'definition': row.get('routine_definition') or '',
                'description': row.get('comment') or '',
                'created': row.get('created') or '',
                'last_altered': row.get('last_altered') or '',
            }
            if data_type == 'TABLE_TYPE':
                return_cols = _parse_return_columns(row.get('full_data_type') or '')
                if return_cols:
                    func['return_columns'] = return_cols
            functions.append(func)

    return functions


def generate_knowledge_store() -> dict:
    tables = load_tables()
    functions = load_functions()

    return {
        'source': 'catalog_schemas_description',
        'table_count': len(tables),
        'function_count': len(functions),
        'tables': list(tables.values()),
        'functions': functions,
    }


def main() -> None:
    knowledge_store = generate_knowledge_store()
    content = json.dumps(knowledge_store, ensure_ascii=False, indent=2)
    for path in (OUTPUT_FILE, SEMANTIC_LAYER_OUTPUT):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf-8')
        print(path)
    print(f"tables={knowledge_store['table_count']} functions={knowledge_store['function_count']}")


if __name__ == '__main__':
    main()