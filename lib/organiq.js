var req = require('./request');
var express = require('./transports/express');
var websocket = require('./transports/websocket');
var when = require('when');
var debug = require('debug')('organiq:core');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

module.exports = Organiq;

/* test-code */
module.exports._LocalDeviceProxy = LocalDeviceProxy;
/* end test-code */

/**
 * Create an Organiq node.
 *
 * @returns {Organiq}
 * @constructor
 */
function Organiq() {
  if (!(this instanceof Organiq)) {
    return new Organiq();
  }

  this.stack = [];      // middleware stack, ordered toward downstream
  this.devices = {};    // registered device drivers by id
  this.proxies = {};    // arrays of connected local device proxies by id
  this.gateway = null;  // upstream gateway for global namespace

  /**
   * Return an ExpressJS-compatible middleware interface
   *
   * @param options
   * @returns {ExpressDapi}
   */
  this.expressDapi = function(options) {
    return express(this, options);
  };

  /**
   * Return a WebSocket- and WebSocketServer-compatible interface.
   *
   * @param {Object=} options
   * @returns {WebSocketApi}
   */
  this.websocketApi = function(options) {
    return websocket(this, options);
  };

}
util.inherits(Organiq, EventEmitter);


/**
 * Determines whether the local node is authoritative for a given deviceid.
 *
 * @param {String} deviceid
 * @returns {boolean} true if we are authoritative for the given device
 */
Organiq.prototype.isAuthoritative = function isAuthoritative(deviceid) {
  // we currently only support a single namespace, and consider ourselves to
  // be authoritative in any case where no gateway is configured.
  void(deviceid);
  return !this.gateway;
};


/**
 * Add middleware to the Organiq stack.
 *
 * Middleware functions are called for every request that passes through the
 * system. They are invoked in the order that they are given to use().
 *
 * @param {function(OrganiqRequest, function)|function[]} fns
 * @returns {Organiq}
 */
Organiq.prototype.use = function use(fns) {

  if (typeof fns === 'function') {
    fns = [fns];
  }

  if (!Array.isArray(fns) || fns.length === 0) {
    throw new TypeError('.use() requires middleware functions');
  }

  fns.forEach(function (fn) {
    this.stack.push(fn);
    fn.organiq = this;
  }, this);

  return this;
};


/**
 * Dispatch a request through the local middleware stack.
 *
 * Requests may be either application-originated (downstream) or device-
 * originated (upstream). After being processed by the local middleware,
 * downstream messages are passed to a registered device (if present),
 * while upstream messages are fanned out to any registered proxies.
 *
 * The registered device may be a local device, or it may be a proxy for
 * a remote node on which the device is actually hosted.
 *
 * Registered proxies may be application (API) clients if we are the
 * authoritative node for the device. Otherwise, a single proxy representing
 * the authoritative node will be present.
 *
 * @param  {OrganiqRequest} req The request to dispatch
 * @return {Promise} A promise for a result value
 */
