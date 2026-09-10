/*!
 * Shared demo scaffolding for the mcx-drawing v2 demo pages.
 *
 * mcxCreateDemoPanel(cfg) builds, inside a root element:
 *   - a map with a DrawingManager (all five tools)
 *   - a "resolved marker mode" badge (basic / advanced)
 *   - the circle/rectangle property editor (radius / width x height in metres,
 *     area readouts, save/deselect/delete)
 *   - a JSON output textarea fed by overlaycomplete
 *
 * cfg: {
 *   root:           element or element id to render into
 *   mapOptions:     google.maps.MapOptions
 *   managerOptions: DrawingManagerOptions (map is set by this helper)
 * }
 * Returns { map, drawingManager }.
 *
 * All panel elements are class-scoped to the root so multiple panels can
 * coexist on one page (see demo-combined.html).
 */

function mcxCreateDemoPanel(cfg)
{
    'use strict';

    const root = typeof cfg.root === 'string' ? document.getElementById(cfg.root) : cfg.root;

    root.innerHTML =
        '<div class="demo-map"></div>' +
        '<div class="modeline">Resolved marker mode: <span class="badge mode-badge">&mdash;</span></div>' +
        '<div class="props">' +
        '  <h3><span class="props-title">Shape</span><span class="badge props-badge">&mdash;</span></h3>' +
        '  <div class="field-row props-fields"></div>' +
        '  <div class="readouts props-readouts"></div>' +
        '  <div style="margin-top:12px; display:flex; gap:8px;">' +
        '    <button class="btn props-save">Save &amp; deselect</button>' +
        '    <button class="btn btn-danger props-delete">Delete shape</button>' +
        '  </div>' +
        '</div>' +
        '<label><strong>Event Output:</strong></label>' +
        '<textarea class="output" readonly placeholder="Waiting for drawn shape..."></textarea>';

    const map = new google.maps.Map(root.querySelector('.demo-map'), cfg.mapOptions);

    const drawingManager = new google.maps.drawing.DrawingManager(cfg.managerOptions);
    drawingManager.setMap(map);

    // Show which marker mode 'auto' (or a forced type) resolved to
    const modeBadge = root.querySelector('.mode-badge');
    const resolved = drawingManager.getMarkerType();
    modeBadge.textContent = resolved;
    modeBadge.classList.toggle('mode-advanced', resolved === 'advanced');

    const Utils = google.maps.drawing.MCXShapeUtils;
    const MarkerUtils = google.maps.drawing.MCXMarkerUtils;

    // ── Selection / property-editing state ─────────────────
    let selected = null;          // { overlay, type, listeners: [] }
    const propsEl = root.querySelector('.props');
    const titleEl = root.querySelector('.props-title');
    const badgeEl = root.querySelector('.props-badge');
    const fieldsEl = root.querySelector('.props-fields');
    const readoutsEl = root.querySelector('.props-readouts');
    const outputEl = root.querySelector('.output');
    root.querySelector('.props-delete').addEventListener('click', deleteSelected);
    root.querySelector('.props-save').addEventListener('click', deselect);

    const fmt = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 });

    function numberField(cls, label, value)
    {
        const wrap = document.createElement('div');
        wrap.className = 'field';
        const lab = document.createElement('label');
        lab.textContent = label;
        const inp = document.createElement('input');
        inp.type = 'number'; inp.className = cls; inp.min = '1'; inp.step = '1';
        inp.value = Math.round(value);
        wrap.appendChild(lab); wrap.appendChild(inp);
        fieldsEl.appendChild(wrap);
        return inp;
    }

    // Build the editor for the selected shape (once per selection)
    function renderPanel()
    {
        fieldsEl.innerHTML = '';
        if (!selected) { propsEl.style.display = 'none'; return; }
        propsEl.style.display = 'block';

        if (selected.type === 'circle')
        {
            titleEl.textContent = 'Circle';
            badgeEl.textContent = 'radius';
            const r = numberField('f-radius', 'Radius (m)', selected.overlay.getRadius());
            r.addEventListener('change', () =>
            {
                const v = parseFloat(r.value);
                if (v >= 1) selected.overlay.setRadius(v);
            });
        } else
        { // rectangle
            titleEl.textContent = 'Rectangle';
            badgeEl.textContent = 'width × height';
            const sz = Utils.rectangleSize(selected.overlay);
            const w = numberField('f-width', 'Width (m)', sz.widthMeters);
            const h = numberField('f-height', 'Height (m)', sz.heightMeters);
            const apply = () =>
            {
                const wv = parseFloat(w.value), hv = parseFloat(h.value);
                if (wv >= 1 && hv >= 1) Utils.setRectangleSize(selected.overlay, wv, hv);
            };
            w.addEventListener('change', apply);
            h.addEventListener('change', apply);
        }
        syncPanel();
    }

    // Refresh field values + readouts + output (e.g. after a handle drag).
    // Skips the field currently being typed in so editing isn't disrupted.
    function syncPanel()
    {
        if (!selected) return;
        const o = selected.overlay;
        const active = document.activeElement;
        let data;

        if (selected.type === 'circle')
        {
            const c = o.getCenter(), rad = o.getRadius();
            const area = Math.PI * rad * rad;
            const rf = root.querySelector('.f-radius');
            if (rf && rf !== active) rf.value = Math.round(rad);
            readoutsEl.innerHTML =
                `Centre: <code>${c.lat().toFixed(6)}, ${c.lng().toFixed(6)}</code><br>` +
                `Area: <code>${fmt(area)} m²</code> (<code>${fmt(area / 10000)} ha</code>)`;
            data = {
                shapeType: 'circle',
                center: { lat: c.lat(), lng: c.lng() },
                radiusMeters: +rad.toFixed(2),
                areaMeters2: +area.toFixed(2)
            };
        } else
        {
            const sz = Utils.rectangleSize(o);
            const b = o.getBounds(), c = b.getCenter();
            const area = sz.widthMeters * sz.heightMeters;
            const wf = root.querySelector('.f-width');
            const hf = root.querySelector('.f-height');
            if (wf && wf !== active) wf.value = Math.round(sz.widthMeters);
            if (hf && hf !== active) hf.value = Math.round(sz.heightMeters);
            readoutsEl.innerHTML =
                `Centre: <code>${c.lat().toFixed(6)}, ${c.lng().toFixed(6)}</code><br>` +
                `Area: <code>${fmt(area)} m²</code> (<code>${fmt(area / 10000)} ha</code>)`;
            data = {
                shapeType: 'rectangle',
                bounds: {
                    north: b.getNorthEast().lat(), east: b.getNorthEast().lng(),
                    south: b.getSouthWest().lat(), west: b.getSouthWest().lng()
                },
                widthMeters: +sz.widthMeters.toFixed(2),
                heightMeters: +sz.heightMeters.toFixed(2),
                areaMeters2: +area.toFixed(2)
            };
        }
        outputEl.value = JSON.stringify(data, null, 2);
    }

    function selectShape(overlay, type)
    {
        if (selected && selected.overlay === overlay) return; // already selected
        deselect();                                           // locks the previous shape
        overlay.setOptions({ editable: true, draggable: true });
        selected = { overlay, type, listeners: [] };
        if (type === 'circle')
        {
            selected.listeners.push(
                google.maps.event.addListener(overlay, 'radius_changed', syncPanel),
                google.maps.event.addListener(overlay, 'center_changed', syncPanel)
            );
        } else
        {
            selected.listeners.push(
                google.maps.event.addListener(overlay, 'bounds_changed', syncPanel)
            );
        }
        renderPanel();
    }

    function deselect()
    {
        if (selected)
        {
            // Turn off the resize handles so the shape is no longer highlighted
            selected.overlay.setOptions({ editable: false, draggable: false });
            selected.listeners.forEach(l => google.maps.event.removeListener(l));
            selected = null;
        }
        propsEl.style.display = 'none';
    }

    function deleteSelected()
    {
        if (!selected) return;
        selected.overlay.setMap(null);
        deselect();
        outputEl.value = '';
    }

    // ── Deselect triggers ──────────────────────────────────
    // Clicking empty map space (a clickable shape consumes its own click,
    // so this only fires on the background) locks the current shape.
    google.maps.event.addListener(map, 'click', deselect);

    // Picking any drawing tool also clears the current selection. Wrapping
    // the instance method shadows the prototype, so the toolbar buttons and
    // the auto-exit after a draw both route through here.
    const _origSetMode = drawingManager.setDrawingMode.bind(drawingManager);
    drawingManager.setDrawingMode = function (mode)
    {
        if (mode) deselect();   // entering a draw mode; null = just finished, keep selection
        _origSetMode(mode);
    };

    // ── Capture finished shapes ────────────────────────────
    google.maps.event.addListener(drawingManager, 'overlaycomplete', function (event)
    {
        const type = event.type;
        const overlay = event.overlay;

        if (type === 'circle' || type === 'rectangle')
        {
            google.maps.event.addListener(overlay, 'click', () => selectShape(overlay, type));
            selectShape(overlay, type);
        } else if (type === 'marker')
        {
            deselect();
            // MCXMarkerUtils reads the position from either marker class, so
            // this code is identical in basic and advanced mode.
            const pos = MarkerUtils.getLatLng(overlay);
            outputEl.value = JSON.stringify({
                shapeType: 'marker',
                markerMode: drawingManager.getMarkerType(),
                markerClass: overlay.constructor && overlay.constructor.name,
                position: pos
            }, null, 2);
        } else
        {
            // polyline / polygon — show coordinates like the classic demo
            deselect();
            const coords = overlay.getPath().getArray().map(p => ({ lat: p.lat(), lng: p.lng() }));
            outputEl.value = JSON.stringify(
                { shapeType: type, vertexCount: coords.length, coordinates: coords },
                null, 2
            );
        }
    });

    return { map, drawingManager };
}
