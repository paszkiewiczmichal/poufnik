"""One-off: prepare and commit the pending Microsoft Store submission for 1.3.0.

MODE=check   prints what the pending submission contains.
MODE=prepare puts the 1.3.0 package, the new Polish listing (texts, screenshots, logos,
             16:9 art) and two trailers into the pending submission and uploads the files.
MODE=commit  commits the submission, which sends it to certification.
"""

import glob
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

APP_ID = "9P6ZLK40V3LL"
API = "https://manage.devcenter.microsoft.com/v1.0/my"
ASSETS = ".github/store-assets"
NEW_TITLE = "Poufnik – anonimizacja dokumentów"

SCREENSHOTS = [
    ("zrzut-1-przeglad.png", "Przejrzyj wykryte dane i zdecyduj, co zostaje"),
    ("zrzut-2-wynik.png", "Dokument gotowy do wysłania do AI, z gotowymi poleceniami"),
    ("zrzut-3-przywracanie.png", "Odpowiedź modelu wraca z prawdziwymi danymi"),
    ("zrzut-4-pdf.png", "Zaczernienie w PDF usuwa dane z pliku, nie tylko je zasłania"),
]
OTHER_IMAGES = [
    ("kafel-1x1-1080.png", "StoreLogoSquare"),
    ("kafel-1x1-300.png", "Icon"),
    ("super-hero-1920x1080.png", "PromotionalArt16x9"),
]
TRAILERS = [
    ("zwiastun-1-anonimizacja-przed-ai.mp4", "zwiastun-1-miniatura.png", "Anonimizacja umowy przed wysłaniem do AI"),
    ("zwiastun-2-skany-i-zdjecia.mp4", "zwiastun-2-miniatura.png", "Skan i zdjęcie dokumentu: OCR na Twoim komputerze"),
]


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


def call(tok: str, method: str, path: str, payload: dict | None = None) -> dict:
    headers = {"Authorization": f"Bearer {tok}"}
    data = None
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    elif method == "POST":
        data = b""
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(f"{API}{path}", data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode("utf-8", "replace")[:2000])
        raise


def summary(sub: dict) -> None:
    print("status:", sub.get("status"), json.dumps(sub.get("statusDetails"), ensure_ascii=False)[:600])
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
    for t in sub.get("trailers") or []:
        print("trailer:", t.get("videoFileName"), json.dumps(t.get("trailerAssets"), ensure_ascii=False)[:200])


def prepare(tok: str, sid: str, sub: dict) -> None:
    bundles = glob.glob("store-package/**/*.msixbundle", recursive=True)
    if len(bundles) != 1:
        raise SystemExit(f"Expected one .msixbundle, found {bundles}")
    bundle = bundles[0]
    bundle_name = os.path.basename(bundle)
    print("bundle:", bundle_name, os.path.getsize(bundle))

    packages = [p for p in sub["applicationPackages"] if p.get("version")]
    for p in packages:
        p["fileStatus"] = "PendingDelete"
    packages.append({"fileName": bundle_name, "fileStatus": "PendingUpload"})
    sub["applicationPackages"] = packages

    texts = json.load(open(f"{ASSETS}/listing.json", encoding="utf-8"))
    base = sub["listings"]["pl-pl"]["baseListing"]
    base["title"] = NEW_TITLE
    base["description"] = texts["desc"]
    base["shortDescription"] = texts["short"]
    base["features"] = texts["features"]
    base["keywords"] = texts["keywords"]
    base["releaseNotes"] = texts["notes"]
    images = []
    for img in base.get("images", []):
        img["fileStatus"] = "PendingDelete"
        images.append(img)
    for name, caption in SCREENSHOTS:
        images.append({"fileName": name, "fileStatus": "PendingUpload", "imageType": "Screenshot", "description": caption})
    for name, kind in OTHER_IMAGES:
        images.append({"fileName": name, "fileStatus": "PendingUpload", "imageType": kind})
    base["images"] = images

    sub["trailers"] = [
        {
            "videoFileName": video,
            "trailerAssets": {"pl-pl": {"title": title, "imageList": [{"fileName": thumb, "description": ""}]}},
        }
        for video, thumb, title in TRAILERS
    ]

    updated = call(tok, "PUT", f"/applications/{APP_ID}/submissions/{sid}", sub)
    upload_url = updated["fileUploadUrl"]

    with zipfile.ZipFile("upload.zip", "w", zipfile.ZIP_STORED, allowZip64=True) as z:
        z.write(bundle, bundle_name)
        names = [n for n, _ in SCREENSHOTS] + [n for n, _ in OTHER_IMAGES]
        names += [v for v, _, _ in TRAILERS] + [t for _, t, _ in TRAILERS]
        for n in names:
            z.write(f"{ASSETS}/{n}", n)
    print("zip:", os.path.getsize("upload.zip"))
    subprocess.run(
        [
            "curl", "--fail-with-body", "-sS", "-X", "PUT", "-T", "upload.zip",
            "-H", "x-ms-blob-type: BlockBlob", "-H", "x-ms-version: 2021-08-06", upload_url,
        ],
        check=True,
    )
    print("upload done")
    summary(call(tok, "GET", f"/applications/{APP_ID}/submissions/{sid}"))


def retry(tok: str, sid: str, sub: dict) -> None:
    """After a failed commit: keep the processed package, re-send the listing files."""
    sub["trailers"] = [
        {
            "videoFileName": video,
            "trailerAssets": {"pl-pl": {"title": title, "imageList": [{"fileName": thumb, "description": ""}]}},
        }
        for video, thumb, title in TRAILERS
    ]
    updated = call(tok, "PUT", f"/applications/{APP_ID}/submissions/{sid}", sub)
    upload_url = updated["fileUploadUrl"]
    with zipfile.ZipFile("upload.zip", "w", zipfile.ZIP_STORED) as z:
        names = [n for n, _ in SCREENSHOTS] + [n for n, _ in OTHER_IMAGES]
        names += [v for v, _, _ in TRAILERS] + [t for _, t, _ in TRAILERS]
        for n in names:
            z.write(f"{ASSETS}/{n}", n)
    print("zip:", os.path.getsize("upload.zip"))
    subprocess.run(
        [
            "curl", "--fail-with-body", "-sS", "-X", "PUT", "-T", "upload.zip",
            "-H", "x-ms-blob-type: BlockBlob", "-H", "x-ms-version: 2021-08-06", upload_url,
        ],
        check=True,
    )
    print("upload done")
    summary(call(tok, "GET", f"/applications/{APP_ID}/submissions/{sid}"))


def commit(tok: str, sid: str) -> int:
    print("Committing...")
    call(tok, "POST", f"/applications/{APP_ID}/submissions/{sid}/commit")
    st = {}
    for _ in range(120):
        time.sleep(20)
        st = call(tok, "GET", f"/applications/{APP_ID}/submissions/{sid}/status")
        print("status:", st.get("status"), json.dumps(st.get("statusDetails"), ensure_ascii=False)[:600])
        if st.get("status") != "CommitStarted":
            break
    summary(call(tok, "GET", f"/applications/{APP_ID}/submissions/{sid}"))
    return 1 if st.get("status") in ("CommitFailed", "CommitStarted") else 0


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
    mode = os.environ.get("MODE", "check")
    if mode == "prepare":
        prepare(tok, sid, sub)
    elif mode == "commit":
        return commit(tok, sid)
    elif mode == "retry":
        retry(tok, sid, sub)
        return commit(tok, sid)
    return 0


if __name__ == "__main__":
    sys.exit(main())