Organiq.prototype.dispatch = function dispatch(req) {

  var idx;                  // index of current handler in middleware stack
  var previousResult;       // last defined result returned from a handler
  var handlers = this.stack;// array of middleware handlers
  var finalHandler;         // function used when end of handlers reached
  var app = this;
  var downstream = req.isApplicationOriginated();

  // Application-originated requests go "downstream" through the stack,
  // from first (index 0) to last. Device-originated requests go "upstream",
  // starting at the last handler in the stack.
  idx = downstream ? 0 : handlers.length - 1;
  finalHandler = downstream ? finalHandlerDownstream : finalHandlerUpstream;

  return next();

  /**
   * Invoke the next middleware handler in the stack.
   *
   * If the request is not handled before it reaches the end of the stack,
   * the `finalHandler` is called to dispatch the request to the target device
   * (if currently registered).
   *
   * A reference to this function is provided to each layer, and the normal
   * case is that each layer will invoke next() to call the next layer if it
   * does not handle the request itself. We therefore are called recursively,
   * and a promise chain is built from the return values of each handler.
   *
   * @returns {Promise} a promise for a response to the request.
   */
  function next() {

    var layer = handlers[downstream ? idx++ : idx--] || finalHandler;
    var result;

    // Invoke the current layer. It may do any of the following:
    // - return the value of next() (normal case)
    // - return a result directly, or a promise (perhaps fulfilled or rejected)
    //    for a result
    // - return nothing
    // - throw an exception
    //
    // If an exception is thrown, we return a rejected promise that can be used
    // by previous layers in the stack to do error handling.
    // Note that this is different than how Connect middleware functions; in
    // Connect, errors are passed to _future_ layers in the stack, while in
    // Organiq, errors are accessible only to _previous_ layers.
    //
    // In the normal case, the layers will call next() recursively
    try { result = layer(req, next); }
    catch(e) {
      debug('Middleware threw an exception: ', e);
      return when.reject(e);
    }

    // At this point, all of the layers (including the finalHandler) that will
    // be called have been called, and we are unwinding the requests from
    // last-called to first-called layer.

    // We normally just return the value given us by the layer. However, layers
    // may not always return a value, in which case we return the most recent
    // well-defined result from any handler.
    if (typeof result === 'undefined') {
      result = previousResult;
    } else {
      previousResult = result;  // remember most recently returned result
    }

    // if result is still undefined here, it means that either (1) finalHandler
    // failed to return a value, or (2) a layer of middleware did not invoke
    // next() yet also failed to return a value.
    if (result === undefined) {
      var e = 'Layer ' + layer.name + ' must invoke next() or return a value.';
      debug(e);
      return when.reject(new Error(e));
    }

    // Return a promise to the caller
    return when(result);
  }

  /**
   * Handle an application-originated request after it has passed through the
   * middleware stack.
   *
   * The request will be passed to the device object (or its proxy) if it
   * exists, otherwise an Error will be raised.
   *
   * @param {OrganiqRequest} req request object
   */
  function finalHandlerDownstream(req) {

    var device = app.devices[req.deviceid];
    if (!device) {
      var msg = 'Device \'' + req.deviceid + '\' is not connected.';
      debug(msg);
      throw new Error(msg);
    }

    switch(req.method) {
      case 'GET':
        return device.get(req.identifier);
      case 'SET':
        return device.set(req.identifier, req.value) || true;
      case 'INVOKE':
        return device.invoke(req.identifier, req.params) || true;
      case 'DESCRIBE':
        return device.describe(req.identifier);
      case 'CONFIG':
        return device.config(req.identifier, req.value);
      default:
        debug('Invalid request method: ' + req.method);
        throw new Error(req.method + ' is not a valid downstream request');
    }
  }

  /**
   * Handle a device-originated request after it has passed through the
   * middleware stack.
   *
   * If we are authoritative for this device, then any connected API clients
   * will receive a copy of the request. If we are not authoritative, the node
   * that is will be forwarded the request for processing.
   *
   * @param {OrganiqRequest} req request object
   * @returns {undefined}
   */
  function finalHandlerUpstream(req) {
    // if we are not authoritative, app.proxies will have exactly one entry -
    // the entry for the authoritative node.
    var proxies = app.proxies[req.deviceid] || [];
    for (var i = 0; i < proxies.length; i++) {
      var proxy = proxies[i];
      try {
        switch (req.method) {
          case 'NOTIFY':
            proxy.emit('notify', req.identifier, req.params);
            break;
          case 'PUT':
            proxy.emit('put', req.identifier, req.value);
            break;
        }
      } catch (err) {
        debug('proxy.notify threw exception:' + err);
      }
    }
  }
};

/**
 * Register a device (or device proxy) with the system.
 *
 * The device may be either a locally-implemented device, or a proxy to a
 * device implemented elsewhere.
 *
 * If we are not authoritative for the given device, the registration will be
 * forwarded to the node that is.
 *
 * The device provided must implement get(), set(), invoke(), config(), and
 * subscribe(), describe().
 *
 * @param {String} deviceid
 * @param {DeviceWrapper|WebSocketDeviceProxy} device
 * @returns {DeviceWrapper} the device object given
 */
