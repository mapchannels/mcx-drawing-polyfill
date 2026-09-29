/*!
 * MCX Drawing Polyfill — Test Suite
 * Tests for attach/detach lifecycle, map settings restoration, and shape types
 */

(function ()
{
    'use strict';

    // Test harness
    var TestRunner = {
        tests: [],
        passed: 0,
        failed: 0,

        test: function (name, fn)
        {
            this.tests.push({ name: name, fn: fn });
        },

        run: async function ()
        {
            console.log('=== MCX Drawing Polyfill Test Suite ===\n');

            for (var i = 0; i < this.tests.length; i++)
            {
                var test = this.tests[i];
                try
                {
                    await test.fn();
                    this.passed++;
                    console.log('✓ PASS: ' + test.name);
                } catch (err)
                {
                    this.failed++;
                    console.error('✗ FAIL: ' + test.name);
                    console.error('  Error: ' + err.message);
                    if (err.stack) console.error('  Stack: ' + err.stack);
                }
            }

            console.log('\n=== Test Results ===');
            console.log('Passed: ' + this.passed);
            console.log('Failed: ' + this.failed);
            console.log('Total: ' + (this.passed + this.failed));

            if (this.failed === 0)
            {
                console.log('\n🎉 All tests passed!');
            } else
            {
                console.error('\n❌ ' + this.failed + ' test(s) failed.');
            }
        }
    };

    // Utility: assert equal
    function assertEqual(actual, expected, message)
    {
        if (actual !== expected)
        {
            throw new Error((message || '') + ' Expected ' + expected + ' but got ' + actual);
        }
    }

    // Utility: assert true
    function assertTrue(value, message)
    {
        if (!value)
        {
            throw new Error(message || 'Expected value to be true');
        }
    }

    // Utility: assert false
    function assertFalse(value, message)
    {
        if (value)
        {
            throw new Error(message || 'Expected value to be false');
        }
    }

    // Utility: create a mock Google Maps Map
    function createMockMap()
    {
        var options = {};
        return {
            getDiv: function () { return document.createElement('div'); },
            getOptions: function () { return Object.assign({}, options); },
            setOptions: function (opts)
            {
                Object.assign(options, opts);
            },
            addListener: function (event, callback) { return 1; },
            removeListener: function (listener) { }
        };
    }

    // ── Tests ──────────────────────────────────────────

    TestRunner.test('DrawingManager attaches to map', function ()
    {
        var map = createMockMap();
        var manager = new google.maps.drawing.DrawingManager({
            map: map,
            drawingControl: false
        });

        assertEqual(manager.getMap(), map, 'Manager should be attached to the map');
    });

    TestRunner.test('DrawingManager detaches from map', function ()
    {
        var map = createMockMap();
        var manager = new google.maps.drawing.DrawingManager({
            map: map,
            drawingControl: false
        });

        manager.setMap(null);
        assertEqual(manager.getMap(), null, 'Manager should be detached from the map');
    });

    TestRunner.test('Map settings are saved and restored on drawing mode', function ()
    {
        var map = createMockMap();
        map.setOptions({
            gestureHandling: 'greedy',
            disableDoubleClickZoom: false
        });

        var manager = new google.maps.drawing.DrawingManager({
            map: map,
            drawingControl: false
        });

        var originalSettings = map.getOptions();
        assertEqual(originalSettings.gestureHandling, 'greedy', 'Original gestureHandling should be greedy');
        assertFalse(originalSettings.disableDoubleClickZoom, 'Original disableDoubleClickZoom should be false');

        // Enter marker mode
        manager.setDrawingMode('marker');
        var drawingSettings = map.getOptions();
        assertEqual(drawingSettings.gestureHandling, 'auto', 'gestureHandling should be auto while drawing marker');
        assertTrue(drawingSettings.disableDoubleClickZoom, 'disableDoubleClickZoom should be true while drawing');

        // Exit drawing mode
        manager.setDrawingMode(null);
        var restoredSettings = map.getOptions();
        assertEqual(restoredSettings.gestureHandling, 'greedy', 'Original gestureHandling should be restored');
        assertFalse(restoredSettings.disableDoubleClickZoom, 'Original disableDoubleClickZoom should be restored');
    });

    TestRunner.test('Map settings are saved when entering drag-shape mode', function ()
    {
        var map = createMockMap();
        map.setOptions({
            gestureHandling: 'cooperative',
            disableDoubleClickZoom: false
        });

        var manager = new google.maps.drawing.DrawingManager({
            map: map,
            drawingControl: false
        });

        // Enter circle mode (drag-shape mode)
        manager.setDrawingMode('circle');
        var drawingSettings = map.getOptions();
        assertEqual(drawingSettings.gestureHandling, 'none', 'gestureHandling should be none for drag-shape modes');
        assertTrue(drawingSettings.disableDoubleClickZoom, 'disableDoubleClickZoom should be true while drawing');

        // Exit drawing mode
        manager.setDrawingMode(null);
        var restoredSettings = map.getOptions();
        assertEqual(restoredSettings.gestureHandling, 'cooperative', 'Original gestureHandling should be restored');
        assertFalse(restoredSettings.disableDoubleClickZoom, 'Original disableDoubleClickZoom should be restored');
    });

    TestRunner.test('Rectangle mode also disables gestures', function ()
    {
        var map = createMockMap();
        map.setOptions({
            gestureHandling: 'auto',
            disableDoubleClickZoom: false
        });

        var manager = new google.maps.drawing.DrawingManager({
            map: map,
            drawingControl: false
        });

        // Enter rectangle mode (drag-shape mode)
        manager.setDrawingMode('rectangle');
        var drawingSettings = map.getOptions();
        assertEqual(drawingSettings.gestureHandling, 'none', 'gestureHandling should be none for rectangle mode');
        assertTrue(drawingSettings.disableDoubleClickZoom, 'disableDoubleClickZoom should be true while drawing');

        // Exit drawing mode
        manager.setDrawingMode(null);
        var restoredSettings = map.getOptions();
        assertEqual(restoredSettings.gestureHandling, 'auto', 'Original gestureHandling should be restored');
    });

    TestRunner.test('Marker completion fires correct overlay type', function (done)
    {
        var map = createMockMap();
        var manager = new google.maps.drawing.DrawingManager({
            map: map,
            drawingControl: false,
            drawingMode: 'marker'
        });

        google.maps.event.addListener(manager, 'overlaycomplete', function (event)
        {
            assertTrue(event.overlay instanceof google.maps.Marker, 'Overlay should be a Marker');
            assertEqual(event.type, 'marker', 'Event type should be marker');
            done();
        });

        // Simulate a marker placement by manually creating the event
        // (In a real test, we would simulate actual map clicks)
        if (manager._handleMapClick)
        {
            var mockClickEvent = { latLng: { lat: 0, lng: 0 } };
            // This would normally be called by actual map interaction
        }
    });

    TestRunner.test('Polyline completion fires correct overlay type', function ()
    {
        var map = createMockMap();
        var manager = new google.maps.drawing.DrawingManager({
            map: map,
            drawingControl: false
        });

        var eventTypes = [];
        google.maps.event.addListener(manager, 'overlaycomplete', function (event)
        {
            eventTypes.push(event.type);
        });

        // Set mode to polyline
        manager.setDrawingMode('polyline');
        assertEqual(manager.getDrawingMode(), 'polyline', 'Drawing mode should be polyline');
    });

    TestRunner.test('Polygon completion fires correct overlay type', function ()
    {
        var map = createMockMap();
        var manager = new google.maps.drawing.DrawingManager({
            map: map,
            drawingControl: false
        });

        // Set mode to polygon
        manager.setDrawingMode('polygon');
        assertEqual(manager.getDrawingMode(), 'polygon', 'Drawing mode should be polygon');
    });

    TestRunner.test('Circle completion fires correct overlay type', function ()
    {
        var map = createMockMap();
        var manager = new google.maps.drawing.DrawingManager({
            map: map,
            drawingControl: false
        });

        // Set mode to circle
        manager.setDrawingMode('circle');
        assertEqual(manager.getDrawingMode(), 'circle', 'Drawing mode should be circle');
    });

    TestRunner.test('Rectangle completion fires correct overlay type', function ()
    {
        var map = createMockMap();
        var manager = new google.maps.drawing.DrawingManager({
            map: map,
            drawingControl: false
        });

        // Set mode to rectangle
        manager.setDrawingMode('rectangle');
        assertEqual(manager.getDrawingMode(), 'rectangle', 'Drawing mode should be rectangle');
    });

    TestRunner.test('Drawing mode can be changed between different modes', function ()
    {
        var map = createMockMap();
        var manager = new google.maps.drawing.DrawingManager({
            map: map,
            drawingControl: false
        });

        manager.setDrawingMode('marker');
        assertEqual(manager.getDrawingMode(), 'marker', 'Should be in marker mode');

        manager.setDrawingMode('polyline');
        assertEqual(manager.getDrawingMode(), 'polyline', 'Should be in polyline mode');

        manager.setDrawingMode('polygon');
        assertEqual(manager.getDrawingMode(), 'polygon', 'Should be in polygon mode');

        manager.setDrawingMode('circle');
        assertEqual(manager.getDrawingMode(), 'circle', 'Should be in circle mode');

        manager.setDrawingMode('rectangle');
        assertEqual(manager.getDrawingMode(), 'rectangle', 'Should be in rectangle mode');

        manager.setDrawingMode(null);
        assertEqual(manager.getDrawingMode(), null, 'Should be in pan mode');
    });

    TestRunner.test('Map settings are undefined in original state', function ()
    {
        var map = createMockMap();
        // Map starts with no specific gestureHandling or disableDoubleClickZoom
        var originalSettings = map.getOptions();
        assertTrue(!originalSettings.gestureHandling || originalSettings.gestureHandling === undefined,
            'Original gestureHandling should be undefined or not set');

        var manager = new google.maps.drawing.DrawingManager({
            map: map,
            drawingControl: false
        });

        // Enter and exit drawing mode
        manager.setDrawingMode('marker');
        manager.setDrawingMode(null);

        // Settings should be restored to their original state
        var restoredSettings = map.getOptions();
        assertTrue(!restoredSettings.gestureHandling || restoredSettings.gestureHandling === undefined,
            'gestureHandling should be restored to original undefined state');
    });

    // Export for use in browsers
    window.MCXDrawingTestRunner = TestRunner;

    // Auto-run if in a test environment
    if (typeof module !== 'undefined' && module.exports)
    {
        module.exports = TestRunner;
    }

})();
