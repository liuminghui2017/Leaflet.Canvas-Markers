/**
 * 使用了https://github.com/corg/Leaflet.Canvas-Markers/branches 的animate-zoom分支；
 * 1. 增强，根据分辨率调整canvas的绘图width、height，以解决图标模糊问题;
 * 2. 增强，可为图标增加一个hover图片;
 * 3. 重写事件，解决原来此插件会遮挡leaflet的多边形图层问题
 */
'use strict';

function layerFactory(L) {

    var CanvasIconLayer = (L.Layer ? L.Layer : L.Class).extend({

        //Add event listeners to initialized section.
        initialize: function (options) {

            L.setOptions(this, options);
            this._onClickListeners = [];
            this._onHoverListeners = [];
            this._onMouseOutListeners = [];
        },

        setOptions: function (options) {

            L.setOptions(this, options);
            return this.redraw();
        },

        redraw: function () {
            this._redraw(true);
        },

        //Multiple layers at a time for rBush performance
        addMarkers: function (markers) {

            var self = this;
            var tmpMark = [];
            var tmpLatLng = [];

            markers.forEach(function (marker) {

                if (!((marker.options.pane == 'markerPane') && marker.options.icon))
                {
                    console.error('Layer isn\'t a marker');
                    return;
                }

                var latlng = marker.getLatLng();
                var isDisplaying = self._map.getBounds().contains(latlng);
                var s = self._addMarker(marker,latlng,isDisplaying);

                //Only add to Point Lookup if we are on map
                if (isDisplaying ===true) tmpMark.push(s[0]);

                tmpLatLng.push(s[1]);
            });

            self._markers.load(tmpMark);
            self._latlngMarkers.load(tmpLatLng);
        },

        //Adds single layer at a time. Less efficient for rBush
        addMarker: function (marker) {

            var self = this;
            var latlng = marker.getLatLng();
            var isDisplaying = self._map.getBounds().contains(latlng);
            var dat = self._addMarker(marker,latlng,isDisplaying);

            //Only add to Point Lookup if we are on map
            if(isDisplaying ===true) self._markers.insert(dat[0]);

            self._latlngMarkers.insert(dat[1]);
        },

        addLayer: function (layer) {

            if ((layer.options.pane == 'markerPane') && layer.options.icon) this.addMarker(layer);
            else console.error('Layer isn\'t a marker');
        },

        addLayers: function (layers) {

            this.addMarkers(layers);
        },

        removeLayer: function (layer) {

            this.removeMarker(layer,true);
        },

        removeMarker: function (marker,redraw) {

            var self = this;

            //If we are removed point
            if(marker["minX"]) marker = marker.data;

            var latlng = marker.getLatLng();
            var isDisplaying = self._map.getBounds().contains(latlng);

            var markerData = {

                minX: latlng.lng,
                minY: latlng.lat,
                maxX: latlng.lng,
                maxY: latlng.lat,
                data: marker
            };

            self._latlngMarkers.remove(markerData, function (a,b) {

                return a.data._leaflet_id ===b.data._leaflet_id;
            });

            self._latlngMarkers.total--;
            self._latlngMarkers.dirty++;

            if(isDisplaying ===true && redraw ===true) {

                self._redraw(true);
            }
        },

        onAdd: function (map) {

            this._map = map;

            if (!this._canvas) this._initCanvas();

            if (this.options.pane) this.getPane().appendChild(this._canvas);
            else map._panes.overlayPane.appendChild(this._canvas);

            map.on('moveend', this._reset, this);
            map.on('resize',this._reset,this);

            L.DomEvent.on(this._canvas, 'mousemove', this._onMouseMove, this);
            L.DomEvent.on(this._canvas, 'click dblclick mousedown mouseup contextmenu', this._onClick, this);
            L.DomEvent.on(this._canvas, 'mouseout', this._handleMouseOut, this);

            if (map._zoomAnimated) {
                map.on('zoomanim', this._animateZoom, this);
            }
        },

        onRemove: function (map) {

            if (this.options.pane) this.getPane().removeChild(this._canvas);
            else map.getPanes().overlayPane.removeChild(this._canvas);

            L.DomEvent.off(this._canvas);
            map.off('moveend', this._reset, this);
            map.off('resize',this._reset,this);

            if (map._zoomAnimated) {
                map.off('zoomanim', this._animateZoom, this);
            }
        },

        addTo: function (map) {

            map.addLayer(this);
            return this;
        },

        clearLayers: function() {

            this._latlngMarkers = null;
            this._markers = null;
            
            this._redraw(true);
        },

        _animateZoom: function(event) {
            var scale = this._map.getZoomScale(event.zoom);
            var offset = this._map._latLngBoundsToNewLayerBounds(this._map.getBounds(), event.zoom, event.center).min;

            L.DomUtil.setTransform(this._canvas, offset, scale);
        },

        _addMarker: function(marker,latlng,isDisplaying) {

            var self = this;
            //Needed for pop-up & tooltip to work.
            marker._map = self._map;

            //_markers contains Points of markers currently displaying on map
            if (!self._markers) self._markers = new rbush();

            //_latlngMarkers contains Lat\Long coordinates of all markers in layer.
            if (!self._latlngMarkers) {
                self._latlngMarkers = new rbush();
                self._latlngMarkers.dirty=0;
                self._latlngMarkers.total=0;
            }

            L.Util.stamp(marker);

            var pointPos = self._map.latLngToContainerPoint(latlng);
            var iconSize = marker.options.icon.options.iconSize;

            pointPos.x *=  devicePixelRatio
            pointPos.y *=  devicePixelRatio

            var adj_x = iconSize[0]/2 * devicePixelRatio;
            var adj_y = iconSize[1]/2 * devicePixelRatio;
            var ret = [({
                minX: (pointPos.x - adj_x),
                minY: (pointPos.y - adj_y),
                maxX: (pointPos.x + adj_x),
                maxY: (pointPos.y + adj_y),
                data: marker
            }),({
                minX: latlng.lng,
                minY: latlng.lat,
                maxX: latlng.lng,
                maxY: latlng.lat,
                data: marker
            })];

            self._latlngMarkers.dirty++;
            self._latlngMarkers.total++;

            //Only draw if we are on map
            if(isDisplaying===true) self._drawMarker(marker, pointPos);

            return ret;
        },

        _drawMarker: function (marker, pointPos) {

            var self = this;

            if (!this._imageLookup) this._imageLookup = {};
            if (!pointPos) {
                pointPos = self._map.latLngToContainerPoint(marker.getLatLng());
                pointPos.x *=  devicePixelRatio;
                pointPos.y *=  devicePixelRatio;
            }

            var iconUrl = marker.options.icon.options.iconUrl;
            var iconBgUrl = marker.options.icon.options.iconBgUrl;

            if (marker.canvas_img) {
                self._drawImage(marker, pointPos);
            }
            else {

                if(self._imageLookup[iconUrl]) {
                    marker.canvas_img = self._imageLookup[iconUrl][0];

                    if (self._imageLookup[iconUrl][1] ===false) {

                        self._imageLookup[iconUrl][2].push([marker,pointPos]);
                    }
                    else {

                        self._drawImage(marker,pointPos);
                    }
                }
                else {

                    var i = new Image();
                    i.src = iconUrl;
                    marker.canvas_img = i;

                    //Image,isLoaded,marker\pointPos ref
                    self._imageLookup[iconUrl] = [i, false, [[marker, pointPos]]];

                    i.onload = function() {

                        self._imageLookup[iconUrl][1] = true;
                        self._imageLookup[iconUrl][2].forEach(function (e) {

                            self._drawImage(e[0],e[1]);
                        });
                    }
                }
            }

            // extend
            if (iconBgUrl && !marker.canvas_bg_img) {
                if (self._imageLookup[iconBgUrl]) {
                    marker.canvas_bg_img = self._imageLookup[iconBgUrl][0]
                } else {
                    var bg = new Image();
                    bg.src = iconBgUrl;
                    marker.canvas_bg_img = bg;
                    self._imageLookup[iconBgUrl] = [bg, false];

                    bg.onload = function() {
                        self._imageLookup[iconBgUrl][1] = true;
                    }
                }
            }
        },

        _drawImage: function (marker, pointPos) {

            var options = marker.options.icon.options;

            this._context.drawImage(
                marker.canvas_img,
                pointPos.x - options.iconAnchor[0] * devicePixelRatio,
                pointPos.y - options.iconAnchor[1] * devicePixelRatio,
                options.iconSize[0] * devicePixelRatio,
                options.iconSize[1] * devicePixelRatio
            );
        },

        _drawBgImage: function (marker, pointPos) {
            var options = marker.options.icon.options;
            if (!marker.canvas_bg_img) return;

            this._context.drawImage(
                marker.canvas_bg_img,
                pointPos.x - options.iconBgAnchor[0] * devicePixelRatio,
                pointPos.y - options.iconBgAnchor[1] * devicePixelRatio,
                options.iconBgSize[0] * devicePixelRatio,
                options.iconBgSize[1] * devicePixelRatio
            );
        },

        _reset: function () {

            var topLeft = this._map.containerPointToLayerPoint([0, 0]);
            L.DomUtil.setPosition(this._canvas, topLeft);

            var size = this._map.getSize();

            this._canvas.style.width = size.x + "px";
            this._canvas.style.height = size.y + "px";
            this._canvas.width = size.x * devicePixelRatio;
            this._canvas.height = size.y * devicePixelRatio;
            
            this._redraw();
        },

        _redraw: function (clear) {
            // console.log('redraw ')
            // return before inited
            if (!this._context) return;

            var self = this;

            if (clear) this._context.clearRect(0, 0, this._canvas.width, this._canvas.height);
            if (!this._map || !this._latlngMarkers) return;

            var tmp = [];

            //If we are 10% individual inserts\removals, reconstruct lookup for efficiency
            if (self._latlngMarkers.dirty/self._latlngMarkers.total >= .1) {

                self._latlngMarkers.all().forEach(function(e) {

                    tmp.push(e);
                });

                self._latlngMarkers.clear();
                self._latlngMarkers.load(tmp);
                self._latlngMarkers.dirty=0;
                tmp = [];
            }

            var mapBounds = self._map.getBounds();

            //Only re-draw what we are showing on the map.

            var mapBoxCoords = {

                minX: mapBounds.getWest(),
                minY: mapBounds.getSouth(),
                maxX: mapBounds.getEast(),
                maxY: mapBounds.getNorth(),
            };

            self._latlngMarkers.search(mapBoxCoords).forEach(function (e) {

                //Readjust Point Map
                var pointPos = self._map.latLngToContainerPoint(e.data.getLatLng());
                pointPos.x *=  devicePixelRatio
                pointPos.y *=  devicePixelRatio

                var iconSize = e.data.options.icon.options.iconSize;
                var adj_x = iconSize[0]/2 * devicePixelRatio;
                var adj_y = iconSize[1]/2 * devicePixelRatio;

                var newCoords = {
                    minX: (pointPos.x - adj_x),
                    minY: (pointPos.y - adj_y),
                    maxX: (pointPos.x + adj_x),
                    maxY: (pointPos.y + adj_y),
                    data: e.data
                }

                tmp.push(newCoords);

                //Redraw points
                self._drawMarker(e.data, pointPos);
            });

            //Clear rBush & Bulk Load for performance
            this._markers.clear();
            this._markers.load(tmp);
        },

        _initCanvas: function () {

            this._canvas = L.DomUtil.create('canvas', 'leaflet-canvas-icon-layer leaflet-layer');
            // var originProp = L.DomUtil.testProp(['transformOrigin', 'WebkitTransformOrigin', 'msTransformOrigin']);
            // this._canvas.style[originProp] = '50% 50%';

            var size = this._map.getSize();
            // this._canvas.style.pointerEvents = "none";
            this._canvas.style.width = size.x + "px";
            this._canvas.style.height = size.y + "px";
            this._canvas.width = size.x * devicePixelRatio;
            this._canvas.height = size.y * devicePixelRatio;

            this._context = this._canvas.getContext('2d');

            var animated = this._map.options.zoomAnimation && L.Browser.any3d;
            L.DomUtil.addClass(this._canvas, 'leaflet-zoom-' + (animated ? 'animated' : 'hide'));
        },

        addOnClickListener: function (listener) {
            this._onClickListeners.push(listener);
        },

        addOnHoverListener: function (listener) {
            this._onHoverListeners.push(listener);
        },

        addOnMouseOutListener: function (listener) {
            this._onMouseOutListeners.push(listener);
        },

        _executeListeners: function (event) {
            if (!this._markers) return false;

            var me = this;
            var x = event.containerPoint.x * devicePixelRatio;
            var y = event.containerPoint.y * devicePixelRatio;


            if(me._openToolTip) {
                me._openToolTip.closeTooltip();
                delete me._openToolTip;
            }

            var ret = this._markers.search({ minX: x, minY: y, maxX: x, maxY: y });
            var hit = ret && ret.length > 0

            if (hit) {
                me._map._container.style.cursor="pointer";
                var marker = ret[0].data;

                if (event.type==="click") {

                    var hasPopup = marker.getPopup();
                    if(hasPopup) marker.openPopup();

                    me._onClickListeners.forEach(function (listener) { listener(event, marker); });
                }

                if (event.type==="mousemove") {
                    var hasTooltip = marker.getTooltip();
                    var riseOnHover = marker.options.riseOnHover;
                    if(hasTooltip) {
                        me._openToolTip = marker;
                        marker.openTooltip();
                    }
                    if (me._lastHoverID && me._lastHoverID != marker._leaflet_id) {
                        me._onMouseOutListeners.forEach(function (listener) { listener(event) });
                    }
                    if (me._lastHoverID != marker._leaflet_id) { // 只触发一次
                        me._lastHoverID = marker._leaflet_id;
                        me._onHoverListeners.forEach(function (listener) { listener(event, marker); });
                        if (riseOnHover) {
                            me._riseOnHover(marker)
                        }
                    }
                }
            }
            else {
                me._map._container.style.cursor="";
                if (me._lastHoverID) {
                    me._lastHoverID = null;
                    me._onMouseOutListeners.forEach(function (listener) { listener(event) });
                    this._redraw(true); // 清空bgImage
                }
            }

            return hit
        },

        _hitTest: function(event) {
            var hitTargets = [];
            var containerPoint = this._map.mouseEventToContainerPoint(event);

            if (this._markers) {
                var x = containerPoint.x * devicePixelRatio;
                var y = containerPoint.y * devicePixelRatio;
                var ret = this._markers.search({ minX: x, minY: y, maxX: x, maxY: y });
                if (ret && ret.length > 0) {
                    hitTargets = ret;
                }
            }

            return hitTargets;
        },

        _onClick: function (e) {
            var targets = [];
            if (e.type === 'click' && this._onClickListeners.length) {
                targets = this._hitTest(e);
            }

            if (targets.length > 0) {
                this._handleClick(e, targets)
            } else if (this._map._renderer) {
                // 主动触发leaflet的多边形canvas的事件监听
                this._map._renderer._onClick(e)
            }
        },

        _onMouseMove: function (e) {
            var targets = [];
            if (this._onHoverListeners.length) {
                targets = this._hitTest(e);
            }

            if (targets.length > 0) {
                this._handleMouseMove(e, targets);
                return;
            }
            
            // 每命中时处理一下mouseout
            this._map._container.style.cursor="";
            if (this._lastHoverID) {
                this._lastHoverID = null;
                this._onMouseOutListeners.forEach(function (listener) { listener(e) });
                this._redraw(true); // 清空bgImage
            }

            if (this._map._renderer) {
                // 主动触发leaflet的多边形canvas的事件监听
                this._map._renderer._onMouseMove(e)
            }
            
        },

        // 这里是鼠标移出canvas容器事件
        _handleMouseOut: function (e) {
            if (this._map._renderer) {
                // 主动触发leaflet的多边形canvas的事件监听
                this._map._renderer._handleMouseOut(e)
            }
        },

        _handleClick: function(e, targets) {
            this._map._container.style.cursor="pointer";
            var marker = targets[0].data;

            var hasPopup = marker.getPopup();
            if(hasPopup) marker.openPopup();

            this._onClickListeners.forEach(function (listener) { listener(e, marker); });
        },

        _handleMouseMove: function(e, targets) {
            this._map._container.style.cursor="pointer";
            var marker = targets[0].data;
            var hasTooltip = marker.getTooltip();
            var riseOnHover = marker.options.riseOnHover;
            if(hasTooltip) {
                this._openToolTip = marker;
                marker.openTooltip();
            }
            
            if (this._lastHoverID != marker._leaflet_id) { // 只触发一次
                if (this._lastHoverID) {
                    this._onMouseOutListeners.forEach(function (listener) { listener(e) });
                }
                this._lastHoverID = marker._leaflet_id;
                this._onHoverListeners.forEach(function (listener) { listener(e, marker); });
                if (riseOnHover) {
                    this._riseOnHover(marker)
                }
            }
        },

        _riseOnHover(marker) {
            // 因为反复在同一个位置绘制图片会出现黑影，重绘一下清除黑影
            this._redraw(true);

            var pointPos = this._map.latLngToContainerPoint(marker.getLatLng());
            pointPos.x *=  devicePixelRatio;
            pointPos.y *=  devicePixelRatio;
            this._drawBgImage(marker, pointPos);
            this._drawImage(marker, pointPos);
        },
    });

    L.canvasIconLayer = function (options) {
        return new CanvasIconLayer(options);
    };
};

module.exports = layerFactory;
