/**
 * WebSocket API connection handler.
 *
 * Manages communication with applications and devices connected via the
 * WebSocket Device API.
 *
 * var organiq = require('organiq'),
 *     WebSocketApi = require('organiq/websocket'),
 *     app = organiq();
 * var WebSocketServer = require('ws').Server,
 *     wss = new WebSocketServer({port: 8080});
 *
 * wss.on('connection', new WebSocketApi(app));
 * // or...
 * wss.on('connection', app.websocketApi());
 *
 */

/**
 * Module Dependencies.
 */
var when_ = require('when');
var debug = require('debug')('organiq:websocket');
var util = require('util'); // node util
var EventEmitter = require('events').EventEmitter;

/**
 * Export WebSocketApi factory function.
 */
module.exports = WebSocketApi;

/* test-code */
module.exports._WebSocketGateway = WebSocketGateway;
module.exports._WebSocketDeviceProxy = WebSocketDeviceProxy;
/* end test-code */

var gatewayCommands = ['CONNECT', 'DISCONNECT', 'REGISTER', 'DEREGISTER'];
var downstreamCommands = ['GET', 'SET', 'INVOKE', 'SUBSCRIBE', 'DESCRIBE', 'CONFIG'];
var upstreamCommands = ['PUT', 'NOTIFY'];
var responseCommand = ['RESPONSE'];

function isGatewayCommand(method) {
  return gatewayCommands.indexOf(method) !== -1;
}

function isDownstreamCommand(method) {
  return downstreamCommands.indexOf(method) !== -1;
}

function isUpstreamCommand(method) {
  return upstreamCommands.indexOf(method) !== -1;
}

function isResponseCommand(method) {
  return method === 'RESPONSE';
}

function isValidRequestMethod(method) {
  return ((responseCommand.indexOf(method) !== -1) ||
          (downstreamCommands.indexOf(method) !== -1) ||
          (gatewayCommands.indexOf(method) !== -1) ||
          (upstreamCommands.indexOf(method) !== -1));
}

var MAX_SAFE_INTEGER = 9007199254740991;
function newId() {
  return Math.floor(Math.random() * MAX_SAFE_INTEGER).toString();
}

/**
 * WebSocket JSON 'wire' representation.
 *
 * An WebSocketRequest object is used to move device and administrative requests
 * between hosts connected via the WebSockets driver. This object is similar,
 * but not identical, to the OrganiqRequest used internally in the stack. In
 * particular, it includes administrative commands that are host-to-host and
 * not meaningful on a local host.
 *
 * method    identifier    value
 * GET        property
 * SET        property
 * INVOKE     method
 *
 * PUT        metric
 * NOTIFY     event
 *
 * CONNECT    n/a
 * DISCONNECT n/a
 * REGISTER   n/a
 * DEREGISTER n/a
 *
 * @returns {WebSocketRequest}
 * @constructor
 */
function WebSocketRequest(method, deviceid, connid, identifier, value) {
  if (!(this instanceof WebSocketRequest)) {
    return new WebSocketRequest(method, deviceid, connid, identifier, value);
  }

  this.method = method;
  this.deviceid = deviceid;
  this.connid = connid;
  this.identifier = identifier;
  this.value = value;
}
void(WebSocketRequest);


