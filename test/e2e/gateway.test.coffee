organiq = require '../..'
WebSocket = require 'ws'
WebSocketServer = WebSocket.Server

# This test case is when the device is attached to the gateway, but the request
# comes from another node.
describe 'Device requests to remote device on gateway', ->
  testDevice = null
  testDeviceId = 'test-device-id'
  appLocal = null
  appRemote = null
  proxy = null
  ws = null
  wss = null

  expectedGetValue = { Iam: 'a property value' }
  expectedSetValue = true
  expectedMethodValue = { ret: 'a method value' }

  beforeEach (done) ->
    # Set up the 'remote' gateway
    appRemote = organiq()
    wss = new WebSocketServer({ port: 1234 })
    wss.on('connection', appRemote.websocketApi())

    # Attach the test device to the remote gateway
    testDevice =
      get: (prop) -> expectedGetValue
      set: (prop, val) ->
      invoke: (method, args) -> expectedMethodValue
      subscribe: (event) -> return true
      config: (sel, args) -> return { prop: sel, args: args }
      describe: (prop) -> return { events: ['a','b'] }

    testDevice.spyGet = sinon.spy testDevice, 'get'
    testDevice.spySet = sinon.spy testDevice, 'set'
    testDevice.spyInvoke = sinon.spy testDevice, 'invoke'
    testDevice.spyConfig = sinon.spy testDevice, 'config'
    testDevice.spyDescribe = sinon.spy testDevice, 'describe'

    appRemote.register testDeviceId, testDevice

    # Set up the local node
    appLocal = organiq()
    ws = new WebSocket('ws://localhost:1234')
    ws.on 'open', appLocal.websocketApi({ gateway: true })
    # Wait until the gateway is opened before getting proxy object
    ws.on 'open', ->
      promise = appLocal.connect testDeviceId
      promise.then (prox) ->
        proxy = prox
        done()

  afterEach ->
    ws.close()
    wss.close()
    ws = wss = appLocal = appRemote = null

  it 'gets proxy for remote device', ->
    proxy.should.be.instanceOf require('../../lib/transports/websocket')._WebSocketDeviceProxy;

  it 'invokes device `get` via proxy', ->
    res = proxy.get('prop')
    return res.then (res) ->
      testDevice.spyGet.should.have.been.calledWith 'prop'
      res.should.deep.equal expectedGetValue

  it 'invokes device `set` via proxy', ->
    res = proxy.set 'setprop', 'newval'
    return res.then (res) ->
      testDevice.spySet.should.have.been.calledWith 'setprop', 'newval'
      res.should.deep.equal expectedSetValue

  it 'invokes device `invoke` via proxy', ->
    res = proxy.invoke 'methodname', { params: 'here' }
    return res.then (res) ->
      testDevice.spyInvoke.should.have.been.calledWith 'methodname', { params: 'here' }
      res.should.deep.equal expectedMethodValue


# This test case is when the device is attached to the local node, but it is not
# authoritative for the namespace. Requests from the local node must travel to the
# master (gateway) before coming back to be passed to the local device. So this does
# a full round-trip for each request.
describe 'Device requests to local device through gateway', ->
  testDevice = null
  testDeviceId = 'test-device-id'
  appLocal = null
  appRemote = null
  proxy = null
  ws = null
  wss = null

  expectedGetValue = { Iam2: 'another property value' }
  expectedSetValue = true
  expectedMethodValue = { ret: 'a method value' }

  beforeEach (done) ->
    # Set up the 'remote' gateway
    appRemote = organiq()
    wss = new WebSocketServer({ port: 1234 })
    wss.on('connection', appRemote.websocketApi())

    # Set up the local node
    appLocal = organiq()
    ws = new WebSocket('ws://localhost:1234')
    ws.on 'open', appLocal.websocketApi({ gateway: true })

    # Attach the test device to the local node.
    testDevice =
      get: (prop) -> expectedGetValue
      set: (prop, val) ->
      invoke: (method, args) -> expectedMethodValue
      subscribe: (event) -> return true
      config: (sel, args) -> return { prop: sel, args: args }
      describe: (prop) -> return { events: ['a','b'] }

    testDevice.spyGet = sinon.spy testDevice, 'get'
    testDevice.spySet = sinon.spy testDevice, 'set'
    testDevice.spyInvoke = sinon.spy testDevice, 'invoke'
    testDevice.spyConfig = sinon.spy testDevice, 'config'
    testDevice.spyDescribe = sinon.spy testDevice, 'describe'

    appLocal.register testDeviceId, testDevice

    # Wait until the gateway is opened before getting proxy object
    ws.on 'open', ->
      p = appLocal.connect testDeviceId
      p.then (proxy_) ->
        proxy = proxy_
        done()

  afterEach ->
    ws.close()
    wss.close()
    ws = wss = appLocal = appRemote = null

  it 'gets proxy for remote device', ->
    # Even though this device is registered locally, we should be going through
    # the master (gateway) node for all requests
    proxy.should.be.instanceOf require('../../lib/transports/websocket')._WebSocketDeviceProxy;

  it 'invokes device `get` via proxy', ->
    res = proxy.get('prop')
    return res.then (res) ->
      testDevice.spyGet.should.have.been.calledWith 'prop'
      res.should.deep.equal expectedGetValue

  it 'invokes device `set` via proxy', ->
    res = proxy.set 'setprop', 'newval'
    return res.then (res) ->
      testDevice.spySet.should.have.been.calledWith 'setprop', 'newval'
      res.should.deep.equal expectedSetValue

  it 'invokes device `invoke` via proxy', ->
    res = proxy.invoke 'methodname', { params: 'here' }
    return res.then (res) ->
      testDevice.spyInvoke.should.have.been.calledWith 'methodname', { params: 'here' }
      res.should.deep.equal expectedMethodValue



