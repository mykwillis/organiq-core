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
 * an interface to administrative functionality for the node. Access to this
 * virtual device object is subject to all of the same controls as access to
 * any other device.
 *
 * @param {Organiq} organiq The organiq node
 * @returns {OrganiqCoreDevice}
 * @return {getAttachedDeviceInfo}
 * @constructor
 * @private
 */
function OrganiqCoreDevice(organiq, getAttachedDeviceInfo) {
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
      throw Error('Unknown property');
  }
};

device.prototype.set = function(property, value) {
  throw Error('Not supported');
};

device.prototype.invoke = function(method, params) {
  throw Error('Not supported');
};

device.prototype.subscribe = function(event) {
  throw Error('Not supported');
};

device.prototype.describe = function(property) {
  return {
    methods: {},
    events: {},
    properties: {
      'ConnectedDevices': { type: 'object' }
    }
  };
};

device.prototype.config = function(property, value) {
  throw Error('Not supported');
};

device.prototype.put = function(metric, value) {
  this.emit(metric, value);
};

device.prototype.notify = function(event, params) {
  this.emit(event, params);
};