Organiq.prototype.register = function(deviceid, device) {
  var devices = this.devices;
  if (typeof devices[deviceid] !== 'undefined') {
    throw new Error('Register called for already registered deviceid: ' + deviceid);
  }

  if (device instanceof EventEmitter) {
    // Pass device-originated messages from the device into the organiq
    // middleware stack.
    var self = this;
    device.on('put', function (metric, value) {
      req = self.request.put(deviceid, metric, value);
      self.dispatch(req);
    });
    device.on('notify', function (event, args) {
      req = self.request.notify(deviceid, event, args);
      self.dispatch(req);
    });
  }

  this.devices[deviceid] = device;

  debug('Device registered: ' + deviceid);

  // forward the registration to a configured gateway, if present.
  // (This is the normal case when we are running as a device container).
  // Note that we return synchronously to the local client, but the gateway
  // registration is asynchronous.
  if (!this.isAuthoritative(deviceid)) {
    var proxy = new LocalDeviceProxy(this, deviceid);
    if (!this.proxies[deviceid]) {
      this.proxies[deviceid] = [];
    }
    this.proxies[deviceid].push(proxy);
    this.gateway.register(deviceid, proxy);
  }

  return device;
};

/**
 * Removes a device registration from the system.
 *
 * Once deregistered, a device is no longer reachable.
 *
 * @param {string} deviceid
 * @returns {DeviceWrapper} the device originally registered
 *
 */
Organiq.prototype.deregister = function(deviceid) {
  if (typeof this.devices[deviceid] === 'undefined') {
    debug('deregister called for unregistered deviceid: ' + deviceid);
    return null;
  }
  var device = this.devices[deviceid];
  device.removeAllListeners();
  delete this.devices[deviceid];

  debug('Device deregistered: ' + deviceid);

  // Remove the LocalDeviceProxy that was created during registration and
  // tell the gateway to deregister it.
  if (!this.isAuthoritative(deviceid)) {
    this.gateway.deregister(deviceid);
    // there should be exactly one proxy in this case, as no proxy other than
    // the one used for the registration should be allowed (b/c we are not
    // authoritative for this device).
    // so, remove the entire entry
    delete this.proxies[deviceid];
  }
  return device;
};

/**
 * Get a proxy for a device.
 *
 * The returned device proxy is *always* connected to the authoritative node
 * for the requested device, regardless of what node the underlying device is
 * actually attached. This ensures that every proxy obtained with connect()
 * will always travel through the entire device stack configured for the target
 * device.
 *
 * If the local node is authoritative for the requested device, a local device
 * proxy will be returned. Otherwise, an appropriate remote device proxy
 * provided by a transport driver will be returned.
 *
 * Regardless of whether the proxy is local or remote, its methods can be used
 * to make requests of the target device (e.g., `invoke()` or `get()`), and
 * device-originated messages can be handled by installing event handlers for
 * 'put' and 'notify'.
 *
 * This method may be invoked by local code (in the case of an API client or
 * device container), or it may be invoked by a transport driver that is
 * relaying a request from a remote node.
 *
 * @param {string} deviceid
 * @return {LocalDeviceProxy} device proxy (local or remote)
 */
Organiq.prototype.connect = function(deviceid) {

  // If we are authoritative for this device, create a proxy object that routes
  // requests through the local device stack. We save off a reference to the
  // proxy so that we can invoke it for device-originated messages from the
  // device.
  if (this.isAuthoritative(deviceid)) {
    var proxy = new LocalDeviceProxy(this, deviceid);
    if (!this.proxies[deviceid]) {
      this.proxies[deviceid] = [];
    }
    this.proxies[deviceid].push(proxy);

    debug('Client connected to device: ' + deviceid);

    return proxy;
  }

  // We aren't authoritative for the device, so need to forward this request to
  // the authoritative node via the gateway. Note that we route through the
  // authoritative node even if the device is local (i.e., we are its device
  // container). This is necessary to ensure all requests for a device always
  // pass through the entire configured device stack.
  return this.gateway.connect(deviceid);
};

