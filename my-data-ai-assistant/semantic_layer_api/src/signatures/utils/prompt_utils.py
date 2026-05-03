from pathlib import Path

SIGNATURES_PATH = Path(__file__).resolve().parent.parent

def load_genui_catalog_developer_prompt() -> str:
    genui_catalog_path = SIGNATURES_PATH / "genui_spec" / "genui_catalog_prompt.md"

    with genui_catalog_path.open("r", encoding="utf-8") as f:
        prompt = f.read()
    return prompt

def load_controller_agent_developer_prompt() -> str:
    controller_agent_prompt_path = SIGNATURES_PATH / "controller_agent" / "controller_agent_prompt.md"

    with controller_agent_prompt_path.open("r", encoding="utf-8") as f:
        prompt = f.read()
    return prompt

def load_rephrase_query_developer_prompt() -> str:
    rephrase_query_prompt_path = SIGNATURES_PATH / "rephrase_query" / "rephrase_query_prompt.md"

    with rephrase_query_prompt_path.open("r", encoding="utf-8") as f:
        prompt = f.read()
    return prompt

def load_query_analysis_developer_prompt() -> str:
    query_analysis_prompt_path = SIGNATURES_PATH / "query_analysis" / "query_analysis_prompt.md"

    with query_analysis_prompt_path.open("r", encoding="utf-8") as f:
        prompt = f.read()
    return prompt

def load_reasoning_summary_developer_prompt() -> str:
    reasoning_summary_prompt_path = SIGNATURES_PATH / "reasoning_summary" / "reasoning_summary_prompt.md"

    with reasoning_summary_prompt_path.open("r", encoding="utf-8") as f:
        prompt = f.read()
    return prompt
