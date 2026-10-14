#!/usr/bin/env python3
"""Import selected public Instagram posts with Instaloader, without login.

Install requirements-scraper.txt in the repository's .venv, then run this file.
Instagram can refuse anonymous requests. Such refusals keep the previous feed
intact; this collector never loads sessions, cookies, credentials or proxies.
"""

from __future__ import annotations

import argparse
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
import io
from itertools import islice
import json
from pathlib import Path
import re
import shutil
import tempfile
import time
from typing import Callable
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
USERNAME = re.compile(r"(?!\.+$)[a-z0-9_.]{1,30}\Z")
SHORTCODE = re.compile(r"[A-Za-z0-9_-]{5,64}\Z")
MEDIA_EXTENSION = {".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov"}
VIDEO_EXTENSION = {".mp4", ".mov"}


class PrivateProfile(Exception):
    """The collector only imports public profiles."""


def canonical_permalink(value: str) -> str:
    """Accept only Instagram post links; remove queries, fragments and userinfo."""
    parsed = urlsplit(value)
    if parsed.scheme != "https" or parsed.netloc not in {"instagram.com", "www.instagram.com"}:
        raise ValueError("Invalid Instagram post URL")
    match = re.fullmatch(r"/(p|reel|reels|tv)/([A-Za-z0-9_-]{5,64})/?", parsed.path)
    if not match:
        raise ValueError("Invalid Instagram post URL")
    route = "reel" if match[1] in {"reel", "reels"} else "p"
    return f"https://www.instagram.com/{route}/{match[2]}/"


def safe_error(exc: Exception) -> dict[str, str]:
    """Classify failures without returning exception text, cookies or URLs."""
    name = type(exc).__name__
    message = str(exc).lower()
    if isinstance(exc, PrivateProfile):
        return {"code": "private_profile", "message": "Perfil privado; coleta ignorada."}
    if "429" in message or name == "TooManyRequestsException":
        return {"code": "rate_limited", "message": "Instagram limitou as requisições; aguarde uma nova execução."}
    if name in {"LoginRequiredException", "LoginException", "BadCredentialsException", "TwoFactorAuthRequiredException"} or any(term in message for term in ("login_required", "challenge_required", "checkpoint_required", "401", "403")):
        return {"code": "access_required", "message": "Instagram exige autenticação ou restringiu o acesso público."}
    if name in {"ProfileNotExistsException", "QueryReturnedNotFoundException"}:
        return {"code": "not_found", "message": "Perfil ou publicação indisponível."}
    if name in {"TimeoutError", "ConnectionException", "ConnectionError"}:
        return {"code": "connection_failed", "message": "Não foi possível conectar ao Instagram."}
    return {"code": "import_failed", "message": "Não foi possível importar esta fonte nesta execução."}


def load_sources(path: Path) -> list[str]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("The source file must contain a JSON array")
    sources = []
    for item in payload:
        username = str(item.get("username", "")).lower() if isinstance(item, dict) else ""
        if not USERNAME.fullmatch(username):
            raise ValueError("The source file contains an invalid username")
        if username not in sources:
            sources.append(username)
    return sources


def local_media_url(value: object) -> str | None:
    if not isinstance(value, str) or "?" in value or "#" in value or "\\" in value:
        return None
    parts = value.split("/")
    if len(parts) != 5 or parts[:3] != ["", "media", "instagram"]:
        return None
    if not USERNAME.fullmatch(parts[3]) or not re.fullmatch(r"[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|mp4|mov)", parts[4]):
        return None
    return value


def clean_record(record: dict) -> dict:
    """Publish only the feed contract, with canonical links and local media."""
    username = record.get("source", "")
    if not isinstance(username, str) or not USERNAME.fullmatch(username):
        raise ValueError("Invalid record source")
    permalink = canonical_permalink(record["permalink"])
    shortcode = permalink.rstrip("/").split("/")[-1]
    kind = record.get("kind")
    if kind not in {"video", "image", "carousel"}:
        raise ValueError("Invalid record kind")
    media = []
    for item in record.get("media", []):
        url = local_media_url(item.get("url")) if isinstance(item, dict) else None
        if url and item.get("kind") in {"video", "image"}:
            entry = {"kind": item["kind"], "url": url, "filename": url.rsplit("/", 1)[-1]}
            thumbnail = local_media_url(item.get("thumbnailUrl"))
            if thumbnail:
                entry["thumbnailUrl"] = thumbnail
            media.append(entry)
    clean = {
        "id": f"instagram-{shortcode}", "source": username, "permalink": permalink,
        "title": str(record.get("title", f"Publicação de @{username}"))[:120],
        "excerpt": str(record.get("excerpt", ""))[:280],
        "publishedAt": str(record.get("publishedAt", "")), "kind": kind,
        "mediaUrl": local_media_url(record.get("mediaUrl")),
        "thumbnailUrl": local_media_url(record.get("thumbnailUrl")),
        "downloadUrl": local_media_url(record.get("downloadUrl")), "media": media,
    }
    tags = [tag[:50] for tag in record.get("tags", []) if isinstance(tag, str) and re.fullmatch(r"\w{1,50}", tag)]
    if tags:
        clean["tags"] = list(dict.fromkeys(tags))[:10]
    return clean


