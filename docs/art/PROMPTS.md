# SimpleCMS One — art production notes

Everything needed to extend the icon set and the page covers so new pieces match the existing ones.
Design language: **INSTRUMENT**. Warm paper `#F2F0EA`, ink `#121210`, one signal colour, international orange `#FF4F00`.

| Asset | Model (OpenArt) | Settings | Output |
|---|---|---|---|
| 21 icons | **GPT Image 2.5 Sunburst** (`gpt-image-2-5-sunburst`, `text2image`; the four review replacements `image2image` with `blocks_1` as style reference) | `aspectRatio 1:1`, `resolutionTier 1k`, `quality medium`, `outputFormat png`, `autoEnhancePrompt false` (30 credits per image, 32 with a reference) | `public/assets/icons/<name>.png` + `.webp` (512×512, alpha) |
| 8 covers | **Nano Banana Pro** (`nano-banana-pro`, `text2image`) | `aspectRatio 21:9`, `resolution 2K` (3168×1344, 40 credits per image) | `public/assets/covers/<name>.webp` (1800×600, q82; `night` q90) |

Spend for the whole set: about **1,670 credits** (1,380 first pass + 288 art-direction review, section 6).

* Icons: 28 renders, 870 credits. 21 were kept. Two retries were rejected: the first hammer and the second history.
  Five were style and model tests: two Sunburst v1 renders and three Nano Banana Pro renders.
* Covers: 12 renders, 510 credits. 8 were kept. Two first attempts were rejected (glass and aluminium), and two
  Sunburst renders were used only for the model comparison.

Manifests: `public/assets/icons/manifest.json` and `public/assets/covers/manifest.json`.
Contact sheets: `docs/art/icons-dark.png`, `docs/art/icons-light.png` and `docs/art/covers.png`.
Pipeline scripts: `docs/art/tools/`.

---

## 1. Model choice (style test)

`blocks` and `lock` were rendered with Sunburst and Nano Banana Pro, using two wordings each.

* **Nano Banana Pro** made objects with a pleasant perspective, but the background drifted to grey (`#E5E5E5`–`#F3F3F3`).
  In one render a stray black cable came into the frame. A grey background cannot be keyed cleanly. Rejected for icons.
* **Sunburst, v1 wording** ("soft-modelled ceramic, gently rounded"): the background was a clean `#FEFEFE`, but the
  forms were pillowy and looked like soap. That is the familiar puffy "AI 3D icon" look we want to avoid.
* **Sunburst, v2 wording** (below): engineered geometry with flat faces, small consistent radii and a Braun-like precision.
  The background is pure white, and the orange shifted toward red, close to `#FF4F00`. **Chosen.** The style master is `blocks`.

Neither model can output transparency, so the alpha channel is made in post-processing (section 4).
Plain text2image with the fixed template below gave a consistent family. The four icons replaced in the art-direction
review (section 6) were made with `image2image` and the `blocks_1` render as style reference, using the reference preamble below.

## 2. Icon prompt template (verbatim)

Fill `{OBJECT}` and `{ACCENT}` and keep everything else exactly as written. The line breaks are part of the prompt.

```
Studio product photograph of a single precision-designed object, part of a cohesive icon family in the industrial-design language of Dieter Rams for Braun and Teenage Engineering.
Object: {OBJECT}
Material and form: matte warm-white ceramic (bisque porcelain, colour #ECEAE4) with crisp, precise engineered geometry: flat faces, consistent small edge radii like a high-end injection-moulded Braun product; solid and dense, never puffy, inflated, clay-like or soap-like.
Accent: exactly one element in vivid international orange #FF4F00 with a satin finish: {ACCENT}
Light: one large softbox from the upper left, gentle falloff, a soft contact shadow directly under the object on the ground plane.
Camera: three-quarter view, rotated about 30 degrees and looking down about 25 degrees, long lens with little perspective distortion; object centred, filling about 70% of the frame, entirely in frame with even margins, clean silhouette.
Background: seamless, perfectly uniform pure white #FFFFFF, no gradient, no vignette, no horizon line.
Strictly no text, letters, numbers, logos, icons or symbols anywhere. No additional objects or props, no glow, no sparkles, no environment reflections, no glossy plastic, no toy look, no unnecessary detail. Calm, minimal, precise, museum-grade.
```