/**
 * Factory for the WebSocket API handler.
 *
 * Clients use ws.send() to deliver API requests and device notifications
 * in a simple JSON format. These messages are handled by the API handler
 * via on('message'). Properly-formatted requests are converted to
 * internal representations and dispatched through the Organiq stack.
 *
 * Downstream requests from applications to devices travel "forwards" through
 * the stack, while upstream notifications from devices travel "backwards".
 * Administrative requests are not dispatched through the stack, rather they are
 * processed by this component.
 *
 * Responses (both success and failure) are sent to the client with a special
 * message type of RESPONSE.
 *
 * Messages include:
 *  GET, SET, INVOKE, SUBSCRIBE, CONFIG - Application requests made by a client
 *    on this connection and directed at a device (that is not on this
 *    connection).
 *  PUT, NOTIFY - Device notifications originating from a device registered on
 *    this connection.
 *  REGISTER, DEREGISTER - administrative requests issued on behalf of devices
 *    by their device container.
 *  CONNECT, DISCONNECT - administrative requests issued on behalf of devices
 *    by their device container.
 *  RESPONSE - a reply to any of the above. The `reqid` of a RESPONSE message
 *    matches the `regid` given in the request to which it is the response.
 *
 * The JSON protocol format is similar, but not identical, to the internal
 * representation of Organiq messages used locally. Every message has the
 * following properties:
 *
 * Method
 * In addition to handling requests from applications and devices on the
 * connection, the server may also initiate requests to them. Such requests
 * generally originate from applications on other connections that want to
 * communicate with a device on this connection, or system components.
 *
 * Requests in both directions may be overlapped; that is, multiple requests
 * may be outstanding at any given time, and responses to those requests may
 * come in any order. To facilitate multiplexing, each request has an associated
 * `reqid` property (assigned by the sender) which is included in the RESPONSE
 * sent by the responder.
 *
 * @param {Organiq} organiq The core device proxy object
 * @param {object} options
 * @param {String} options.domain If set, this connection will register as
 *  a gateway authoritative for the given domain.
 * @returns {Function} handler function to be installed for 'connection'
 *  or 'open' handler.
 *
 */