def read_previous(path: Path) -> list[dict]:
    if not path.exists():
        return []
    records = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(records, list):
        raise ValueError("The existing feed must contain a JSON array")
    # An invalid previous manifest fails before any network request or rewrite.
    return [clean_record(record) for record in records]


def write_json_atomic(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False) as output:
        temporary = Path(output.name)
        json.dump(value, output, ensure_ascii=False, indent=2)
        output.write("\n")
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def publish_media(cache_root: Path, media_root: Path, username: str, shortcode: str, *, max_file_bytes: int, remaining_bytes: int) -> tuple[list[dict], int]:
    """Copy only downloaded media, keeping temporary metadata outside the site."""
    if not USERNAME.fullmatch(username) or not SHORTCODE.fullmatch(shortcode):
        raise ValueError("Invalid media identity")
    cache = cache_root / username
    files = sorted((file for file in cache.glob(f"{shortcode}*.*") if file.is_file() and file.suffix.lower() in MEDIA_EXTENSION and re.fullmatch(re.escape(shortcode) + r"(?:_\d+)?\.(jpg|jpeg|png|webp|mp4|mov)", file.name)), key=lambda file: (int(re.search(r"_(\d+)$", file.stem)[1]) if re.search(r"_(\d+)$", file.stem) and file.stem != shortcode else 0, file.name))
    copied: dict[str, str] = {}
    used = 0
    for file in files:
        size = file.stat().st_size
        if size <= 0 or size > max_file_bytes or used + size > remaining_bytes:
            continue
        destination = media_root / username / file.name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(file, destination)
        copied[file.name] = f"/media/instagram/{username}/{file.name}"
        used += size
    # Pair a video's jpg preview with its mp4 rather than listing the preview twice.
    video_stems = {Path(name).stem for name in copied if Path(name).suffix in VIDEO_EXTENSION}
    media = []
    for name, url in copied.items():
        stem, extension = Path(name).stem, Path(name).suffix
        if extension not in VIDEO_EXTENSION and stem in video_stems:
            continue
        entry = {"kind": "video" if extension in VIDEO_EXTENSION else "image", "url": url, "filename": name}
        thumbnail = next((copied.get(stem + ext) for ext in (".jpg", ".jpeg", ".png", ".webp") if copied.get(stem + ext)), None)
        if thumbnail:
            entry["thumbnailUrl"] = thumbnail
        media.append(entry)
    return media, used


def profile_media(profile: object, max_posts: int, max_reels: int):
    """Read explicitly bounded Reels and posts, without duplicating a shortcode."""
    seen = set()
    for method, limit, is_reel in ((profile.get_reels, max_reels, True), (profile.get_posts, max_posts, False)):
        if not limit:
            continue
        for post in islice(method(), limit):
            shortcode = str(post.shortcode)
            if shortcode not in seen:
                seen.add(shortcode)
                yield post, is_reel


def post_record(post: object, username: str, media: list[dict], *, is_reel: bool = False) -> dict:
    shortcode = str(post.shortcode)
    if not SHORTCODE.fullmatch(shortcode):
        raise ValueError("Invalid post shortcode")
    caption = str(post.caption or "").strip()
    first_line = next((line.strip() for line in caption.splitlines() if line.strip()), f"Publicação de @{username}")
    kind = "carousel" if post.typename == "GraphSidecar" else "video" if post.is_video else "image"
    if kind == "video":
        media = [item for item in media if item["kind"] == "video"]
    primary = media[0] if media else None
    thumbnail = (primary.get("thumbnailUrl") or (primary["url"] if primary["kind"] == "image" else None)) if primary else None
    date = post.date_utc
    date = date.replace(tzinfo=timezone.utc) if date.tzinfo is None else date.astimezone(timezone.utc)
    return clean_record({
        "source": username, "permalink": f"https://www.instagram.com/{'reel' if is_reel else 'p'}/{shortcode}/",
        "title": first_line, "excerpt": caption, "publishedAt": date.isoformat().replace("+00:00", "Z"),
        "kind": kind, "mediaUrl": primary["url"] if primary else None,
        "thumbnailUrl": thumbnail, "downloadUrl": primary["url"] if primary else None,
        "media": media, "tags": re.findall(r"#(\w+)", caption),
    })