**Reference preamble** (image2image only, prepended to the template; reference = the `blocks_1` render, OpenArt resource `ERbJy7hnLJPSFuOtcyUw`):

```
Use the reference image ONLY as the style guide: the same matte warm-white ceramic, the same signal-orange satin accent, the same soft studio light from the upper left, the same soft contact shadow, the same three-quarter camera angle and the same pure white background. Do NOT draw the stacked tiles from the reference; draw a completely different object.
```

Small per-icon additions to the last line: `no stars` (ai), `no motion lines` (publish, import), `tick marks` (focus),
`legends ... the key top is blank` (command), `digits, serifs, flags ... the bar is a plain straight bar` (app-icon).

### Per-icon slots (final, kept renders)

| name | label / label_de | {OBJECT} | {ACCENT} |
|---|---|---|---|
| blocks | Block editor / Block-Editor | a stack of three thick rectangular tiles with rounded corners, each tile shifted slightly forward and to the right of the one below, like neatly stacked building blocks. | the top tile. The two lower tiles are warm-white ceramic. |
| database | Databases / Datenbanken | a short squat cylinder made of three stacked round discs of equal diameter with softly rounded edges, separated by thin shadow gaps, like the classic database symbol rendered as a solid object. | the middle disc. The top and bottom discs are warm-white ceramic. |
| kanban | Board view / Board-Ansicht | a small upright board, like a desktop easel panel leaning back slightly on its lower edge, its front face divided into three vertical columns by thin raised ribs; each column holds two or three small rounded rectangular cards mounted flat on it, like a kanban board. | one single card in the middle column. The board and all other cards are warm-white ceramic, all cards completely blank. |
| calendar | Calendar & timeline / Kalender & Timeline | a chunky desk calendar block: a solid wedge-shaped block whose sloped front face carries a neat grid of shallow soft square dimples, five columns by four rows; nothing is printed on it. | exactly one of the square dimples is filled with an orange inlay. All other dimples are empty warm-white ceramic. |
| graph | Graph view / Graph-Ansicht | *(image2image)* a small three-dimensional network graph built like a precise ceramic model: one larger central sphere and four smaller spheres placed at clearly different depths and heights around it (one in front low on the ground, one behind and higher, one to the left, one to the right), each joined to the central sphere by a short thick straight rod, plus one extra rod directly linking the left and the front outer spheres so the network contains one closed triangle. Asymmetric and clearly three-dimensional, not a flat X, not a cross, not a molecule kit. The lowest spheres rest on the ground plane. | the central sphere. The four outer spheres and all rods are warm-white ceramic. |
| ai | AI assistant / KI-Assistent | a speech bubble made solid: a thick upright slab with rounded-rectangle outline and a small triangular tail at its lower left corner, standing on the ground; on its right side face sits one small round control dial knob with fine knurled edge, like the knob of a precision instrument, so the bubble reads as an intelligent instrument. | the small dial knob. The bubble is warm-white ceramic with a completely blank front face. |
| command | Command palette / Command Palette | a single oversized keyboard keycap: a square key with gently tapered sides and a slightly concave, completely blank top surface, like a premium mechanical keyboard key. | a thin ring running around the base of the keycap, like a gasket. The keycap itself is warm-white ceramic. |
| lock | Local & private / Lokal & privat | a compact padlock: a squarish body with rounded corners and a round U-shaped shackle rising from its top; one small circular recess on the front face instead of a keyhole. | the shackle. The body is warm-white ceramic. |
| history | Version history / Versionsverlauf | *(image2image)* an audio cassette reduced to its essential, instantly recognisable form, standing upright on its long edge and turned slightly: a flat rounded-rectangle shell; two round reel hubs, each a plain smooth solid disc set into a circular recess in the front face; a plain rectangular window recess between the two hubs; a shallow raised trapezoid strip along the bottom edge of the front face. Nothing else: no screws, no screw holes, no small holes, no teeth or spokes on the hubs, no visible tape, no label, no seams. | the left reel hub disc. The shell, the window and the right hub are warm-white ceramic. |
| sync | Real-time sync / Echtzeit-Sync | two thick interlocking rings (tori with round cross-section), linked through each other like two chain links, standing upright on the ground at an angle to each other. *(material line: "smooth and exact like a high-end injection-moulded Braun product")* | one of the two rings. The other ring is warm-white ceramic. |
| templates | Templates / Vorlagen | three rectangular document sheets made of thick rigid ceramic card with rounded corners, stacked and fanned out slightly like a hand of cards, standing upright and leaning back a little. The front sheet carries a simple raised layout in relief: one wide rectangular header block near the top and two short plain raised bars below it. | the wide header block on the front sheet. Everything else is warm-white ceramic. |
| publish | Publish / Veröffentlichen | a folded paper plane made from a thick ceramic sheet with crisp but softly rounded folds, nose pointing up and to the right as if about to take off, resting on the ground. | the outer tip of one wing. The rest of the plane is warm-white ceramic. |
| present | Presentation mode / Präsentationsmodus | a small presentation screen: a thin landscape rectangular panel with rounded corners mounted on a slim vertical stand with a round base disc. The screen face is blank except for one single horizontal raised bar shape in relief, like one bar of a chart. | the horizontal bar on the screen face. Screen, stand and base are warm-white ceramic. |
| code | Code & formulas / Code & Formeln | *(image2image)* a slim pocket calculator in the spirit of the Braun ET66, lying flat on the ground and turned at an angle: a thin rounded-rectangle body; in its upper part one plain recessed rectangular display window that is completely empty; below it a neat grid of small round slightly convex push buttons, four columns by four rows. Every button is a perfectly blank smooth dome with nothing printed on it; the display is blank. *(camera: "looking down about 35 degrees"; last line: "no text, letters, digits, numbers, mathematical symbols ... no legends on the keys, no digits on the display")* | the single bottom-right button. The body, the display and all other buttons are warm-white ceramic. |
| split | Split view / Split View | a rounded-rectangle window frame standing upright like a small display, divided by one vertical divider bar into two equal side-by-side recessed panes. | the right pane, a flat inset panel. The frame, the divider and the left pane are warm-white ceramic. |
| focus | Focus mode / Fokus-Modus | a round target disc made of three concentric raised rings stepping up towards the centre, like a precision-turned dial, standing upright on a short edge foot and tilted slightly back. | one small round dot at the exact centre. All rings are warm-white ceramic. |
| search | Search / Suche | a magnifying glass lying on the ground at a diagonal: a thick round ring frame holding a frosted, milky translucent lens disc, and a short chunky cylindrical handle. | the short handle. The ring frame is warm-white ceramic. |
| automation | Automations / Automationen | two thick gears meshing with each other, standing upright on the ground: one larger gear and one smaller gear, each with chunky rounded teeth and a round hub hole, their teeth interlocking. | the smaller gear. The larger gear is warm-white ceramic. |
| import | Import / Import | *(image2image)* a desk in-tray: an open rectangular tray with rounded corners and low walls resting on the ground, and one thick rigid rectangular card with rounded corners sliding into it from above: the card is tilted steeply at about 40 degrees, its lower edge already dipping just inside the tray opening, as if it is being dropped in. The card is completely blank. *(light line: "...under the tray"; last line adds "arrows" and "no motion lines")* | the card. The tray is warm-white ceramic. |
| hammer | Hammer / Hammer | a heavy sledgehammer lying diagonally on the ground, head at lower left, handle rising to the upper right: a big, massive rectangular block head with chamfered, softly rounded edges, and a thick, fairly short cylindrical handle about two and a half times the length of the head. Heavy, sturdy proportions. | the whole handle. The head is warm-white ceramic. |
| app-icon | App icon / App-Icon | a thick rounded-square app tile (squircle) like a solid ceramic tablet, standing upright and turned slightly; its plain front face carries one single bold raised vertical bar with rounded ends, placed slightly left of centre, like an abstract numeral one reduced to a plain bar. Minimal. | the raised vertical bar. The tile is warm-white ceramic. |

