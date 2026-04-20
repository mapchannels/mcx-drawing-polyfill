# mcx-drawing-polyfill
# Google Maps Drawing Manager Polyfill
A standalone, zero-dependency drop-in replacement for the deprecated `google.maps.drawing` library in the Google Maps Javascript API.

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

## Example

https://mapchannels.github.io/mcx-drawing-polyfill/demo.html
    
    document.head.appendChild(polyfill);
}
