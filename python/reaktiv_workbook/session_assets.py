"""Bounded, content-addressed image transfer for local browser sessions."""
from __future__ import annotations
import base64
import binascii
import hashlib
from pathlib import Path
import re
from typing import Mapping
from .model import SheetDocument

ASSET = re.compile(r'assets/([0-9a-f]{16}\.(?:webp|png|jpe?g|gif))\b')
MAX_BYTES = 20 * 1024 * 1024


def referenced_assets(document: SheetDocument) -> set[str]:
    result: set[str] = set()
    for cell in document.cells:
        if cell.kind != 'markdown':
            continue
        sources = re.findall(r'!\[[^\]\n]*\]\((?:<([^>\n]+)>|([^\s)]+))', cell.source)
        for angled, bare in sources:
            reference = angled or bare
            if ASSET.fullmatch(reference):
                result.add(reference)
        for reference in re.findall(r"<img\b[^>]*?\ssrc=[\"']([^\"']+)[\"']", cell.source, re.IGNORECASE):
            if ASSET.fullmatch(reference):
                result.add(reference)
    return result


def asset_path(workbook: Path, reference: str) -> Path:
    if ASSET.fullmatch(reference) is None:
        raise ValueError(f'Invalid workbook image reference: {reference}')
    folder = workbook.parent / 'assets'
    path = workbook.parent / reference
    if folder.is_symlink() or path.is_symlink():
        raise ValueError('Workbook image assets must not be symbolic links')
    return path


def validate_asset(reference: str, data: bytes) -> None:
    if len(data) > MAX_BYTES or hashlib.sha256(data).hexdigest()[:16] != Path(reference).stem:
        raise ValueError(f'Workbook image has invalid content or exceeds 20 MiB: {reference}')


def read_assets(workbook: Path, document: SheetDocument) -> dict[str, str]:
    result: dict[str, str] = {}
    total = 0
    for reference in sorted(referenced_assets(document)):
        path = asset_path(workbook, reference)
        if path.stat().st_size > MAX_BYTES:
            raise ValueError(f'Workbook image exceeds 20 MiB: {reference}')
        data = path.read_bytes()
        validate_asset(reference, data)
        total += len(data)
        if total > MAX_BYTES:
            raise ValueError('Workbook image transfer exceeds 20 MiB in total')
        result[reference] = base64.b64encode(data).decode('ascii')
    return result


def write_assets(workbook: Path, document: SheetDocument, encoded: Mapping[str, str]) -> None:
    required = referenced_assets(document)
    prepared: dict[str, bytes] = {}
    total = 0
    for reference, value in encoded.items():
        asset_path(workbook, reference)
        if reference not in required:
            raise ValueError(f'Image is not referenced by this workbook: {reference}')
        if len(value) > (MAX_BYTES + 2) // 3 * 4:
            raise ValueError('Workbook image transfer exceeds 20 MiB')
        try:
            data = base64.b64decode(value, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError(f'Invalid base64 image: {reference}') from error
        validate_asset(reference, data)
        prepared[reference] = data
        total += len(data)
        if total > MAX_BYTES:
            raise ValueError('Workbook image transfer exceeds 20 MiB in total')
    # Validate everything before creating files. Existing images are immutable.
    for reference in required:
        path = asset_path(workbook, reference)
        if path.exists():
            if path.stat().st_size > MAX_BYTES:
                raise ValueError(f'Workbook image exceeds 20 MiB: {reference}')
            validate_asset(reference, path.read_bytes())
        elif reference not in prepared:
            raise ValueError(f'Workbook image is missing: {reference}')
    for reference, data in prepared.items():
        path = asset_path(workbook, reference)
        path.parent.mkdir(exist_ok=True)
        try:
            with path.open('xb') as output:
                output.write(data)
        except FileExistsError:
            validate_asset(reference, path.read_bytes())
