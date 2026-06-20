from pathlib import Path

from scripts.start_manager import main


if __name__ == "__main__":
  raise SystemExit(main(root_dir=Path(__file__).resolve().parent))
