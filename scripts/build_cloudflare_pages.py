#!/usr/bin/env python3
"""Build a Cloudflare Pages directory while omitting unsupported large assets."""

import os
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist"
MAX_ASSET_SIZE = 25 * 1024 * 1024
MAX_ASSET_COUNT = 20_000
ROOT_ONLY_EXCLUDES = {
    ".github",
    ".netlify",
    ".wrangler",
    "db",
    "dist",
    "download",
    "node_modules",
    "out",
    "scripts",
    "tests",
    "upload",
    "_site",
}
EXCLUDED_FILES = {
    ".gitignore",
    "Caddyfile",
    "KEYS.json",
    "LICENSE",
    "MOVING.md",
    "README.md",
}


def main():
    if OUTPUT.is_symlink() or OUTPUT.resolve() != (ROOT / "dist").resolve():
        raise RuntimeError(f"Refusing to build to unexpected output path: {OUTPUT}")

    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    OUTPUT.mkdir()

    uploaded_files = 0
    uploaded_bytes = 0
    omitted_files = 0

    for directory, subdirectories, filenames in os.walk(ROOT):
        source_directory = Path(directory)
        relative_directory = source_directory.relative_to(ROOT)

        subdirectories[:] = [
            name
            for name in subdirectories
            if name != ".git"
            and not (
                relative_directory == Path(".") and name in ROOT_ONLY_EXCLUDES
            )
        ]

        for filename in filenames:
            source = source_directory / filename
            relative_path = source.relative_to(ROOT)

            if filename in EXCLUDED_FILES or filename.startswith(".env"):
                continue
            if source.is_symlink():
                continue

            size = source.stat().st_size
            if size > MAX_ASSET_SIZE:
                omitted_files += 1
                print(
                    f"Skipping over-limit asset ({size / 1024 / 1024:.1f} MiB): "
                    f"{relative_path}"
                )
                continue

            destination = OUTPUT / relative_path
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
            uploaded_files += 1
            uploaded_bytes += size

    if uploaded_files > MAX_ASSET_COUNT:
        raise RuntimeError(
            f"Cloudflare Pages supports at most {MAX_ASSET_COUNT} assets; "
            f"the build contains {uploaded_files}."
        )

    print(
        f"Prepared {uploaded_files} Pages assets "
        f"({uploaded_bytes / 1024 / 1024:.1f} MiB); "
        f"omitted {omitted_files} over-limit assets."
    )


if __name__ == "__main__":
    main()
