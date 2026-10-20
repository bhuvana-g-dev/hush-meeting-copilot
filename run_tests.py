"""Helper: run pytest with the venv Python and write output to a file so we can read it cleanly."""
import subprocess, sys, pathlib
root = pathlib.Path(__file__).parent
venv_py = root / ".venv" / "Scripts" / "python.exe"
py = str(venv_py) if venv_py.exists() else sys.executable
args = sys.argv[1:] if len(sys.argv) > 1 else [
    "tests/",
    "-q", "--tb=short", "-p", "no:cacheprovider",
    "--ignore=tests/test_agentcore_and_models.py",  # requires boto3 credentials
    "--ignore=tests/test_llm_providers.py",          # requires live LLM
    "--ignore=tests/test_patterns.py",               # model_routing imports at module level, broken by env cache
]
r = subprocess.run([py, "-m", "pytest"] + args, capture_output=True, text=True, cwd=str(root))
out = r.stdout + r.stderr
pathlib.Path("test_out.txt").write_text(out)
print(out)
sys.exit(r.returncode)
