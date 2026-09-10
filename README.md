# Google Maps Drawing Manager Polyfill

A standalone, zero-dependency drop-in replacement for the deprecated `google.maps.drawing` library.

## 🆕 v2.0 — `mcx-drawing-polyfill-v2.js` (unified file)

Version 2.0 merges the base polyfill, PR #1 (AdvancedMarkerElement + styling options) and the circle/rectangle extension into a **single file**: **`mcx-drawing-polyfill-v2.js`**. Existing pages using `mcx-drawing-polyfill.js` + `mcx-drawing-shapes.js` work unchanged — just swap the script tag(s) for the one file. The two old files remain in the repo for one release but are **deprecated** in favour of `mcx-drawing-polyfill-v2.js`.

### Dual marker support

The marker tool and the finishing node can use either marker class, controlled by the `markerType` option:

| `markerType` | Behaviour |
|---|---|
| `'auto'` (default) | Advanced if `google.maps.marker.AdvancedMarkerElement` is available **and** the map was created with a `mapId`; otherwise basic. |
| `'basic'` | Always `google.maps.Marker`. |
| `'advanced'` | `AdvancedMarkerElement`, but falls back to basic with a `console.warn` if the prerequisites are missing. |

Advanced mode requires the Maps API loaded with **`&libraries=marker`** and a map **`mapId`**; basic mode needs neither. The resolved mode is logged via `console.info` on attach and readable via `drawingManager.getMarkerType()`.

In advanced mode, `overlaycomplete` for markers carries an `AdvancedMarkerElement` (`.position` property, not `.getPosition()`). Use **`google.maps.drawing.MCXMarkerUtils.getLatLng(overlay)`** to read `{lat, lng}` from either marker class without branching.

### DrawingManagerOptions reference

All styling options are **partial overrides** — supply only the fields you want to change and the defaults fill in the rest.

| Option | Applies to | Notes |
|---|---|---|
| `map` | — | Map to attach to (or call `setMap()` later). |
| `drawingMode` | — | Initial mode; `null` = pan. |
| `drawingControl` | toolbar | `false` suppresses the toolbar. |
| `drawingControlOptions` | toolbar | `{ position, drawingModes }`; modes: `'marker'`, `'polyline'`, `'polygon'`, `'circle'`, `'rectangle'`. |
| `markerType` | markers | `'basic' \| 'advanced' \| 'auto'` (see above). |
| `markerOptions` | completed markers | **Interpreted per resolved mode**: `MarkerOptions` in basic mode (e.g. `icon`, `label`), `AdvancedMarkerElementOptions` in advanced mode (e.g. `content` — an Element is cloned per marker — `gmpDraggable`). There is no translation layer. |
| `polylineOptions` | completed polylines **and** the in-progress line | The active line's stroke colour/weight/opacity mirror these so preview matches result. |
| `polygonOptions` | completed polygons | |
| `circleOptions` | circles | Drawn shapes are promoted to `editable`/`draggable`/`clickable` on completion. |
| `rectangleOptions` | rectangles | As above. |
| `ghostlineOptions` | dotted preview line | `icons` supplies the repeating dot symbol(s). `clickable` and `zIndex` are **fixed internally** and cannot be overridden. |
| `finishingMarkerSVGOptions` | finishing node (both modes) | `fillColor`, `fillOpacity`, `strokeColor`, `strokeWeight`, `scale` — rendered as a Symbol in basic mode and as a generated SVG in advanced mode. |
| `finishingMarkerSVG` | finishing node (advanced only) | Custom SVG markup; ignored (with a warning) in basic mode. Overrides `finishingMarkerSVGOptions`. |

### Helpers

* `google.maps.drawing.MCXShapeUtils` — `metersBetween(a, b)`, `rectangleSize(rect)`, `setRectangleSize(rect, w, h)` (metres, spherical maths, zero-dependency).
* `google.maps.drawing.MCXMarkerUtils` — `getLatLng(overlay)` → `{lat, lng}` from either marker class.

### Demos

* **`demo-basic.html`** — API without `libraries=marker`, no `mapId` → auto-resolves to basic. All five tools + custom shape/ghost-line styling + the metre-based property editor.
* **`demo-advanced.html`** — API with `libraries=marker`, map with a `mapId` → auto-resolves to advanced. Custom HTML pin markers, custom SVG finishing node, `MCXMarkerUtils` output.
* **`demo-combined.html`** — both of the above side by side on one page, from one API load and one script file, demonstrating `'auto'` resolving differently per map.

---

