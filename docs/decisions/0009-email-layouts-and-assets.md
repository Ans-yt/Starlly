# 0009 — Email layouts and persistent assets

Messages offers four HTML layouts (Branded, Letter, Spotlight, Compact) and editable, ordered blocks. The message block is mandatory; buttons use the existing customer-page link. Owners can save reusable custom layouts. Plain text remains a fallback, and Copy only also offers an HTML download.

Store designs with drafts and include them in the approval hash. Editing a design invalidates approval. Preview, owner tests and real sends share the server renderer; provider dispatch continues through the persisted outbox. Explicit tests of changed content get a fresh idempotency key only when no send is in progress or ambiguous. Customer sends retain their existing duplicate and ambiguity protections.

The asset drawer accepts PNG, JPEG and WebP. A crop/resize dialog produces logo (400×400), banner (1200×400), or photo (1200×800) variants. The server verifies pixel/byte limits, rejects active/vector and animated formats, strips metadata and stores the resulting image in SQLite. Limit the library to 40 images and 30 saved layouts. Assets and layouts are included in backup, restore and Delete my data.

Opaque public image tokens allow inbox clients to retrieve only the image; the library and upload APIs require owner access. Referenced assets cannot be deleted, preserving sent-email URLs. Customer image delivery requires PUBLIC_BASE_URL to be a public HTTPS address. Images may still be blocked by the recipient’s email client. Use inline email CSS and presentation tables; no arbitrary owner-supplied HTML, scripts or custom link destinations.

Provider verification (2026-10-10): Agentboxd accepts `html` alongside `text` (https://agentboxd.com/docs/api). OpenMail auto-detects HTML in `body` and accepts separate `bodyHtml` alongside plain `body` (https://docs.openmail.sh/api-reference/messages/send-email.md). Existing adapters already map these fields.
