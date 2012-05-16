/*global define*/
define([
        'require',
        'dojo/_base/declare',
        'dojo/ready',
        'dojo/_base/lang',
        'dojo/_base/event',
        'dojo/on',
        'dijit/_WidgetBase',
        'dijit/_TemplatedMixin',
        'Core/Ellipsoid',
        'Core/SunPosition',
        'Core/EventHandler',
        'Core/MouseEventType',
        'Core/requestAnimationFrame',
        'Core/Cartesian2',
        'Core/JulianDate',
        'Core/DefaultProxy',
        'Scene/Scene',
        'Scene/CentralBody',
        'Scene/BingMapsTileProvider',
        'Scene/BingMapsStyle',
        'Scene/SingleTileProvider',
        'Scene/StatisticsDisplay',
        'dojo/text!./templates/CesiumWidget.html'
    ], function (
        require,
        declare,
        ready,
        lang,
        event,
        on,
        _WidgetBase,
        _TemplatedMixin,
        Ellipsoid,
        SunPosition,
        EventHandler,
        MouseEventType,
        requestAnimationFrame,
        Cartesian2,
        JulianDate,
        DefaultProxy,
        Scene,
        CentralBody,
        BingMapsTileProvider,
        BingMapsStyle,
        SingleTileProvider,
        StatisticsDisplay,
        template) {
    "use strict";

    return declare('DojoWidgets.CesiumWidget', [_WidgetBase, _TemplatedMixin], {
        templateString : template,
        clock : undefined,
        preRender : undefined,
        postSetup : undefined,
        useStreamingImagery : true,
        mapStyle : BingMapsStyle.AERIAL,
        defaultCamera : undefined,
        lockSunPositionToCamera : false,

        constructor : function() {
            this.ellipsoid = Ellipsoid.WGS84;
        },

        postCreate : function() {
            ready(this, "_setupCesium");
        },

        resize : function() {
            var width = this.canvas.clientWidth, height = this.canvas.clientHeight;

            if (typeof this.scene === 'undefined' || (this.canvas.width === width && this.canvas.height === height)) {
                return;
            }

            this.canvas.width = width;
            this.canvas.height = height;

            this.scene.getContext().setViewport({
                x : 0,
                y : 0,
                width : width,
                height : height
            });

            this.scene.getCamera().frustum.aspectRatio = width / height;
        },

        onObjectSelected : undefined,
        onObjectRightClickSelected : undefined,
        onObjectMousedOver : undefined,
        onLeftMouseDown : undefined,
        onLeftMouseUp : undefined,
        onRightMouseDown : undefined,
        onRightMouseUp : undefined,
        onLeftDrag : undefined,
        onZoom : undefined,
        onCameraToggled : undefined,

        _handleLeftClick : function(e) {
            if (typeof this.onObjectSelected !== 'undefined') {
                // If the user left-clicks, we re-send the selection event, regardless if it's a duplicate,
                // because the client may want to react to re-selection in some way.
                this.selectedObject = this.scene.pick(e.position);
                this.onObjectSelected(this.selectedObject);
            }
        },

        _handleRightClick : function(e) {
            if (typeof this.onObjectRightClickSelected !== 'undefined') {
                // If the user right-clicks, we re-send the selection event, regardless if it's a duplicate,
                // because the client may want to react to re-selection in some way.
                this.selectedObject = this.scene.pick(e.position);
                this.onObjectRightClickSelected(this.selectedObject);
            }
        },

        _handleMouseMove : function(movement) {
            if (typeof this.onObjectMousedOver !== 'undefined') {
                // Don't fire multiple times for the same object as the mouse travels around the screen.
                var mousedOverObject = this.scene.pick(movement.endPosition);
                if (this.mousedOverObject !== mousedOverObject) {
                    this.mousedOverObject = mousedOverObject;
                    this.onObjectMousedOver(mousedOverObject);
                }
            }
            if (typeof this.leftDown !== 'undefined' && this.leftDown && typeof this.onLeftDrag !== 'undefined') {
                this.onLeftDrag(movement);
            } else if (typeof this.rightDown !== 'undefined' && this.rightDown && typeof this.onZoom !== 'undefined') {
                this.onZoom(movement);
            }
        },

        _handleRightDown : function(e) {
            this.rightDown = true;
            if (typeof this.onRightMouseDown !== 'undefined') {
                this.onRightMouseDown(e);
            }
        },

        _handleRightUp : function(e) {
            this.rightDown = false;
            if (typeof this.onRightMouseUp !== 'undefined') {
                this.onRightMouseUp(e);
            }
        },

        _handleLeftDown : function(e) {
            this.leftDown = true;
            if (typeof this.onLeftMouseDown !== 'undefined') {
                this.onLeftMouseDown(e);
            }
        },

        _handleLeftUp : function(e) {
            this.leftDown = false;
            if (typeof this.onLeftMouseUp !== 'undefined') {
                this.onLeftMouseUp(e);
            }
        },

        _handleWheel : function(e) {
            if (typeof this.onZoom !== 'undefined') {
                this.onZoom(e);
            }
        },

        _setupCesium : function() {
            var canvas = this.canvas, ellipsoid = this.ellipsoid, scene;

            try {
                scene = this.scene = new Scene(canvas);
            } catch (ex) {
                if (typeof this.onSetupError !== 'undefined') {
                    this.onSetupError(this, ex);
                }
                return;
            }

            this.resize();

            on(canvas, 'contextmenu', event.stop);
            on(canvas, 'selectstart', event.stop);

            var maxTextureSize = scene.getContext().getMaximumTextureSize();
            if (maxTextureSize < 4095) {
                // Mobile, or low-end card
                this.dayImageUrl = require.toUrl('Images//NE2_50M_SR_W_1024.jpg');
                this.nightImageUrl = require.toUrl('Images//land_ocean_ice_lights_512.jpg');
            } else {
                // Desktop
                this.dayImageUrl = require.toUrl('Images//NE2_50M_SR_W_4096.jpg');
                this.nightImageUrl = require.toUrl('Images//land_ocean_ice_lights_2048.jpg');
                this.specularMapUrl = require.toUrl('Images//earthspec1k.jpg');
                this.cloudsMapUrl = require.toUrl('Images//earthcloudmaptrans.jpg');
                this.bumpMapUrl = require.toUrl('Images//earthbump1k.jpg');
            }

            var centralBody = this.centralBody = new CentralBody(scene.getCamera(), ellipsoid);
            centralBody.showSkyAtmosphere = true;

            this._configureCentralBodyImagery();

            scene.getPrimitives().setCentralBody(centralBody);

            var camera = scene.getCamera(), maxRadii = ellipsoid.getRadii().getMaximumComponent();

            camera.position = camera.position.multiplyWithScalar(1.5);
            camera.frustum.near = 0.0002 * maxRadii;
            camera.frustum.far = 50.0 * maxRadii;

            this.spindleCameraController = camera.getControllers().addSpindle(ellipsoid);
            this.spindleCameraController.constrainedZAxis = true;
            this.freelookCameraController = camera.getControllers().addFreeLook(ellipsoid);

            var handler = new EventHandler(canvas);
            handler.setMouseAction(lang.hitch(this, '_handleLeftClick'), MouseEventType.LEFT_CLICK);
            handler.setMouseAction(lang.hitch(this, '_handleRightClick'), MouseEventType.RIGHT_CLICK);
            handler.setMouseAction(lang.hitch(this, '_handleMouseMove'), MouseEventType.MOVE);
            handler.setMouseAction(lang.hitch(this, '_handleLeftDown'), MouseEventType.LEFT_DOWN);
            handler.setMouseAction(lang.hitch(this, '_handleLeftUp'), MouseEventType.LEFT_UP);
            handler.setMouseAction(lang.hitch(this, '_handleWheel'), MouseEventType.WHEEL);
            handler.setMouseAction(lang.hitch(this, '_handleRightDown'), MouseEventType.RIGHT_DOWN);
            handler.setMouseAction(lang.hitch(this, '_handleRightUp'), MouseEventType.RIGHT_UP);

            if (typeof this.postSetup !== 'undefined') {
                this.postSetup(this);
            }

            this.defaultCamera = camera.clone();

            this.render();
        },

        viewHome : function() {
            var camera = this.scene.getCamera();
            camera.position = this.defaultCamera.position;
            camera.direction = this.defaultCamera.direction;
            camera.up = this.defaultCamera.up;
            camera.transform = this.defaultCamera.transform;
            camera.frustum = this.defaultCamera.frustum.clone();

            var controllers = camera.getControllers();
            controllers.removeAll();
            this.spindleCameraController = controllers.addSpindle(this.ellipsoid);
            this.spindleCameraController.constrainedZAxis = true;
            this.freelookCameraController = controllers.addFreeLook(this.ellipsoid);
        },

        areCloudsAvailable : function() {
            return typeof this.centralBody.cloudsMapSource !== 'undefined';
        },

        enableClouds : function(useClouds) {
            if (this.areCloudsAvailable()) {
                this.centralBody.showClouds = useClouds;
                this.centralBody.showCloudShadows = useClouds;
            }
        },

        enableStatistics : function(showStatistics) {
            if (typeof this._statisticsDisplay === 'undefined' && showStatistics) {
                this._statisticsDisplay = new StatisticsDisplay();
                this.scene.getPrimitives().add(this._statisticsDisplay);
            } else if (typeof this._statisticsDisplay !== 'undefined' && !showStatistics) {
                this._statisticsDisplay = undefined;
                this.scene.getPrimitives().remove(this._statisticsDisplay);
            }
        },

        showSkyAtmosphere : function(show) {
            this.centralBody.showSkyAtmosphere = show;
        },

        enableStreamingImagery : function(value) {
            this.useStreamingImagery = value;
            this._configureCentralBodyImagery();
        },

        setStreamingImageryMapStyle : function(value) {
            this.useStreamingImagery = true;

            if (this.mapStyle !== value) {
                this.mapStyle = value;
                this._configureCentralBodyImagery();
            }
        },

        setLogoOffset : function(logoOffsetX, logoOffsetY) {
            var logoOffset = this.centralBody.logoOffset;
            if ((logoOffsetX !== logoOffset.x) || (logoOffsetY !== logoOffset.y)) {
                this.centralBody.logoOffset = new Cartesian2(logoOffsetX, logoOffsetY);
            }
        },

        render : function() {
            if (typeof this.preRender !== 'undefined') {
                this.preRender(this);
            }

            var clock = this.clock;

            var time;
            if (typeof clock !== 'undefined') {
                time = clock.currentTime;
            } else {
                time = new JulianDate();
            }

            var scene = this.scene;
            if (this.lockSunPositionToCamera) {
                scene.setSunPosition(scene.getCamera().position);
            } else {
                scene.setSunPosition(SunPosition.compute(time).position);
            }
            scene.render();

            var renderHitched = this._renderHitched;
            if (typeof renderHitched === 'undefined') {
                renderHitched = lang.hitch(this, 'render');
                this._renderHitched = renderHitched;
            }

            requestAnimationFrame(renderHitched);
        },

        _configureCentralBodyImagery : function() {
            var centralBody = this.centralBody;

            if (this.useStreamingImagery) {
                centralBody.dayTileProvider = new BingMapsTileProvider({
                    server : "dev.virtualearth.net",
                    mapStyle : this.mapStyle
                });
            } else {
                centralBody.dayTileProvider = new SingleTileProvider(this.dayImageUrl);
            }

            centralBody.nightImageSource = this.nightImageUrl;
            centralBody.specularMapSource = this.specularMapUrl;
            centralBody.cloudsMapSource = this.cloudsMapUrl;
            centralBody.bumpMapSource = this.bumpMapUrl;
        }
    });
});