function WebSocketApi(organiq, options) {
  options = options || {};
  options.gateway = options.gateway ? true : false;
  options.domain = options.domain || '*';

  /**
   * Connection handler function.
   *
   * This function should be installed as the 'connection' handler for a
   * server-side WebSocketServer, or the 'open' handler for a client-side
   * WebSocket.
   *
   *
   * var wss = new WebSocketServer(...);
   * wss.on('connection', handler) // when
   *  - or -
   * var ws = new WebSocket(...);
   * ws.on('open', handler)
   *
   * @params {WebSocket|undefined} A new WebSocket connection. If not specified,
   *  it is assumed that `this` refers to the WebSocket object.
   */
  return function webSocketApiConnectionHandler(ws) {

    /**
     * Local devices to which the remote node is currently connected.
     *
     * The devices in this collection provide access to locally-registered
     * devices via the local device stack. One entry exists for every currently-
     * established connection between the remote node and a local device.
     *
     * There are two types of device connections: client connections, and
     * master connections (or registrations). Client connections are created to
     * interface directly with API clients, and are used when the local node is
     * authoritative for the device. Master connections are normally created on
     * device containers, and serve to interface between a locally-registered
     * device and its (remote) master node.
     *
     * Connections are established between the remote node and a local device
     * whenever:
     *  (1) the remote node sends a CONNECT request (in response to an API
     *      client calling organiq.connect()) referencing a device for which the
     *      local node is authoritative;
     *  (2) the local node sends a REGISTER request (in response to a device
     *      container calling organiq.register()) identifying a local device
     *      for which the remote node is authoritative.
     *
     * These device objects facilitate both downstream and upstream
     * communication with devices. Downstream requests received from the remote
     * node can be handled simply by invoking the appropriate device method
     * (e.g., `get`, `invoke`), while upstream notifications from the device are
     * captured locally with event handlers and automatically forwarded to the
     * remote node as NOTIFY and PUT commands.
     *
     * In both cases the device object is a LocalDeviceObject that sits upstream
     * of the local device stack. Each device object has event handlers
     * installed that handle device-originated ('put' and 'notify') messages and
     * forward them across the WebSocket connection.
     *
     * @type {Object.<string, LocalDeviceProxy>}
     */
    var devices = {};   // LocalDeviceProxy objects by connid

    /**
     * Collection of proxies for remote devices for which we are authoritative.
     * These proxies are created when we receive a REGISTER from the remote
     * node, and are only used internally.
     *
     * Device proxies are created to stand in for devices that live on the
     * other side of the WebSocket connection. This collection holds only those
     * proxies that were created to interface with remote devices for which
     * we are authoritative.
     *
     * N.B. The proxies object holds only proxies that have been registered with
     *      the local system via organiq.register().
     *
     * @type {Object.<string, WebSocketDeviceProxy>}
     */
    var proxies = {};   // WebSocketDeviceProxy objects by deviceid

    /**
     * Collection of proxies for remote devices for which we are NOT
     * authoritative. These objects are created when a caller on the local node
     * invokes connect().
     *
     * @type {Object.<string, WebSocketDeviceProxy>}
     */
    var proxyConnections = {}; // WebSocketDeviceProxy arrays by deviceid
    var requests = {};  // outstanding server-originated requests, by reqid
    var _reqid = 0;     // request ID used for last server-originated request
    var handlers = {};  // protocol command handlers, by command

    // Access to functions within this closure are required for WebSocketGateway
    // and WebSocketDeviceProxy objects we create. We expose them via this
    // connection object.
    var connection = { sendRequest: sendRequest, sendResponse: sendResponse,
      sendFailureResponse: sendFailureResponse,
      connectLocalDevice: connectLocalDevice,
      disconnectLocalDevice: disconnectLocalDevice,
      disconnectLocalDeviceByDeviceId: disconnectLocalDeviceByDeviceId,
      registerProxyConnection: registerProxyConnection,
      deregisterProxyConnection: deregisterProxyConnection};

    ws = ws || this;    // in case of 'open', ws is undefined and `this` is WebSocket

    ws.on('message', processMessage);
    ws.on('close', processClose);
    ws.on('error', processError);

    // If this connection is being configured as a gateway, all local device
    // registrations need to be forwarded to the remote node. We do this by
    // exposing methods to the local host through a registered gateway object.
    if (options.gateway) {
      organiq.registerGateway(options.domain, new WebSocketGateway(connection));
    }

    /**
     * WebSocket message handler.
     *
     * This handler is installed with the WebSocket and receives all messages
     * sent by the remote node. Requests are of one of three types:
     *  (1) device request or notifications (e.g., GET, SET, INVOKE, NOTIFY)
     *  (2) administrative requests (e.g., REGISTER, CONNECT)
     *  (3) replies to one of the above.
     *
     * The format for both device and administrative requests is a JSON-
     * formatted WebSocketRequest object. Requests always include a `method`
     * and unique `reqid`, with slightly different properties depending on
     * request type. Responses to requests are indicated by method=`RESPONSE`,
     * and have the following additional properties:
     *  `reqid` - the value of reqid from the request message
     *  `success` - a boolean that is true if the request was successful
     *  `res` - on success, a JavaScript object representing the returned value
     *  `err` - on failure, a JavaScript Error object
     *
     * @param {String} data Data provided by the underlying WebSocket provider
     * @param {Object} flags includes `binary` property as boolean
     */
    function processMessage(data, flags) {
      // Check for (unsupported) binary message
      if (flags.binary) {
        throw new Error("Invalid (binary) message received.");
      }

      // Parse and validate the incoming message
      var msg;
      try { msg = JSON.parse(data); }
      catch(e) { debug('Invalid (non-JSON) message received.'); }

      if (!msg || !msg.reqid || !msg.method) {
        throw new Error('Invalid message (missing reqid or method)');
      }

      var method = msg.method;
      if (!isValidRequestMethod(method)) {
        throw new Error(
          'Invalid message received: invalid method \'' + method + '\'');
      }

      // Special handling for responses
      if (isResponseCommand(method)) {
        return handleResponse(msg);
      }

      // Administrative commands
      if (isGatewayCommand(method)) {
        return handlers[method](msg);
      }


      // Downstream commands may be received when we are either the
      // authoritative node for a device, or the remote node is authoritative
      // and the device is attached locally.
      if (isDownstreamCommand(method)) {
        if (typeof devices[msg.connid] === 'undefined') {
          var err = 'Invalid downstream command: bad connection ID.';
          return sendFailureResponse(msg, err);
        }
        var device = devices[msg.connid];
        var promise;

        switch (method) {
          case 'GET':
            promise = device.get(msg.identifier);
            break;
          case 'SET':
            promise = device.set(msg.identifier, msg.value);
            break;
          case 'INVOKE':
            promise = device.invoke(msg.identifier, msg.value);
            break;
          case 'SUBSCRIBE':
            promise = device.subscribe(msg.identifier);
            break;
          case 'DESCRIBE':
            promise = device.describe(msg.identifier);
            break;
          case 'CONFIG':
            promise = device.config(msg.identifier, msg.value);
            break;
        }

        return promise.then(function (res) {
            sendResponse(msg, res);
          })
          .catch(function (err) {
            debug('dispatch failed: ' + err);
            var errMessage = (err instanceof Error) ? err.message : err;
            sendFailureResponse(msg, errMessage);
          });
      }

      if (isUpstreamCommand(method)) {
        // If we are authoritative for this device, we will find a proxy for it
        // in proxies[]. This proxy is the one that we gave to the core node's
        // register(). We need to emit an event on it so that the core can send
        // it up through the local stack. In this case, there should be no
        // proxies in proxyConnections[], because any local attempt to connect()
        // to the device would've been handled directly by core.
        //
        // If we are not authoritative for this device, then we might have given
        // out proxies to local connect() API callers. We need to emit on all of
        // these objects to signal to the application-level code.
        var ps = proxies[msg.deviceid] || proxyConnections[msg.deviceid] || [];
        if (!Array.isArray(ps)) {
          ps = [ps];
        }
        for(var i=0;i<ps.length;i++) {
          var proxy = ps[i];
          try {
            switch (method) {
              case 'PUT':
                proxy.emit('put', msg.identifier, msg.value);
                break;
              case 'NOTIFY':
                var params = msg.value;
                if (!Array.isArray(params)) {
                  params = [params];
                }
                proxy.emit('notify', msg.identifier, params);
                break;
            }
          } catch(err) {
            debug('proxy.emit ' + msg.identifier + ' threw exception: ' + err);
          }
        }
        // we don't wait for the PUT or NOTIFY to complete; they are 'fire-and
        // forget' events.
        return sendResponse(msg, true);
      }
    }

    /**
     * Handle a REGISTER protocol command
     *
     * We receive REGISTER commands when we are the authoritative node for a
     * device that was registered on the remote node.
     *
     * We handle the command by creating a WebSocketDeviceProxy object and
     * registering it locally. This allows the remote device to be invoked
     * after requests for it have passed through the local device stack.
     *
     * The remote node should DEREGISTER the device if it goes offline. In
     * any case, the proxy object created locally will be deregistered if the
     * connection drops.
     *
     * If a device with the given deviceid has already been registered on this
     * connection, the operation fails.
     *
     * @param {object} req
     */
    handlers['REGISTER'] = function handleRegister(req) {
      var deviceid = req.deviceid;
      var connid = req.connid;

      // Only one instance of a given deviceid can be registered on a connection.
      if (typeof proxies[deviceid] !== 'undefined') {
        sendFailureResponse(req, 'Already registered');
        return;
      }

      // Create a proxy for the remote device, and register it with the local
      // system. If we get a valid registration id, return it to the caller.
      var proxy = new WebSocketDeviceProxy(connection, deviceid, connid);
      var regid = organiq.register(deviceid, proxy);
      if (regid) {
        proxies[deviceid] = proxy;
        sendResponse(req, deviceid);
      } else {
        sendFailureResponse(req, 'Device registration failed');
      }
    };

    /**
     * Handle a DEREGISTER protocol command.
     *
     * We receive DEREGISTER commands when we are the authoritative node for a
     * device that has been deregistered on the remote node.
     *
     * @param {Object} req
     */
    handlers['DEREGISTER'] = function handleDeregister(req) {
      var deviceid = req.deviceid;
      var proxy = proxies[deviceid];
      if (proxy) {
        delete proxies[deviceid];
        organiq.deregister(deviceid);
        sendResponse(req, proxy.deviceid);
      } else {
        sendFailureResponse(req, 'Unknown device');
      }
    };

    /**
     * Handle a CONNECT protocol command.
     *
     * We receive CONNECT requests when the remote node wants to connect to
     * the authoritative node for a device. When a device has been connected
     * in this manner, the remote node can issue application-originated commands
     * and receive device-originated messages.
     *
     * @param req
     */
    handlers['CONNECT'] = function handleConnect(req) {
      var deviceid = req.deviceid;

      // Attempt to connect to the device on the local node.
      var device = organiq.connect(deviceid);
      if (!device) {
        return sendFailureResponse(req, 'Device connect failed.');
      }

      // Install handlers so that we can generate WebSocket protocol when
      // device-originated messages (NOTIFY and PUT) occur on the device.
      var connid = connectLocalDevice(deviceid, device);

      debug('Connected remote device: ' + deviceid + '; connid=' + connid);

      sendResponse(req, connid);
    };

    /**
     * Handle a DISCONNECT protocol request.
     *
     * @param req
     */
    handlers['DISCONNECT'] = function handleDisconnect(req) {
      var connid = req.connid;

      var device = disconnectLocalDevice(connid);
      if (!device) {
        sendFailureResponse(req, 'Unknown device connection');
      }
      organiq.disconnect(device);

      debug('Disconnected remote device: ' + device.deviceid);

      sendResponse(req, true);
    };

    /**
     * Handle a closed WebSocket connection (via ws.on('close')).
     *
     * This method cleans up all state associated with the client connection.
     */
    function processClose() {
      debug('websocket closed.');
      for (var deviceid in proxies) {
        if (proxies.hasOwnProperty(deviceid)) {
          organiq.deregister(deviceid);
        }
      }
      proxies = {};
      if (options.gateway) {
        organiq.deregisterGateway(options.domain);
      }
    }

    /**
     * Handle an error raised on the WebSocket connection (via ws.on('error')).
     */
    function processError(err) {
      debug('websocket error: ' + err);
    }

    /**
     * Deliver a protocol request to this connection.
     *
     * @param msg
     * @param msg.method
     * @param msg.deviceid
     * @param msg.connid
     * @param msg.identifier
     * @param msg.value
     *
     * @returns {Promise|promise|}
     */
    function sendRequest(msg) {
      var deferred = when_.defer();
      msg.reqid = ++_reqid;
      requests[msg.reqid] = deferred;
      ws.send(JSON.stringify(msg), function ack(err) {
        if (err) {
          delete requests[msg.reqid];
          deferred.reject(err);
        }
      });
      return deferred.promise;
    }

    function sendResponse(req, res) {
      var msg = { reqid: req.reqid, deviceid: req.deviceid, method: 'RESPONSE',
                  success: true, res: res };
      ws.send(JSON.stringify(msg));
    }

    function sendFailureResponse(req, err) {
      var msg = { reqid: req.reqid, deviceid: req.deviceid, method: 'RESPONSE',
                  success: false, err: err };
      debug('request failed: ' + JSON.stringify(msg));
      ws.send(JSON.stringify(msg));
    }

    /**
     * Handle a response from a device on this connection.
     *
     * We simply look up the request based on the id and fulfill the
     * attached promise.
     *
     * @params {object} msg
     */
    function handleResponse(msg) {
      var deferred = requests[msg.reqid];
      delete requests[msg.reqid];

      if (msg.success) {
        deferred.resolve(msg.res);
      } else {
        debug('Request failed: ' + msg.err);
        deferred.reject(new Error(msg.err));
      }
    }

    /**
     * Connect to a local proxy object to enable sending/receiving.
     *
     * This routine installs event handlers for the given proxy to enable
     * device-originated messages to be passed to the remote node. It also
     * saves a reference to the proxy so that downstream messages can be
     * routed to it.
     *
     * @param {String} deviceid
     * @param {LocalDeviceProxy} device
     * @returns {*} The connection id for the local proxy.
     * @private
     */
    function connectLocalDevice(deviceid, device) {

      // Generate a new connection ID, which will be given to the remote node
      // to refer to this device connection.
      var connid = newId();

      // Install handlers so that we can generate WebSocket protocol when
      // device-originated messages (NOTIFY and PUT) occur on the device.
      if (typeof device.on === 'function') {
        device.on('notify', function (event, params) {
          var req = {
            method: 'NOTIFY', deviceid: deviceid, connid: connid,
            identifier: event, value: params
          };
          connection.sendRequest(req);
        });
        device.on('put', function (metric, value) {
          var req = {
            method: 'PUT', deviceid: deviceid, connid: connid,
            identifier: metric, value: value
          };
          connection.sendRequest(req);
        });
      }

      // Put the local device in the connection so we can find it to handle
      // future requests.
      devices[connid] = device;
      return connid;
    }

    /**
     * Disconnect the transport from the given proxy.
     *
     * We remove any installed event handlers and remove the reference to the
     * object.
     *
     * @param connid
     * @return {LocalDeviceProxy} the originally connected local device proxy
     */
    function disconnectLocalDevice(connid) {
      var device = devices[connid];
      if (device) {
        device.removeAllListeners();
        delete devices[connid];
      }
      return device;
    }

    function disconnectLocalDeviceByDeviceId(deviceid) {
      var connid;
      for(connid in devices) {
        if (devices.hasOwnProperty(connid)) {
          var device = devices[connid];
          if (device.deviceid === deviceid) {
            this.connection.disconnectLocalDevice(connid);
            return connid;
          }
        }
      }
      return null;
    }

    function registerProxyConnection(deviceid, proxy) {
      if (!proxyConnections[deviceid]) {
        proxyConnections[deviceid] = [];
      }
      proxyConnections[deviceid].push(proxy);
    }

    function deregisterProxyConnection(deviceid, proxy) {
      var proxies = proxyConnections[deviceid] || [];
      var idx = proxies.indexOf(proxy);
      if (idx > -1) {
        proxies.splice(idx, 1);
        if (proxies.length === 0) {
          delete proxyConnections[proxy.deviceid];
        }
      }
    }

  };
}


