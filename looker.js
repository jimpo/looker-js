;(function() {
    'use strict';

    function Looker(options) {
        var requiredOptions = ['token', 'secret', 'host'];
        var missingOptions = requiredOptions.filter(function(option) {
            return !options[option];
        });
        if (missingOptions.length > 0) {
            throw new Error(
                'Missing required options: ' + missingOptions.join(', '));
        }
        this.options = options;
    };
    Looker.prototype.query = function(model, explore) {
        return new LookerQuery(model, explore, this.options);
    };

    /**
     * Function that returns a Base64 encoded HMAC-SHA1 signed message.
     *
     * Should be overridden in environments other than Node.js.
     */
    Looker.sign = function(message, secret) {
        var crypto = require('crypto');

        var hmac = crypto.createHmac('sha1', secret);
        hmac.update(message);
        return hmac.digest('base64');
    };

    /**
     * Function that makes an HTTP/HTTPS request and returns a Promise object
     * resolving to the response. Called from LookerQuery#execute.
     *
     * Should be overridden in environments other than Node.js. Can return a
     * jqXHR object in browser environments or a deferred type of the
     * implementor's choosing.
     */
    Looker.request = function(url, headers) {
        var Promise = require('promise');
        var urllib = require('url');

        var urlData = urllib.parse(url);
        var http = urlData.protocol === 'https:' ?
            require('https') : require('http');

        return new Promise(function(resolve, reject) {
            var requestData = {
                host: urlData.host,
                path: urlData.path,
                headers: headers
            };
            http.request(requestData)
                .on('response', function(response) {
                    var body = '';
                    response
                        .on('data', function(chunk) {
                            body += chunk.toString();
                        })
                        .on('end', function() {
                            resolve(JSON.parse(body), response.status);
                        });
                })
                .on('error', function(error) {
                    reject(error);
                })
                .end();
        });
    };

    function LookerQuery(model, explore, options) {
        this._token = options.token;
        this._secret = options.secret;
        this._host = options.host;
        this._port = options.port;
        this._https = !options.hasOwnProperty('https') || options.https;

        this.model = model;
        this.explore = explore;

        this._fields = [];
        this._filters = {};
    }
    LookerQuery.prototype.fields = function(fields) {
        if (!Array.isArray(fields)) {
            fields = Array.prototype.slice.call(arguments);
        }
        this._fields = fields;
        return this;
    };
    LookerQuery.prototype.fieldData = function(fieldData) {
        this._fieldData = validateValuesArray(
            fieldData,
            'field_data',
            ['label', 'name', 'type']
        );
        return this;
    };
    LookerQuery.prototype.dataFormats = function(dataFormats) {
        this._dataFormats = validateValuesArray(
            dataFormats,
            'data_formats',
            ['value', 'rendered', 'html']
        );
        return this;
    };
    LookerQuery.prototype.filters = function(filters) {
        for (var field in filters) {
            this._filters[field] = filters[field];
        }
        return this;
    };
    LookerQuery.prototype.sorts = function(sorts) {
        if (!Array.isArray(sorts)) {
            sorts = Array.prototype.slice.call(arguments);
        }
        this._sorts = sorts;
        return this;
    };
    LookerQuery.prototype.limit = function(limit) {
        this._limit = limit;
        return this;
    };
    LookerQuery.prototype.params = function(params) {
        if (arguments.length === 0) {
            return getQueryParams(this);
        }
        else {
            return setQueryParams(this, params);
        }
    };
    LookerQuery.prototype.url = function() {
        return (
            (this._https ? "https" : "http") + "://" + this._host +
            (this._port ? ":" + this._port : "") +
            queryPath(this) +
            "?" + serializeParams(this.params()).join('&')
        );
    };
    LookerQuery.prototype.requestHeaders = function() {
        var timestamp = (new Date()).toUTCString();
        var nonce = randomString(40);

        var message = (
            "GET\n" +
            queryPath(this) + "\n" +
            timestamp + "\n" +
            nonce + "\n"
        );
        serializeParams(this.params()).forEach(function(param) {
            message += param + "\n";
        });

        var auth = this._token + ":" + Looker.sign(message, this._secret);

        return {
            'x-llooker-date': timestamp,
            'x-llooker-nonce': nonce,
            'Authorization': auth
        };
    };
    LookerQuery.prototype.execute = function() {
        return Looker.request(this.url(), this.requestHeaders());
    };

    // Private Helper Functions

    function serializeParams(params) {
        var requestParams = {};
        for (var paramKey in params) {
            var paramValue = params[paramKey];
            if (Array.isArray(paramValue)) {
                requestParams[paramKey] = paramValue.join(',');
            }
            else if (typeof(paramValue) === 'object') {
                for (var key in paramValue) {
                    requestParams[paramKey + '[' + key + ']'] = paramValue[key];
                }
            }
            else {
                requestParams[paramKey] = paramValue.toString();
            }
        }

        var serializedParams = [];
        for (var paramKey in requestParams) {
            var paramValue = encodeURIComponent(requestParams[paramKey]);
            serializedParams.push(paramKey + '=' + paramValue);
        }
        return serializedParams;
    }

    function queryPath(query) {
        return "/api/dictionaries/" + query.model + "/queries/" + query.explore;
    }

    function getQueryParams(query) {
        var params = {
            fields: query._fields,
            filters: query._filters
        };
        var optionalParams = ['fieldData', 'dataFormats', 'sorts', 'limit'];
        optionalParams.forEach(function(paramKey) {
            if (query.hasOwnProperty('_' + paramKey)) {
                params[paramKey] = query['_' + paramKey];
            }
        });
        return params;
    }

    function setQueryParams(query, params) {
        var paramKeys = [
            'fields', 'fieldData', 'dataFormats', 'filters', 'sorts',
            'limit'
        ];
        paramKeys.forEach(function(paramKey) {
            if (params.hasOwnProperty(paramKey)) {
                query[paramKey].call(query, params[paramKey]);
            }
        });
        return query;
    }

    function validateValuesArray(values, param, validValues) {
        if (!Array.isArray(values)) {
            values = Object.keys(values).filter(function(value) {
                return values[value];
            });
        }
        values.forEach(function(value) {
            if (validValues.indexOf(value) === -1) {
                throw new Error("Invalid value for \"" + param + "\": " + value);
            }
        });
        return values;
    }

    function randomString(n) {
        var chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        var value = '';
        for (var i = 0; i < n; i++) {
            value += chars[Math.floor(Math.random() * chars.length)];
        }
        return value;
    }

    if (typeof(module) === 'object' && module.exports) {
        module.exports = Looker;
    }
    else {
        this.Looker = Looker;
    }
}.call(this));
