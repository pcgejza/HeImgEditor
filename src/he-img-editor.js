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
    var REGEXP_ACTIONS = /^(e|w|s|n|se|sw|ne|nw|all|crop|move|zoom)$/;
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
    var EVENT_CROP_START = 'cropstart.' + NAMESPACE;
    var EVENT_CROP_MOVE = 'cropmove.' + NAMESPACE;
    var EVENT_CROP_END = 'cropend.' + NAMESPACE;
    var EVENT_CROP = 'crop.' + NAMESPACE;
    var EVENT_ZOOM = 'zoom.' + NAMESPACE;

    // Classes
    var CLASS_BG = 'he-img-bg';


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

        this.init();
    }


    HeImgEditor.prototype = {
        constructor: HeImgEditor,

        init: function () {
            var $this = this.$element;
            var url;

            if ($this.is('img')) {
                this.isImg = true;

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
            console.log('zsi2r');

            return;


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

            if (this.isImg) {
                if ($this[0].complete) {
                    this.start();
                } else {
                    $this.one(EVENT_LOAD, $.proxy(this.start, this));
                }
            } else {
                $clone.
                        one(EVENT_LOAD, $.proxy(this.start, this)).
                        one(EVENT_ERROR, $.proxy(this.stop, this)).
                        addClass(CLASS_HIDE).
                        insertAfter($this);
            }
        },

        start: function () {
            var $image = this.$element;
            var $clone = this.$clone;

            if (!this.isImg) {
                $clone.off(EVENT_ERROR, this.stop);
                $image = $clone;
            }

            getImageSize($image[0], $.proxy(function (naturalWidth, naturalHeight) {
                $.extend(this.image, {
                    naturalWidth: naturalWidth,
                    naturalHeight: naturalHeight,
                    aspectRatio: naturalWidth / naturalHeight
                });

                this.isLoaded = true;
                console.log(naturalWidth);
            }, this));
        },

        stop: function () {
            this.$clone.remove();
            this.$clone = null;
        },
    }


    HeImgEditor.DEFAULTS = {

    };

    HeImgEditor.setDefaults = function (options) {
        $.extend(HeImgEditor.DEFAULTS, options);
    };


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