/**
 * Proxy for a remote device connected via WebSockets.
 *
 * Device proxies are created to stand in for devices that live on the
 * other side of a WebSocket connection. They can be used to send application-
 * originated requests to remote devices, and may also be used by locally-
 * connected clients to receive device-notifications from remote devices.
 *
 * Device proxies may be created in either of these situations:
 *  (1) a device is registered on the remote node for which the local node
 *      is authoritative. In this case, we will receive a REGISTER command
 *      from the remote host, causing us to create a device proxy and
 *      register it with the local system via organiq.register().
 *  (2) code running on the local node calls organiq.connect() to connect
 *      to a device for which the remote node to which we are connected is
 *      authoritative. In this case, organiq.connect() will invoke our
 *      connect() method, which allocates the proxy.
 *
 * @param {Object} connection
 * @param {String} deviceid
 * @param {String} connid
 * @constructor
 */
function WebSocketDeviceProxy(connection, deviceid, connid) {
  if (!(this instanceof WebSocketDeviceProxy)) {
    return new WebSocketDeviceProxy(connection, deviceid, connid);
  }

  /**
   * Send a device request via WebSocket to the connected remote node.
   *
   * @param {String} method
   * @param {String} identifier
   * @param {object=} value
   * @return {Promise}
   * @private
   */
  this.sendRequest = function sendRequest(method, identifier, value) {
    var req = {
      method: method,
      deviceid: deviceid,
      connid: connid,
      identifier: identifier
    };
    if (typeof value !== 'undefined') {
      req.value = value;
    }

    return connection.sendRequest(req);
  };
}

