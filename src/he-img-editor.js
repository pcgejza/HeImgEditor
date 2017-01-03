/*!
 * HeImgEditor 
 *
 * Copyright (c) 2017 Huzinecz Erik
 */

(function (factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as anonymous module.
        define(['jquery'], factory);
    } else if (typeof exports === 'object') {
        // Node / CommonJS
        factory(require('jquery'));
    } else {
        // Browser globals.
        factory(jQuery);
    }
})(function ($) {

    'use strict';


    // Globals
    var $window = $(window);
    var $document = $(document);
    var location = window.location;
    var navigator = window.navigator;
    var ArrayBuffer = window.ArrayBuffer;
    var Uint8Array = window.Uint8Array;
    var DataView = window.DataView;
    var btoa = window.btoa;

    // Constants
    var NAMESPACE = 'HE_IMG_EDITOR';

    // RegExps
    var REGEXP_ACTIONS = /^(e|w|s|n|se|sw|ne|nw|all|crop|move)$/;
    var REGEXP_DATA_URL = /^data:/;
    var REGEXP_DATA_URL_HEAD = /^data:([^;]+);base64,/;
    var REGEXP_DATA_URL_JPEG = /^data:image\/jpeg.*;base64,/;


    // Supports
    var SUPPORT_CANVAS = $.isFunction($('<canvas>')[0].getContext);
    var IS_SAFARI_OR_UIWEBVIEW = navigator && /(Macintosh|iPhone|iPod|iPad).*AppleWebKit/i.test(navigator.userAgent);

    // Events
    var EVENT_MOUSE_DOWN = 'mousedown touchstart pointerdown MSPointerDown';
    var EVENT_MOUSE_MOVE = 'mousemove touchmove pointermove MSPointerMove';
    var EVENT_MOUSE_UP = 'mouseup touchend touchcancel pointerup pointercancel MSPointerUp MSPointerCancel';
    var EVENT_WHEEL = 'wheel mousewheel DOMMouseScroll';
    var EVENT_DBLCLICK = 'dblclick';
    var EVENT_LOAD = 'load.' + NAMESPACE;
    var EVENT_ERROR = 'error.' + NAMESPACE;
    var EVENT_RESIZE = 'resize.' + NAMESPACE; // Bind to window with namespace
    var EVENT_BUILD = 'build.' + NAMESPACE;
    var EVENT_BUILT = 'built.' + NAMESPACE;
    var EVENT_ZOOM = 'zoom.' + NAMESPACE;

    // Classes
    var CLASS_BG = 'he-img-bg';
    var CLASS_HIDDEN = 'heimg-hidden';
    var CLASS_MOVE = 'heimg-move';
    var CLASS_CROP = 'heimg-crop';
    var CLASS_MODAL = 'heimg-modal';


    // Maths
    var num = Number;
    var min = Math.min;
    var max = Math.max;
    var abs = Math.abs;
    var sin = Math.sin;
    var cos = Math.cos;
    var sqrt = Math.sqrt;
    var round = Math.round;
    var floor = Math.floor;

    var DATA_PREVIEW = 'preview';
    var DATA_ACTION = 'action';

    // Események
    var ACTION_ALL = 'all';
    var ACTION_CROP = 'crop';
    var ACTION_MOVE = 'move';
    var ACTION_NONE = 'none';

    function isNumber(n) {
        return typeof n === 'number' && !isNaN(n);
    }

    function isUndefined(n) {
        return typeof n === 'undefined';
    }

    function toArray(obj, offset) {
        var args = [];

        // This is necessary for IE8
        if (isNumber(offset)) {
            args.push(offset);
        }

        return args.slice.apply(obj, args);
    }


    // Custom proxy to avoid jQuery's guid
    function proxy(fn, context) {
        var args = toArray(arguments, 2);

        return function () {
            return fn.apply(context, args.concat(toArray(arguments)));
        };
    }

    function isCrossOriginURL(url) {
        var parts = url.match(/^(https?:)\/\/([^\:\/\?#]+):?(\d*)/i);

        return parts && (
                parts[1] !== location.protocol ||
                parts[2] !== location.hostname ||
                parts[3] !== location.port
                );
    }

    function addTimestamp(url) {
        var timestamp = 'timestamp=' + (new Date()).getTime();

        return (url + (url.indexOf('?') === -1 ? '?' : '&') + timestamp);
    }

    function getCrossOrigin(crossOrigin) {
        return crossOrigin ? ' crossOrigin="' + crossOrigin + '"' : '';
    }

    function getImageSize(image, callback) {
        var newImage;

        // Modern browsers (ignore Safari, #120 & #509)
        if (image.naturalWidth && !IS_SAFARI_OR_UIWEBVIEW) {
            return callback(image.naturalWidth, image.naturalHeight);
        }

        // IE8: Don't use `new Image()` here (#319)
        newImage = document.createElement('img');

        newImage.onload = function () {
            callback(this.width, this.height);
        };

        newImage.src = image.src;
    }



    function HeImgEditor(element, options) {
        this.$element = $(element);
        this.options = $.extend({}, HeImgEditor.DEFAULTS, $.isPlainObject(options) && options);
        this.isLoaded = false;
        this.isBuilt = false;
        this.isCompleted = false;
        this.canvas = null;
        this.cropBox = null;

        this.init();
    }


    HeImgEditor.prototype = {
        constructor: HeImgEditor,

        init: function () {
            var $this = this.$element;
            var url;

            if ($this.is('img')) {

                // Should use `$.fn.attr` here. e.g.: "img/picture.jpg"
                this.originalUrl = url = $this.attr('src');

                // Stop when it's a blank image
                if (!url) {
                    return;
                }

                url = $this.prop('src');
            } else {
                console.error('This is not image!');
                return this;
            }

            this.load(url);
        },

        // A shortcut for triggering custom events
        trigger: function (type, data) {
            var e = $.Event(type, data);

            this.$element.trigger(e);

            return e;
        },

        load: function (url) {
            var options = this.options;
            var $this = this.$element;
            var read;
            var xhr;

            if (!url) {
                return;
            }

            // Trigger build event first
            $this.one(EVENT_BUILD, options.build);

            if (this.trigger(EVENT_BUILD).isDefaultPrevented()) {
                return;
            }

            this.url = url;
            this.image = {};

            if (!options.checkOrientation || !ArrayBuffer) {
                return this.clone();
            }

            read = $.proxy(this.read, this);

            // XMLHttpRequest disallows to open a Data URL in some browsers like IE11 and Safari
            if (REGEXP_DATA_URL.test(url)) {
                return REGEXP_DATA_URL_JPEG.test(url) ?
                        read(dataURLToArrayBuffer(url)) :
                        this.clone();
            }

            xhr = new XMLHttpRequest();

            xhr.onerror = xhr.onabort = $.proxy(function () {
                this.clone();
            }, this);

            xhr.onload = function () {
                read(this.response);
            };

            if (options.checkCrossOrigin && isCrossOriginURL(url) && $this.prop('crossOrigin')) {
                url = addTimestamp(url);
            }

            xhr.open('get', url);
            xhr.responseType = 'arraybuffer';
            xhr.send();
        },

        clone: function () {
            var options = this.options;
            var $this = this.$element;
            var url = this.url;
            var crossOrigin = '';
            var crossOriginUrl;
            var $clone;

            if (options.checkCrossOrigin && isCrossOriginURL(url)) {
                crossOrigin = $this.prop('crossOrigin');

                if (crossOrigin) {
                    crossOriginUrl = url;
                } else {
                    crossOrigin = 'anonymous';

                    // Bust cache (#148) when there is not a "crossOrigin" property
                    crossOriginUrl = addTimestamp(url);
                }
            }

            this.crossOrigin = crossOrigin;
            this.crossOriginUrl = crossOriginUrl;
            this.$clone = $clone = $('<img' + getCrossOrigin(crossOrigin) + ' src="' + (crossOriginUrl || url) + '">');

            if ($this[0].complete) {
                this.start();
            } else {
                $this.one(EVENT_LOAD, $.proxy(this.start, this));
            }
        },

        start: function () {
            var $image = this.$element;
            var $clone = this.$clone;

            getImageSize($image[0], $.proxy(function (naturalWidth, naturalHeight) {
                $.extend(this.image, {
                    naturalWidth: naturalWidth,
                    naturalHeight: naturalHeight,
                    aspectRatio: naturalWidth / naturalHeight
                });

                this.isLoaded = true;
                this.build();
            }, this));
        },

        build: function () {
            var options = this.options;
            var $this = this.$element;
            var $clone = this.$clone;
            var $heImgEditor;
            var $cropBox;
            var $face;

            if (!this.isLoaded) {
                return;
            }

            // Unbuild first when replace
            if (this.isBuilt) {
                this.unbuild();
            }

            // Elemek létrehozása
            this.$container = $this.parent();
            this.$heImgEditor = $heImgEditor = $(HeImgEditor.TEMPLATE);
            this.$canvas = $heImgEditor.find('.heimgeditor-canvas').append($clone);
            this.$dragBox = $heImgEditor.find('.heimgeditor-drag-box');
            this.$cropBox = $cropBox = $heImgEditor.find('.heimgeditor-crop-box');
            this.$face = $face = $cropBox.find('.heimgeditor-face');
            this.$button = {
                cut: $heImgEditor.find('.heimgeditor-c-crop')
            };

            // Eredeti kép elrejtése
            $this.addClass(CLASS_HIDDEN).after($heImgEditor);

            this.bind();
            
            
            this.isCropped = true;

            this.$dragBox.addClass(CLASS_MODAL);

            options.aspectRatio = max(0, options.aspectRatio) || NaN;

            if (options.background) {
                $heImgEditor.addClass(CLASS_BG);
            }

            $face.addClass(CLASS_MOVE).data(DATA_ACTION, ACTION_ALL);

            this.render();
            this.isBuilt = true;

            // Trigger the built event asynchronously to keep `data('cropper')` is defined
            this.completing = setTimeout($.proxy(function () {
                this.trigger(EVENT_BUILT);
                this.isCompleted = true;
            }, this), 0);
        },

        bind: function () {
            var options = this.options;
            var $this = this.$element;
            var $heImgEditor = this.$heImgEditor;

            if (options.responsive) {
                $window.on(EVENT_RESIZE, (this._resize = proxy(this.resize, this)));
            }

            $heImgEditor.on(EVENT_MOUSE_DOWN, $.proxy(this.cropStart, this));
            $document.
                    on(EVENT_MOUSE_MOVE, (this._cropMove = proxy(this.cropMove, this))).
                    on(EVENT_MOUSE_UP, (this._cropEnd = proxy(this.cropEnd, this)));
        },

        render: function () {
            this.initContainer();
            this.initCanvas();
            this.initCropBox();
            this.renderCanvas();
            this.bindButtons();
        },

        initCropBox: function () {
            var options = this.options;
            var canvas = this.canvas;
            var aspectRatio = options.aspectRatio;
            var autoCropArea = num(options.autoCropArea) || 0.8;
            var cropBox = {
                width: canvas.width,
                height: canvas.height
            };

            if (aspectRatio) {
                if (canvas.height * aspectRatio > canvas.width) {
                    cropBox.height = cropBox.width / aspectRatio;
                } else {
                    cropBox.width = cropBox.height * aspectRatio;
                }
            }

            this.cropBox = cropBox;
            this.limitCropBox(true, true);

            // Initialize auto crop area
            cropBox.width = min(max(cropBox.width, cropBox.minWidth), cropBox.maxWidth);
            cropBox.height = min(max(cropBox.height, cropBox.minHeight), cropBox.maxHeight);

            // The width of auto crop area must large than "minWidth", and the height too. (#164)
            cropBox.width = max(cropBox.minWidth, cropBox.width * autoCropArea);
            cropBox.height = max(cropBox.minHeight, cropBox.height * autoCropArea);
            cropBox.oldLeft = cropBox.left = canvas.left + (canvas.width - cropBox.width) / 2;
            cropBox.oldTop = cropBox.top = canvas.top + (canvas.height - cropBox.height) / 2;

            this.initialCropBox = $.extend({}, cropBox);
        },

        limitCropBox: function (isSizeLimited, isPositionLimited) {
            var options = this.options;
            var aspectRatio = options.aspectRatio;
            var container = this.container;
            var containerWidth = container.width;
            var containerHeight = container.height;
            var canvas = this.canvas;
            var cropBox = this.cropBox;
            var isLimited = this.isLimited;
            var minCropBoxWidth;
            var minCropBoxHeight;
            var maxCropBoxWidth;
            var maxCropBoxHeight;

            if (isSizeLimited) {
                minCropBoxWidth = num(options.minCropBoxWidth) || 0;
                minCropBoxHeight = num(options.minCropBoxHeight) || 0;

                // The min/maxCropBoxWidth/Height must be less than containerWidth/Height
                minCropBoxWidth = min(minCropBoxWidth, containerWidth);
                minCropBoxHeight = min(minCropBoxHeight, containerHeight);
                maxCropBoxWidth = min(containerWidth, isLimited ? canvas.width : containerWidth);
                maxCropBoxHeight = min(containerHeight, isLimited ? canvas.height : containerHeight);

                if (aspectRatio) {
                    if (minCropBoxWidth && minCropBoxHeight) {
                        if (minCropBoxHeight * aspectRatio > minCropBoxWidth) {
                            minCropBoxHeight = minCropBoxWidth / aspectRatio;
                        } else {
                            minCropBoxWidth = minCropBoxHeight * aspectRatio;
                        }
                    } else if (minCropBoxWidth) {
                        minCropBoxHeight = minCropBoxWidth / aspectRatio;
                    } else if (minCropBoxHeight) {
                        minCropBoxWidth = minCropBoxHeight * aspectRatio;
                    }

                    if (maxCropBoxHeight * aspectRatio > maxCropBoxWidth) {
                        maxCropBoxHeight = maxCropBoxWidth / aspectRatio;
                    } else {
                        maxCropBoxWidth = maxCropBoxHeight * aspectRatio;
                    }
                }

                // The minWidth/Height must be less than maxWidth/Height
                cropBox.minWidth = min(minCropBoxWidth, maxCropBoxWidth);
                cropBox.minHeight = min(minCropBoxHeight, maxCropBoxHeight);
                cropBox.maxWidth = maxCropBoxWidth;
                cropBox.maxHeight = maxCropBoxHeight;
            }

            if (isPositionLimited) {
                if (isLimited) {
                    cropBox.minLeft = max(0, canvas.left);
                    cropBox.minTop = max(0, canvas.top);
                    cropBox.maxLeft = min(containerWidth, canvas.left + canvas.width) - cropBox.width;
                    cropBox.maxTop = min(containerHeight, canvas.top + canvas.height) - cropBox.height;
                } else {
                    cropBox.minLeft = 0;
                    cropBox.minTop = 0;
                    cropBox.maxLeft = containerWidth - cropBox.width;
                    cropBox.maxTop = containerHeight - cropBox.height;
                }
            }
        },

        renderCropBox: function () {
            var options = this.options;
            var container = this.container;
            var containerWidth = container.width;
            var containerHeight = container.height;
            var cropBox = this.cropBox;

            if (cropBox.width > cropBox.maxWidth || cropBox.width < cropBox.minWidth) {
                cropBox.left = cropBox.oldLeft;
            }

            if (cropBox.height > cropBox.maxHeight || cropBox.height < cropBox.minHeight) {
                cropBox.top = cropBox.oldTop;
            }

            cropBox.width = min(max(cropBox.width, cropBox.minWidth), cropBox.maxWidth);
            cropBox.height = min(max(cropBox.height, cropBox.minHeight), cropBox.maxHeight);

            this.limitCropBox(false, true);

            cropBox.oldLeft = cropBox.left = min(max(cropBox.left, cropBox.minLeft), cropBox.maxLeft);
            cropBox.oldTop = cropBox.top = min(max(cropBox.top, cropBox.minTop), cropBox.maxTop);

            if (options.movable && options.cropBoxMovable) {

                // Turn to move the canvas when the crop box is equal to the container
                this.$face.data(DATA_ACTION, (cropBox.width === containerWidth && cropBox.height === containerHeight) ? ACTION_MOVE : ACTION_ALL);
            }

            this.$cropBox.css({
                width: cropBox.width,
                height: cropBox.height,
                left: cropBox.left,
                top: cropBox.top
            });

            if (this.isCropped && this.isLimited) {
                this.limitCanvas(true, true);
            }

        },

        initContainer: function () {
            var options = this.options;
            var $this = this.$element;
            var $container = this.$container;
            var $heImgEditor = this.$heImgEditor;

            $heImgEditor.addClass(CLASS_HIDDEN);
            $this.removeClass(CLASS_HIDDEN);

            $heImgEditor.css((this.container = {
                width: max($container.width(), num(options.minContainerWidth) || 200),
                height: max($container.height(), num(options.minContainerHeight) || 100)
            }));

            $this.addClass(CLASS_HIDDEN);
            $heImgEditor.removeClass(CLASS_HIDDEN);
        },

        // Canvas (image wrapper)
        initCanvas: function () {
            var viewMode = this.options.viewMode;
            var container = this.container;
            var containerWidth = container.width;
            var containerHeight = container.height;
            var image = this.image;
            var imageNaturalWidth = image.naturalWidth;
            var imageNaturalHeight = image.naturalHeight;
            var is90Degree = abs(image.rotate) === 90;
            var naturalWidth = is90Degree ? imageNaturalHeight : imageNaturalWidth;
            var naturalHeight = is90Degree ? imageNaturalWidth : imageNaturalHeight;
            var aspectRatio = naturalWidth / naturalHeight;
            var canvasWidth = containerWidth;
            var canvasHeight = containerHeight;
            var canvas;

            if (containerHeight * aspectRatio > containerWidth) {
                if (viewMode === 3) {
                    canvasWidth = containerHeight * aspectRatio;
                } else {
                    canvasHeight = containerWidth / aspectRatio;
                }
            } else {
                if (viewMode === 3) {
                    canvasHeight = containerWidth / aspectRatio;
                } else {
                    canvasWidth = containerHeight * aspectRatio;
                }
            }

            canvas = {
                naturalWidth: naturalWidth,
                naturalHeight: naturalHeight,
                aspectRatio: aspectRatio,
                width: canvasWidth,
                height: canvasHeight
            };

            canvas.oldLeft = canvas.left = (containerWidth - canvasWidth) / 2;
            canvas.oldTop = canvas.top = (containerHeight - canvasHeight) / 2;

            this.canvas = canvas;
            this.isLimited = (viewMode === 1 || viewMode === 2);

            this.limitCanvas(true, true);
            this.initialImage = $.extend({}, image);
            this.initialCanvas = $.extend({}, canvas);
        },

        limitCanvas: function (isSizeLimited, isPositionLimited) {
            var options = this.options;
            var viewMode = options.viewMode;
            var container = this.container;
            var containerWidth = container.width;
            var containerHeight = container.height;
            var canvas = this.canvas;
            var aspectRatio = canvas.aspectRatio;
            var cropBox = this.cropBox;
            var isCropped = this.isCropped && cropBox;
            var minCanvasWidth;
            var minCanvasHeight;
            var newCanvasLeft;
            var newCanvasTop;

            if (isSizeLimited) {
                minCanvasWidth = num(options.minCanvasWidth) || 0;
                minCanvasHeight = num(options.minCanvasHeight) || 0;

                if (viewMode) {
                    if (viewMode > 1) {
                        minCanvasWidth = max(minCanvasWidth, containerWidth);
                        minCanvasHeight = max(minCanvasHeight, containerHeight);

                        if (viewMode === 3) {
                            if (minCanvasHeight * aspectRatio > minCanvasWidth) {
                                minCanvasWidth = minCanvasHeight * aspectRatio;
                            } else {
                                minCanvasHeight = minCanvasWidth / aspectRatio;
                            }
                        }
                    } else {
                        if (minCanvasWidth) {
                            minCanvasWidth = max(minCanvasWidth, isCropped ? cropBox.width : 0);
                        } else if (minCanvasHeight) {
                            minCanvasHeight = max(minCanvasHeight, isCropped ? cropBox.height : 0);
                        } else if (isCropped) {
                            minCanvasWidth = cropBox.width;
                            minCanvasHeight = cropBox.height;

                            if (minCanvasHeight * aspectRatio > minCanvasWidth) {
                                minCanvasWidth = minCanvasHeight * aspectRatio;
                            } else {
                                minCanvasHeight = minCanvasWidth / aspectRatio;
                            }
                        }
                    }
                }

                if (minCanvasWidth && minCanvasHeight) {
                    if (minCanvasHeight * aspectRatio > minCanvasWidth) {
                        minCanvasHeight = minCanvasWidth / aspectRatio;
                    } else {
                        minCanvasWidth = minCanvasHeight * aspectRatio;
                    }
                } else if (minCanvasWidth) {
                    minCanvasHeight = minCanvasWidth / aspectRatio;
                } else if (minCanvasHeight) {
                    minCanvasWidth = minCanvasHeight * aspectRatio;
                }

                canvas.minWidth = minCanvasWidth;
                canvas.minHeight = minCanvasHeight;
                canvas.maxWidth = Infinity;
                canvas.maxHeight = Infinity;
            }

            if (isPositionLimited) {
                if (viewMode) {
                    newCanvasLeft = containerWidth - canvas.width;
                    newCanvasTop = containerHeight - canvas.height;

                    canvas.minLeft = min(0, newCanvasLeft);
                    canvas.minTop = min(0, newCanvasTop);
                    canvas.maxLeft = max(0, newCanvasLeft);
                    canvas.maxTop = max(0, newCanvasTop);

                    if (isCropped && this.isLimited) {
                        canvas.minLeft = min(
                                cropBox.left,
                                cropBox.left + cropBox.width - canvas.width
                                );
                        canvas.minTop = min(
                                cropBox.top,
                                cropBox.top + cropBox.height - canvas.height
                                );
                        canvas.maxLeft = cropBox.left;
                        canvas.maxTop = cropBox.top;

                        if (viewMode === 2) {
                            if (canvas.width >= containerWidth) {
                                canvas.minLeft = min(0, newCanvasLeft);
                                canvas.maxLeft = max(0, newCanvasLeft);
                            }

                            if (canvas.height >= containerHeight) {
                                canvas.minTop = min(0, newCanvasTop);
                                canvas.maxTop = max(0, newCanvasTop);
                            }
                        }
                    }
                } else {
                    canvas.minLeft = -canvas.width;
                    canvas.minTop = -canvas.height;
                    canvas.maxLeft = containerWidth;
                    canvas.maxTop = containerHeight;
                }
            }
        },

        renderCanvas: function (isChanged) {
            var canvas = this.canvas;
            var image = this.image;
            var rotate = image.rotate;
            var naturalWidth = image.naturalWidth;
            var naturalHeight = image.naturalHeight;
            var aspectRatio;
            var rotated;

            if (canvas.width > canvas.maxWidth || canvas.width < canvas.minWidth) {
                canvas.left = canvas.oldLeft;
            }

            if (canvas.height > canvas.maxHeight || canvas.height < canvas.minHeight) {
                canvas.top = canvas.oldTop;
            }

            canvas.width = min(max(canvas.width, canvas.minWidth), canvas.maxWidth);
            canvas.height = min(max(canvas.height, canvas.minHeight), canvas.maxHeight);

            this.limitCanvas(false, true);

            canvas.oldLeft = canvas.left = min(max(canvas.left, canvas.minLeft), canvas.maxLeft);
            canvas.oldTop = canvas.top = min(max(canvas.top, canvas.minTop), canvas.maxTop);

            this.$canvas.css({
                width: canvas.width,
                height: canvas.height,
                left: canvas.left,
                top: canvas.top
            });


            this.renderImage();

            /*
             if (this.isCropped && this.isLimited) {
             this.limitCropBox(true, true);
             }
             
             if (isChanged) {
             this.output();
             }
             */
        },

        cropStart: function (event) {
            var options = this.options;
            var originalEvent = event.originalEvent;
            var touches = originalEvent && originalEvent.touches;
            var e = event;
            var touchesLength;
            var action;

            if (touches) {
                touchesLength = touches.length;

                if (touchesLength > 1) {
                    return;
                }

                e = touches[0];
            }

            action = action || $(e.target).data(DATA_ACTION);

            if (REGEXP_ACTIONS.test(action)) {
                event.preventDefault();

                this.action = action;
                this.cropping = false;

                // IE8  has `event.pageX/Y`, but not `event.originalEvent.pageX/Y`
                // IE10 has `event.originalEvent.pageX/Y`, but not `event.pageX/Y`
                this.startX = e.pageX || originalEvent && originalEvent.pageX;
                this.startY = e.pageY || originalEvent && originalEvent.pageY;

                if (action === ACTION_CROP) {
                    this.cropping = true;
                    this.$dragBox.addClass(CLASS_MODAL);
                }
            }
        },
        cropMove: function (event) {
            var options = this.options;
            var originalEvent = event.originalEvent;
            var touches = originalEvent && originalEvent.touches;
            var e = event;
            var action = this.action;
            var touchesLength;

            if (touches) {
                touchesLength = touches.length;

                if (touchesLength > 1) {
                    if (options.zoomable && options.zoomOnTouch && touchesLength === 2) {
                        e = touches[1];
                        this.endX2 = e.pageX;
                        this.endY2 = e.pageY;
                    } else {
                        return;
                    }
                }

                e = touches[0];
            }

            if (action) {
                event.preventDefault();

                this.endX = e.pageX || originalEvent && originalEvent.pageX;
                this.endY = e.pageY || originalEvent && originalEvent.pageY;

                this.change(e.shiftKey, null);
            }
        },

        cropEnd: function (event) {
            var originalEvent = event.originalEvent;
            var action = this.action;

            if (this.isDisabled) {
                return;
            }

            if (action) {
                event.preventDefault();

                if (this.cropping) {
                    this.cropping = false;
                    this.$dragBox.toggleClass(CLASS_MODAL, this.isCropped && this.options.modal);
                }

                this.action = '';

                this.trigger(EVENT_CROP_END, {
                    originalEvent: originalEvent,
                    action: action
                });
            }
        },

        change: function (shiftKey, event) {
            var options = this.options;
            var aspectRatio = options.aspectRatio;
            var action = this.action;
            var container = this.container;
            var canvas = this.canvas;
            var cropBox = this.cropBox;
            var width = cropBox.width;
            var height = cropBox.height;
            var left = cropBox.left;
            var top = cropBox.top;
            var right = left + width;
            var bottom = top + height;
            var minLeft = 0;
            var minTop = 0;
            var maxWidth = container.width;
            var maxHeight = container.height;
            var renderable = true;
            var offset;
            var range;

            // Locking aspect ratio in "free mode" by holding shift key (#259)
            if (!aspectRatio && shiftKey) {
                aspectRatio = width && height ? width / height : 1;
            }

            if (this.isLimited) {
                minLeft = cropBox.minLeft;
                minTop = cropBox.minTop;
                maxWidth = minLeft + min(container.width, canvas.width, canvas.left + canvas.width);
                maxHeight = minTop + min(container.height, canvas.height, canvas.top + canvas.height);
            }

            range = {
                x: this.endX - this.startX,
                y: this.endY - this.startY
            };

            if (aspectRatio) {
                range.X = range.y * aspectRatio;
                range.Y = range.x / aspectRatio;
            }

            switch (action) {
                // Move crop box
                case ACTION_ALL:
                    left += range.x;
                    top += range.y;
                    break;

                    // Resize crop box
                case ACTION_EAST:
                    if (range.x >= 0 && (right >= maxWidth || aspectRatio &&
                            (top <= minTop || bottom >= maxHeight))) {

                        renderable = false;
                        break;
                    }

                    width += range.x;

                    if (aspectRatio) {
                        height = width / aspectRatio;
                        top -= range.Y / 2;
                    }

                    if (width < 0) {
                        action = ACTION_WEST;
                        width = 0;
                    }

                    break;

                case ACTION_NORTH:
                    if (range.y <= 0 && (top <= minTop || aspectRatio &&
                            (left <= minLeft || right >= maxWidth))) {

                        renderable = false;
                        break;
                    }

                    height -= range.y;
                    top += range.y;

                    if (aspectRatio) {
                        width = height * aspectRatio;
                        left += range.X / 2;
                    }

                    if (height < 0) {
                        action = ACTION_SOUTH;
                        height = 0;
                    }

                    break;

                case ACTION_WEST:
                    if (range.x <= 0 && (left <= minLeft || aspectRatio &&
                            (top <= minTop || bottom >= maxHeight))) {

                        renderable = false;
                        break;
                    }

                    width -= range.x;
                    left += range.x;

                    if (aspectRatio) {
                        height = width / aspectRatio;
                        top += range.Y / 2;
                    }

                    if (width < 0) {
                        action = ACTION_EAST;
                        width = 0;
                    }

                    break;

                case ACTION_SOUTH:
                    if (range.y >= 0 && (bottom >= maxHeight || aspectRatio &&
                            (left <= minLeft || right >= maxWidth))) {

                        renderable = false;
                        break;
                    }

                    height += range.y;

                    if (aspectRatio) {
                        width = height * aspectRatio;
                        left -= range.X / 2;
                    }

                    if (height < 0) {
                        action = ACTION_NORTH;
                        height = 0;
                    }

                    break;

                case ACTION_NORTH_EAST:
                    if (aspectRatio) {
                        if (range.y <= 0 && (top <= minTop || right >= maxWidth)) {
                            renderable = false;
                            break;
                        }

                        height -= range.y;
                        top += range.y;
                        width = height * aspectRatio;
                    } else {
                        if (range.x >= 0) {
                            if (right < maxWidth) {
                                width += range.x;
                            } else if (range.y <= 0 && top <= minTop) {
                                renderable = false;
                            }
                        } else {
                            width += range.x;
                        }

                        if (range.y <= 0) {
                            if (top > minTop) {
                                height -= range.y;
                                top += range.y;
                            }
                        } else {
                            height -= range.y;
                            top += range.y;
                        }
                    }

                    if (width < 0 && height < 0) {
                        action = ACTION_SOUTH_WEST;
                        height = 0;
                        width = 0;
                    } else if (width < 0) {
                        action = ACTION_NORTH_WEST;
                        width = 0;
                    } else if (height < 0) {
                        action = ACTION_SOUTH_EAST;
                        height = 0;
                    }

                    break;

                case ACTION_NORTH_WEST:
                    if (aspectRatio) {
                        if (range.y <= 0 && (top <= minTop || left <= minLeft)) {
                            renderable = false;
                            break;
                        }

                        height -= range.y;
                        top += range.y;
                        width = height * aspectRatio;
                        left += range.X;
                    } else {
                        if (range.x <= 0) {
                            if (left > minLeft) {
                                width -= range.x;
                                left += range.x;
                            } else if (range.y <= 0 && top <= minTop) {
                                renderable = false;
                            }
                        } else {
                            width -= range.x;
                            left += range.x;
                        }

                        if (range.y <= 0) {
                            if (top > minTop) {
                                height -= range.y;
                                top += range.y;
                            }
                        } else {
                            height -= range.y;
                            top += range.y;
                        }
                    }

                    if (width < 0 && height < 0) {
                        action = ACTION_SOUTH_EAST;
                        height = 0;
                        width = 0;
                    } else if (width < 0) {
                        action = ACTION_NORTH_EAST;
                        width = 0;
                    } else if (height < 0) {
                        action = ACTION_SOUTH_WEST;
                        height = 0;
                    }

                    break;

                case ACTION_SOUTH_WEST:
                    if (aspectRatio) {
                        if (range.x <= 0 && (left <= minLeft || bottom >= maxHeight)) {
                            renderable = false;
                            break;
                        }

                        width -= range.x;
                        left += range.x;
                        height = width / aspectRatio;
                    } else {
                        if (range.x <= 0) {
                            if (left > minLeft) {
                                width -= range.x;
                                left += range.x;
                            } else if (range.y >= 0 && bottom >= maxHeight) {
                                renderable = false;
                            }
                        } else {
                            width -= range.x;
                            left += range.x;
                        }

                        if (range.y >= 0) {
                            if (bottom < maxHeight) {
                                height += range.y;
                            }
                        } else {
                            height += range.y;
                        }
                    }

                    if (width < 0 && height < 0) {
                        action = ACTION_NORTH_EAST;
                        height = 0;
                        width = 0;
                    } else if (width < 0) {
                        action = ACTION_SOUTH_EAST;
                        width = 0;
                    } else if (height < 0) {
                        action = ACTION_NORTH_WEST;
                        height = 0;
                    }

                    break;

                case ACTION_SOUTH_EAST:
                    if (aspectRatio) {
                        if (range.x >= 0 && (right >= maxWidth || bottom >= maxHeight)) {
                            renderable = false;
                            break;
                        }

                        width += range.x;
                        height = width / aspectRatio;
                    } else {
                        if (range.x >= 0) {
                            if (right < maxWidth) {
                                width += range.x;
                            } else if (range.y >= 0 && bottom >= maxHeight) {
                                renderable = false;
                            }
                        } else {
                            width += range.x;
                        }

                        if (range.y >= 0) {
                            if (bottom < maxHeight) {
                                height += range.y;
                            }
                        } else {
                            height += range.y;
                        }
                    }

                    if (width < 0 && height < 0) {
                        action = ACTION_NORTH_WEST;
                        height = 0;
                        width = 0;
                    } else if (width < 0) {
                        action = ACTION_SOUTH_WEST;
                        width = 0;
                    } else if (height < 0) {
                        action = ACTION_NORTH_EAST;
                        height = 0;
                    }

                    break;

                    // Move canvas
                case ACTION_MOVE:
                    this.move(range.x, range.y);
                    renderable = false;
                    break;

                    // Create crop box
                case ACTION_CROP:
                    if (!range.x || !range.y) {
                        renderable = false;
                        break;
                    }

                    offset = this.$cropper.offset();
                    left = this.startX - offset.left;
                    top = this.startY - offset.top;
                    width = cropBox.minWidth;
                    height = cropBox.minHeight;

                    if (range.x > 0) {
                        action = range.y > 0 ? ACTION_SOUTH_EAST : ACTION_NORTH_EAST;
                    } else if (range.x < 0) {
                        left -= width;
                        action = range.y > 0 ? ACTION_SOUTH_WEST : ACTION_NORTH_WEST;
                    }

                    if (range.y < 0) {
                        top -= height;
                    }

                    // Show the crop box if is hidden
                    if (!this.isCropped) {
                        this.$cropBox.removeClass(CLASS_HIDDEN);
                        this.isCropped = true;

                        if (this.isLimited) {
                            this.limitCropBox(true, true);
                        }
                    }

                    break;

                    // No default
            }

            if (renderable) {
                cropBox.width = width;
                cropBox.height = height;
                cropBox.left = left;
                cropBox.top = top;
                this.action = action;

                this.renderCropBox();
            }

            // Override
            this.startX = this.endX;
            this.startY = this.endY;
        },

        renderImage: function (isChanged) {
            var canvas = this.canvas;
            var image = this.image;

            $.extend(image, {
                width: canvas.width,
                height: canvas.height,
                left: 0,
                top: 0
            });

            this.$clone.css({
                width: image.width,
                height: image.height,
                marginLeft: image.left,
                marginTop: image.top
            });
        },

        bindButtons: function () {
            var _this = this;

            // Vágásra kattintva
            this.$button.cut.click(function (e) {
                _this.startCutFunction(e, 'crop');
            });

        },

        startCutFunction: function (event, mode) {
            if (this.cutIsStarted) {
                return;
            }

            this.cutIsStarted = true;


            var options = this.options;
            var croppable = true;
            var movable = true;

            if (this.isLoaded) {
                this.$dragBox.
                        data(DATA_ACTION, mode).
                        toggleClass(CLASS_CROP, croppable).
                        toggleClass(CLASS_MOVE, movable);
            }


        },

        unbuild: function () {
            if (!this.isBuilt) {
                return;
            }

            if (!this.isCompleted) {
                clearTimeout(this.completing);
            }

            this.isBuilt = false;
            this.isCompleted = false;
            this.initialImage = null;


            this.$viewBox = null;
            this.$cropBox = null;
            this.$dragBox = null;
        },

        stop: function () {
            this.$clone.remove();
            this.$clone = null;
        },
    }


    HeImgEditor.DEFAULTS = {
        // Háttér megjelenítése
        background: true,

        // Képarány
        aspectRatio: NaN,

        // Konténer méretezése
        minContainerWidth: 200,
        minContainerHeight: 100,

        // nézet módja
        viewMode: 0, // 0, 1, 2, 3

    };

    HeImgEditor.setDefaults = function (options) {
        $.extend(HeImgEditor.DEFAULTS, options);
    };

    HeImgEditor.TEMPLATE = (
            '<div class="heimgeditor-container">' +
            '<div class="heimgeditor-wrap-box">' +
            '<div class="heimgeditor-canvas"></div>' +
            '</div>' +
            '<div class="heimgeditor-controls">' +
            '<div class="heimgeditor-c-crop heimgeditor-btn"><i class="fa fa-cut"></i></div>' +
            '</div>' +
            '<div class="heimgeditor-drag-box"></div>' +
            '<div class="heimgeditor-crop-box">' +
            '<span class="heimgeditor-view-box"></span>' +
            '<span class="heimgeditor-dashed dashed-h"></span>' +
            '<span class="heimgeditor-dashed dashed-v"></span>' +
            '<span class="heimgeditor-center"></span>' +
            '<span class="heimgeditor-face"></span>' +
            '<span class="heimgeditor-line line-e" data-action="e"></span>' +
            '<span class="heimgeditor-line line-n" data-action="n"></span>' +
            '<span class="heimgeditor-line line-w" data-action="w"></span>' +
            '<span class="heimgeditor-line line-s" data-action="s"></span>' +
            '<span class="heimgeditor-point point-e" data-action="e"></span>' +
            '<span class="heimgeditor-point point-n" data-action="n"></span>' +
            '<span class="heimgeditor-point point-w" data-action="w"></span>' +
            '<span class="heimgeditor-point point-s" data-action="s"></span>' +
            '<span class="heimgeditor-point point-ne" data-action="ne"></span>' +
            '<span class="heimgeditor-point point-nw" data-action="nw"></span>' +
            '<span class="heimgeditor-point point-sw" data-action="sw"></span>' +
            '<span class="heimgeditor-point point-se" data-action="se"></span>' +
            '</div>' +
            '</div>'
            );


    // Save the other cropper
    HeImgEditor.other = $.fn.heimgeditor;

    // Register as jQuery plugin
    $.fn.heimgeditor = function (option) {
        var args = toArray(arguments, 1);
        var result;

        this.each(function () {
            var $this = $(this);
            var data = $this.data(NAMESPACE);
            var options;
            var fn;

            if (!data) {
                if (/destroy/.test(option)) {
                    return;
                }

                options = $.extend({}, $this.data(), $.isPlainObject(option) && option);
                $this.data(NAMESPACE, (data = new HeImgEditor(this, options)));
            }

            if (typeof option === 'string' && $.isFunction(fn = data[option])) {
                result = fn.apply(data, args);
            }
        });

        return isUndefined(result) ? this : result;
    };

    $.fn.heimgeditor.Constructor = HeImgEditor;
    $.fn.heimgeditor.setDefaults = HeImgEditor.setDefaults;

    // No conflict
    $.fn.heimgeditor.noConflict = function () {
        $.fn.heimgeditor = HeImgEditor.other;
        return this;
    };

});