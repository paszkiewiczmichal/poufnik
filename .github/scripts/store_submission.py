"""One-off: inspect (and optionally commit) the pending Microsoft Store submission.

MODE=check prints what the pending submission contains. MODE=commit also commits it,
which sends it to certification, and waits for the package to be processed.
"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request

APP_ID = "9P6ZLK40V3LL"
API = "https://manage.devcenter.microsoft.com/v1.0/my"


def token() -> str:
    body = urllib.parse.urlencode(
        {
            "grant_type": "client_credentials",
            "client_id": os.environ["CLIENT_ID"],
            "client_secret": os.environ["CLIENT_SECRET"],
            "resource": "https://manage.devcenter.microsoft.com",
        }
    ).encode()
    url = f"https://login.microsoftonline.com/{os.environ['TENANT_ID']}/oauth2/token"
    with urllib.request.urlopen(urllib.request.Request(url, data=body)) as r:
        return json.load(r)["access_token"]


def call(tok: str, method: str, path: str) -> dict:
    req = urllib.request.Request(f"{API}{path}", method=method, headers={"Authorization": f"Bearer {tok}"})
    if method == "POST":
        req.data = b""
    with urllib.request.urlopen(req) as r:
        raw = r.read()
        return json.loads(raw) if raw else {}


def summary(sub: dict) -> None:
    print("status:", sub.get("status"), json.dumps(sub.get("statusDetails"), ensure_ascii=False))
    for p in sub.get("applicationPackages", []):
        print("package:", p.get("fileName"), p.get("fileStatus"), p.get("version"))
    for lang, listing in sub.get("listings", {}).items():
        b = listing.get("baseListing", {})
        print(f"--- listing {lang}")
        print("  title:", b.get("title"))
        print("  description:", (b.get("description") or "")[:90].replace("\n", " "))
        print("  shortDescription:", (b.get("shortDescription") or "")[:60])
        print("  features:", len(b.get("features") or []), "keywords:", b.get("keywords"))
        print("  releaseNotes:", (b.get("releaseNotes") or "")[:40].replace("\n", " "))
        for img in b.get("images", []):
            print("  image:", img.get("imageType"), img.get("fileName"), img.get("fileStatus"), (img.get("description") or "")[:40])
    print("trailers:", len(sub.get("trailers") or []))


def main() -> int:
    tok = token()
    app = call(tok, "GET", f"/applications/{APP_ID}")
    pending = app.get("pendingApplicationSubmission")
    if not pending:
        print("No pending submission.")
        return 1
    sid = pending["id"]
    print("pending submission:", sid)
    sub = call(tok, "GET", f"/applications/{APP_ID}/submissions/{sid}")
    summary(sub)
    if os.environ.get("MODE") != "commit":
        return 0
    print("Committing...")
    call(tok, "POST", f"/applications/{APP_ID}/submissions/{sid}/commit")
    for _ in range(90):
        time.sleep(20)
        st = call(tok, "GET", f"/applications/{APP_ID}/submissions/{sid}/status")
        print("status:", st.get("status"), json.dumps(st.get("statusDetails"), ensure_ascii=False)[:400])
        if st.get("status") not in ("CommitStarted",):
            break
    final = call(tok, "GET", f"/applications/{APP_ID}/submissions/{sid}")
    summary(final)
    return 0 if final.get("status") not in ("CommitFailed",) else 1


if __name__ == "__main__":
    sys.exit(main())
