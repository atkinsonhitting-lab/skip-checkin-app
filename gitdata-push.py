#!/usr/bin/env python3
"""Push the current HEAD commit to GitHub via the Git Data API (single commit).

Usage: gitdata-push.py <owner/repo> [base_ref] [--files f1 f2 ...]
Defaults: base_ref=main, files = files changed in HEAD vs its parent.
Auth: secure custom.github connector via dynamic credential surrogates.
"""
import base64
import json
import subprocess
import sys
import urllib.request

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response

API = "https://api.github.com"
ALLOWED = ("api.github.com",)
CRED = "custom.github"


def api(method, path, payload=None):
    url = API + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    req.add_header("User-Agent", "skip-push-deploy")
    if data:
        req.add_header("Content-Type", "application/json")
    add_surrogate_to_request(req, CRED, allowed_hosts=ALLOWED)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return read_json_response(resp)


def main():
    repo = sys.argv[1] if len(sys.argv) > 1 else "atkinsonhitting-lab/skip-checkin-app"
    ref = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith("--") else "main"
    files = []
    if "--files" in sys.argv:
        files = sys.argv[sys.argv.index("--files") + 1 :]
    if not files:
        out = subprocess.run(
            ["git", "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"],
            capture_output=True, text=True, check=True,
        ).stdout
        files = [f for f in out.splitlines() if f.strip()]
    msg = subprocess.run(
        ["git", "log", "-1", "--format=%B"], capture_output=True, text=True, check=True
    ).stdout.strip()

    head = api("GET", f"/repos/{repo}/git/ref/heads/{ref}")["object"]["sha"]
    base_tree = api("GET", f"/repos/{repo}/git/commits/{head}")["tree"]["sha"]

    tree_entries = []
    for path in files:
        with open(path, "rb") as f:
            content = base64.b64encode(f.read()).decode()
        blob = api("POST", f"/repos/{repo}/git/blobs", {"content": content, "encoding": "base64"})
        tree_entries.append({"path": path, "mode": "100644", "type": "blob", "sha": blob["sha"]})
        print(f"blob {path}: {blob['sha'][:8]}")

    new_tree = api("POST", f"/repos/{repo}/git/trees", {"base_tree": base_tree, "tree": tree_entries})["sha"]
    commit = api("POST", f"/repos/{repo}/git/commits",
                 {"message": msg, "tree": new_tree, "parents": [head]})["sha"]
    api("PATCH", f"/repos/{repo}/git/refs/heads/{ref}", {"sha": commit})
    print(f"pushed {commit[:8]} to {repo}@{ref} ({len(files)} files)")


if __name__ == "__main__":
    main()