### Quality gate log (icons)

Every render was checked for text or glyphs, extra objects, deformed geometry, a material or light that differs from the
master, more than one orange group, a busy background, cropping and muddy edges.

* `hammer` attempt 1 was rejected because the head was too small and the handle long and thin, so it read as a mallet,
  not a sledgehammer. Attempt 2 with "big, massive head ... handle about 2.5× the head" was kept.
* `history` attempt 2 (a "reduced" cassette with no window, screws or holes) was rejected because it no longer read as a
  cassette. Attempt 1 was kept for recognisability, even though it carries more detail than the rest of the family.
* All other icons passed on the first render.
* Art-direction review (section 6) replaced `graph`, `history`, `code` and `import`, and re-cut `automation` with `--keywhite`.

## 3. Cover prompts (Nano Banana Pro, 21:9, 2K)

Nano Banana Pro beat Sunburst in a side-by-side test on `paper-folds` and `night`. It gave crisper, more editorial
paper folds and a far more minimal night scene, where Sunburst produced a literal city panorama full of lights.

The shared style tail is appended to each subject:

```
Editorial still-life / photograph for a premium design magazine, medium-format camera, natural colour, subtle film grain,
[restrained palette ...]. Very wide panoramic composition whose interest sits in the central horizontal band.
No people, no text, no logos, no fantasy elements, no neon, no HDR, no oversaturation, no lens flare.
```

