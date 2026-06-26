/*!
 * MCX Drawing Polyfill — Circle & Rectangle Extension
 *
 * Adds 'circle' and 'rectangle' drawing tools to the MCX Drawing Manager polyfill.
 * Each finished shape is editable (resize handles) and draggable. Helper utilities
 * are exposed for reading/writing width, height and radius in metres.
 *
 * Requires mcx-drawing-polyfill.js to be loaded FIRST.
 * Zero dependencies (no geometry library needed). MIT License.
 *
 * Author: (add-on for) Robert McMahon / Map Channels
 */

(function ()
{
    'use strict';

    // ── Guard: base polyfill must be present ───────────────
    if (!window.google || !google.maps || !google.maps.drawing || !google.maps.drawing.DrawingManager)
    {
        console.error('[MCX] Circle/Rectangle extension: base drawing polyfill not found. ' +
            'Load mcx-drawing-polyfill.js before this file.');
        return;
    }

    var drawing = google.maps.drawing;
    var DM = drawing.DrawingManager;

    // Guard against applying the extension twice
    if (DM.prototype._mcxShapesExtended) return;
    DM.prototype._mcxShapesExtended = true;

    // Extend the OverlayType enum
    drawing.OverlayType.CIRCLE = 'circle';
    drawing.OverlayType.RECTANGLE = 'rectangle';

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

    // Expose helpers so demos / consumers can reuse the maths
    drawing.MCXShapeUtils = {
        metersBetween: _metersBetween,
        rectangleSize: _rectangleSize,
        setRectangleSize: _setRectangleSize
    };

    // ── Toolbar icons (match the base polyfill style) ──────

    var EXT_ICONS = {
        circle: '<svg width="18" height="18" viewBox="0 0 24 24" fill="rgba(85,85,85,0.15)" stroke="#555" stroke-width="2"><circle cx="12" cy="12" r="8"/></svg>',
        rectangle: '<svg width="18" height="18" viewBox="0 0 24 24" fill="rgba(85,85,85,0.15)" stroke="#555" stroke-width="2"><rect x="4" y="6" width="16" height="12" rx="1"/></svg>'
    };

    var EXT_LABELS = { circle: 'Draw Circle', rectangle: 'Draw Rectangle' };

    function _isExtMode(mode) { return mode === 'circle' || mode === 'rectangle'; }

    // ── Toolbar: append circle / rectangle buttons ─────────
    //
    // The base _buildToolbar() only knows marker/polyline/polygon, so we wrap it:
    // strip the extended modes out before calling the original, then append our
    // own buttons afterwards (styled identically, registered for active-state).

    var _origBuildToolbar = DM.prototype._buildToolbar;
    DM.prototype._buildToolbar = function ()
    {
        var dco = (this._options && this._options.drawingControlOptions) || null;
        var saved = null;
        var extModes = [];

        if (dco && Array.isArray(dco.drawingModes))
        {
            saved = dco.drawingModes;
            var baseModes = [];
            saved.forEach(function (m)
            {
                if (_isExtMode(m)) extModes.push(m);
                else baseModes.push(m);
            });
            dco.drawingModes = baseModes;
        }

        _origBuildToolbar.call(this);

        if (saved) dco.drawingModes = saved; // restore caller's array untouched

        this._appendExtButtons(extModes);
    };

    DM.prototype._appendExtButtons = function (modes)
    {
        if (!modes || !modes.length || !this._toolbar) return;
        var self = this;

        modes.forEach(function (mode)
        {
            if (self._btnElements[mode]) return; // already present

            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'mcx-draw-btn';
            btn.title = EXT_LABELS[mode] || mode;
            btn.setAttribute('data-mode', mode);
            btn.innerHTML = EXT_ICONS[mode] || '';

            btn.addEventListener('click', function (e)
            {
                e.stopPropagation();
                self.setDrawingMode(mode);
            });
            btn.addEventListener('mousedown', function (e) { e.stopPropagation(); });

            self._toolbar.appendChild(btn);
            self._btnElements[mode] = btn;
        });

        this._updateToolbarState();
    };

    // ── Map attachment: add drag listeners for shape drawing ─

    var _origAttach = DM.prototype._attachToMap;
    DM.prototype._attachToMap = function ()
    {
        _origAttach.call(this); // sets up base click/mousemove and resets this._listeners

        var self = this;
        var map = this._map;

        var down = google.maps.event.addListener(map, 'mousedown', function (e) { self._extDown(e); });
        var move = google.maps.event.addListener(map, 'mousemove', function (e) { self._extMove(e); });
        var up = google.maps.event.addListener(map, 'mouseup', function (e) { self._extUp(e); });

        // base _detachFromMap iterates this._listeners, so pushing here covers cleanup
        this._listeners.push(down, move, up);

        // Safety net: finish the drag even if the mouse is released off the map
        this._extDocUp = function () { if (self._extDragging) self._extUp(); };
        document.addEventListener('mouseup', this._extDocUp);
    };

    var _origDetach = DM.prototype._detachFromMap;
    DM.prototype._detachFromMap = function ()
    {
        if (this._extDocUp)
        {
            document.removeEventListener('mouseup', this._extDocUp);
            this._extDocUp = null;
        }
        this._cancelExtDraw();
        _origDetach.call(this);
    };

    // ── Drawing mode: lock map panning while drag-drawing ──

    var _origSetMode = DM.prototype.setDrawingMode;
    DM.prototype.setDrawingMode = function (mode)
    {
        this._cancelExtDraw();          // abandon any half-drawn shape
        _origSetMode.call(this, mode);  // sets mode + cursor + toolbar state

        if (this._map)
        {
            // Circle/Rectangle are drag-to-draw, so panning must be off while active
            this._map.setOptions({ draggable: !_isExtMode(mode) });
        }
    };

    // ── Drag drawing handlers ──────────────────────────────

    DM.prototype._extDown = function (e)
    {
        var mode = this._currentMode;
        if (!_isExtMode(mode)) return;
        if (!e || !e.latLng) return;

        // Clean up any stray preview
        if (this._extPreview) { this._extPreview.setMap(null); this._extPreview = null; }

        this._extDragging = true;
        this._extStart = e.latLng;
        this._extLast = e.latLng;

        if (mode === 'circle')
        {
            this._extPreview = new google.maps.Circle({
                center: e.latLng, radius: 0.5, map: this._map,
                strokeColor: '#1a73e8', strokeWeight: 2, strokeOpacity: 0.9,
                fillColor: '#1a73e8', fillOpacity: 0.2, clickable: false, zIndex: 200
            });
        }
        else // rectangle
        {
            this._extPreview = new google.maps.Rectangle({
                bounds: new google.maps.LatLngBounds(e.latLng, e.latLng), map: this._map,
                strokeColor: '#1a73e8', strokeWeight: 2, strokeOpacity: 0.9,
                fillColor: '#1a73e8', fillOpacity: 0.2, clickable: false, zIndex: 200
            });
        }
    };

    DM.prototype._extMove = function (e)
    {
        if (!this._extDragging || !e || !e.latLng || !this._extPreview) return;
        this._extLast = e.latLng;

        if (this._currentMode === 'circle')
        {
            this._extPreview.setRadius(Math.max(0.5, _metersBetween(this._extStart, e.latLng)));
        }
        else
        {
            var b = new google.maps.LatLngBounds();
            b.extend(this._extStart);
            b.extend(e.latLng);
            this._extPreview.setBounds(b);
        }
    };

    DM.prototype._extUp = function ()
    {
        if (!this._extDragging) return;
        this._extDragging = false;

        var mode = this._currentMode;
        var preview = this._extPreview;

        // Detach state immediately so the setDrawingMode(null) call below
        // (which runs _cancelExtDraw) cannot destroy the finished shape.
        this._extPreview = null;
        this._extStart = null;
        this._extLast = null;

        if (!preview) return;

        // Discard accidental clicks / micro-drags
        var tooSmall = false;
        if (mode === 'circle')
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

        google.maps.event.trigger(this, 'overlaycomplete', { type: mode, overlay: preview });
        google.maps.event.trigger(this, mode + 'complete', preview); // circlecomplete / rectanglecomplete

        // Drop back to pan mode, consistent with the polygon/polyline tools
        this.setDrawingMode(null);
    };

    DM.prototype._cancelExtDraw = function ()
    {
        if (this._extPreview) { this._extPreview.setMap(null); this._extPreview = null; }
        this._extDragging = false;
        this._extStart = null;
        this._extLast = null;
    };

    console.log('[MCX] Circle/Rectangle extension loaded (adds circle + rectangle drawing tools).');

}());