def run_collection(sources: list[str], previous: list[dict], collector: Callable[[str, Callable[[dict], None]], None], *, backoff_seconds: float = 30, profile_delay: float = 8, sleep: Callable[[float], None] = time.sleep) -> tuple[list[dict], list[dict]]:
    """A single host-wide retry respects 429 and retains all successful records."""
    records = {record["id"]: dict(record) for record in previous}
    report = []
    halted = False
    for username in sources:
        if halted:
            report.append({"source": username, "status": "not_attempted", "importedCount": 0, "errors": []})
            continue
        imported: set[str] = set()
        errors = []
        status = "ok"

        def emit(record: dict) -> None:
            clean = clean_record(record)
            # Failed media downloads must not erase a usable prior download.
            old = records.get(clean["id"])
            if old and not clean["media"] and old.get("media"):
                for field in ("media", "mediaUrl", "thumbnailUrl", "downloadUrl"):
                    clean[field] = old[field]
            records[clean["id"]] = clean
            imported.add(clean["id"])

        for attempt in range(2):
            try:
                collector(username, emit)
                break
            except Exception as exc:
                error = safe_error(exc)
                errors.append(error)
                if error["code"] == "rate_limited" and attempt == 0:
                    sleep(backoff_seconds)
                    continue
                status = error["code"]
                if status in {"rate_limited", "access_required"}:
                    halted = True
                break
        report.append({"source": username, "status": status, "importedCount": len(imported), "errors": errors})
        if not halted and username != sources[-1]:
            sleep(profile_delay)
    feed = sorted(records.values(), key=lambda record: (record.get("publishedAt", ""), record["id"]), reverse=True)
    return feed, report


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", type=Path, default=ROOT / "src/data/sources.json")
    parser.add_argument("--output", type=Path, default=ROOT / "src/data/instagram-posts.json")
    parser.add_argument("--report", type=Path, default=ROOT / "data/instagram-import-report.json")
    parser.add_argument("--cache-root", type=Path, default=ROOT / ".cache/instagram")
    parser.add_argument("--media-root", type=Path, default=ROOT / "public/media/instagram")
    parser.add_argument("--max-posts", type=int, default=5)
    parser.add_argument("--max-reels", type=int, default=5)
    parser.add_argument("--backoff-seconds", type=float, default=30)
    parser.add_argument("--profile-delay", type=float, default=8)
    parser.add_argument("--max-file-mb", type=int, default=80)
    parser.add_argument("--max-total-mb", type=int, default=250)
    args = parser.parse_args()
    if not 0 <= args.max_posts <= 100 or not 0 <= args.max_reels <= 100 or args.max_posts + args.max_reels == 0 or not 1 <= args.backoff_seconds <= 60 or not 0 <= args.profile_delay <= 60 or args.max_file_mb < 1 or args.max_total_mb < 1:
        parser.error("Use 0–100 posts/reels (at least one enabled), 1–60 seconds backoff, 0–60 seconds profile delay, and positive size limits")
    return args


def main() -> int:
    args = arguments()
    try:
        sources = load_sources(args.sources)
        previous = read_previous(args.output)
    except (OSError, ValueError, KeyError, TypeError):
        print("Configuração ou manifesto inválido; nenhum arquivo alterado.")
        return 2
    try:
        import instaloader
    except ImportError:
        print("Instale requirements-scraper.txt no ambiente virtual deste repositório.")
        return 2
    started = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    loader = instaloader.Instaloader(
        dirname_pattern=str(args.cache_root / "{target}"), filename_pattern="{shortcode}",
        quiet=True, save_metadata=False, post_metadata_txt_pattern="",
        download_comments=False, max_connection_attempts=1, request_timeout=20,
        fatal_status_codes=[400, 401, 403, 429], iphone_support=False,
    )
    remaining_bytes = args.max_total_mb * 1024 * 1024

    def collect(username: str, emit: Callable[[dict], None]) -> None:
        nonlocal remaining_bytes
        # Library error output may contain signed CDN URLs. Discard it entirely.
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            profile = instaloader.Profile.from_username(loader.context, username)
            if profile.is_private:
                raise PrivateProfile()
            for post, is_reel in profile_media(profile, args.max_posts, args.max_reels):
                shortcode = str(post.shortcode)
                if not SHORTCODE.fullmatch(shortcode):
                    continue
                # The source label represents the author, including collaborator posts.
                author = str(post.owner_username).lower()
                if author not in sources:
                    continue
                loader.download_post(post, target=username)
                media, used = publish_media(args.cache_root, args.media_root, username, shortcode, max_file_bytes=args.max_file_mb * 1024 * 1024, remaining_bytes=remaining_bytes)
                remaining_bytes -= used
                emit(post_record(post, author, media, is_reel=is_reel))

    try:
        feed, profiles = run_collection(sources, previous, collect, backoff_seconds=args.backoff_seconds, profile_delay=args.profile_delay)
    finally:
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            loader.close()
    write_json_atomic(args.output, feed)
    write_json_atomic(args.report, {
        "startedAt": started,
        "finishedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "provider": "instaloader", "version": instaloader.__version__, "authenticated": False,
        "maxPostsPerProfile": args.max_posts, "maxReelsPerProfile": args.max_reels,
        "recordsInFeed": len(feed), "profiles": profiles,
    })
    for profile in profiles:
        print(f"@{profile['source']}: {profile['status']} ({profile['importedCount']} publicações)")
    print(f"Feed preservado com {len(feed)} publicações.")
    return 0 if all(profile["status"] == "ok" for profile in profiles) else 1


if __name__ == "__main__":
    raise SystemExit(main())
