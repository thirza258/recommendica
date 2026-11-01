"""Tests for the Write-editor image store (POST/GET /api/v1/assets/)."""

import io
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image
from rest_framework import status
from rest_framework.test import APITestCase

from airecommender import assets

KEY = "docs/" + "a" * 32 + ".png"


def png_bytes() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (2, 2), "white").save(buffer, "PNG")
    return buffer.getvalue()


def upload(data: bytes, name: str = "figure.png", content_type: str = "image/png"):
    return SimpleUploadedFile(name, data, content_type=content_type)


class DetectImageTests(APITestCase):
    def test_accepts_raster_formats_by_content(self):
        self.assertEqual(assets.detect_image(png_bytes()), ("image/png", "png"))

    def test_accepts_svg_root(self):
        svg = b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'
        self.assertEqual(assets.detect_image(svg), ("image/svg+xml", "svg"))

    def test_rejects_non_images_even_when_labelled_svg(self):
        self.assertIsNone(assets.detect_image(b"<!doctype html><html><svg></svg></html>"))


class AssetUploadTests(APITestCase):
    def test_store_image_and_return_its_url(self):
        with mock.patch("airecommender.assets.put_image", return_value=KEY) as put:
            response = self.client.post(
                "/api/v1/assets/",
                {"file": upload(png_bytes())},
                format="multipart",
            )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["url"], f"/api/v1/assets/{KEY}")
        self.assertEqual(response.data["type"], "image/png")
        self.assertEqual(put.call_args.args[1:], ("image/png", "png"))

    def test_rejects_unsupported_content(self):
        response = self.client.post(
            "/api/v1/assets/",
            {"file": upload(b"not an image", "notes.txt", "text/plain")},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_415_UNSUPPORTED_MEDIA_TYPE)

    @override_settings(ASSET_MAX_UPLOAD_BYTES=10)
    def test_rejects_oversized_uploads(self):
        response = self.client.post(
            "/api/v1/assets/",
            {"file": upload(b"x" * 11)},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)

    def test_reports_unavailable_storage(self):
        with mock.patch(
            "airecommender.assets.put_image",
            side_effect=assets.AssetUnavailable("down"),
        ):
            response = self.client.post(
                "/api/v1/assets/",
                {"file": upload(png_bytes())},
                format="multipart",
            )
        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)


class AssetContentTests(APITestCase):
    def test_serves_the_stored_bytes(self):
        with mock.patch(
            "airecommender.assets.get_image",
            return_value=(iter([b"abc"]), "image/png", 3),
        ):
            response = self.client.get(f"/api/v1/assets/{KEY}")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(b"".join(response.streaming_content), b"abc")
        self.assertEqual(response["Content-Type"], "image/png")
        self.assertEqual(response["Content-Length"], "3")
        self.assertIn("immutable", response["Cache-Control"])
        self.assertIn("sandbox", response["Content-Security-Policy"])

    def test_rejects_keys_outside_the_generated_namespace(self):
        for key in ("docs/not-a-key.png", "static/images/bg/hero.png", "secrets.txt"):
            response = self.client.get(f"/api/v1/assets/{key}")
            self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND, key)

    def test_head_returns_size_without_a_body(self):
        with mock.patch(
            "airecommender.assets.stat_image", return_value=("image/png", 42)
        ):
            response = self.client.head(f"/api/v1/assets/{KEY}")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Length"], "42")
        self.assertFalse(response.content)
