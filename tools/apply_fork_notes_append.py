"""Append the 2026-08-08 session section to docs/FORK_NOTES.md, once.

Run from the repo root:  python tools/apply_fork_notes_append.py
Idempotent: a second run detects the section and changes nothing.
"""
import os, sys

MARKER = "## Notes from the books-and-cards session, 2026-08-08"
NOTES = os.path.join("docs", "FORK_NOTES.md")
APPEND = os.path.join("tools", "fork_notes_append.md")

def main():
    if not os.path.exists(NOTES):
        sys.exit(f"not found: {NOTES}. Run from the repo root.")
    body = open(NOTES, encoding="utf-8").read()
    if MARKER in body:
        print("already applied, nothing to do")
        return
    section = open(APPEND, encoding="utf-8").read()
    if MARKER not in section:
        sys.exit("the append file is damaged: marker missing")
    if not body.endswith("\n"):
        body += "\n"
    open(NOTES, "w", encoding="utf-8").write(body + section)
    print(f"appended: {MARKER}")

if __name__ == "__main__":
    main()
