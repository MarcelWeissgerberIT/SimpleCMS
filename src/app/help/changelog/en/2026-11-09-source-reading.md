---
id: 2026-11-09-source-reading
order: 3
summary: Contiguous sources, bounded parallel reads and visible cache usage.
image: assets/shots/changelog/source-reading.webp
alt: Source-reading summary in a One document pipeline log.
help: agent
try: terminal
title: Read sources together
date: 2026-11-09
---

One now provides suitable pages together within a bounded reading budget. Larger sources retain explicit continuation offsets. Overlapping portions do not count twice as new source coverage; gaps and changed source versions remain visible.

Independent reads in fixed compiled programs run in groups of up to three. Dependent steps and changes wait for preceding results.

The log reports fully provided source versions, unique and reread characters, model responses, duration, known cost and observed cache usage. Providing a source does not yet verify a finding.
