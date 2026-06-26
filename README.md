# Google Maps Drawing Manager Polyfill

A standalone, zero-dependency drop-in replacement for the deprecated `google.maps.drawing` library.

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
