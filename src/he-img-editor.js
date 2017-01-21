/*!
 * HeImgEditor 
 * 
 * Forgatás, homályosítás, szürkítés, sötétítés-világosítás, szépia funckiókat megvalósító képszerkesztő
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

    var COMPONENTS = {
        css: {
            'jquery-ui': ['jquery-ui.min.css'],
        },
        js: {
            'jquery-ui': ['jquery-ui.min.js'],
        },
    };

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
    var EVENT_MOUSE_DOWN = 'click';
    var EVENT_MOUSE_MOVE = 'mousemove touchmove pointermove MSPointerMove';
    var EVENT_MOUSE_UP = 'mouseup touchend touchcancel pointerup pointercancel MSPointerUp MSPointerCancel';
    var EVENT_WHEEL = 'wheel mousewheel DOMMouseScroll';
    var EVENT_DBLCLICK = 'dblclick';
    var EVENT_LOAD = 'load.' + NAMESPACE;
    var EVENT_RESIZE = 'resize.' + NAMESPACE; // Bind to window with namespace
    var EVENT_BUILD = 'build.' + NAMESPACE;
    var EVENT_BUILT = 'built.' + NAMESPACE;

    // Classes
    var CLASS_BG = 'he-img-bg';
    var CLASS_HIDDEN = 'heimg-hidden';
    var CLASS_MOVE = 'heimg-move';
    var CLASS_CROP = 'heimg-crop';
    var CLASS_MODAL = 'heimg-modal';
    var CLASS_ACTIVE_FUNCTION = 'he-active-func';
    var CLASS_ACTIVE_FUNCTION_EDITOR = 'he-active-func-editor';

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
        this.activeFunction = false;
        this.activatedFilters = {
            blur: 0,
            grayscale: 0,
            brightness: 0,
            rotate: 0
        };
        this.filter.allowFilters = {};
        this.activeFilterString = "none";
        this.activeRotate = 0;

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
            this.$heImgEditor = $heImgEditor = $(getTemplate());
            this.$editorControls = this.$heImgEditor.find('.he-editor-panel');
            this.$imageHolder = this.$heImgEditor.find('.he-image-holder');
            this.$imageHolder.append($clone);
            this.$image = this.$imageHolder.find('img');
            this.$sliderBox = this.$heImgEditor.find('.he-slide-holder');
            this.$sliderBoxSlider = this.$sliderBox.find('.he-slider');
            this.$button = {
                blur: $heImgEditor.find('.he-btn-c-blur'),
                grayscale: $heImgEditor.find('.he-btn-c-grayscale'),
                brightness: $heImgEditor.find('.he-btn-c-brightness'),
                rotate: $heImgEditor.find('.he-btn-c-rotate'),
                save: $heImgEditor.find('.he-btn-save-img'),
                addFile: $heImgEditor.find('.he-btn-set-img'),
            };

            // Eredeti kép elrejtése
            $this.addClass(CLASS_HIDDEN).after($heImgEditor);

            this.isCropped = true;

            //options.aspectRatio = max(0, options.aspectRatio) || NaN;

            if (options.background) {
                $heImgEditor.addClass(CLASS_BG);
            }

            this.isBuilt = true;

            // Trigger the built event asynchronously to keep `data('cropper')` is defined
            this.completing = setTimeout($.proxy(function () {
                this.trigger(EVENT_BUILT);
                this.isCompleted = true;
            }, this), 0);

            this.bindButtonActions();
            this.bindTooltips();
        },

        bindButtonActions: function () {
            var _this = this;

            this.$button.blur.on(EVENT_MOUSE_DOWN, function (e) {
                if (_this.setThisFunctionToActive(e))
                    return _this.setThisFunctionToInActive(e);

                var val = _this.activatedFilters.blur;
                var text = "Homályosítás mértéke";


                var options = {
                    min: 0,
                    max: 10,
                    value: val
                };

                var changeFunc = function (_this, event, ui) {
                    _this.activatedFilters.blur = ui.value;
                    _this.filter.blur(_this, ui.value);
                };

                //_this.generate.slider(_this, options, changeFunc, text).appendTo(_this.$sliderBox);
                _this.generate.slider(_this, options, changeFunc, text);
                _this.$sliderBox.removeClass('hide');
            });

            this.$button.grayscale.on(EVENT_MOUSE_DOWN, function (e) {
                if (_this.setThisFunctionToActive(e))
                    return _this.setThisFunctionToInActive(e);

                var val = _this.activatedFilters.grayscale;
                var text = "Szürkítés mértéke";

                var options = {
                    min: 0,
                    max: 10,
                    value: val
                };

                var changeFunc = function (_this, event, ui) {
                    _this.activatedFilters.grayscale = ui.value;
                    _this.filter.grayscale(_this, ui.value);
                };

                //_this.generate.slider(_this, options, changeFunc, text).appendTo(_this.$sliderBox);
                _this.generate.slider(_this, options, changeFunc, text);
                _this.$sliderBox.removeClass('hide');
            });

            this.$button.brightness.on(EVENT_MOUSE_DOWN, function (e) {
                if (_this.setThisFunctionToActive(e))
                    return _this.setThisFunctionToInActive(e);

                var val = _this.activatedFilters.brightness;
                var text = "Sötétítés-világosítás mértéke";

                var options = {
                    min: -10,
                    max: 10,
                    value: val
                };

                var changeFunc = function (_this, event, ui) {
                    _this.activatedFilters.brightness = ui.value;
                    _this.filter.brightness(_this, ui.value);
                };

                //_this.generate.slider(_this, options, changeFunc, text)
                _this.generate.slider(_this, options, changeFunc, text);
                _this.$sliderBox.removeClass('hide');
            });

            this.$button.rotate.on('click', function (e) {
                var ROTATE_STEP = 20;
                var val = _this.activatedFilters.rotate;
                var type = $(this).attr('data-type');

                if (type == 'left') {
                    val += ROTATE_STEP;
                } else if (type == 'right') {
                    val -= ROTATE_STEP;
                }

                _this.activeRotate = val;
                _this.activatedFilters.rotate = val;
                _this.filter.rotate(_this, val);
            });

            this.$button.save.on('click', function (e) {
                _this.saveImage();
            });

            this.$button.addFile.on('click', function (e) {
                _this.setNewImage();
            });

        },

        bindTooltips: function () {
            $(document).tooltip();
        },

        generate: {

            slider: function (_this, options, changeFunc, text) {
                var html = '<div id="slider" class="he-slider"></div>';

                var slider = _this.$sliderBoxSlider;
                if (slider.hasClass('ui-slider')) {
                    slider.slider('destroy');
                }

                var sliderTooltip = function (event, ui) {
                    var curValue = ui.value || options.value;
                    var tooltip = '<div class="tooltip"><div class="tooltip-inner">' + curValue + '</div><div class="tooltip-arrow"></div></div>';
                    slider.find('.ui-slider-handle').html(tooltip);
                }

                $.extend(options, {
                    create: function (event, ui) {
                        sliderTooltip(event, ui);
                    },
                    slide: function (event, ui) {
                        sliderTooltip(event, ui);
                        changeFunc(_this, event, ui);
                    }
                });

                slider.slider(options);

                var div = $('<div/>');

                $('<label/>').html(text).appendTo(div);
                //slider.appendTo(div);

                return div;
            },

            saveBtn: function (_this) {
                var html = '<button class="save-btn">' +
                        '<i class="fa fa-floppy-o"></i>' +
                        '</div>';
                var btn = $(html);

                btn.click(function (e) {
                    _this.functionIsInActivate(e);
                    _this.$sliderBox.addClass('hide').html('');
                });

                return btn;
            },

        },

        filter: {

            allowFilters: {},

            blur: function (_this, val) {
                val = 'blur(' + val + 'px)';
                this.allowFilters.blur = val;
                this.applyFilters(_this);
            },
            grayscale: function (_this, val) {
                val = val * 10;
                val = 'grayscale(' + val + '%)';
                this.allowFilters.grayscale = val;
                this.applyFilters(_this);
            },
            brightness: function (_this, val) {
                val = 100 + val * 10;
                val = 'brightness(' + val + '%)';
                this.allowFilters.brightness = val;
                this.applyFilters(_this);
            },
            rotate: function (_this, val) {
                var image = _this.$image;
                val = 'rotate(' + val + 'deg)';

                image.css({
                    '-ms-transform': val, /* IE 9 */
                    '-webkit-transform': val, /* Chrome, Safari, Opera */
                    'transform': val
                });
            },
            applyFilters: function (_this) {
                var image = _this.$image;
                var allowF = this.allowFilters;

                var filt = "";
                for (var k in allowF) {
                    filt += allowF[k] + " ";
                }
                filt = filt.substring(0, filt.length - 1);
                _this.activeFilterString = filt;
                image.css({
                    '-webkit-filter': filt,
                    'filter': filt,
                    'moz-filter': filt,
                    'o-filter': filt
                });
            },
        },

        /**
         * Egy funkció aktiválása
         * @param {type} e
         * @returns {Boolean}
         */
        setThisFunctionToActive: function (e) {
            var $target = $(e.currentTarget);
            if (this.activeFunction == $target.attr('data-function')) {
                return true;
            }

            this.activeFunction = $target.attr('data-function');
            $target.siblings('div').removeClass(CLASS_ACTIVE_FUNCTION);
            $target.addClass(CLASS_ACTIVE_FUNCTION);

            return false;
        },

        /**
         * Egy funkció inaktiválása
         * @param {type} e
         * @returns {Boolean}
         */
        setThisFunctionToInActive: function (e) {
            var $target = $(e.currentTarget);
            if (this.activeFunction != $target.attr('data-function')) {
                return true;
            }

            this.activeFunction = false;
            $target.removeClass(CLASS_ACTIVE_FUNCTION);
            // Elrejtjük a csúszkát
            this.$sliderBox.addClass('hide');

            return false;
        },

        saveImage: function () {
            var img = this.$image[0];
            var can = document.createElement('canvas');
            var ctx = can.getContext('2d');
            can.width = img.width;
            can.height = img.height;

            ctx.filter = this.activeFilterString;
            //ctx.rotate(this.activeRotate * Math.PI / 180); // FIXME: Még nem működik a forgatás mentése


            ctx.drawImage(img, 0, 0, img.width, img.height);

            var objURL = can.toDataURL('image/png');
            window.location.href = objURL;
        },

        setNewImage: function () {
            var _this = this;
            var f = $('<input/>').attr('type', 'file');

            f.attr('accept', '.jpg,.png,.jpeg');

            f.change(function () {
                var files = $(this)[0].files;

                var reader = new FileReader();

                reader.onload = function (e) {
                    var img = $('<img/>');
                    img.attr('src', e.target.result);
                    _this.$heImgEditor.after(img);
                    _this.destroy();
                    img.heimgeditor({

                    });
                }

                reader.readAsDataURL(files[0]);
            });

            f.click();
        },

        destroy: function () {
            this.$heImgEditor.remove();
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

        startCutFunction: function (event, mode) {
            if (this.cutIsStarted) {
                return;
            }

            this.cutIsStarted = true;


            var options = this.options;
            var croppable = true;
            var movable = true;


            this.renderCropBox();

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

        },

        stop: function () {
            this.$clone.remove();
            this.$clone = null;
        },
    }


    HeImgEditor.DEFAULTS = { // TODO: Ezt még lehetne bővíteni
        // Képarány
        aspectRatio: NaN,
    };

    HeImgEditor.setDefaults = function (options) {
        $.extend(HeImgEditor.DEFAULTS, options);
    };


    function getTemplate() {
        var t = `<div class="he-holder">
            <div class="he-editor-panel">
                <div class="he-btns">
                    <div class="he-btn he-btn-set-img">
                        <img src="` + JSFileParentPath + `/img/upl.png">
                        <span>Kép feltöltése</span>
                    </div>
                    <div class="he-btn he-btn-save-img">
                        <img src="` + JSFileParentPath + `/img/save.png">
                        <span>Kép mentése</span>
                    </div>
                    <div class="he-btn he-btn-c-blur"  data-function="blur" >
                        <img src="` + JSFileParentPath + `/img/blur.jpg">
                        <span>Homályosítás</span>
                    </div>
                    <div class="he-btn he-btn-c-grayscale" data-function="grayscale">
                        <img src="` + JSFileParentPath + `/img/grayscale.png">
                        <span>Szürkítés</span>
                    </div>
                    <div class="he-btn he-btn-c-brightness" data-function="brightness">
                        <img src="` + JSFileParentPath + `/img/brightness.png">
                        <span>Fényerő</span>
                    </div>
                    <div class="he-btn he-btn-c-rotate"  data-function="rotate" data-type="left">
                        <img src="` + JSFileParentPath + `/img/rotate_left.png">
                        <span>Forgatás balra</span>
                    </div>
                    <div class="he-btn he-btn-c-rotate" data-function="rotate" data-type="right">
                        <img src="` + JSFileParentPath + `/img/rotate_right.png">
                        <span>Forgatás jobbra</span>
                    </div>
                </div>
            </div>
            <div class="he-image-holder">  
                <span class="helper"></span>
            </div>
            <div class="he-slide-holder hide">
                <div class="he-slider-cont">
                    <div id="slider" class="he-slider"></div>
                </div>
            </div>
        </div>`;

        return t;
    }



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


    // Ez a rész deríti ki a javascript helyét
    var fnFullFilePathToFileParentPath = function (JSFullFilePath) {
        var JSFileParentPath = '';
        if (JSFullFilePath) {
            JSFileParentPath = JSFullFilePath.substring(0, JSFullFilePath.lastIndexOf('/') + 1);
        } else {
            JSFileParentPath = null;
        }
        return JSFileParentPath;
    };

    var fnExceptionToFullFilePath = function (e) {
        var JSFullFilePath = '';

        if (e.fileName) {    // firefox
            JSFullFilePath = e.fileName;
        } else if (e.stacktrace) {  // opera
            var tempStackTrace = e.stacktrace;
            tempStackTrace = tempStackTrace.substr(tempStackTrace.indexOf('http'));
            tempStackTrace = tempStackTrace.substr(0, tempStackTrace.indexOf('Dummy Exception'));
            tempStackTrace = tempStackTrace.substr(0, tempStackTrace.lastIndexOf(':'));
            JSFullFilePath = tempStackTrace;
        } else if (e.stack) {   // firefox, opera, chrome
            (function () {
                var str = e.stack;
                var tempStr = str;

                var strProtocolSeparator = '://';
                var idxProtocolSeparator = tempStr.indexOf(strProtocolSeparator) + strProtocolSeparator.length;

                var tempStr = tempStr.substr(idxProtocolSeparator);
                if (tempStr.charAt(0) == '/') {
                    tempStr = tempStr.substr(1);
                    idxProtocolSeparator++;
                }

                var idxHostSeparator = tempStr.indexOf('/');
                tempStr = tempStr.substr(tempStr.indexOf('/'));

                var idxFileNameEndSeparator = tempStr.indexOf(':');
                var finalStr = (str.substr(0, idxProtocolSeparator + idxHostSeparator + idxFileNameEndSeparator));
                finalStr = finalStr.substr(finalStr.indexOf('http'));
                JSFullFilePath = finalStr;
            }());
        } else {    // internet explorer
            JSFullFilePath = null;
        }

        return JSFullFilePath;
    };

    var fnExceptionToFileParentPath = function (e) {
        return fnFullFilePathToFileParentPath(fnExceptionToFullFilePath(e));
    };

    var fnGetJSFileParentPath = function () {
        try {
            throw new Error('Dummy Exception');
        } catch (e) {
            return fnExceptionToFileParentPath(e);
        }
    };

    var JSFileParentPath = fnGetJSFileParentPath();
    // VÉGE Ez a rész deríti ki a javascript helyét VÉGE


    // LOAD COMPONENTS
    // JS
    for (var c in COMPONENTS.js) {
        for (var ck in COMPONENTS.js[c]) {
            var url = JSFileParentPath + 'components/' + c + '/' + COMPONENTS.js[c][ck];
            $.ajax({
                url: url,
                dataType: "script",
                async: false
            });
        }
    }

    // CSS
    for (var c in COMPONENTS.css) {
        for (var ck in COMPONENTS.css[c]) {
            var url = JSFileParentPath + 'components/' + c + '/' + COMPONENTS.css[c][ck];
            $('head').append($('<link rel="stylesheet" type="text/css" />').attr('href', url));
        }
    }

});