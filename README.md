# Tone Recall

Tone Recall is a capture-first tone library for saving guitar tones before they are forgotten. It runs as a local-first web app for mobile and desktop: save a photo, title, description/tags, and optional voice memo.

## Product Flow

1. Press `Save Tone`.
2. Take/import/paste a pedalboard photo.
3. Add a title and description with tags like `#crunchy`.
4. Optionally add pedals, then add knob-name/value rows under each selected pedal.
5. Optionally record or attach a voice memo.
6. Zoom and pan the saved photo when checking details.
7. Return to the library.

The library search matches titles, descriptions, and tags, then shows matching tones as cards.

## MVP Stack

The active prototype is a static web app using IndexedDB for local storage. It has no API dependency.

## Implementation Plan

1. Build a photo-first static app with local persistence.
2. Support quick import/paste/camera capture from the tone detail screen.
3. Keep tone context separate from pedal and knob assignment.
4. Verify `ToneRecall.html` loads, capture/import works, zoom/pan works on the photo, and saved tones remain in the local browser library.
5. Defer computer vision, cloud sync, sharing, and automatic knob recognition.

## Run

Open `ToneRecall.html` in a browser for local desktop testing. For mobile camera, microphone, and PWA behavior, serve the folder over localhost or HTTPS. New audio clips are stored as browser data URLs for simpler local playback. Browser-recorded clips may download as `.webm` on Chrome; attach `mp3`, `m4a`, or `wav` files when external player compatibility matters.
