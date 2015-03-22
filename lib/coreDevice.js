/**
 * Module dependencies.
 */


/**
 * Organiq Core Device
 */
var device = module.exports = OrganiqCoreDevice;

/*
 * Core Device Object
 *
 * One instance of OrganiqCoreDevice is created on each core node, providing
 * an interface to administrative functionality for the node.
 *
 * The device is registered in the non-routed (empty) domain as ':core'.
 *
 * @param {Organiq} organiq The organiq node
 * @returns {OrganiqCoreDevice}
 * @constructor
 * @private
 */
function OrganiqCoreDevice(organiq) {
  if (!(this instanceof OrganiqCoreDevice)) {
    return new OrganiqCoreDevice(organiq);
  }
  this.organiq = organiq;
}

device.prototype.get = function(property) {
  switch (property) {
    case 'ConnectedDevices':
      return this.organiq.getAttachedDeviceInfo();
    default:
      throw Error('Unknown property \'' + property + '\'');
  }
};

device.prototype.set = function(property, value) {
  void(property);
  void(value);
  throw Error('Not supported');
};

device.prototype.invoke = function(method, params) {
  void(method);
  void(params);
  throw Error('Not supported');
};

device.prototype.subscribe = function(event) {
  void(event);
  throw Error('Not supported');
};

device.prototype.describe = function(property) {
  void(property);
  return {
    methods: {},
    events: {},
    properties: {
      'ConnectedDevices': { type: 'object' }
    }
  };
};

device.prototype.config = function(property, value) {
  void(property);
  void(value);
  throw Error('Not supported');
};
