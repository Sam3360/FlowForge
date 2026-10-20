"""PyInstaller entry point (a frozen exe cannot use `python -m`)."""
import sys

from flowforge_engine.protocol import main

if __name__ == "__main__":
    sys.exit(main())