| name | label / label_de | crop anchor y, grain | prompt (verbatim) |
|---|---|---|---|
| paper-folds | Paper folds / Papierfalten | 0.55 | Macro studio photograph of large sheets of heavy off-white paper folded into soft, crisp ridges and valleys that run diagonally across the whole frame; among them, exactly one sheet in signal orange (#FF4F00) tucked between the white folds. Soft directional window light from the left, deep soft shadows in the valleys, fine paper fibre texture visible. Editorial still-life for a premium design magazine, shot on a medium-format camera with an 80mm lens, natural colour, subtle film grain, restrained palette of warm paper white, soft grey shadow and one orange accent, generous calm negative space. Very wide panoramic composition whose interest sits in the central horizontal band. No people, no text, no logos, no fantasy elements, no neon, no HDR, no oversaturation, no lens flare. |
| glass *(replaced, see below)* | Frosted glass / Milchglas | 0.40 | Full-bleed abstract studio photograph, filling the entire frame edge to edge: three thick frosted glass slabs standing upright at slightly different angles and depths, placed off-centre, on a pale warm-white seamless surface that continues smoothly into the background. Warm orange light passes through the glass from behind and lays soft, translucent orange-tinted shadows forward across the surface; thin bright highlights on the polished glass edges. Calm, minimal, quiet, large areas of empty negative space. Editorial still-life for a premium design magazine, medium-format camera, natural colour, subtle film grain, restrained palette of warm off-white, soft grey and one orange glow. Very wide panoramic composition whose interest sits in the central horizontal band. No border, no frame, no vignette, no visible studio walls, lamps or equipment, no people, no text, no logos, no neon, no HDR, no oversaturation, no lens flare. |
| aluminum | Brushed aluminium / Gebürstetes Aluminium | 0.5 | Full-bleed macro photograph of a sheet of brushed aluminium bent into a few gentle, slow, wide waves, filling the entire frame. The metal has fine, tight, perfectly straight parallel micro-scratches from machine brushing, running horizontally; satin anisotropic sheen, cool neutral silver-grey tones, crisp and hard, clearly metal. One faint warm orange reflection glides along a single wave crest. Precise, tactile, minimal, soft studio light. Editorial still-life for a premium design magazine, medium-format camera, natural colour, subtle grain. Very wide panoramic composition whose interest sits in the central horizontal band. No border, no frame, not fabric, not hair, not water, no people, no text, no logos, no fantasy elements, no neon, no HDR, no oversaturation, no lens flare. |
| dunes *(replaced, see below)* | Dunes / Dünen | 0.5 | Aerial photograph taken from high above of soft sand dunes at golden hour: long sweeping crescent ridgelines with crisp edges between sunlit and shaded slopes, warm orange and cream tones, deep soft shadows, minimal abstract composition. No vegetation, no tracks, no people, no vehicles, no buildings. Editorial landscape photograph for a premium design magazine, medium-format camera, natural colour, subtle film grain. Very wide panoramic composition whose interest sits in the central horizontal band. No text, no logos, no fantasy elements, no HDR, no oversaturation, no lens flare. |
| ink *(kept, colour-graded, see section 6)* | Ink in water / Tinte im Wasser | 0.45 | Macro photograph of a single plume of orange ink slowly diffusing in perfectly clear water, delicate silky tendrils and soft billowing clouds drifting sideways, against a seamless warm off-white background; elegant and minimal with lots of empty negative space; crisp studio lighting, sharp detail in the fine filaments. Editorial still-life for a premium design magazine, medium-format camera, natural colour, subtle film grain. Very wide panoramic composition whose interest sits in the central horizontal band. No glass container edges, no bubbles, no people, no text, no logos, no fantasy elements, no neon, no HDR, no oversaturation. |
| grain | Grain gradient / Körniger Verlauf | 0.5, grain σ 7, 60 px inset | Abstract print: a smooth, soft colour gradient field that transitions from deep charcoal black on the left through warm umber to a warm signal orange (#FF4F00) glow on the right, with a gentle soft diagonal falloff, covered evenly in fine risograph-like film grain and very subtle uncoated paper texture. Absolutely no shapes, no objects, no lines, no circles, no horizon, no text, no logos. Calm, tactile, analogue. Very wide panoramic format. |
| concrete | Concrete curves / Betonkurven | 0.6 | Architectural photograph of smooth light-grey concrete curves: a sweeping curved wall meeting a gently curved ramp, fine board-formed texture, long soft shadows raking across the surfaces in low afternoon daylight, minimal brutalist detail, clear calm composition with a lot of empty wall surface. No people, no signage, no windows with reflections, no plants. Editorial architecture photograph for a premium design magazine, medium-format camera, natural colour, subtle film grain, restrained palette of warm concrete grey and soft shadow. Very wide panoramic composition whose interest sits in the central horizontal band. No text, no logos, no fantasy elements, no HDR, no oversaturation, no lens flare. |
| night | Night city / Nachtstadt | 0.75 | Long-exposure photograph of a dark city at night seen from a high vantage point, the frame almost entirely in deep shadow, with a scattering of soft, out-of-focus warm orange sodium-light bokeh circles in the lower third, faint silhouettes of rooftops barely visible, subtle atmospheric haze. Very minimal, mostly dark, quiet. Editorial photograph for a premium design magazine, medium-format camera, natural colour, subtle film grain. Very wide panoramic composition whose interest sits in the central horizontal band. No people, no text, no signs, no logos, no neon, no HDR, no oversaturation, no lens flare, no stars. |

### Quality gate log (covers)

* `glass` attempt 1 was rejected. The model framed the photo as a print with a white border, and the dark studio
  cyclorama edges showed on both sides. "Full-bleed ... no border, no frame, no visible studio walls" fixed it.
* `aluminum` attempt 1 was rejected because the brushing read as hair or fur, which is an AI tell. Attempt 2 asks for
  "tight, perfectly straight parallel micro-scratches ... not fabric, not hair".
* The `grain` render came back as a print with a white paper border. It was cropped 60 px inside the border. The
  model's own grain was too fine to survive WebP, so post-processing adds mono film grain (σ 7, a fine plus a 2 px
  clumped layer, strongest in the mid-tones).
* The model test also rejected the Sunburst versions of `paper-folds` (folds looked like cloth) and `night` (too literal and busy).

## 4. Post-processing

### Icons: `docs/art/tools/process_icon.py`

```
pip install pillow numpy opencv-python-headless rembg onnxruntime
python3 docs/art/tools/process_icon.py <render.png> <name> [--holes 0.72]
```

1. **Object mask.** rembg `isnet-general-use` produces a soft matte. Specks are removed, then the interior is made
   solid: everything more than about 3 px inside the silhouette becomes opaque, because the network leaves translucent
   patches on flat white faces. Enclosed pin-holes smaller than 900 px² are closed and inpainted. Real holes (gear hubs,
   ring centres) stay transparent.
2. **Contact shadow.** The object is inpainted out to get a "background plate". Shadow alpha is
   `(bgL − plateL) / (bgL − inkL)` in ink colour `#121210`, capped at 0.75 and faded out near the canvas border. On paper
   it looks like the original photograph. On dark UI it disappears without a grey halo.
3. **Decontamination.** `pymatting.estimate_foreground_ml` recovers the true edge colour, which removes the white fringe on dark backgrounds.
4. **Signal-orange normalisation.** The median hue of the orange accent (19.7–25° raw) is shifted to 18.6°, the hue of
   `#FF4F00`, and saturation is lifted slightly. Neutrals are untouched.
5. **Framing.** The object's bounding box is fitted to 84% of the canvas (8% margin), centred horizontally on the object
   and vertically on the object plus its core shadow. The image is shrunk further only if the faint shadow would clip.
   Resampling is done on premultiplied RGBA.
6. **Export.** `512×512` PNG (optimised) and WebP (q90, alpha).
7. **Edge check.** Composites on `#0B0B0E`, `#F2F0EA` and `#FFFFFF` go to `.art-work/comp/<name>.png`. View them.

`search` is processed with `--holes 0.72`, so the frosted lens becomes a 72%-opaque disc instead of a hole.

`--keywhite` keys pure background white that is visible *through* a bore (gear hub, reel hub) back to transparent. The
matte's interior solidification otherwise fills such bores with white, which shows as a lit-up hole on dark UI. Used for
`automation`, `graph`, `history`, `code`, `import` (harmless where there is no bore). `picks.tsv` carries it as a 4th column.

### Covers: `docs/art/tools/process_cover.py`

`python3 docs/art/tools/process_cover.py <render.png> <name> <anchor_y> [anchor_x] [grain_sigma]`

This crops the full-width 3:1 band at the given vertical anchor, resizes it to 1800×600 with Lanczos, optionally adds
grain, and saves WebP at q82. An optional 6th argument sets the WebP quality: `night` uses **90**, because q82 smeared
its shadow grain into blocks (27 KB instead of 11 KB).

`python3 docs/art/tools/grade_signal.py <render.png> <graded.png>` shifts the median orange hue of a render onto
`#FF4F00` (18.6°) and lifts its saturation, leaving neutrals untouched. Used on `ink` before cropping.

Renders that come back framed like a print (white border) are cropped inside the border first (`grain` 60 px, `glass` 40 px).

### Contact sheets: `docs/art/tools/contact_sheets.py [icons|covers]`

Reads both manifests and writes the three sheets in `docs/art/`. Labels use IBM Plex Mono; set `ART_FONT_DIR` to a
folder that contains `IBMPlexMono-Regular.ttf` and `IBMPlexMono-Bold.ttf`. Without it the script falls back to DejaVu Sans Mono.

## 5. Adding a new icon

1. Write `{OBJECT}` with one simple, instantly readable object, and `{ACCENT}` with exactly one orange part. Name the
   colour of every other part ("... is warm-white ceramic").
2. Generate it with Sunburst using the settings above. Raw renders and job logs go to `.art-work/` (gitignored).
3. Run `process_icon.py` and view the composite. If the result looks puffy, too detailed or has the wrong angle, retry
   with a sharper `{OBJECT}`. Allow at most 4 attempts.
4. Add an entry to `public/assets/icons/manifest.json` (`name`, `label`, `label_de`, `png`, `webp`) and re-run `contact_sheets.py icons`.

## 6. Art-direction review (round 2)

Every icon was checked on `#121210` and `#F2F0EA` at 1:1 and with 3× edge crops; every cover at 1800×600 plus 1:1
crops. Alpha edges are clean on all 21 icons (no white halo). Verdicts:

| item | verdict | reason / action |
|---|---|---|
| blocks, database, kanban, calendar, ai, command, sync, templates, publish, present, split, focus, search | PASS | — |
| lock | PASS | slightly more frontal than the set; acceptable |
| hammer | PASS | handle ~3.5× head (brief said 2.5×), still reads as a sledgehammer |
| app-icon | PASS | the bar reads as an abstract "1" for *One*; deliberate brand mark, not a glyph of type |
| graph | REJECT → replaced | flat, symmetric X seen almost top-down: broke the family's three-quarter camera and read as a molecule kit. New: asymmetric 3D network with one closed triangle |
| history | REJECT → replaced | screws, holes, toothed reels: far busier than the family; both reel hubs also showed unkeyed background white on dark. New: reduced cassette (two solid hubs, window, trapezoid strip) — still reads as a cassette |
| code | REJECT → replaced | extruded `{ }` braces are a typographic glyph (brief: no text or UI glyphs) and the most generic 3D-icon-pack motif. New: Braun-ET66-style calculator with blank keys and one orange key |
| import | REJECT → replaced | extruded download arrow is a UI glyph. New: in-tray with an orange card dropping in |
| automation | REJECT → re-cut | the large gear's bore was filled with background white (bright crescent on dark UI). Re-processed with `--keywhite`, no new render |
| paper-folds, aluminum, grain, concrete | PASS | the thin line on `concrete` is the top edge of a lower front wall (texture changes across it), not an artefact |
| night | PASS → re-encoded | re-encoded at q90 from the same render (q82 turned the shadow grain into blocks) |
| glass | REJECT → replaced | visible cyclorama arch and studio-backdrop shading behind the panes. New: full-bleed close-up of frosted panes in front of orange light fields, no room visible; 40 px border inset |
| dunes | REJECT → replaced | pseudo-script scribble marks in the sand and grey-blue smudges on the right slope (AI artefacts). New: high, graphic aerial of clean crescent dunes |
| ink | REJECT → colour-graded | peach (median hue 24°, low saturation), off-palette. Graded onto 18.6° with `grade_signal.py`. Two re-renders were tried and not used: `cov_ink_nb2` (the bloom reads as a jellyfish or tadpole), `cov_ink_nb3` (a silk ribbon with frayed threads and a visible water line) |

Credits: 4 icon renders × 32 + 4 cover renders × 40 = **288** (balance 20,471 → 20,183). Job IDs are in `.art-work/jobs.tsv`.

### Replacement cover prompts (verbatim, Nano Banana Pro, 21:9, 2K)

* **glass** (`cov_glass_nb3`, inset 40 px, anchor 0.5): Full-bleed abstract close-up photograph: several large sheets of acid-etched frosted glass overlap and fill the entire frame edge to edge, standing upright at slightly different angles and depths, seen from very close so that only glass is visible. Behind them a soft, blurred rectangular field of warm signal-orange (#FF4F00) light glows through the frosted glass and is diffused into calm, smooth gradients; where sheets overlap the orange deepens. The polished glass edges show as a few thin, crisp, bright vertical lines. No floor, no horizon, no room, no studio backdrop or cyclorama curve, no walls, no lamp or light source visible. Calm, minimal, quiet, large areas of soft negative space. Editorial still-life for a premium design magazine, medium-format camera, natural colour, subtle film grain, restrained palette of warm off-white, pale grey and one orange glow. Very wide panoramic composition whose interest sits in the central horizontal band. No border, no frame, no vignette, no people, no text, no logos, no fantasy elements, no neon, no HDR, no oversaturation, no lens flare.
* **dunes** (`cov_dunes_nb2`, anchor 0.5): Aerial photograph taken from directly above of pristine sand dunes at golden hour: a few long, clean, sweeping crescent ridgelines with razor-sharp crests dividing sunlit warm sand from deep soft shadow; large calm areas of smooth, untouched, fine-grained sand with delicate wind ripples. Abstract, graphic and minimal. The sand is perfectly clean: no footprints, no tracks, no marks, no scribbles, no debris, no stones, no dark stains or smudges, no vegetation. Warm tones from cream to burnt orange, deep umber shadows. Editorial landscape photograph for a premium design magazine, medium-format camera, natural colour, subtle film grain. Very wide panoramic composition whose interest sits in the central horizontal band. No people, no vehicles, no buildings, no text, no logos, no fantasy elements, no HDR, no oversaturation, no lens flare.
* **ink** keeps the original render `cov_ink_nb` → `grade_signal.py` → `cov_ink_nb_graded.png` → anchor 0.45.

## 7. Page icons (round 3, October 2026)

Ten more objects for the demo workspace's pages and the built-in templates, made with the unchanged template from
section 2 (`text2image`, two renders each, the better one kept; 600 credits). Picks and slots:

| name | label / label_de | {OBJECT} (short) | {ACCENT} | processing |
|---|---|---|---|---|
| binder | Wiki / Wiki | lever-arch ring binder standing on its edge, finger hole + blank label slot on the spine | a band around the spine | `--keywhite` |
| notepad | Notes / Notizen | notepad block lying flat, three raised bars on the top sheet | the binding strip | `--warmmask` |
| book | Reading list / Leseliste | closed hardcover book lying flat, ribbon bookmark | the ribbon | — |
| megaphone | Content & campaigns / Content & Kampagnen | compact megaphone on its side, pistol grip | the grip | `--keywhite` |
| microphone | Brand voice / Markenstimme | studio desk microphone, ribbed grille, round base | a band around the head | `--keywhite` |
| compass | Onboarding / Onboarding | flat orienteering compass, tick-mark bezel, blank face | one half of the needle | `--holes 1.0` |
| cardbox | Glossary / Glossar | open index card box with one divider card | the divider's tab | — |
| clock | Meetings / Meetings | square desk alarm clock after the Braun AB 1, tick marks only | the second hand | — |
| rolodex | Contacts & CRM / Kontakte & CRM | rotary card file on a low base | the side knob | `--warmmask` |
| counter | Habits / Gewohnheiten | hand-held tally counter with finger ring, blank wheels | the push button | `--keywhite` |

`--warmmask` (new in `process_icon.py`): the matting net read the large flat faces of `notepad` and `rolodex` as
background where they meet the white backdrop (they turned into holes on dark UI). The option also takes the object
by colour — warm-white ceramic has `R − B ≥ 5`, the backdrop is pure white and the contact shadow neutral grey — and
fills the interior from that mask, keeping the net's soft matte on the outermost pixels.

## 8. Calculate icons (round 4, October 2026)

Four objects for the landing's "Calculate" group and the object picker, same template as section 2 (`text2image`,
two renders each, the better one kept). Picks and slots:

| name | label / label_de | {OBJECT} (short) | {ACCENT} | processing |
|---|---|---|---|---|
| sheet | Spreadsheet / Tabellenkalkulation | thick square slab lying flat, 5 × 5 grid of recessed cells, raised header row and column | one cell near the centre | `--warmmask` |
| fx | Functions / Funktionen | tree of three blank keycaps: one on top, two rods down to two keycaps on the ground | the top keycap | — |
| chart | Charts / Diagramme | four square-section bars of different heights on a thin base plate | the tallest bar | `--warmmask` |
| adder | Formulas & rollups / Formeln & Rollups | low wedge-shaped adding machine, four blank dials on the sloped face, crank on the side | the crank's knob | `--warmmask` |
