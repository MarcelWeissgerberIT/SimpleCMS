---
id: automations
title: Automations & webhooks
section: databases
order: 8
keywords: automation, webhook, n8n, make, zapier, trigger, action, notify, set property, integration, Automation, Webhook, Auslöser
related: buttons, forms, public-api, ai-autofill
summary: When a row is created, changed or deleted — send a webhook, set a property or show a notice.
---
Open **Automations** (the lightning bolt in the database toolbar, or Page options **•••** → **Automations**). Start from a recipe or create one:

- **Send new rows to n8n / Make / Zapier**
- **Notify when Status → Done**
- **Stamp a date when Done**

## When … then …
- **Trigger:** **Row created**, **Property changed** (any property, or one changing to a value), **Row deleted**.
- **Actions**, run in order: **Send webhook** (POST or PUT to an https URL), **Set property** (e.g. today, checked, a status), **Show notification**.

Switch it on with **Enabled**; the LED shows armed, needs setup or last run failed. **Send test** sends a sample, **Payload** shows the JSON every webhook receives, and **Copy as n8n workflow** gives you a ready webhook trigger to paste into n8n. The **Run log** lists the last 30 runs of this session.

> Automations run in your browser while One is open. A new row fires once it has a title and editing pauses. Webhooks time out after 10 s, and the receiving service must allow requests from a browser (CORS).

In a team workspace, the server can also receive data: see **Public API & webhooks**.