util.inherits(WebSocketDeviceProxy, EventEmitter);

WebSocketDeviceProxy.prototype.get = function(prop) {
  return this.sendRequest('GET', prop);
};

WebSocketDeviceProxy.prototype.set = function(prop, value) {
  return this.sendRequest('SET', prop, value);
};

WebSocketDeviceProxy.prototype.invoke = function(method, params) {
  return this.sendRequest('INVOKE', method, params);
};

WebSocketDeviceProxy.prototype.subscribe = function(event) {
  return this.sendRequest('SUBSCRIBE', event);
};

WebSocketDeviceProxy.prototype.describe = function(property) {
  return this.sendRequest('DESCRIBE', property);
};

WebSocketDeviceProxy.prototype.config = function(property, value) {
  return this.sendRequest('CONFIG', property, value);
};



/**
 * Gateway for forwarding messages to an upstream gateway.
 *
 * This object is used by the system to send device registration requests
 * to a connected Gateway. It is only used when the local WebSocket connection
 * is created with `gateway: true` in its options.
 *
 * This object also forwards device-originated notifications (NOTIFY, PUT).
 *
 * @param {Object} connection
 * @constructor
 */
function WebSocketGateway(connection) {
  this.connection = connection;
  this.sendRequest = connection.sendRequest;
}

