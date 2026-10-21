# Active assets

- Grass 005 — ambientCG: https://ambientcg.com/a/Grass005 (2K Color, NormalGL, Roughness). CC0: https://docs.ambientcg.com/license/
- Quiver Tree 02 — Poly Haven: https://polyhaven.com/a/quiver_tree_02 (glTF, 1K). CC0: https://polyhaven.com/license
- Reticulated Giraffe - Rigged & Animated — Animal Animator: https://sketchfab.com/3d-models/reticulated-giraffe-rigged-animated-b8a7cf34d2614b8c93e76d5300f9aaaa . Creative Commons Attribution per user-provided download screenshot; exact version not supplied. User-provided original GLB, scaled to 5 world units high. Built-in animation clips used without modifying the source file: 01_Idle_Ruminating, 02_Walk, 03_Run_Gallop.

The procedural giraffe, grass blades and rocks have been removed from the scene and source. The earlier Leafy Grass files remain unused on disk.

## Project archive (2026-10-21)
- Sports poster: https://www.instagram.com/p/Db5UwdEEaVs/ — nuvook_ / livinglikeagiraffe_. Program context: https://www.instagram.com/p/DcMF-HzE5aM/
- Mental Sauna poster: https://www.instagram.com/p/DX6zjVmk2Yg/ — moa.lnp and collaborators. Program and credits: https://www.instagram.com/p/DYzoaMNAbp5/
- Original post images downloaded using the browser's native media download, with explicit user permission for this site. These project images are not CC0.
- The four user-specified recap posts are stored in assets/projects/posts.json. All 59 carousel items (images and video, in original order) are stored locally with user permission. Visible videos autoplay muted; offscreen and background playback is paused.
- Relay lanes, pennants and sauna architecture interpret the projects rather than reproducing the venues.

## Realistic furnishing update
All following models are downloaded glTF assets with their original 1K PBR textures, from Poly Haven under CC0. Local copies: assets/props/<id>/.
- https://polyhaven.com/a/painted_wooden_bench
- https://polyhaven.com/a/wooden_bucket_01
- https://polyhaven.com/a/barrel_stove
- https://polyhaven.com/a/football (inflated variant only)
- https://polyhaven.com/a/wooden_picnic_table
- https://polyhaven.com/a/potted_plant_01
- https://polyhaven.com/a/portable_cassette_player
- https://polyhaven.com/a/folding_wooden_stool
- Deck/wall PBR material: https://polyhaven.com/a/brown_planks_03
License: https://polyhaven.com/license . Models are resized and arranged for the project exhibition; they are not records of actual event equipment.

## Pretendard
- Source: https://github.com/orioncactus/pretendard (v1.3.9)
- Copyright 2021 Kil Hyung-jin; SIL Open Font License 1.1.
- Local variable webfont: assets/fonts/PretendardVariable.woff2; license: assets/fonts/LICENSE.

## Sauna cutaway
Custom open-roof/front architecture, two-tier slatted benches, sconces and soft procedural steam; cedar surfaces reuse the documented Poly Haven Brown Planks 03 material. Heater, buckets and cassette player remain Poly Haven assets.

## Sports equipment update
CC0, original PBR models: https://polyhaven.com/a/baseball_bat , https://polyhaven.com/a/baseball_01 , https://polyhaven.com/a/american_football , https://polyhaven.com/a/old_tyre , https://polyhaven.com/a/wooden_crate_01 . Tyres rotated for an agility course.

## Original recap sources
- https://www.instagram.com/p/DYzoaMNAbp5/ — 9 items, Mental Sauna project text and credit roles.
- https://www.instagram.com/p/DYznV1bAWT5/ — 16 items, BTS.
- https://www.instagram.com/p/Dd-dc1Rk3Em/ — 15 items, sports event gallery.
- https://www.instagram.com/p/Dd-eBlHkzyJ/ — 19 items, sports project text and credit roles.
Captions preserved verbatim; single line breaks inside paragraphs are reflowed. Account handles link to original profiles. Source JSON snapshots retained alongside the media.

## Typography reference
https://postmelee.github.io/pear/ko/ — measured visual values from the public tokens.css, components.css and style.css: system sans, article font size calc(.9375rem + .25vw), Korean line-height 1.75, weight 500 headings, #fffcf0 paper, #100f0f text, #6f6e69 muted text and link underline. CSS implementation is written for this reader.

## Team profile
- Original public profile image from https://www.instagram.com/livinglikeagiraffe_/ (2026-10-21), saved as assets/projects/team-profile.jpg at its original 100×100 resolution. Used with the user’s permission; displayed with a circular CSS crop and linked to the account.

### Typography audit (2026-10-21)
Rechecked the published Pear tokens.css, components.css and style.css. Corrected author text from fixed 14px to Pear shell body size clamp(1rem, .875rem + .2vw, 1.125rem), weight 400 and line-height 1.55; avatar is 32px. Poster title follows blog-title-size (28–36px), date follows article-meta inside article-body, h3 follows body size. Body, h2, links and muted colors match the reference. At 1512px viewport: author 17.024px, article body/date 18.78px, h2 20px, poster title 36px. Scene labels intentionally retain the requested original Pretendard uppercase style in white instead of Pear gray.

## Evening lighting and reader
Custom floodlight fixtures reuse the sports field’s existing rear poles; small emissive bulbs follow the pennant cable. No new external models. Dusk reader colors follow Pear’s dark tokens: paper #100f0f, text #cecdc3, muted #878580, surface #1c1b1a, border #282726, focus #a0af54; scoped to the project reader.

## Giraffe companion
The same credited Animal Animator GLB is reused for one independently animated NPC, with the original 01_Idle_Ruminating clip looping. No additional external model.

## Team meadow rug
The original team profile image documented above is reused unchanged as the circular rug's printed surface. Custom thin geometry, cream stitched binding and procedural textile bump detail; placed in the foreground meadow at (-1, 10.5). No additional external asset.

## BlueMesh sauna companion
- Giraffe by BlueMesh: https://sketchfab.com/3d-models/giraffe-522c042aad9f4348a74c2985ec3f99f9
- Author: https://sketchfab.com/VapTor ; CC BY 4.0: https://creativecommons.org/licenses/by/4.0/
- Source and license read from the supplied GLB metadata. Local file: assets/giraffe/bluemesh/giraffe.glb.
- Removed display plinth/studio lights, normalized height to 5, changed metallic fur to nonmetallic, and looped the original four-second Take 01. Placed beside the sauna at (12.5, -1), with the shared face-view interaction.

### BlueMesh rendering correction
The supplied body material uses alphaMode BLEND. Rendered as alpha-tested cutouts (threshold 0.5) with depth writing to prevent overlapping body surfaces appearing through each other; original texture and geometry are unchanged. Turned the companion slightly sideways for a clearer silhouette in the quarter view. Removed the two ivory connecting path rectangles.

## Web optimization (2026-10-21)
Original source files are retained locally in .source-assets/ and excluded from publication. Grass color remains 2048px; normal/roughness are 1024px and JPEG-optimized. Main giraffe body color is reduced from 8192px to 4096px, roughness/tongue color to 1024px, and embedded images recompressed. All original geometry, skin, animation and non-image buffer bytes are unchanged. Original source/license links above apply to these modified copies.
