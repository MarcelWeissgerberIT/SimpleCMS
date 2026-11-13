# Polarion original PDFs through the browser worker

The terminal reads a structured, successful `atlas_polarion_status` receipt with
`result.status=exported` and `source=polarion-native-pdf`. It shows a DE/EN file
card with the original filename, size, export time and Polarion source link.
“Save PDF in ONE” retrieves bounded chunks over the same personal Atlas
connection, checks the full size/PDF markers/SHA-256 and stores the original
bytes in the original workspace. Cloud uploads are private until insertion and
are read back before reporting success. The insertion remains a normal reviewed
terminal change. Source URL, export date and checksum remain beside the file.

A failed export, wrong job, incomplete/corrupt bytes or changed workspace/account
must not create an attachment. The transfer bypasses inference. There is no
implicit Atlas content write; an optional later Atlas handoff is a separate task.
The UI checks workspace scope between asynchronous operations and aborts when
its component/workspace is left. A repeated render retains the imported state.

Dependencies: Atlas native PDF tools and migration `0201_polarion_pdf_export`,
and a Polarion browser worker advertising `native_pdf_v1`. Existing workers must
be updated/restarted; ONE's MCP catalogue must be refreshed. Exports are limited
to supported LiveDocs and 20 MiB, and expire 30 minutes after job creation.
Chunk retrieval is paced below the normal shared MCP request limit.

The PDF cards derive attachment status from actual file nodes on the target page,
not from an older applied change. Removing or undoing an attachment updates the
status; an already saved file can be prepared for insertion again without another
export or byte transfer. Saved files have a direct download link. Polling the same
job does not multiply export counts or discard its import receipt.

PDF tasks end with “Review export progress” rather than a blanket completion
claim. The live summary counts confirmed exports and current attachments for this
turn only; it does not infer the total requested batch. The model answer is labelled
as historical, with failures still visible. Existing page prose is not rewritten.

Validation: typed receipt/byte corruption and attachment-evidence tests; terminal
tests import and insert exact PDF bytes, remove and restore the attachment without
another worker call, check the live counts/download link, and reject corrupt files.
German mobile layout, app typecheck and production build are checked.

Live observation on 2026-11-12: five of eleven native exports reported success;
three actual ONE attachments were visible, two awaited insertion. Six exports
failed at document/actions/menu stages. Those stage errors do not establish that
the source type is unsupported. Complete eleven-document delivery remains
unverified; successful export jobs must not be blindly repeated.
