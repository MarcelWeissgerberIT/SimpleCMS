---
id: atlas-package-freshness
date: 2026-11-08
order: 10
title: Atlas package freshness directly on the mock
summary: Package and used components are rechecked when loading a mock.
help: agent
---

Opening or reloading a saved mock re-reads its recorded design sources in Atlas. A status below the tabs shows **checking**, **used sources up to date**, **package changed** or **unavailable**, with the check time.

Changed sources and associated used components are named. **Atlas details** opens the source list, where you can queue a focused update as a note. Your existing mock remains until you accept a new version.

The check uses your existing Atlas connection and makes no model request. It covers the package index and actually used sources, not every unused component. If access fails, the last saved comparison is explicitly historical. Switching tabs does not recheck; **Check sources now** always performs a fresh read.
