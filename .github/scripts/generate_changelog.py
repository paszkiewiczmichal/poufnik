from __future__ import annotations

import argparse
import subprocess
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    previous = previous_tag(args.tag)
    if previous:
        commits = git("log", "--pretty=format:- %s (%h)", f"{previous}..HEAD")
        heading = f"Zmiany od `{previous}`"
    else:
        commits = git("log", "--pretty=format:- %s (%h)", "--max-count=80")
        heading = "Zmiany w tym wydaniu"

    body = commits.strip() or "- Brak commitow do pokazania."
    args.output.write_text(f"## {heading}\n\n{body}\n", encoding="utf-8")


def previous_tag(current: str) -> str | None:
    tags = git("tag", "--sort=-creatordate").splitlines()
    filtered = [tag for tag in tags if tag != current and tag.startswith("v")]
    return filtered[0] if filtered else None


def git(*args: str) -> str:
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout


if __name__ == "__main__":
    main()
