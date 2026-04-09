/*!
 * Google Maps Drawing Manager Polyfill
 * * A zero-dependency, drop-in replacement for the deprecated google.maps.drawing library.
 * * Author: Robert McMahon
 * Website: https://www.mapchannels.com/ 
 * GitHub: https://github.com/mapchannels/google-maps-drawing-polyfill
 * Demo: https://mapchannels.github.io/google-maps-drawing-polyfill/
 * * Released under the MIT License.
 * Copyright (c) 2026 Map Channels
 * * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction... (see GitHub repo for full license).
 */

(function ()
{
    'use strict';

    // Guard: only inject if the native library is absent
    window.google = window.google || {};
    window.google.maps = window.google.maps || {};

    if (window.google.maps.drawing)
    {
        return; // Native library present — do nothing
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
    };

    // ── OverlayType enum ───────────────────────────────────

    var OverlayType = {
        MARKER: 'marker',
        POLYGON: 'polygon',
        POLYLINE: 'polyline'
    };

    // ── DrawingManager Class ───────────────────────────────

    var DrawingManager = (function ()
    {

        function DrawingManager(options)
        {
            options = options || {};

            this._map = null;
            this._currentMode = options.drawingMode || null;
            this._options = options;

            // In-progress drawing state
            this._coords = [];         // accumulated coordinates
            this._activeShape = null;  // primary google.maps.Polyline being drawn (even for polygons!)
            this._ghostLine = null;    // dashed preview line to cursor
            this._finishingMarker = null; // The interactive node to close/finish shapes

            this._ignoreMapClick = false; // Safety guard to prevent double-firing

            // Map event listener handles (for cleanup)
            this._listeners = [];

            // Toolbar DOM reference
            this._toolbar = null;
            this._btnElements = {};    // mode → button element

            // Bind stable handler references
            this._onMapClick = this._handleMapClick.bind(this);
            this._onMouseMove = this._handleMouseMove.bind(this);
            this._onFinishingNodeClick = this._handleFinishingNodeClick.bind(this);

            // Attach to map if provided
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
                this._attachToMap();
                if (this._options.drawingControl !== false)
                {
                    this._buildToolbar();
                }
            }
        };

        DrawingManager.prototype.getMap = function ()
        {
            return this._map;
        };

        DrawingManager.prototype.setDrawingMode = function (mode)
        {
            this._cancelCurrentDraw();
            this._currentMode = mode;
            this._updateCursor();
            this._updateToolbarState();
        };

        DrawingManager.prototype.getDrawingMode = function ()
        {
            return this._currentMode;
        };

        // ── Map attachment / detachment ────────────────────

        DrawingManager.prototype._attachToMap = function ()
        {
            var map = this._map;
            var self = this;

            var clickHandle = google.maps.event.addListener(map, 'click', self._onMapClick);
            var moveHandle = google.maps.event.addListener(map, 'mousemove', self._onMouseMove);

            this._listeners = [clickHandle, moveHandle];
            this._updateCursor();
        };

        DrawingManager.prototype._detachFromMap = function ()
        {
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
            if (!this._currentMode) return;
            if (!e.latLng) return;
            if (this._ignoreMapClick) return;

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
                    if (distSq < 0.0000000001) return;
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

            this._activeShape = new google.maps.Polyline({
                path: coords,
                map: map,
                strokeColor: '#1a73e8',
                strokeWeight: 3,
                strokeOpacity: 0.9,
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

        DrawingManager.prototype._updateGhostLine = function (cursorLatLng)
        {
            var lastCoord = this._coords[this._coords.length - 1];
            if (!lastCoord) return;

            // FIX: If the mouse hasn't moved from the exact spot you clicked,
            // hide the ghost line. A zero-length line has no angle, which causes 
            // the Google Maps renderer to draw a crooked "spike" artifact!
            if (lastCoord.equals(cursorLatLng))
            {
                if (this._ghostLine) this._ghostLine.setVisible(false);
                return;
            }

            var ghostPath = [lastCoord, cursorLatLng];

            if (!this._ghostLine)
            {
                this._ghostLine = new google.maps.Polyline({
                    path: ghostPath,
                    map: this._map,
                    strokeOpacity: 0, // The main solid stroke must be hidden for dots to work
                    icons: [{
                        icon: {
                            // FIX: Changed from a dashed line to a dotted line as requested
                            path: google.maps.SymbolPath.CIRCLE,
                            fillColor: '#1a73e8',
                            fillOpacity: 0.7,
                            strokeOpacity: 0,
                            scale: 2
                        },
                        offset: '0',
                        repeat: '4px'
                    }],
                    clickable: false,
                    zIndex: 201
                });
            } else
            {
                this._ghostLine.setPath(ghostPath);
                this._ghostLine.setVisible(true); // Bring it back once the mouse moves
            }
        };

        DrawingManager.prototype._updateFinishingNode = function () 
        {
            var coords = this._coords;
            var mode = this._currentMode;
            var self = this;

            if (coords.length === 0) 
            {
                if (this._finishingMarker) this._finishingMarker.setVisible(false);
                return;
            }

            if (!this._finishingMarker) 
            {
                this._finishingMarker = new google.maps.Marker({
                    map: this._map,
                    icon: {
                        path: google.maps.SymbolPath.CIRCLE,
                        fillColor: '#ffffff',
                        fillOpacity: 1,
                        strokeColor: '#1a73e8',
                        strokeWeight: 2,
                        scale: 5
                    },
                    cursor: 'pointer', // Creates the "Hand" icon on hover automatically
                    zIndex: 300
                });

                google.maps.event.addListener(this._finishingMarker, 'click', function (e)
                {
                    if (e.domEvent)
                    {
                        e.domEvent.preventDefault();
                        e.domEvent.stopPropagation();
                    }
                    self._onFinishingNodeClick();
                });
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

        // ── Finish handlers ────────────────────────────────

        DrawingManager.prototype._finishMarker = function (latLng)
        {
            var markerOptions = {};
            if (this._options.markerOptions)
            {
                for (var k in this._options.markerOptions)
                {
                    markerOptions[k] = this._options.markerOptions[k];
                }
            }
            markerOptions.position = latLng;
            markerOptions.map = this._map;

            var mockMarker = new google.maps.Marker(markerOptions);

            var self = this;
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

            if (mode === OverlayType.POLYLINE)
            {
                mockOverlay = new google.maps.Polyline({
                    path: coords,
                    map: this._map,
                    strokeColor: '#1a73e8',
                    strokeWeight: 3,
                    strokeOpacity: 0.9,
                    clickable: true
                });
                google.maps.event.trigger(self, 'overlaycomplete', {
                    type: OverlayType.POLYLINE,
                    overlay: mockOverlay
                });
                google.maps.event.trigger(self, 'polylinecomplete', mockOverlay);

            } else if (mode === OverlayType.POLYGON)
            {
                mockOverlay = new google.maps.Polygon({
                    paths: [coords],
                    map: this._map,
                    strokeColor: '#1a73e8',
                    strokeWeight: 2,
                    strokeOpacity: 0.9,
                    fillColor: '#1a73e8',
                    fillOpacity: 0.25,
                    clickable: true
                });
                google.maps.event.trigger(self, 'overlaycomplete', {
                    type: OverlayType.POLYGON,
                    overlay: mockOverlay
                });
                google.maps.event.trigger(self, 'polygoncomplete', mockOverlay);
            }

            // Exit draw mode automatically so Place Edit panel can take priority cleanly
            this.setDrawingMode(null);
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
                polygon: 'Draw Polygon'
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

    // ── Namespace injection ────────────────────────────────

    window.google.maps.drawing = {
        OverlayType: OverlayType,
        DrawingManager: DrawingManager
    };

    console.log('[MCX] Drawing Manager Polyfill loaded (google.maps.drawing replacement).');

}());