## ⚠️ Why is this needed?
In August 2025, Google deprecated the `google.maps.drawing` library. It will be completely removed from the Maps JavaScript API in **May 2026**. 

While Google recommends migrating to third-party libraries like Terra Draw, doing so requires completely rewriting your UI, state management, and event-handling logic, as Terra Draw is headless and uses a different event architecture.

This polyfill solves the problem by **perfectly replicating the original Google Maps Drawing Manager**. You can keep your existing legacy code, UI expectations, and event listeners exactly as they are.

## ✨ Features
* **Zero Dependencies:** Does not rely on Terra Draw, Leaflet, or any other third-party rendering engines.
* **Drop-in Replacement:** Uses the exact same `google.maps.drawing.DrawingManager` class, properties, and methods.
* **Native UI Replicated:** Automatically injects the classic white Google Maps drawing toolbar (Pan, Marker, Polyline, Polygon) using the Custom Controls API.
* **Event Bridging:** Fires standard `overlaycomplete`, `markercomplete`, `polylinecomplete`, and `polygoncomplete` events so your legacy listeners don't break.
* **Smart Finishing Nodes:** Automatically adds an interactive "finishing node" (a white circle) to easily close polygons or terminate polylines without relying on clunky double-clicks.

## 🆕 Update — 26 June 2026: Circle & Rectangle Tools

An optional extension, **`mcx-drawing-shapes.js`**, adds two more drawing tools on top of the core polyfill. Load it *after* `mcx-drawing-polyfill.js` and it self-applies by monkey-patching the `DrawingManager` prototype — the base file is left untouched.

* **Two new tools:** adds `circle` and `rectangle` to `OverlayType` and the toolbar. List them in `drawingControlOptions.drawingModes` to show the buttons.
* **Drag-to-draw:** press and drag to size the shape (map panning is suspended while these tools are active, then automatically restored).
* **Editable & resizable:** finished shapes are returned as native `google.maps.Circle` / `google.maps.Rectangle` with resize handles and drag-to-move.
* **Metre-based editing:** read or set real-world dimensions — circle **radius**, rectangle **width** / **height** — in metres via `google.maps.drawing.MCXShapeUtils` (`rectangleSize`, `setRectangleSize`, `metersBetween`). Uses inline spherical maths, so it remains **zero-dependency** (no geometry library required).
* **Event Bridging:** fires `overlaycomplete` (with `type: 'circle' | 'rectangle'`) plus dedicated `circlecomplete` / `rectanglecomplete` events, matching the existing pattern.

```javascript
// After Google Maps + the base polyfill have loaded:
const ext = document.createElement('script');
ext.src = 'mcx-drawing-shapes.js';
ext.onload = initApp;
document.head.appendChild(ext);

// ...then simply list the extra tools when creating the DrawingManager:
drawingControlOptions: {
    drawingModes: ['marker', 'polyline', 'polygon', 'circle', 'rectangle']
}
```

See **`demo-shapes.html`** for a complete example with a live metre-based property editor (radius / width / height), resize handles, and click-empty-map-to-deselect.

## 🚀 How it works
Because Google is only deprecating the *interaction layer* (the Drawing Manager), the base map shapes (`google.maps.Marker`, `google.maps.Polyline`, `google.maps.Polygon`) remain perfectly safe and fully supported. 

This polyfill hijacks the `window.google.maps.drawing` namespace. It tracks native map `click` and `mousemove` events to render temporary "ghost lines" and shapes, and then outputs standard Google Maps Overlay objects when the shape is completed. 

*(Note: This polyfill handles the **creation** of shapes. For post-creation node editing, simply use the native `editable: true` property on standard Google Polylines/Polygons).*

## 📦 How to Integrate

**Crucial Step:** Because this polyfill injects itself into the `google.maps` namespace, it **must** be loaded *after* the Google Maps API has fully initialized.

If you load Google Maps dynamically (via callback):

```javascript
function loadGoogleMaps() {
    const script = document.createElement('script');
    // Do NOT include libraries=drawing
    script.src = '[https://maps.googleapis.com/maps/api/js?key=YOUR_API_KEY&callback=onMapsReady](https://maps.googleapis.com/maps/api/js?key=YOUR_API_KEY&callback=onMapsReady)';
    document.head.appendChild(script);
}

function onMapsReady() {
    // 1. Load the polyfill
    const polyfill = document.createElement('script');
    polyfill.src = 'mcx-drawing-polyfill.js';
    
    polyfill.onload = function() {
        // 2. Initialize your map and DrawingManager normally!
        initApp(); 
    };
    
    document.head.appendChild(polyfill);
}
