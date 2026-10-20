"""Create .venv and install kit requirements (offline: only strands-agents core + pytest + httpx)."""
import subprocess, sys, pathlib, shutil

root = pathlib.Path(__file__).parent
venv = root / ".venv"
venv_py = venv / "Scripts" / "python.exe"

# create venv
if not venv_py.exists():
    print("Creating .venv ...")
    subprocess.run([sys.executable, "-m", "venv", str(venv)], check=True)

# install only what the tests need
pkgs = [
    "strands-agents[openai]>=1.60.0",
    "boto3>=1.35",
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "pyyaml>=6",
    "pytest>=8",
    "httpx>=0.27",
]
print("Installing packages (this may take a minute) ...")
subprocess.run([str(venv_py), "-m", "pip", "install", "-q", "--upgrade", "pip"], check=True)
r = subprocess.run([str(venv_py), "-m", "pip", "install", "-q"] + pkgs,
                   capture_output=True, text=True)
if r.returncode != 0:
    print(r.stdout[-2000:])
    print(r.stderr[-2000:])
    sys.exit(r.returncode)
print("Done.")