/**
 * Get a proxy for a device for which this remote gateway is authoritative.
 *
 * This method is called by the local node when a connection request is made
 * for a device for which the remote gateway is authoritative.
 *
 * The returned device proxy uses the underlying WebSocket transport to
 * communicate device requests with the authoritative node.
 *
 * @param {String} deviceid
 * @returns {Promise|WebSocketDeviceProxy}
 */
WebSocketGateway.prototype.connect = function(deviceid) {
  var connection = this.connection; // needed for sendRequest handler
  var req = {
    method: 'CONNECT',
    deviceid: deviceid
  };
  return this.connection.sendRequest(req)
    .then(function(connid) {
      var proxy = new WebSocketDeviceProxy(connection, deviceid, connid);
      // these are currently needed to do disconnect below
      proxy.deviceid = deviceid;
      proxy.connid = connid;

      connection.registerProxyConnection(deviceid, proxy);

      debug('Client connected to WebSocket device: ' + deviceid);

      return proxy;
    });
};

/**
 *
 * @param {WebSocketDeviceProxy} proxy
 * @returns {Promise|*}
 */
WebSocketGateway.prototype.disconnect = function(proxy) {
  var connection = this.connection;
  var req = {
    method: 'DISCONNECT',
    deviceid: proxy.deviceid,
    connid: proxy.connid
  };
  return this.connection.sendRequest(req)
    .then(function(res) {
      connection.deregisterProxyConnection(proxy.deviceid, proxy);
      return res;
    });
};

