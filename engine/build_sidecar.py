"""Build the engine as a Tauri sidecar for the CURRENT platform.

    pip install -e ".[dev]" && python build_sidecar.py

Output: ../app/src-tauri/binaries/flowforge-engine-<rust-target-triple>[.exe]
PyInstaller does not cross-compile: a Windows sidecar must be built on Windows.
"""
from __future__ import annotations

import platform
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "app" / "src-tauri" / "binaries"


def target_triple() -> str:
    try:
        for line in subprocess.check_output(["rustc", "-vV"], text=True).splitlines():
            if line.startswith("host:"):
                return line.split(":", 1)[1].strip()
    except (OSError, subprocess.CalledProcessError):
        pass
    m = platform.machine().lower()
    arch = "aarch64" if m in ("arm64", "aarch64") else "x86_64"
    return {"win32": f"{arch}-pc-windows-msvc", "darwin": f"{arch}-apple-darwin"}.get(sys.platform, f"{arch}-unknown-linux-gnu")


def main() -> None:
    build = HERE / "build-pyinstaller"
    subprocess.check_call([sys.executable, "-m", "PyInstaller", "--onefile", "--noconfirm", "--clean", "--name", "flowforge-engine",
                           "--paths", str(HERE), "--distpath", str(build / "dist"), "--workpath", str(build / "work"),
                           "--specpath", str(build), str(HERE / "sidecar_entry.py")], cwd=HERE)
    exe = "flowforge-engine.exe" if sys.platform == "win32" else "flowforge-engine"
    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / (f"flowforge-engine-{target_triple()}" + (".exe" if sys.platform == "win32" else ""))
    shutil.copy2(build / "dist" / exe, dest)
    print(dest)


if __name__ == "__main__":
    main()
