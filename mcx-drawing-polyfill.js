/*!
 * MCX Drawing — Google Maps Drawing Manager Polyfill (Unified)
 * Version 2.0.0
 *
 * File: mcx-drawing-polyfill.js
 *
 * A zero-dependency, drop-in replacement for the deprecated google.maps.drawing
 * library. This single file merges:
 *   - the base polyfill (marker / polyline / polygon tools)
 *   - PR #1: AdvancedMarkerElement support + styling options (GotGud2)
 *   - the circle / rectangle drag-to-draw extension + MCXShapeUtils
 *
 * Marker modes:
 *   markerType: 'basic' | 'advanced' | 'auto'   (default 'auto')
 *   Advanced mode requires the Maps API loaded with `&libraries=marker` AND a
 *   map created with a `mapId`. 'auto' picks advanced only when both are met;
 *   forcing 'advanced' without the prerequisites warns and falls back to basic.
 *   Neither is required for basic mode.
 *
 * DrawingManagerOptions (all optional, partial overrides merge onto defaults):
 *   map                      google.maps.Map to attach to
 *   drawingMode              initial mode (null = pan)
 *   drawingControl           false to suppress the toolbar
 *   drawingControlOptions    { position, drawingModes: ['marker','polyline',
 *                              'polygon','circle','rectangle'] }
 *   markerType               'basic' | 'advanced' | 'auto'
 *   markerOptions            options for COMPLETED markers. Interpreted per
 *                            resolved mode: MarkerOptions in basic mode,
 *                            AdvancedMarkerElementOptions in advanced mode
 *                            (an Element `content` is cloned per marker).
 *   polylineOptions          styling for completed polylines; also drives the
 *                            in-progress line's stroke so preview matches result
 *   polygonOptions           styling for completed polygons
 *   circleOptions            styling for circles (drawn by drag)
 *   rectangleOptions         styling for rectangles (drawn by drag)
 *   ghostlineOptions         styling for the dotted preview line. Note:
 *                            `clickable` and `zIndex` are fixed internally and
 *                            cannot be overridden.
 *   finishingMarkerSVGOptions  styles the finishing node in BOTH modes
 *                            (fillColor, fillOpacity, strokeColor,
 *                            strokeWeight, scale)
 *   finishingMarkerSVG       custom SVG markup for the finishing node —
 *                            advanced mode only (warns and is ignored in basic)
 *   suppressCompletedClicks  default true. While a drawing tool is active,
 *                            overlays this manager has already completed are
 *                            made non-clickable so they cannot swallow a
 *                            drawing click. Set false to opt out.
 *   silent                   true to suppress informational console output
 *                            (warnings are always emitted)
 *
 * Public API: setMap / getMap / setDrawingMode / getDrawingMode / setOptions /
 *   getMarkerType / getCompletedOverlays
 *
 * Debugging: set `window.mcxDrawingDebug = true` before interacting to log every
 *   map click the manager sees, including the reason a click was discarded.
 *
 * IMPORTANT: this file must be loaded AFTER the Google Maps JS API. Loading it
 *   first is now a hard error rather than a silent no-op.
 *
 * ── Changes in 2.0.0 ──────────────────────────────────────────────────────
 *   - FIX: completed overlays no longer swallow the first click after a tool is
 *     selected (they were left `clickable: true` and consumed the map click).
 *   - FIX: click-debounce state (`_lastMapClickTime` / `_ignoreMapClick`) is now
 *     reset on every mode change, so a tool picked within 150 ms of finishing a
 *     shape no longer drops its first click.
 *   - FIX: an initial `drawingMode` passed to the constructor now routes through
 *     setDrawingMode(), so cursor, toolbar state and map draggability are all
 *     applied (previously a starting mode of 'circle'/'rectangle' left the map
 *     pannable and the drag-to-draw tools unusable).
 *   - FIX: hard failure when loaded before the Maps API instead of installing
 *     onto a stub `window.google` that the real API then replaces.
 *   - ADD: setOptions(), getCompletedOverlays(), google.maps.drawing.MCX_VERSION.
 *   - ADD: `silent` option and `window.mcxDrawingDebug` diagnostics.
 *   - CHANGE: constructor options are shallow-copied instead of retained by
 *     reference.
 *
 * NOTE for consumers that make completed shapes `editable`/`draggable`: an
 *   editable overlay's vertex handles are separate DOM/SVG hit targets and are
 *   NOT covered by suppressCompletedClicks. Clear your selection when a drawing
 *   mode is entered (the bundled demo does this by wrapping setDrawingMode).
 *
 * Events (on the DrawingManager): overlaycomplete, markercomplete,
 *   polylinecomplete, polygoncomplete, circlecomplete, rectanglecomplete
 *
 * Helpers:
 *   google.maps.drawing.MCXShapeUtils  — metersBetween, rectangleSize,
 *                                        setRectangleSize
 *   google.maps.drawing.MCXMarkerUtils — getLatLng(overlay) → {lat, lng}
 *                                        from either marker class
 *
 * Author: Robert McMahon
 * Contributors: GotGud2 (PR #1 — AdvancedMarker + styling options)
 * Website: https://www.mapchannels.com/
 * GitHub: https://github.com/mapchannels/mcx-drawing-polyfill
 *
 * Released under the MIT License.
 * Copyright (c) 2026 Map Channels
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction... (see GitHub repo for full license).
 */

