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

Validation: typed receipt/byte corruption tests, terminal tests that import and
insert an exact PDF without sending its bytes to the model, corrupt-file
rejection, German mobile layout, app typecheck and build. Atlas has native
English/German dialog fixtures and scoped PostgreSQL transfer tests. The real
company Polarion download has not yet been confirmed: live browser automation
could inspect the export dialog but could not reliably activate its Export
control. This is not a production end-to-end success claim.
