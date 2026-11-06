---
id: 2026-11-01-frankfurt-costs
date: 2026-11-01
order: 1
title: Attribute Frankfurt operating costs to tasks
summary: A private host estimate separates model occupancy, storage and unattributed compute.
image: assets/shots/changelog/frankfurt-costs.webp
alt: Frankfurt operating-cost overview with host totals and a workspace allocation.
help: ai-costs
try: settings-ai
---
The designated test lead can open **Settings → AI → Atlas Flow · Frankfurt → My complete test log → Operating costs**. The overview estimates VM, GPU and disk costs since the current VM boot using a dated host rate.

Completed model rounds, including failed attempts, are grouped by task and workspace. Queue and tool time are excluded. Unattributed compute includes idle time and missing logs; it is not labelled as pure idle time. Storage remains a host cost.

Download a complete JSON snapshot with the period and calculation basis. This is an estimate, not a cloud invoice or user charge. IPv4, snapshots, egress and tax are excluded. AI token budgets remain separate.
