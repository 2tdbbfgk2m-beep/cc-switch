# Command Code document attachments

Goal: parse DOCX/PDF dropped or selected in Command Code 0.1.61 locally, preserve existing configuration and sessions, test, push, and install.

Architecture: a standalone local renderer module using Mammoth, Turndown/GFM and PDF.js. A version-gated installer patches only attachment dispatch in the existing renderer, backs up replaced resources, and re-seals the already ad-hoc-signed application. No main-process/IPC/CSP changes or new daemon.

Constraints:

- Native plain text, images, folders, current draft guards, settings and history retain their behavior.
- DOCX body/table extraction; images represented by descriptive placeholders.
- PDF text extracted by page; textless pages rendered to native image attachments, subject to the existing eight-image capacity. No OCR API or silent truncation.
- Reject damaged/encrypted/oversized documents clearly; bound archive expansion, page count and output text. Use no external resource access.
- Unsupported desktop versions fail before mutation; installation is idempotent, with backups and a manifest identifying patch version.

## Tasks

- [x] Write failing parser tests with synthetic DOCX/table, text PDF, textless PDF and failures; implement parser with bounded resources.
- [x] Exercise version-gated patch against actual 0.1.61 attachment functions; cover normal attachments, per-file errors, stale drafts and image capacity.
- [x] Bundle local parser/worker/fonts, test installer on a fake app, verify unsupported/idempotent/failure cases.
- [x] Run regression checks, isolated original DOCX conversion and independent review. Document installation and limitations.
- [x] Push tested changes; build package; install while desktop is idle and verify real attachment selection without sending user content.
- [x] Compare configuration/session/source-file hashes and deliver verification record.
