organiq = require '../..'
WebSocket = require 'ws'
WebSocketServer = WebSocket.Server
{EventEmitter} = require 'events'

#
# Full Network Roundtrip of Device APIs
#
# We set up a local node and a 'remote' node, the local node connecting as a
# client to the remote node which acts as master.
#
# We register a device on the local node (core.register), then connect to that
# same device (core.connect) and exercise the full API.  Because the remote
# node is authoritative, all of the requests will end up going to the remote
# node and back to the local node to be handled.
#
describe 'Device API Roundtrip', ->
  appLocal = null     # local instance
  appRemote = null    # 'remote' instance (authoritative)
  testDevice = null   # locally-registered device (given to core.register)
  proxy = null        # locally-obtained proxy (returned from core.connect)

  ws = null           # WebSocket client used by appLocal
  wss = null          # WebSocket server used by appRemote

  # Test Device attributes
  testDeviceId = 'test-device-id'
  expectedGetValue = { Iam: 'a property value' }
  expectedSetValue = true
  expectedInvokeValue = { ret: 'a method value' }
  expectedSubscribeValue = true
  expectedConfigValue = true
  expectedDescribeValue = { events: ['a', 'b'] }

  beforeEach (done) ->
    # Set up the 'remote' gateway
    appRemote = organiq()
    wss = new WebSocketServer({ port: 1234 })
    wss.on('connection', appRemote.websocketApi())

    # Set up the local node, connecting to remote as gateway
    appLocal = organiq()
    ws = new WebSocket('ws://localhost:1234')
    ws.on 'open', appLocal.websocketApi({ gateway: true })

    # Create the test device, attach spies, and register it with the local app
    testDevice =
      get: (prop) -> expectedGetValue
      set: (prop, val) -> expectedSetValue
      invoke: (method, args) -> expectedInvokeValue
      subscribe: (event) -> expectedSubscribeValue
      config: (sel, args) -> expectedConfigValue
      describe: (prop) -> expectedDescribeValue
      on: (ev, fn) -> @__emitter.on ev, fn
      __emitter: new EventEmitter()


    testDevice.spyGet = sinon.spy testDevice, 'get'
    testDevice.spySet = sinon.spy testDevice, 'set'
    testDevice.spyInvoke = sinon.spy testDevice, 'invoke'
    testDevice.spySubscribe = sinon.spy testDevice, 'subscribe'
    testDevice.spyConfig = sinon.spy testDevice, 'config'
    testDevice.spyDescribe = sinon.spy testDevice, 'describe'

    appLocal.register testDeviceId, testDevice

    # (Asynchronously) get a proxy to the test device. (Wait until the gateway
    # has connected to ensure we don't get a local device proxy).
    appLocal.on 'gatewayRegistered', ->
      p = appLocal.connect testDeviceId
      p.then (proxy_) ->
        proxy = proxy_
        done()

  afterEach ->
    ws.close()
    wss.close()
    ws = wss = appLocal = appRemote = null

  it 'gets proxy for remote device', ->
    proxy.should.be.instanceOf require('../../lib/transports/websocket')._WebSocketDeviceProxy;

  it 'invokes device `get` via proxy', ->
    res = proxy.get('prop')
    res.then (res) ->
      testDevice.spyGet.should.have.been.calledWith 'prop'
      res.should.deep.equal expectedGetValue

  it 'invokes device `set` via proxy', ->
    res = proxy.set 'propName', 'propValue'
    res.then (res) ->
      testDevice.spySet.should.have.been.calledWith 'propName', 'propValue'
      res.should.deep.equal expectedSetValue

  it 'invokes device `invoke` via proxy', ->
    params = [ 'a', 12, true, { param: 'here' } ]
    res = proxy.invoke 'methodName', params
    res.then (res) ->
      testDevice.spyInvoke.should.have.been.calledWith 'methodName', params
      res.should.deep.equal expectedInvokeValue

  it 'invokes device `subscribe` via proxy', ->
    res = proxy.subscribe 'eventName'
    res.then (res) ->
      testDevice.spySubscribe.should.have.been.calledWith 'eventName'
      res.should.deep.equal expectedSubscribeValue

  it 'invokes device `config` via proxy', ->
    params = { someVal: '1', another: { a: true } }
    res = proxy.config params
    res.then (res) ->
      testDevice.spyConfig.should.have.been.calledWith params
      res.should.deep.equal expectedConfigValue

  it 'invokes device `describe` via proxy', ->
    res = proxy.describe 'propName'
    res.then (res) ->
      testDevice.spyDescribe.should.have.been.calledWith 'propName'
      res.should.deep.equal expectedDescribeValue

  it 'receives device `put` on proxy', (done) ->
    metricName = 'test-metric'
    metricValue = 23
    proxy.on 'put', (metric, value) ->
      metric.should.equal metricName
      value.should.equal metricValue
      done()
    testDevice.__emitter.emit 'put', metricName, metricValue

  it 'receives device `notify` on proxy', (done) ->
    eventName = 'test-event'
    eventValue = [ 'event-arg', 3 ]
    proxy.on 'notify', (event, value) ->
      event.should.equal eventName
      value.should.deep.equal eventValue
      done()
    testDevice.__emitter.emit 'notify', eventName, eventValue



