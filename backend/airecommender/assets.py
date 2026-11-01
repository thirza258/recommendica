"""Paper images stored in the MinIO instance deployed alongside decalove.

The Write editor keeps its documents in browser storage. Figures are uploaded
here instead of being embedded as base64, so a paper stays small and its images
survive across browsers. Objects are keyed by a random UUID; the public URL is
served through the API, which keeps MinIO credentials and its address private.
"""

import io
import logging
import re
import threading
import uuid
from typing import Iterator

from django.conf import settings
from minio import Minio
from minio.error import S3Error

logger = logging.getLogger(__name__)

#: Formats the editor accepts, keyed by Pillow's reported format. Extensions
#: come from the detected bytes, never from the uploaded client's filename.
RASTER_TYPES = {
    "PNG": ("image/png", "png"),
    "JPEG": ("image/jpeg", "jpg"),
    "GIF": ("image/gif", "gif"),
    "WEBP": ("image/webp", "webp"),
}
SVG_TYPE = ("image/svg+xml", "svg")

KEY_PATTERN = re.compile(r"^docs/[0-9a-f]{32}\.(?:png|jpg|gif|webp|svg)$")

_client: Minio | None = None
_bucket_ready = False
_lock = threading.Lock()


class AssetError(Exception):
    """Base class for failures the views translate into HTTP responses."""


class AssetNotFound(AssetError):
    pass


class AssetUnavailable(AssetError):
    pass


def _minio() -> Minio:
    global _client
    if _client is None:
        with _lock:
            if _client is None:
                _client = Minio(
                    settings.MINIO_ENDPOINT,
                    access_key=settings.MINIO_ACCESS_KEY,
                    secret_key=settings.MINIO_SECRET_KEY,
                    secure=settings.MINIO_SECURE,
                )
    return _client


def _ensure_bucket(client: Minio) -> None:
    global _bucket_ready
    if _bucket_ready:
        return
    with _lock:
        if _bucket_ready:
            return
        try:
            if not client.bucket_exists(settings.MINIO_BUCKET_NAME):
                client.make_bucket(settings.MINIO_BUCKET_NAME)
                logger.info("Created MinIO bucket %s", settings.MINIO_BUCKET_NAME)
        except Exception as exc:
            raise AssetUnavailable("The image store is unavailable.") from exc
        _bucket_ready = True


def asset_url(key: str) -> str:
    return f"/api/v1/assets/{key}"


def detect_image(data: bytes) -> tuple[str, str] | None:
    """Return ``(content_type, extension)`` for a supported image, else None."""
    from PIL import Image, UnidentifiedImageError

    fmt = ""
    try:
        with Image.open(io.BytesIO(data)) as image:
            fmt = (image.format or "").upper()
            image.verify()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        fmt = ""
    if fmt in RASTER_TYPES:
        return RASTER_TYPES[fmt]

    # SVG is text, so Pillow never sees it. Accept only a document whose root
    # is an <svg> element (possibly after an XML declaration).
    head = data[:4096].lower().lstrip()
    if head.startswith((b"<?xml", b"<svg")) and b"<svg" in head:
        return SVG_TYPE
    return None


def put_image(data: bytes, content_type: str, extension: str) -> str:
    key = f"docs/{uuid.uuid4().hex}.{extension}"
    client = _minio()
    _ensure_bucket(client)
    try:
        client.put_object(
            settings.MINIO_BUCKET_NAME,
            key,
            io.BytesIO(data),
            length=len(data),
            content_type=content_type,
        )
    except Exception as exc:
        logger.warning("MinIO image upload failed: %s", exc)
        raise AssetUnavailable("The image could not be stored.") from exc
    return key


def stat_image(key: str) -> tuple[str, int]:
    if not KEY_PATTERN.fullmatch(key):
        raise AssetNotFound()
    try:
        stat = _minio().stat_object(settings.MINIO_BUCKET_NAME, key)
    except S3Error as exc:
        if exc.code in {"NoSuchKey", "NoSuchObject", "NoSuchBucket"}:
            raise AssetNotFound() from exc
        raise AssetUnavailable("The image store is unavailable.") from exc
    except Exception as exc:
        raise AssetUnavailable("The image store is unavailable.") from exc
    return stat.content_type or "application/octet-stream", stat.size


def get_image(key: str) -> tuple[Iterator[bytes], str, int]:
    if not KEY_PATTERN.fullmatch(key):
        raise AssetNotFound()
    try:
        client = _minio()
        stat = client.stat_object(settings.MINIO_BUCKET_NAME, key)
        response = client.get_object(settings.MINIO_BUCKET_NAME, key)
    except S3Error as exc:
        if exc.code in {"NoSuchKey", "NoSuchObject", "NoSuchBucket"}:
            raise AssetNotFound() from exc
        raise AssetUnavailable("The image store is unavailable.") from exc
    except Exception as exc:
        raise AssetUnavailable("The image store is unavailable.") from exc

    def chunks() -> Iterator[bytes]:
        try:
            yield from response.stream(64 * 1024)
        finally:
            response.close()
            response.release_conn()

    return chunks(), stat.content_type or "application/octet-stream", stat.size