(function ()
{
    'use strict';

    // ── Load-order guard ───────────────────────────────────
    // This file patches an object the Maps API owns. If it runs first there is
    // nothing to patch, and creating a stub `window.google` is worse than
    // useless: the real API replaces window.google.maps wholesale when it
    // loads, silently discarding everything installed here. Fail loudly.
    if (!window.google || !window.google.maps || typeof window.google.maps.Map !== 'function')
    {
        console.error('[MCX] mcx-drawing-polyfill must be loaded AFTER the Google Maps JS API. ' +
            'Load it from the Maps API callback (see the bundled demos). Nothing was installed.');
        return;
    }

    // Guard: only inject if the native library is absent
    if (window.google.maps.drawing)
    {
        return; // Native library present — do nothing
    }

    var MCX_VERSION = '2.0.0';

    // Informational logging is opt-out per manager (`silent: true`) and can be
    // killed page-wide with window.mcxDrawingSilent. Warnings always print.
    function _info(msg)
    {
        if (window.mcxDrawingSilent) return;
        console.info(msg);
    }

    function _debug(label, data)
    {
        if (!window.mcxDrawingDebug) return;
        console.log('[MCX debug] ' + label, data);
    }

    // ── CSS Injection ──────────────────────────────────────

    var TOOLBAR_CSS = [
        '.mcx-draw-toolbar {',
        '  display: flex;',
        '  align-items: center;',
        '  background: #fff;',
        '  border-radius: 2px;',
        '  box-shadow: rgba(0,0,0,0.3) 0 1px 4px -1px;',
        '  margin: 10px;',
        '  overflow: hidden;',
        '}',
        '.mcx-draw-btn {',
        '  width: 40px;',
        '  height: 40px;',
        '  display: flex;',
        '  align-items: center;',
        '  justify-content: center;',
        '  cursor: pointer;',
        '  border: none;',
        '  background: #fff;',
        '  border-right: 1px solid #e0e0e0;',
        '  padding: 0;',
        '  transition: background 0.15s;',
        '  flex-shrink: 0;',
        '}',
        '.mcx-draw-btn:last-child { border-right: none; }',
        '.mcx-draw-btn:hover { background: #f5f5f5; }',
        '.mcx-draw-btn.mcx-draw-active {',
        '  background: #e8e8e8;',
        '  box-shadow: inset 0 1px 3px rgba(0,0,0,0.2);',
        '}',
        '.mcx-draw-btn svg { pointer-events: none; }',
    ].join('\n');

    var _stylesInjected = false;
    function _injectStyles()
    {
        if (_stylesInjected) return;
        var style = document.createElement('style');
        style.id = 'mcx-drawing-polyfill-css';
        style.textContent = TOOLBAR_CSS;
        document.head.appendChild(style);
        _stylesInjected = true;
    }

    // ── SVG Icons ──────────────────────────────────────────

    var ICONS = {
        hand: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M6 14a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4v-2.5a.5.5 0 0 0-.5-.5H6.5a.5.5 0 0 0-.5.5V14z"/></svg>',
        marker: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#555" stroke="#555" stroke-width="0"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>',
        polyline: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,17 9,7 15,13 21,5"/></svg>',
        polygon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="rgba(85,85,85,0.15)" stroke="#555" stroke-width="2" stroke-linejoin="round"><polygon points="12,3 21,9 18,20 6,20 3,9"/></svg>',
        circle: '<svg width="18" height="18" viewBox="0 0 24 24" fill="rgba(85,85,85,0.15)" stroke="#555" stroke-width="2"><circle cx="12" cy="12" r="8"/></svg>',
        rectangle: '<svg width="18" height="18" viewBox="0 0 24 24" fill="rgba(85,85,85,0.15)" stroke="#555" stroke-width="2"><rect x="4" y="6" width="16" height="12" rx="1"/></svg>'
    };

    // ── OverlayType enum ───────────────────────────────────

    var OverlayType = {
        MARKER: 'marker',
        POLYGON: 'polygon',
        POLYLINE: 'polyline',
        CIRCLE: 'circle',
        RECTANGLE: 'rectangle'
    };

    function _isDragShapeMode(mode)
    {
        return mode === OverlayType.CIRCLE || mode === OverlayType.RECTANGLE;
    }

    // ── Geometry helpers (spherical, zero-dependency) ──────

    var R = 6378137;            // Earth radius (m) — matches Google's spherical model
    var DEG = Math.PI / 180;
    var M_PER_DEG_LAT = R * DEG; // metres per degree of latitude (~111320 m)

    function _haversine(lat1, lng1, lat2, lng2)
    {
        var dLat = (lat2 - lat1) * DEG;
        var dLng = (lng2 - lng1) * DEG;
        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
    }

    function _metersBetween(a, b)
    {
        return _haversine(a.lat(), a.lng(), b.lat(), b.lng());
    }

    // Width (E-W) and height (N-S) of a rectangle's bounds, in metres
    function _rectangleSize(rect)
    {
        var b = rect.getBounds();
        if (!b) return { widthMeters: 0, heightMeters: 0 };
        var ne = b.getNorthEast();
        var sw = b.getSouthWest();
        var midLat = (ne.lat() + sw.lat()) / 2;
        var width = _haversine(midLat, sw.lng(), midLat, ne.lng());
        var height = _haversine(sw.lat(), sw.lng(), ne.lat(), sw.lng());
        return { widthMeters: width, heightMeters: height };
    }

    // Resize a rectangle to an exact width/height (m) about its current centre
    function _setRectangleSize(rect, widthMeters, heightMeters)
    {
        var b = rect.getBounds();
        if (!b) return;
        var c = b.getCenter();
        var lat = c.lat();
        var dLatDeg = (heightMeters / 2) / M_PER_DEG_LAT;
        var cosLat = Math.cos(lat * DEG) || 1e-9;
        var dLngDeg = (widthMeters / 2) / (M_PER_DEG_LAT * cosLat);
        rect.setBounds(new google.maps.LatLngBounds(
            new google.maps.LatLng(lat - dLatDeg, c.lng() - dLngDeg),
            new google.maps.LatLng(lat + dLatDeg, c.lng() + dLngDeg)
        ));
    }

    // ── Marker helpers ─────────────────────────────────────

    // Reads a {lat, lng} from either google.maps.Marker (getPosition()) or
    // google.maps.marker.AdvancedMarkerElement (.position), so consumers of
    // overlaycomplete don't need to branch on the resolved marker mode.
    var MCXMarkerUtils = {
        getLatLng: function (overlay)
        {
            if (!overlay) return null;
            var pos = (typeof overlay.getPosition === 'function')
                ? overlay.getPosition()
                : overlay.position;
            if (!pos) return null;
            return {
                lat: (typeof pos.lat === 'function') ? pos.lat() : pos.lat,
                lng: (typeof pos.lng === 'function') ? pos.lng() : pos.lng
            };
        }
    };

    // ── DrawingManager Class ───────────────────────────────

    var DrawingManager = (function ()
    {

        function DrawingManager(options)
        {
            options = options || {};

            this._map = null;
            this._currentMode = options.drawingMode || null;

            // Shallow copy: retaining the caller's object meant later mutations
            // of it leaked into the manager with undefined timing.
            this._options = Object.assign({}, options);

            this._silent = options.silent === true;

            // Completed overlays this manager created. Kept so they can be made
            // non-clickable while a tool is active — otherwise a click landing on
            // an existing shape is consumed by that shape and never reaches the
            // map listener, which reads to the user as "the click did nothing".
            this._completed = [];
            this._suppressCompletedClicks = options.suppressCompletedClicks !== false;

            // In-progress drawing state
            this._coords = [];         // accumulated coordinates
            this._activeShape = null;  // primary google.maps.Polyline being drawn (even for polygons!)
            this._ghostLine = null;    // dashed preview line to cursor
            this._finishingMarker = null; // The interactive node to close/finish shapes

            this._ignoreMapClick = false; // Safety guard to prevent double-firing
            this._lastMapClickTime = 0;   // Timestamp of the last accepted vertex click

            // Drag-to-draw (circle / rectangle) state
            this._shapeDragging = false;
            this._shapePreview = null;
            this._shapeStart = null;

            // Map event listener handles (for cleanup)
            this._listeners = [];

            // Toolbar DOM reference
            this._toolbar = null;
            this._btnElements = {};    // mode → button element

            // Resolved marker mode ('basic' | 'advanced'), decided at setMap() time
            this._markerMode = null;

            // Bind stable handler references
            this._onMapClick = this._handleMapClick.bind(this);
            this._onMouseMove = this._handleMouseMove.bind(this);
            this._onFinishingNodeClick = this._handleFinishingNodeClick.bind(this);

            // ── Styling / customisation options ────────────
            // All option objects are initialised BEFORE setMap() runs so any
            // code on the attach path can rely on them (fixes PR ordering).

            // Options for COMPLETED markers. Interpreted by the resolved marker
            // mode: MarkerOptions (basic) or AdvancedMarkerElementOptions (advanced).
            this._markerOptions = options.markerOptions || {};

            this._polylineOptions = {
                strokeColor: '#1a73e8',
                strokeWeight: 3,
                strokeOpacity: 0.9,
                clickable: true
            };
            if (options.polylineOptions)
            {
                Object.assign(this._polylineOptions, options.polylineOptions);
            }

            this._polygonOptions = {
                strokeColor: '#1a73e8',
                strokeWeight: 2,
                strokeOpacity: 0.9,
                fillColor: '#1a73e8',
                fillOpacity: 0.25,
                clickable: true
            };
            if (options.polygonOptions)
            {
                Object.assign(this._polygonOptions, options.polygonOptions);
            }

            this._circleOptions = {
                strokeColor: '#1a73e8',
                strokeWeight: 2,
                strokeOpacity: 0.9,
                fillColor: '#1a73e8',
                fillOpacity: 0.2
            };
            if (options.circleOptions)
            {
                Object.assign(this._circleOptions, options.circleOptions);
            }

            this._rectangleOptions = {
                strokeColor: '#1a73e8',
                strokeWeight: 2,
                strokeOpacity: 0.9,
                fillColor: '#1a73e8',
                fillOpacity: 0.2
            };
            if (options.rectangleOptions)
            {
                Object.assign(this._rectangleOptions, options.rectangleOptions);
            }

            // Dotted preview line styling. `clickable` and `zIndex` are fixed
            // internally (documented) — everything else is overridable.
            this._ghostlineOptions = {
                strokeOpacity: 0, // The main solid stroke must be hidden for dots to work
                icons: [{
                    icon: {
                        path: google.maps.SymbolPath.CIRCLE,
                        fillColor: '#1a73e8',
                        fillOpacity: 0.7,
                        strokeOpacity: 0,
                        scale: 2
                    },
                    offset: '0',
                    repeat: '4px'
                }]
            };
            if (options.ghostlineOptions)
            {
                Object.assign(this._ghostlineOptions, options.ghostlineOptions);
            }

            // Finishing node styling — applies in BOTH marker modes.
            this._finishingMarkerSVGOptions = {
                fillColor: '#ffffff',
                fillOpacity: 1,
                strokeColor: '#1a73e8',
                strokeWeight: 2,
                scale: 5
            };

            if (options.finishingMarkerSVG)
            {
                // Custom SVG markup for the finishing node (advanced mode only)
                this._finishingMarkerSVG = options.finishingMarkerSVG;
                if (options.finishingMarkerSVGOptions)
                {
                    console.warn('[MCX] finishingMarkerSVGOptions are ignored when finishingMarkerSVG is provided.');
                }
            } else
            {
                if (options.finishingMarkerSVGOptions)
                {
                    Object.assign(this._finishingMarkerSVGOptions, options.finishingMarkerSVGOptions);
                }

                // The square bounding box (px) the generated SVG needs to be fully visible
                this._finishingMarkerSVGOptions.boundingSize =
                    (parseFloat(this._finishingMarkerSVGOptions.scale != null ? this._finishingMarkerSVGOptions.scale : 1) * 2) +
                    (parseFloat(this._finishingMarkerSVGOptions.strokeWeight != null ? this._finishingMarkerSVGOptions.strokeWeight : 0) * 2);

                // Generate a circle SVG matching the Symbol the basic mode uses
                var fo = this._finishingMarkerSVGOptions;
                this._finishingMarkerSVG =
                    '<svg height="' + fo.boundingSize + '" width="' + fo.boundingSize + '" xmlns="http://www.w3.org/2000/svg">' +
                    '<circle cx="' + (fo.boundingSize / 2) + '" cy="' + (fo.boundingSize / 2) + '" r="' + (fo.scale != null ? fo.scale : 1) + '"' +
                    ' fill="' + (fo.fillColor || '#000') + '" opacity="' + (fo.fillOpacity != null ? fo.fillOpacity : 1) + '"' +
                    ' stroke="' + (fo.strokeColor || 'transparent') + '" stroke-width="' + (fo.strokeWeight != null ? fo.strokeWeight : 0) + '"/></svg>';
            }

            // Attach to map if provided — LAST, so all options above are ready
            if (options.map)
            {
                this.setMap(options.map);
            }
        }

        // ── Public API ─────────────────────────────────────

        DrawingManager.prototype.setMap = function (map)
        {
            if (this._map === map) return;

            // Detach from old map
            if (this._map)
            {
                this._detachFromMap();
            }

            this._map = map;

            if (map)
            {
                this._markerMode = this._resolveMarkerMode();
                if (!this._silent)
                {
                    _info('[MCX] Marker mode resolved: ' + this._markerMode +
                        (this._markerMode === 'basic' && this._finishingMarkerSVGProvided()
                            ? ' — custom finishingMarkerSVG is ignored in basic mode' : ''));
                }

                this._attachToMap();
                if (this._options.drawingControl !== false)
                {
                    this._buildToolbar();
                }

                // FIX: an initial drawingMode set in the constructor used to be
                // assigned straight to _currentMode, bypassing every side effect
                // of setDrawingMode — so a manager created with
                // drawingMode: 'circle' left the map draggable and the drag-to-
                // draw tools unusable. Replay it through the public path now
                // that the map, listeners and toolbar all exist.
                this.setDrawingMode(this._currentMode);
            }
        };

        DrawingManager.prototype.getMap = function ()
        {
            return this._map;
        };

        DrawingManager.prototype.setDrawingMode = function (mode)
        {
            this._cancelShapeDraw();   // abandon any half-drawn circle/rectangle
            this._cancelCurrentDraw();

            // FIX: these guards used to survive a mode change. Picking a tool
            // within 150 ms of the click that finished the previous shape meant
            // the debounce in _handleMapClick silently ate the first click of
            // the new shape. Entering a mode starts from a clean slate.
            //
            // Only on ENTRY: _handleFinishingNodeClick raises _ignoreMapClick and
            // then finishes the shape, which calls setDrawingMode(null) — clearing
            // the flag there would defeat the guard it just set.
            if (mode)
            {
                this._lastMapClickTime = 0;
                this._ignoreMapClick = false;
            }

            this._currentMode = mode;
            this._updateCursor();
            this._updateToolbarState();

            // FIX: completed overlays default to clickable:true, so a click
            // landing on one is consumed by that overlay and never reaches the
            // map's click listener. Make them inert while a tool is active.
            this._setCompletedClickable(!mode);

            if (this._map)
            {
                // Circle/Rectangle are drag-to-draw, so panning must be off while active
                this._map.setOptions({ draggable: !_isDragShapeMode(mode) });
            }
        };

        // Partial option update, mirroring the native DrawingManager surface.
        // Recognised here: drawingMode, drawingControl, silent,
        // suppressCompletedClicks, and any of the *Options styling objects
        // (which apply to shapes drawn from this point on).
        DrawingManager.prototype.setOptions = function (options)
        {
            if (!options) return;

            Object.assign(this._options, options);

            if (options.silent !== undefined) this._silent = options.silent === true;
            if (options.suppressCompletedClicks !== undefined)
            {
                this._suppressCompletedClicks = options.suppressCompletedClicks !== false;
            }

            if (options.markerOptions) this._markerOptions = options.markerOptions;
            if (options.polylineOptions) Object.assign(this._polylineOptions, options.polylineOptions);
            if (options.polygonOptions) Object.assign(this._polygonOptions, options.polygonOptions);
            if (options.circleOptions) Object.assign(this._circleOptions, options.circleOptions);
            if (options.rectangleOptions) Object.assign(this._rectangleOptions, options.rectangleOptions);
            if (options.ghostlineOptions)
            {
                Object.assign(this._ghostlineOptions, options.ghostlineOptions);
                this._destroyGhostLine(); // rebuilt with the new styling on next use
            }

            if (options.drawingControl !== undefined && this._map)
            {
                if (options.drawingControl === false)
                {
                    if (this._toolbar && this._toolbar.parentElement)
                    {
                        this._toolbar.parentElement.removeChild(this._toolbar);
                    }
                    this._toolbar = null;
                    this._btnElements = {};
                } else
                {
                    this._buildToolbar();
                }
            }

            if (options.drawingMode !== undefined) this.setDrawingMode(options.drawingMode);
        };

        // Overlays completed by this manager, oldest first (live array copy).
        DrawingManager.prototype.getCompletedOverlays = function ()
        {
            this._pruneCompleted();
            return this._completed.slice();
        };

        DrawingManager.prototype.getDrawingMode = function ()
        {
            return this._currentMode;
        };

        // Resolved marker mode: 'basic' | 'advanced' (null before a map is attached)
        DrawingManager.prototype.getMarkerType = function ()
        {
            return this._markerMode;
        };

        // ── Marker mode resolution & adapter ───────────────

        DrawingManager.prototype._finishingMarkerSVGProvided = function ()
        {
            return !!(this._options && this._options.finishingMarkerSVG);
        };

        DrawingManager.prototype._resolveMarkerMode = function ()
        {
            var requested = this._options.markerType || 'auto';
            var hasAdvanced = !!(google.maps.marker && google.maps.marker.AdvancedMarkerElement);
            var map = this._map;
            var mapId = map ? ((typeof map.get === 'function' && map.get('mapId')) || map.mapId) : null;
            var prereqsMet = hasAdvanced && !!mapId;

            if (requested === 'basic') return 'basic';

            if (requested === 'advanced')
            {
                if (prereqsMet) return 'advanced';
                console.warn('[MCX] markerType "advanced" requested but prerequisites are missing (' +
                    (hasAdvanced ? '' : 'Maps API not loaded with &libraries=marker; ') +
                    (mapId ? '' : 'map has no mapId') +
                    '). Falling back to basic markers.');
                return 'basic';
            }

            // 'auto'
            return prereqsMet ? 'advanced' : 'basic';
        };

        // Creates a marker in the resolved mode with a normalised surface:
        // setPosition(latLng), setVisible(bool) and setMap(map) work on both
        // classes, and `onClick` is wired with DOM propagation stopped so a
        // marker click can never double as a map click.
        DrawingManager.prototype._createMarker = function (opts, onClick)
        {
            var self = this;
            var marker;

            if (this._markerMode === 'advanced')
            {
                // gmpClickable is required on some Maps JS channels for gmp-click to fire
                marker = new google.maps.marker.AdvancedMarkerElement(
                    Object.assign({ gmpClickable: true }, opts));

                /* Normalisation shims — AdvancedMarkerElement uses properties.
                   Only installed when the class doesn't already provide the
                   method: some Maps JS channels define setMap/setPosition
                   internally and their property setters delegate to them, so
                   shadowing those on the instance recurses infinitely
                   (setMap ⇄ `set map`). */
                if (typeof marker.setPosition !== 'function')
                    marker.setPosition = function (latLng) { this.position = latLng; };
                if (typeof marker.setVisible !== 'function')
                    marker.setVisible = function (visible) { this.map = visible ? self._map : null; };
                if (typeof marker.setMap !== 'function')
                    marker.setMap = function (m) { this.map = m; };

                if (onClick)
                {
                    marker.addListener('gmp-click', function (e)
                    {
                        if (e && typeof e.preventDefault === 'function')
                        {
                            e.preventDefault();
                            e.stopPropagation();
                        }
                        if (e && e.domEvent)
                        {
                            e.domEvent.preventDefault();
                            e.domEvent.stopPropagation();
                        }
                        onClick();
                    });
                }
            } else
            {
                marker = new google.maps.Marker(opts);

                if (onClick)
                {
                    google.maps.event.addListener(marker, 'click', function (e)
                    {
                        if (e && e.domEvent)
                        {
                            e.domEvent.preventDefault();
                            e.domEvent.stopPropagation();
                        }
                        onClick();
                    });
                }
            }

            return marker;
        };

        // Builds the finishing node's SVG content element (advanced mode),
        // vertically centred on its anchor point. For a CUSTOM SVG the bounding
        // height is parsed from the markup's `height` attribute, falling back
        // to a DOM measurement, then to 14px — so custom nodes centre correctly
        // instead of computing style.top = "NaNpx".
        DrawingManager.prototype._buildFinishingContent = function ()
        {
            var container = document.createElement('div');
            container.innerHTML = this._finishingMarkerSVG;
            container.style.cursor = 'pointer'; // Creates the "Hand" icon on hover automatically
            container.style.fontSize = 0;
            container.style.position = 'relative';

            var boundingSize = this._finishingMarkerSVGOptions.boundingSize;
            if (!(boundingSize > 0))
            {
                var svg = container.querySelector('svg');
                var h = svg ? parseFloat(svg.getAttribute('height')) : NaN;
                if (h > 0)
                {
                    boundingSize = h;
                } else
                {
                    // Measure offscreen as a fallback
                    container.style.visibility = 'hidden';
                    document.body.appendChild(container);
                    boundingSize = container.offsetHeight;
                    document.body.removeChild(container);
                    container.style.visibility = '';
                }
                if (!(boundingSize > 0)) boundingSize = 14;
            }

            // AdvancedMarkerElement anchors its content bottom-centre, so push
            // the SVG down by half its height to centre it on the position.
            container.style.top = ((boundingSize / 2) - 1) + 'px';

            return container;
        };

        // ── Map attachment / detachment ────────────────────

        DrawingManager.prototype._attachToMap = function ()
        {
            var map = this._map;
            var self = this;

            this._listeners = [
                google.maps.event.addListener(map, 'click', self._onMapClick),
                google.maps.event.addListener(map, 'mousemove', self._onMouseMove),
                // Drag-to-draw handlers for circle / rectangle
                google.maps.event.addListener(map, 'mousedown', function (e) { self._shapeDown(e); }),
                google.maps.event.addListener(map, 'mousemove', function (e) { self._shapeMove(e); }),
                google.maps.event.addListener(map, 'mouseup', function (e) { self._shapeUp(e); })
            ];

            // Safety net: finish the drag even if the mouse is released off the map
            this._shapeDocUp = function () { if (self._shapeDragging) self._shapeUp(); };
            document.addEventListener('mouseup', this._shapeDocUp);

            this._updateCursor();
        };

        DrawingManager.prototype._detachFromMap = function ()
        {
            if (this._shapeDocUp)
            {
                document.removeEventListener('mouseup', this._shapeDocUp);
                this._shapeDocUp = null;
            }
            this._cancelShapeDraw();

            // Hand the completed overlays back in a usable state before letting go
            this._setCompletedClickable(true);
            this._completed = [];

            this._listeners.forEach(function (l)
            {
                google.maps.event.removeListener(l);
            });
            this._listeners = [];
            this._destroyGhostLine();
            this._destroyActiveShape();

            if (this._finishingMarker)
            {
                this._finishingMarker.setMap(null);
                this._finishingMarker = null;
            }

            this._coords = [];

            if (this._toolbar && this._toolbar.parentElement)
            {
                this._toolbar.parentElement.removeChild(this._toolbar);
                this._toolbar = null;
            }
        };

        // ── Map event handlers ─────────────────────────────

        DrawingManager.prototype._handleMapClick = function (e)
        {
            _debug('map click', {
                mode: this._currentMode,
                ignoreMapClick: this._ignoreMapClick,
                msSinceLastClick: this._lastMapClickTime ? (Date.now() - this._lastMapClickTime) : null,
                coords: this._coords.length,
                completed: this._completed.length
            });

            if (!this._currentMode) { _debug('discarded', 'no active drawing mode'); return; }
            if (!e.latLng) { _debug('discarded', 'event carried no latLng'); return; }
            if (this._ignoreMapClick) { _debug('discarded', '_ignoreMapClick guard'); return; }

            var mode = this._currentMode;

            if (mode === OverlayType.MARKER)
            {
                this._finishMarker(e.latLng);
                return;
            }

            if (mode === OverlayType.POLYLINE || mode === OverlayType.POLYGON)
            {
                var now = Date.now();

                // FIX: Time Debounce - ignore double-clicks caused by physical mouse bounce
                if (this._lastMapClickTime && (now - this._lastMapClickTime) < 150)
                {
                    _debug('discarded', 'time debounce (<150ms since last vertex)');
                    return;
                }

                // FIX: Spatial Jitter - ignore clicks that are microscopic distances from the
                // last node (less than ~1 meter) to prevent invisible micro-segments from forming.
                var lastCoord = this._coords[this._coords.length - 1];
                if (lastCoord)
                {
                    var dLat = lastCoord.lat() - e.latLng.lat();
                    var dLng = lastCoord.lng() - e.latLng.lng();
                    var distSq = (dLat * dLat) + (dLng * dLng);
                    if (distSq < 0.0000000001)
                    {
                        _debug('discarded', 'spatial jitter (click on previous vertex)');
                        return;
                    }
                }

                this._lastMapClickTime = now;
                this._coords.push(e.latLng);

                if (this._coords.length === 1)
                {
                    this._initActiveShape();
                } else
                {
                    this._updateActiveShape();
                }

                this._updateFinishingNode();
                this._updateGhostLine(e.latLng);
            }
        };

        DrawingManager.prototype._handleMouseMove = function (e)
        {
            if (!this._currentMode) return;
            if (!e.latLng) return;

            var mode = this._currentMode;
            if ((mode === OverlayType.POLYLINE || mode === OverlayType.POLYGON) && this._coords.length > 0)
            {
                this._updateGhostLine(e.latLng);
            }
        };

        DrawingManager.prototype._handleFinishingNodeClick = function ()
        {
            var self = this;
            var mode = this._currentMode;
            if (!mode) return;

            // FIX: If the Map click event fired just milliseconds before this Marker click event,
            // it means we caught an event bubble. Remove the bogus point to prevent stroke overshoot.
            if (this._lastMapClickTime && (Date.now() - this._lastMapClickTime) < 200)
            {
                this._coords.pop();
            }

            this._ignoreMapClick = true;
            setTimeout(function () { self._ignoreMapClick = false; }, 150);

            var minPoints = (mode === OverlayType.POLYGON) ? 3 : 2;
            if (this._coords.length >= minPoints)
            {
                // FIX: Native google.maps.Polygon closes itself. If the last node matches the
                // start node, it creates a sharp visual spike. We remove it here.
                if (mode === OverlayType.POLYGON)
                {
                    var first = this._coords[0];
                    var last = this._coords[this._coords.length - 1];
                    if (first.equals(last))
                    {
                        this._coords.pop();
                    }
                }

                this._finishShape(mode);
            } else
            {
                this._cancelCurrentDraw();
            }
        };

        // ── Shape lifecycle ────────────────────────────────

        DrawingManager.prototype._initActiveShape = function ()
        {
            var map = this._map;
            var coords = this._coords;
            var lineStyle = this._polylineOptions;

            // The in-progress line takes its stroke from polylineOptions so the
            // preview matches the finished polyline; joins/caps stay forced.
            this._activeShape = new google.maps.Polyline({
                path: coords,
                map: map,
                strokeColor: lineStyle.strokeColor,
                strokeWeight: lineStyle.strokeWeight,
                strokeOpacity: lineStyle.strokeOpacity,
                // FIX: Force Google Maps SVG renderer to use round joints instead of square caps.
                // This completely eliminates sharp overlapping corners/horns on acute angles.
                strokeLineJoin: 'round',
                strokeLineCap: 'round',
                clickable: false,
                zIndex: 200
            });
        };

        DrawingManager.prototype._updateActiveShape = function ()
        {
            if (!this._activeShape) return;
            // Since it's always a polyline during drawing, we just set the continuous path
            this._activeShape.setPath(this._coords);
        };

        // Fresh clone of the ghost-line symbol array. A NEW array (and icon
        // object) reference is needed on every update — see repaint note below.
        DrawingManager.prototype._cloneGhostIcons = function ()
        {
            return (this._ghostlineOptions.icons || []).map(function (seq)
            {
                var copy = Object.assign({}, seq);
                if (seq.icon) copy.icon = Object.assign({}, seq.icon);
                return copy;
            });
        };

        DrawingManager.prototype._updateGhostLine = function (cursorLatLng)
        {
            var lastCoord = this._coords[this._coords.length - 1];
            if (!lastCoord) return;

            // The dotted preview is a Polyline whose dots are rendered as repeating
            // icon SYMBOLS, sourced from ghostlineOptions so callers can restyle
            // them. A fresh array reference is built each call so re-assigning it
            // below forces the symbol layer to repaint (see note further down).
            var dotIcons = this._cloneGhostIcons();

            // Create the ghost line once, then keep it permanently on the map and
            // ALWAYS visible. We never call setVisible() on it.
            //
            // FIX (intermittent disappearing dotted preview): the previous code hid
            // the line with setVisible(false) right after each click and setVisible(true)
            // on the next move. Toggling visibility on a symbol/icon polyline can leave
            // the dot layer in a stale, un-painted state — the polyline reports itself
            // as visible with a valid path, but the dots don't draw until a zoom/pan
            // forces a full re-render. We now control the preview purely via its PATH.
            if (!this._ghostLine)
            {
                // ghostlineOptions styling first; path/map/clickable/zIndex are
                // fixed internally and always win (documented behaviour).
                var options = Object.assign({}, this._ghostlineOptions, {
                    path: [],
                    map: this._map,
                    icons: dotIcons,
                    clickable: false,
                    zIndex: 201
                });
                this._ghostLine = new google.maps.Polyline(options);
            }

            // If the cursor sits exactly on the last node the segment is zero-length,
            // which has no bearing and makes the renderer draw a stray "spike". Collapse
            // the path to nothing instead of hiding the overlay.
            if (lastCoord.equals(cursorLatLng))
            {
                this._ghostLine.setPath([]);
                return;
            }

            this._ghostLine.setPath([lastCoord, cursorLatLng]);

            // Re-assign the icons (new array reference) to force the dotted symbol layer
            // to repaint. This defeats the stale-render glitch that the old setVisible
            // toggle could trigger, so the preview can no longer get "stuck" blank.
            this._ghostLine.set('icons', dotIcons);
        };

        DrawingManager.prototype._updateFinishingNode = function ()
        {
            var coords = this._coords;
            var mode = this._currentMode;

            if (coords.length === 0)
            {
                if (this._finishingMarker) this._finishingMarker.setVisible(false);
                return;
            }

            if (!this._finishingMarker)
            {
                var fo = this._finishingMarkerSVGOptions;
                var markerOpts;

                if (this._markerMode === 'advanced')
                {
                    markerOpts = {
                        map: this._map,
                        content: this._buildFinishingContent(),
                        zIndex: 300
                    };
                } else
                {
                    markerOpts = {
                        map: this._map,
                        icon: {
                            path: google.maps.SymbolPath.CIRCLE,
                            fillColor: fo.fillColor,
                            fillOpacity: fo.fillOpacity,
                            strokeColor: fo.strokeColor,
                            strokeWeight: fo.strokeWeight,
                            scale: fo.scale
                        },
                        cursor: 'pointer', // Creates the "Hand" icon on hover automatically
                        zIndex: 300
                    };
                }

                this._finishingMarker = this._createMarker(markerOpts, this._onFinishingNodeClick);
            }

            if (mode === OverlayType.POLYLINE)
            {
                // For Polylines, the finishing node lives on the LAST clicked point
                this._finishingMarker.setPosition(coords[coords.length - 1]);
                this._finishingMarker.setVisible(true);
            }
            else if (mode === OverlayType.POLYGON)
            {
                // For Polygons, the finishing node lives on the FIRST point to close the shape.
                // We only show it once a line segment actually exists.
                if (coords.length >= 2)
                {
                    this._finishingMarker.setPosition(coords[0]);
                    this._finishingMarker.setVisible(true);
                } else
                {
                    this._finishingMarker.setVisible(false);
                }
            }
        };

        DrawingManager.prototype._destroyGhostLine = function ()
        {
            if (this._ghostLine)
            {
                this._ghostLine.setMap(null);
                this._ghostLine = null;
            }
        };

        DrawingManager.prototype._destroyActiveShape = function ()
        {
            if (this._activeShape)
            {
                this._activeShape.setMap(null);
                this._activeShape = null;
            }
        };

        DrawingManager.prototype._cancelCurrentDraw = function ()
        {
            this._destroyGhostLine();
            this._destroyActiveShape();
            if (this._finishingMarker)
            {
                this._finishingMarker.setVisible(false);
            }
            this._coords = [];
        };

        // ── Drag drawing (circle / rectangle) ──────────────

        DrawingManager.prototype._shapeDown = function (e)
        {
            var mode = this._currentMode;
            if (!_isDragShapeMode(mode)) return;
            if (!e || !e.latLng) return;

            // Clean up any stray preview
            if (this._shapePreview) { this._shapePreview.setMap(null); this._shapePreview = null; }

            this._shapeDragging = true;
            this._shapeStart = e.latLng;

            if (mode === OverlayType.CIRCLE)
            {
                this._shapePreview = new google.maps.Circle(
                    Object.assign({}, this._circleOptions, {
                        center: e.latLng, radius: 0.5, map: this._map,
                        clickable: false, zIndex: 200
                    }));
            }
            else // rectangle
            {
                this._shapePreview = new google.maps.Rectangle(
                    Object.assign({}, this._rectangleOptions, {
                        bounds: new google.maps.LatLngBounds(e.latLng, e.latLng), map: this._map,
                        clickable: false, zIndex: 200
                    }));
            }
        };

        DrawingManager.prototype._shapeMove = function (e)
        {
            if (!this._shapeDragging || !e || !e.latLng || !this._shapePreview) return;

            if (this._currentMode === OverlayType.CIRCLE)
            {
                this._shapePreview.setRadius(Math.max(0.5, _metersBetween(this._shapeStart, e.latLng)));
            }
            else
            {
                var b = new google.maps.LatLngBounds();
                b.extend(this._shapeStart);
                b.extend(e.latLng);
                this._shapePreview.setBounds(b);
            }
        };

        DrawingManager.prototype._shapeUp = function ()
        {
            if (!this._shapeDragging) return;
            this._shapeDragging = false;

            var mode = this._currentMode;
            var preview = this._shapePreview;

            // Detach state immediately so the setDrawingMode(null) call below
            // (which runs _cancelShapeDraw) cannot destroy the finished shape.
            this._shapePreview = null;
            this._shapeStart = null;

            if (!preview) return;

            // Discard accidental clicks / micro-drags
            var tooSmall = false;
            if (mode === OverlayType.CIRCLE)
            {
                if (preview.getRadius() < 1) tooSmall = true;
            }
            else
            {
                var sz = _rectangleSize(preview);
                if (sz.widthMeters < 1 || sz.heightMeters < 1) tooSmall = true;
            }

            if (tooSmall)
            {
                preview.setMap(null);
                return; // stay in the current tool so the user can retry
            }

            // Promote the preview into the final, editable + draggable overlay
            preview.setOptions({ editable: true, draggable: true, clickable: true });

            this._trackCompleted(preview);

            google.maps.event.trigger(this, 'overlaycomplete', { type: mode, overlay: preview });
            google.maps.event.trigger(this, mode + 'complete', preview); // circlecomplete / rectanglecomplete

            // Drop back to pan mode, consistent with the polygon/polyline tools
            this.setDrawingMode(null);
        };

        DrawingManager.prototype._cancelShapeDraw = function ()
        {
            if (this._shapePreview) { this._shapePreview.setMap(null); this._shapePreview = null; }
            this._shapeDragging = false;
            this._shapeStart = null;
        };

        // ── Finish handlers ────────────────────────────────

        DrawingManager.prototype._finishMarker = function (latLng)
        {
            // markerOptions is interpreted per resolved mode (documented):
            // MarkerOptions in basic mode, AdvancedMarkerElementOptions in
            // advanced mode. position/map always win over caller values.
            var markerOptions = Object.assign({}, this._markerOptions, {
                position: latLng,
                map: this._map
            });

            var mockMarker;
            if (this._markerMode === 'advanced')
            {
                // A single Element can only live in one marker — clone caller-
                // supplied content so every drawn marker gets its own copy.
                if (markerOptions.content && markerOptions.content.cloneNode)
                {
                    markerOptions.content = markerOptions.content.cloneNode(true);
                }
                mockMarker = new google.maps.marker.AdvancedMarkerElement(markerOptions);
            } else
            {
                mockMarker = new google.maps.Marker(markerOptions);
            }

            var self = this;
            this._trackCompleted(mockMarker);

            google.maps.event.trigger(self, 'overlaycomplete', {
                type: OverlayType.MARKER,
                overlay: mockMarker
            });
            google.maps.event.trigger(self, 'markercomplete', mockMarker);

            // Exit draw mode automatically so user isn't stuck holding the marker tool
            this.setDrawingMode(null);
        };

        DrawingManager.prototype._finishShape = function (mode)
        {
            var coords = this._coords.slice(); // snapshot

            // Clear all temporary drawing assets before dispatching the final shape
            this._cancelCurrentDraw();

            var self = this;
            var mockOverlay;
            var options;

            if (mode === OverlayType.POLYLINE)
            {
                // Styling from polylineOptions; path/map always win over caller values
                options = Object.assign({}, this._polylineOptions, {
                    path: coords,
                    map: this._map
                });
                mockOverlay = new google.maps.Polyline(options);
                this._trackCompleted(mockOverlay);

                google.maps.event.trigger(self, 'overlaycomplete', {
                    type: OverlayType.POLYLINE,
                    overlay: mockOverlay
                });
                google.maps.event.trigger(self, 'polylinecomplete', mockOverlay);

            } else if (mode === OverlayType.POLYGON)
            {
                options = Object.assign({}, this._polygonOptions, {
                    paths: [coords],
                    map: this._map
                });
                mockOverlay = new google.maps.Polygon(options);
                this._trackCompleted(mockOverlay);

                google.maps.event.trigger(self, 'overlaycomplete', {
                    type: OverlayType.POLYGON,
                    overlay: mockOverlay
                });
                google.maps.event.trigger(self, 'polygoncomplete', mockOverlay);
            }

            // Exit draw mode automatically so Place Edit panel can take priority cleanly
            this.setDrawingMode(null);
        };

        // ── Completed overlay tracking ─────────────────────
        //
        // Every overlay this manager finishes is recorded here. All drawing
        // input arrives via the MAP's click/mousemove events, so anything
        // sitting on top of the map with hit-testing enabled will intercept a
        // click before the manager ever sees it. Completed shapes default to
        // clickable:true (consumers need that to select them), which meant the
        // first click of a new shape was frequently swallowed by a shape drawn
        // moments earlier — most visibly on narrow maps, where more of the
        // viewport is covered by what you just drew.

        DrawingManager.prototype._trackCompleted = function (overlay)
        {
            if (!overlay) return;
            this._completed.push(overlay);

            // If a tool is still active (marker mode stays put between clicks),
            // the new overlay must not be able to eat the next click either.
            if (this._currentMode) this._setCompletedClickable(false);
        };

        // Drop overlays the consumer has removed from the map so the list can't
        // grow without bound over a long editing session.
        DrawingManager.prototype._pruneCompleted = function ()
        {
            this._completed = this._completed.filter(function (o)
            {
                if (!o) return false;
                var m = (typeof o.getMap === 'function') ? o.getMap() : o.map;
                return !!m;
            });
        };

        DrawingManager.prototype._setCompletedClickable = function (clickable)
        {
            if (!this._suppressCompletedClicks) return;
            if (!this._completed.length) return;

            this._pruneCompleted();

            this._completed.forEach(function (o)
            {
                try
                {
                    if (typeof o.setOptions === 'function')
                    {
                        // Polyline / Polygon / Circle / Rectangle / basic Marker
                        o.setOptions({ clickable: clickable });
                    } else if ('gmpClickable' in o)
                    {
                        // AdvancedMarkerElement
                        o.gmpClickable = clickable;
                    }
                } catch (err)
                {
                    /* An overlay may have been torn down by the consumer — ignore. */
                }
            });
        };

        // ── Cursor & state helpers ─────────────────────────

        DrawingManager.prototype._updateCursor = function ()
        {
            if (!this._map) return;
            var container = this._map.getDiv ? this._map.getDiv() : null;

            if (this._currentMode)
            {
                if (container) container.style.cursor = 'crosshair';
                // Lock crosshairs and disable double click zooming while drawing
                this._map.setOptions({
                    draggableCursor: 'crosshair',
                    disableDoubleClickZoom: true
                });
            } else
            {
                if (container) container.style.cursor = '';
                // Restore map defaults
                this._map.setOptions({
                    draggableCursor: '',
                    disableDoubleClickZoom: false
                });
            }
        };

        DrawingManager.prototype._updateToolbarState = function ()
        {
            for (var mode in this._btnElements)
            {
                var btn = this._btnElements[mode];
                if (btn)
                {
                    btn.classList.toggle('mcx-draw-active', mode === (this._currentMode || 'hand'));
                }
            }
        };

        // ── Toolbar ────────────────────────────────────────

        DrawingManager.prototype._buildToolbar = function ()
        {
            if (this._toolbar) return;
            _injectStyles();

            var opts = this._options;
            var drawCtrlOpts = opts.drawingControlOptions || {};
            var drawModes = drawCtrlOpts.drawingModes || [
                OverlayType.MARKER,
                OverlayType.POLYLINE,
                OverlayType.POLYGON
            ];
            var position = drawCtrlOpts.position != null
                ? drawCtrlOpts.position
                : google.maps.ControlPosition.TOP_CENTER;

            var toolbar = document.createElement('div');
            toolbar.className = 'mcx-draw-toolbar';

            var self = this;

            // Hand / Pan button (always present)
            var handBtn = _makeToolbarButton('hand', ICONS.hand, 'Pan', true, function ()
            {
                self.setDrawingMode(null);
            });
            toolbar.appendChild(handBtn);
            this._btnElements['hand'] = handBtn;

            // Mode buttons
            var modeLabels = {
                marker: 'Add Marker',
                polyline: 'Draw Line',
                polygon: 'Draw Polygon',
                circle: 'Draw Circle',
                rectangle: 'Draw Rectangle'
            };

            drawModes.forEach(function (mode)
            {
                var icon = ICONS[mode] || ICONS.marker;
                var label = modeLabels[mode] || mode;
                var btn = _makeToolbarButton(mode, icon, label, false, function ()
                {
                    self.setDrawingMode(mode);
                });
                toolbar.appendChild(btn);
                self._btnElements[mode] = btn;
            });

            this._toolbar = toolbar;
            this._map.controls[position].push(toolbar);

            // Set initial active state
            this._updateToolbarState();
        };

        // ── Private helpers ────────────────────────────────

        function _makeToolbarButton(mode, svgHtml, title, isActive, onClick)
        {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'mcx-draw-btn' + (isActive ? ' mcx-draw-active' : '');
            btn.title = title;
            btn.setAttribute('data-mode', mode);
            btn.innerHTML = svgHtml;

            btn.addEventListener('click', function (e)
            {
                e.stopPropagation();
                onClick();
            });

            // Prevent the button from passing click events to the map
            btn.addEventListener('mousedown', function (e) { e.stopPropagation(); });

            return btn;
        }

        return DrawingManager;
    }());

    // Circle/rectangle support is built in — the flag stops the legacy
    // mcx-drawing-shapes.js extension from double-applying if it is still
    // loaded alongside this file.
    DrawingManager.prototype._mcxShapesExtended = true;

    // ── Namespace injection ────────────────────────────────

    window.google.maps.drawing = {
        MCX_VERSION: MCX_VERSION,
        OverlayType: OverlayType,
        DrawingManager: DrawingManager,
        MCXShapeUtils: {
            metersBetween: _metersBetween,
            rectangleSize: _rectangleSize,
            setRectangleSize: _setRectangleSize
        },
        MCXMarkerUtils: MCXMarkerUtils
    };

    _info('[MCX] Drawing Manager Polyfill v' + MCX_VERSION +
        ' loaded (google.maps.drawing replacement — markers, lines, polygons, circles, rectangles).');

}());