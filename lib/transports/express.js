/**
 * Express-compatible middleware for Organiq Device API stack.
 *
 * This module allows the Organiq device stack to be exposed as middleware in
 * an Express application. It implements the handle_request() interface
 * expected by Express by translating HTTP requests into appropriate Organiq
 * device API requests that are then dispatched.
 *
 * This module provides access to the low-level Device API interface by both
 * applications and devices. It does not implement the higher-level API used by
 * most applications that use Organiq.
 *
 * Organiq Device API requests are made over HTTP semantically. This module
 * converts the HTTP representation of a request to its Organiq equivalent.
 *
 */

/**
 * Module Dependencies.
 */
var debug = require('debug')('organiq:express');

/**
 * Export ExpressApi factory function.
 */
module.exports = ExpressDapi;



function ExpressDapi(organiq) {

  /**
   * Express-compatible middleware handler for Organiq Device API stack.
   *
   * Convert REST-ful Device API requests to the internal Organiq format and
   * dispatch them through the stack.
   *
   * Middleware requirements:
   *  params
   *  body (npm install body-parser)
   *
   * @api private
   */
  return function organiqApiHandler(httpreq, httpres, next) {
    var deviceid = httpreq.params.deviceid;
    var identifier = httpreq.params.identifier;
    var res;

    organiq.connect(deviceid).then(function(device) {
      // GET /dapi/{deviceid}/{property} -> GET
      // PUT /dapi/{deviceid}/{property} -> SET
      // POST /dapi/{deviceid}/{method}  -> INVOKE
      // GET /dapi/{deviceid}/.schema    -> DESCRIBE
      // PUT /dapi/{deviceid}/.config    -> CONFIG
      // POST /dapi/{deviceid}/metrics   -> PUT [device-originated]
      // POST /dapi/{deviceid}/events    -> NOTIFY [device-originated]
      switch (httpreq.method) {
        case 'GET':
          if (identifier === '.schema') {
            res = device.describe('schema');
          } else if (identifier === '.config') {
            res = device.describe('config');
          } else {
            res = device.get(identifier);
          }
          break;
        case 'PUT':
          if (identifier === '.config') {
            var config = httpreq.body;
            res = device.config(identifier, config);
          } else {
            var value = httpreq.body;
            res = device.set(identifier, value);
          }
          break;
        case 'POST':
          if (identifier === 'metrics') {
            // need to crack out the metric information. For now, we expect a
            // single metric with value to be here
            var metrics = httpreq.body;
            var metric = Object.keys(metrics)[0];
            var mvalue = metrics[metric];
            req = organiq.request.put(deviceid, metric, mvalue);
          } else if (identifier === 'events') {
            // need to crack out the event information. For now, we expect a
            // single metric with value to be here
            var events = httpreq.body;
            var event = Object.keys(events)[0];
            var evalue = events[event];
            req = organiq.request.notify(deviceid, event, evalue);
          } else {
            var params = JSON.stringify(httpreq.body);
            req = organiq.request.invoke(deviceid, identifier, params);
          }
          break;
        default:
          throw new Error("Invalid Request");
      }
    }).then(function(res) {
        organiq.disconnect(device);
        return httpres.json(res);
    }).catch(function(err) {
        debug('organiq.dispatch failed: ' + err);
        organiq.disconnect(device);
        next(err);
    });
  };
}
