"""Offline contract tests; never issue requests to Instagram."""

import importlib.util
import json
from datetime import datetime
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest


spec = importlib.util.spec_from_file_location("instagram_collector", Path(__file__).with_name("scrape-instagram.py"))
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


def record(code="ABCdef12345", source="lulaoficial", media=False):
    url = f"/media/instagram/{source}/{code}.mp4"
    return collector.clean_record({
        "source": source, "permalink": f"https://www.instagram.com/p/{code}/",
        "title": "Publicação de teste", "excerpt": "Resumo", "publishedAt": "2026-10-01T12:00:00Z",
        "kind": "video", "mediaUrl": url if media else None,
        "downloadUrl": url if media else None, "thumbnailUrl": None,
        "media": [{"kind": "video", "url": url, "filename": f"{code}.mp4"}] if media else [],
    })


class PublicFeedTests(unittest.TestCase):
    def test_canonical_url_removes_queries_and_rejects_foreign_hosts(self):
        self.assertEqual(collector.canonical_permalink("https://instagram.com/reels/ABCdef12345/?access_token=private-value#part"), "https://www.instagram.com/reel/ABCdef12345/")
        for url in ("https://instagram.com.evil.example/p/ABCdef12345/", "https://name:password@instagram.com/p/ABCdef12345/", "http://instagram.com/p/ABCdef12345/", "https://instagram.com/lulaoficial/", "https://instagram.com/p/../../private/"):
            with self.assertRaises(ValueError):
                collector.canonical_permalink(url)

    def test_error_never_contains_exception_secrets_or_remote_url(self):
        error = collector.safe_error(RuntimeError("429 URL https://example.test?access_token=private-value Cookie: sessionid=secret-session"))
        self.assertEqual(error["code"], "rate_limited")
        output = json.dumps(error)
        for secret in ("private-value", "secret-session", "example.test", "Cookie"):
            self.assertNotIn(secret, output)

    def test_manifest_allows_only_local_media_and_contract_fields(self):
        dirty = record()
        dirty.update({"title": "a" * 200, "excerpt": "b" * 400, "access_token": "private-value", "mediaUrl": "https://cdn.example/video.mp4?token=secret", "downloadUrl": "/media/instagram/../private.mp4", "media": [{"kind": "video", "url": "https://cdn.example/video.mp4"}], "tags": ["brasil", "bad tag", "brasil"]})
        clean = collector.clean_record(dirty)
        self.assertEqual((len(clean["title"]), len(clean["excerpt"])), (120, 280))
        self.assertIsNone(clean["mediaUrl"])
        self.assertIsNone(clean["downloadUrl"])
        self.assertEqual(clean["media"], [])
        self.assertEqual(clean["tags"], ["brasil"])
        self.assertNotIn("access_token", clean)

    def test_rate_limit_retries_once_then_stops_host_and_keeps_success(self):
        old = record("Previous123")
        calls = []
        sleeps = []

        def collect(source, emit):
            calls.append(source)
            emit(record("Imported123", source, media=True))
            raise RuntimeError("429 Too Many Requests")

        feed, report = collector.run_collection(["lulaoficial", "uneoficial"], [old], collect, sleep=sleeps.append)
        self.assertEqual(calls, ["lulaoficial", "lulaoficial"])
        self.assertEqual(sleeps, [30])
        self.assertEqual({entry["id"] for entry in feed}, {"instagram-Previous123", "instagram-Imported123"})
        self.assertEqual(report[0]["status"], "rate_limited")
        self.assertEqual(report[0]["importedCount"], 1)
        self.assertEqual(report[1]["status"], "not_attempted")

    def test_authentication_refusal_stops_without_retry(self):
        calls = []

        def collect(source, emit):
            calls.append(source)
            raise RuntimeError("challenge_required 403 private-value")

        feed, report = collector.run_collection(["lulaoficial", "uneoficial"], [record()], collect, sleep=lambda _: self.fail("must not retry"))
        self.assertEqual(calls, ["lulaoficial"])
        self.assertEqual(len(feed), 1)
        self.assertEqual(report[0]["status"], "access_required")

    def test_failed_new_media_does_not_erase_previous_download(self):
        previous = record(media=True)
        feed, _ = collector.run_collection(["lulaoficial"], [previous], lambda source, emit: emit(record()), sleep=lambda _: None)
        self.assertEqual(feed[0]["downloadUrl"], previous["downloadUrl"])
        self.assertEqual(feed[0]["media"], previous["media"])

    def test_failed_video_does_not_offer_its_jpg_preview_as_video_download(self):
        post = SimpleNamespace(shortcode="ABCdef12345", caption="A video", typename="GraphVideo", is_video=True, date_utc=datetime(2026, 10, 1))
        entry = collector.post_record(post, "lulaoficial", [{"kind": "image", "url": "/media/instagram/lulaoficial/ABCdef12345.jpg", "filename": "ABCdef12345.jpg"}])
        self.assertEqual(entry["kind"], "video")
        self.assertIsNone(entry["mediaUrl"])
        self.assertIsNone(entry["downloadUrl"])

    def test_explicit_reels_and_posts_are_bounded_and_deduplicated(self):
        reels = [SimpleNamespace(shortcode=code) for code in ("ReelCode123", "Shared12345", "ExtraReel12")]
        posts = [SimpleNamespace(shortcode=code) for code in ("Shared12345", "ImageCode12", "ExtraImage1")]
        profile = SimpleNamespace(get_reels=lambda: iter(reels), get_posts=lambda: iter(posts))
        entries = list(collector.profile_media(profile, max_posts=2, max_reels=2))
        self.assertEqual([(post.shortcode, reel) for post, reel in entries], [("ReelCode123", True), ("Shared12345", True), ("ImageCode12", False)])

    def test_disabled_reels_does_not_request_the_reels_edge(self):
        profile = SimpleNamespace(get_reels=lambda: self.fail("Reels must be disabled"), get_posts=lambda: iter([SimpleNamespace(shortcode="ImageCode12")]))
        self.assertEqual(len(list(collector.profile_media(profile, max_posts=1, max_reels=0))), 1)

    def test_reel_record_uses_the_actual_reel_permalink(self):
        post = SimpleNamespace(shortcode="ReelCode123", caption="Reel", typename="GraphVideo", is_video=True, date_utc=datetime(2026, 10, 1))
        entry = collector.post_record(post, "lulaoficial", [], is_reel=True)
        self.assertEqual(entry["permalink"], "https://www.instagram.com/reel/ReelCode123/")

    def test_publishing_pairs_thumbnails_and_obeys_size_budget(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            cache = root / "cache/lulaoficial"
            cache.mkdir(parents=True)
            (cache / "ABCdef12345_1.jpg").write_bytes(b"thumbnail")
            (cache / "ABCdef12345_1.mp4").write_bytes(b"video")
            (cache / "ABCdef12345_2.jpg").write_bytes(b"photo")
            (cache / "ABCdef12345_3.mp4").write_bytes(b"x" * 100)
            (cache / "ABCdef12345.json").write_text('{"access_token":"private-value"}')
            media, used = collector.publish_media(root / "cache", root / "public/media/instagram", "lulaoficial", "ABCdef12345", max_file_bytes=20, remaining_bytes=30)
            self.assertEqual([entry["kind"] for entry in media], ["video", "image"])
            self.assertTrue(media[0]["thumbnailUrl"].endswith("_1.jpg"))
            self.assertEqual(used, 19)
            self.assertFalse((root / "public/media/instagram/lulaoficial/ABCdef12345.json").exists())
            self.assertFalse((root / "public/media/instagram/lulaoficial/ABCdef12345_3.mp4").exists())

    def test_atomic_manifest_round_trip_and_invalid_previous_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "feed.json"
            collector.write_json_atomic(path, [record()])
            self.assertEqual(collector.read_previous(path), [record()])
            path.write_text('{"unexpected":"not a feed"}', encoding="utf-8")
            with self.assertRaises(ValueError):
                collector.read_previous(path)


if __name__ == "__main__":
    unittest.main()
