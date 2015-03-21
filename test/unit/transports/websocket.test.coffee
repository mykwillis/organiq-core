WebSocket = require 'ws'
WebSocketServer = WebSocket.Server
when_ = require 'when'

WebSocketApi = require '../../../lib/transports/websocket'
WebSocketDeviceProxy = WebSocketApi._WebSocketDeviceProxy

describe 'WebSocketAPI module', ->
  it 'should return factory for connection handler', ->
    handler = WebSocketApi()
    handler.name.should.equal 'webSocketApiConnectionHandler'

  describe 'webSocketApiConnectionHandler', ->
    mock_app = null
    mock_ws = null
    handler = null
    messageFn = null
    closeFn = null
    errorFn = null
    spy_registerGateway = null
    beforeEach ->
      mock_app =
        registerGateway: (gateway) ->
          return;
        deregisterGateway: () ->
          return;
      spy_registerGateway = sinon.spy(mock_app, 'registerGateway')
      mock_ws =
        on: (msg, fn) ->
          if msg == 'message' then messageFn = fn
          else if msg == 'close' then closeFn = fn
          else if msg == 'error' then errorFn = fn
        send: (s) ->
      handler = WebSocketApi()

    it 'should register proper event handlers', ->
      spy = sinon.spy(mock_ws, 'on')
      handler(mock_ws)

      spy.should.have.been.calledWith 'message'
      spy.should.have.been.calledWith 'close'
      spy.should.have.been.calledWith 'error'

    it 'should reject binary messages', ->
      handler(mock_ws)

      fn = messageFn.bind mock_ws, {}, { binary: true }
      fn.should.throw(/Invalid.*binary/)

    it 'should reject invalid methods', ->
      handler(mock_ws)

      message = JSON.stringify { method: 'INVALID'}
      fn = messageFn.bind mock_ws, message, {}
      fn.should.throw(/Invalid.*method/)

      message = JSON.stringify { method: 'GET0'}
      fn = messageFn.bind mock_ws, message, {}
      fn.should.throw(/Invalid.*method/)

      message = JSON.stringify { method: 'AINVOKE'}
      fn = messageFn.bind mock_ws, message, {}
      fn.should.throw(/Invalid.*method/)

    it 'should reject invalid JSON', ->
      handler(mock_ws)

      message = "{ i: am not JSON }"
      fn = messageFn.bind mock_ws, message, {}
      fn.should.throw(/Invalid.*message/)

    it 'should register gateway if gateway:true option specified', ->
      handler = WebSocketApi(mock_app, { gateway: true })
      handler(mock_ws)
      spy_registerGateway.should.have.been.calledOnce
      domain = spy_registerGateway.getCall(0).args[0]
      gateway = spy_registerGateway.getCall(0).args[1]
      domain.should.equal '*'
      gateway.should.be.instanceOf(WebSocketApi._WebSocketGateway)

    it 'should not register gateway if gateway:true option unspecified', ->
      handler = WebSocketApi(mock_app, { })
      handler(mock_ws)
      spy_registerGateway.should.not.have.been.called

  describe 'WebSocketGateway', ->
    gateway = null
    spy = null
    test_deviceid = 'test-deviceid-wsg'
    test_event = 'test-event-name'
    test_params = [ 'first', 'second', 'third' ]
    test_metric = 'test-metric-name'
    test_value = { o: 'hey' }
    test_connid = -1234
    beforeEach ->
      WebSocketGateway = WebSocketApi._WebSocketGateway;
      success =
        success: true
        res: true
      mock_conn =
        sendRequest: (req) -> return when_(success)
        sendResponse: (req, res) -> return
        sendFailureResponse: (req, err) -> return
        connectLocalDevice: (deviceid, device) -> test_connid
        disconnectLocalDevice: (connid) -> return
        disconnectLocalDeviceByDeviceId: (deviceid) -> return test_connid

      spy = sinon.spy(mock_conn, 'sendRequest')
      gateway = new WebSocketGateway(mock_conn)

    it 'should support register', ->
      gateway.register test_deviceid
      spy.should.have.been.calledWith { connid: test_connid, method: 'REGISTER', deviceid: test_deviceid }

    it 'should support deregister', ->
      gateway.register test_deviceid
      spy.reset()
      gateway.deregister test_deviceid
      spy.should.have.been.calledWith { connid: test_connid, method: 'DEREGISTER', deviceid: test_deviceid }

    it 'should support notify', ->
      gateway.notify test_deviceid, test_event, test_params
      spy.should.have.been.calledWith {  method: 'NOTIFY', deviceid: test_deviceid, identifier: test_event, params: test_params }

    it 'should support put', ->
      gateway.put test_deviceid, test_metric, test_value
      spy.should.have.been.calledWith {  method: 'PUT', deviceid: test_deviceid, identifier: test_metric, value: test_value }


describe 'WebSocketDeviceProxy', ->
  testDeviceId = 'test-device-id'
  testConnId = 'test-conn-id'
  mockResult = { result: 'test-result' }
  proxy = null
  spy = null
  beforeEach ->
    # stub out connection.sendRequest to return successful empty object
    connection =
      sendRequest: (method, identifier, value) -> when_ mockResult
    spy = sinon.spy connection, 'sendRequest'
    proxy = new WebSocketDeviceProxy connection, testDeviceId, testConnId

  it 'should send `get` request', ->
    p = proxy.get 'test-prop'
    expectedReq =
      deviceid: testDeviceId
      connid: testConnId
      method: 'GET'
      identifier: 'test-prop'
    spy.should.have.been.calledWith expectedReq
    return p.then (res) ->
      res.should.deep.equal mockResult

  it 'should send `set` request', ->
    p = proxy.set 'test-prop', { val: 'someval' }
    expectedReq =
      deviceid: testDeviceId
      connid: testConnId
      method: 'SET'
      identifier: 'test-prop'
      value: { val: 'someval' }
    spy.should.have.been.calledWith expectedReq
    return p.then (res) ->
      res.should.deep.equal mockResult

  it 'should send `invoke` request', ->
    p = proxy.invoke 'test-method', ['1', '2']
    expectedReq =
      deviceid: testDeviceId
      connid: testConnId
      method: 'INVOKE'
      identifier: 'test-method'
      value: ['1', '2']
    spy.should.have.been.calledWith expectedReq
    p.then (res) ->
      res.should.deep.equal mockResult

  it 'should send `subscribe` request', ->
    p = proxy.subscribe 'test-event'
    expectedReq =
      deviceid: testDeviceId
      connid: testConnId
      method: 'SUBSCRIBE'
      identifier: 'test-event'
    spy.should.have.been.calledWith expectedReq
    p.then (res) ->
      res.should.deep.equal mockResult

  it 'should send `config` request', ->
    p = proxy.config 'unused', { setting: 'value' }
    expectedReq =
      deviceid: testDeviceId
      connid: testConnId
      method: 'CONFIG'
      identifier: 'unused'
      value: { setting: 'value' }
    spy.should.have.been.calledWith expectedReq
    p.then (res) ->
      res.should.deep.equal mockResult

  it 'should send `describe` request', ->
    p = proxy.describe 'unused'
    expectedReq =
      deviceid: testDeviceId
      connid: testConnId
      method: 'DESCRIBE'
      identifier: 'unused'
    spy.should.have.been.calledWith expectedReq
    p.then (res) ->
      res.should.deep.equal mockResult

