---
id: hand-drawn
title: Hand-drawn diagrams and illustrations
section: writing
order: 16
keywords: hand drawn, hand-drawn, sketch, sketchnote, illustration, drawing, diagram, orange, black, cover, reference image, handgezeichnet
related: blocks, charts, mcp-servers, ai-providers
summary: Create editable sketch diagrams or illustrations in One’s orange-and-black style.
---
Type `/handdrawn` and choose **Hand-drawn**. The window has two variants: **Diagram** and **Illustration**. It starts with a preview; your page changes only when you choose **Insert block**, **Apply changes** or **Use as cover**.

## Diagram
The sample works without an AI key. Open **Edit diagram data** to change its labels and arrows. For AI assistance, describe what the drawing should show and choose **Generate preview**. The provider and model selector applies to this request; a configured local text model can help create diagrams too. A malformed AI diagram gets at most one repair attempt.

The inserted block keeps its editable Mermaid data and sketch styling. **Edit drawing** opens the drawing window again; **Open large** shows the vector diagram with zoom, pan and SVG download. **Use as cover** stores an SVG snapshot; later diagram edits do not automatically change that cover.

## Illustration
Choose a connected **Image service · MCP**, write a request and pick a format: square, 16:9 or **3:1 · Cover**. The cover format asks the service to keep faces and important shapes in the central band and omit lettering. One adds the black-ink, orange-marker and paper style to the request.

Generation needs a configured AI route with MCP support and a connected image service. A coding model alone does not generate images. The model selector and the image-service selector control different parts of the request. Generation may consume usage from both services; One’s normal data rules, metering and budget controls apply.

Results appear as media cards. No remote image is loaded automatically. Click **Save to One** to check and store the file for the preview, then insert it or use it as a cover. If a host blocks the download, the card offers **Upload a copy** and, in a team workspace, **Fetch through the team server**.

## Page context and references
**Use this page as context** is off initially. When enabled, One uses only the page’s permitted AI context and applies the selected route’s data rules. It does not search other pages, Atlas or One memory for this block.

An optional PNG, JPEG or WebP reference (up to 10 MB) is stored in the workspace. On **Generate preview**, the selected AI model reads it and produces a visual description; the image service receives that description. This is visual guidance, not guaranteed pixel editing or exact likeness.

The original request, format, service selection and local reference stay with an inserted drawing in the workspace and workspace backups. Ordinary HTML and Markdown exports omit this generation metadata and the original reference. The displayed drawing is exported normally. Reopening an illustration preserves the request that produced the selected image; editing the request alone does not regenerate it.