/**
 * Register a device with the remote host.
 *
 * @param deviceid
 * @param device
 * @return {Promise<String|Error>} A promise resolving to the deviceid used in
 *  the registration, or an Error on rejection.
 */
WebSocketGateway.prototype.register = function(deviceid, device) {
  // We are given a LocalDeviceProxy, which sits upstream of the device stack.
  // We will be able to invoke the get, set, etc methods when we receive
  // WebSocket commands to do so. In order to forward device-originated messages
  // to remote clients, we need to register device handlers.
  var connid = this.connection.connectLocalDevice(deviceid, device);

  var req = {
    method: 'REGISTER',
    deviceid: deviceid,
    connid: connid
  };
  return this.connection.sendRequest(req);
};

/**
 * Deregister a previously-registered device with the remote host.
 *
 * @param deviceid
 * @return {Promise<String|Error>} A promise resolving to the deviceid of the
 *  device deregistered, or rejecting as an Error.
 */
WebSocketGateway.prototype.deregister = function(deviceid) {

  var connid = this.connection.disconnectLocalDeviceByDeviceId(deviceid);
  if (!connid) {
    return when_.reject(new Error('device was not registered.'));
  }

  var req = {
    method: 'DEREGISTER',
    deviceid: deviceid,
    connid: connid
  };
  return this.connection.sendRequest(req);
};

/**
 * Send a NOTIFY message to the remote host.
 *
 * @param deviceid
 * @param event
 * @param params
 * @returns {Promise<Boolean|Error>}
 */
WebSocketGateway.prototype.notify = function(deviceid, event, params) {
  var req = {
    method: 'NOTIFY',
    deviceid: deviceid,
    identifier: event,
    params: params
  };
  return this.connection.sendRequest(req);
};

/**
 * Send a PUT message to the remote host.
 *
 * @param deviceid
 * @param metric
 * @param value
 * @return {Promise<Boolean|Error>}
 */
WebSocketGateway.prototype.put = function(deviceid, metric, value) {
  var req = {
    method: 'PUT',
    deviceid: deviceid,
    identifier: metric,
    value: value
  };
  return this.connection.sendRequest(req);
};