/**
 * Release a proxy for a device.
 *
 * @params {LocalDeviceProxy} previously connected device proxy
 */
Organiq.prototype.disconnect = function(proxy) {

  if (this.isAuthoritative(proxy.deviceid)) {
    var proxies = this.proxies[proxy.deviceid] || [];
    var idx = proxies.indexOf(proxy);
    if (idx > -1) {
      proxies.splice(idx, 1);
      if (proxies.length === 0) {
        delete this.proxies[proxy.deviceid];
      }
    }
  } else {
    return this.gateway.disconnect(proxy);
  }
};

/**
 * Register a gateway with the system.
 *
 * If devices for which this gateway is authoritative have already been
 * registered, they will be registered with the gateway.
 *
 * A `gatewayRegistered` event is raised upon successful completion.
 *
 * The device provided must implement register(), deregister(), connect(),
 * and disconnect().
 *
 */
Organiq.prototype.registerGateway = function(gateway) {
  if (this.gateway) {
    throw new Error('Gateway already registered.');
  }
  this.gateway = gateway;

  // if any devices have already been registered, register them with the gateway.
  var devices = this.devices;
  for (var deviceid in devices) {
    if (devices.hasOwnProperty(deviceid)) {
      // TODO: This code is duplicated from register()
      var proxy = new LocalDeviceProxy(this, deviceid);
      if (!this.proxies[deviceid]) {
        this.proxies[deviceid] = [];
      }
      this.proxies[deviceid].push(proxy);
      this.gateway.register(deviceid, proxy);
    }
  }
  debug('Gateway registered.');

  this.emit('gatewayRegistered');
  return gateway;
};

/**
 * Remove a gateway.
 *
 */
Organiq.prototype.deregisterGateway = function() {
  if (!this.gateway) {
    throw new Error('There is no registered gateway.');
  }
  debug('Gateway deregistered.');

  this.gateway = null;
  return true;
};

/**
 * Expose the request constructor as a property on the app object.
 *
 * @type {OrganiqRequest|exports}
 */
Organiq.prototype.request = req;

/**
 * Provides a device interface to the local organiq stack.
 *
 * The standard device methods (get, set, invoke, config, describe) can be
 * invoked directly on this object, and event handlers are supported for
 * 'put' and 'notify'.
 *
 * Used in two contexts:
 *  (1) returned to callers of connect() if we are authoritative for the
 *      requested device.
 *  (2) passed to gateway.register() if a local device is registered for which
 *      we are not authoritative (and the gateway is).
 *
 * var proxy = organiq.connect(...);
 * proxy.get('someProp');
 * proxy.on('put', function onPut(metric, value) { ... });
 * proxy.on('notify', function onNotify(event, args) { ... });
 *
 * We do not currently track identity or other context information with the
 * proxy, but we are likely to do so in the future.
 *
 * @param {Organiq} organiq
 * @param deviceid
 * @constructor
 */
function LocalDeviceProxy(organiq, deviceid) {
  this.deviceid = deviceid;

  this.get = function(property) {
    var req = organiq.request.get(deviceid, property);
    return organiq.dispatch(req);
  };
  this.set = function(property, value) {
    var req = organiq.request.set(deviceid, property, value);
    return organiq.dispatch(req);
  };
  this.invoke = function(method, params) {
    var req = organiq.request.invoke(deviceid, method, params);
    return organiq.dispatch(req);
  };
  this.describe = function(property) {
    var req = organiq.request.describe(deviceid, property);
    return organiq.dispatch(req);
  };
  this.config = function(property, value) {
    var req = organiq.request.config(deviceid, property, value);
    return organiq.dispatch(req);
  };

  // emits 'put' and 'notify' events
}
util.inherits(LocalDeviceProxy, EventEmitter);

