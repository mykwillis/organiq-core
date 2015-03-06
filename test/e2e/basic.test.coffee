WebSocket = require 'ws'
WebSocketServer = WebSocket.Server
organiq = require '../../index.js'

describe 'WebSocket device API', ->
  wss = null
  ws = null
  app = null

  # Every test gets a fresh instance of organiq connected over a live, local
  # WebSocket connection
  beforeEach (done) ->
    app = organiq()
    wss = new WebSocketServer({ port: 1234 })
    wss.on('connection', app.websocketApi())
    ws = new WebSocket('ws://localhost:1234')
    ws.on 'open', done

  afterEach ->
    ws.close()
    wss.close()
    ws = wss = app = null

  describe 'Device registration', ->
    testDeviceId = 'test-register-deviceid'
    testReqId = 'test-register-reqid'

    # Helper function to register a test device with the server
    registerDevice = (done) ->
      message =
        method: 'REGISTER'
        deviceid: testDeviceId
        reqid: testReqId

      ws.on 'message', cb = (msg) ->
        msg = JSON.parse(msg)
        msg.method.should.equal 'RESPONSE'
        msg.reqid.should.equal testReqId
        msg.success.should.be.true
        ws.removeListener 'message', cb
        done()

      ws.send JSON.stringify(message)

    it 'should handle REGISTER', (done) ->
      message =
        method: 'REGISTER'
        deviceid: testDeviceId
        reqid: testReqId

      ws.on 'message', (msg) ->
        msg = JSON.parse(msg)
        msg.method.should.equal 'RESPONSE'
        msg.reqid.should.equal testReqId
        msg.success.should.be.true
        app.devices.should.have.property testDeviceId
        done()

      ws.send JSON.stringify(message)

    it 'should fail REGISTER for already-registered device', (done) ->
      registerDevice ->
        message =
          method: 'REGISTER'
          deviceid: testDeviceId
          reqid: testReqId

        ws.on 'message', (msg) ->
          msg = JSON.parse(msg)
          msg.method.should.equal 'RESPONSE'
          msg.reqid.should.equal testReqId
          msg.success.should.be.false
          msg.err.should.contain 'Already'
          app.devices.should.have.property testDeviceId
          done()

        ws.send JSON.stringify(message)

    it 'should handle DEREGISTER', (done) ->
      # First register a device, then deregister it
      registerDevice ->
        app.devices.should.have.property testDeviceId
        message =
          method: 'DEREGISTER'
          deviceid: testDeviceId
          reqid: testReqId

        ws.on 'message', (msg) ->
          msg = JSON.parse(msg)
          msg.method.should.equal 'RESPONSE'
          msg.reqid.should.equal testReqId
          msg.success.should.be.true
          app.devices.should.not.have.property testDeviceId
          done()

        ws.send JSON.stringify(message)

    it 'should fail DEREGISTER for unregistered device', (done) ->
      # First register a device, then deregister it
      message =
        method: 'DEREGISTER'
        deviceid: testDeviceId
        reqid: testReqId

      ws.on 'message', (msg) ->
        msg = JSON.parse(msg)
        msg.method.should.equal 'RESPONSE'
        msg.reqid.should.equal testReqId
        msg.success.should.be.false
        msg.err.should.contain 'Unknown'
        done()

      ws.send JSON.stringify(message)

    it 'should deregister all devices on disconnect', (done) ->
      registerDevice ->
        ws.on 'close', ->
          # need to delay a bit to let the server rundown the connection
          callback = ->
            app.devices.should.be.empty
            done()
          setTimeout callback, 100

        ws.close()


#  describe 'Upstream registration', ->
#    testDeviceId = 'test-register-deviceid-2'
#    testReqId = 'test-register-reqid-2'
#
#    # Helper function to register a test upstream with the server
#    registerUpstream = (done) ->
#      message =
#        method: 'CONNECT'
#        deviceid: testDeviceId
#        reqid: testReqId
#
#      ws.on 'message', cb = (msg) ->
#        msg = JSON.parse(msg)
#        msg.method.should.equal 'RESPONSE'
#        msg.reqid.should.equal testReqId
#        msg.success.should.be.true
#        ws.removeListener 'message', cb
#        done()
#
#      ws.send JSON.stringify(message)
#
#    it 'should handle CONNECT', (done) ->
#      message =
#        method: 'CONNECT'
#        deviceid: testDeviceId
#        reqid: testReqId
#
#      ws.on 'message', (msg) ->
#        msg = JSON.parse(msg)
#        msg.method.should.equal 'RESPONSE'
#        msg.reqid.should.equal testReqId
#        msg.success.should.be.true
#        app.upstreams.should.have.property.testDeviceId
#        done()
#
#      ws.send JSON.stringify(message)
#
#    it 'should reject CONNECT of already connected upstream', (done) ->
#      registerUpstream ->
#        message =
#          method: 'CONNECT'
#          deviceid: testDeviceId
#          reqid: testReqId
#
#        ws.on 'message', (msg) ->
#          msg = JSON.parse(msg)
#          msg.method.should.equal 'RESPONSE'
#          msg.reqid.should.equal testReqId
#          msg.success.should.be.false
#          msg.err.should.contain 'Already'
#          app.upstreams.should.have.property.testDeviceId
#          done()
#
#        ws.send JSON.stringify(message)
#
#    it 'should handle DISCONNECT', (done) ->
#      # First register a device, then deregister it
#      registerUpstream ->
#        app.upstreams.should.have.property.testDeviceId
#        message =
#          method: 'DISCONNECT'
#          deviceid: testDeviceId
#          reqid: testReqId
#
#        ws.on 'message', (msg) ->
#          msg = JSON.parse(msg)
#          msg.method.should.equal 'RESPONSE'
#          msg.reqid.should.equal testReqId
#          msg.success.should.be.true
#          app.upstreams.should.not.have.property.testDeviceId
#          done()
#
#        ws.send JSON.stringify(message)
#
#    it 'should fail DISCONNECT for unregistered upstream', (done) ->
#      # First register a device, then deregister it
#      message =
#        method: 'DISCONNECT'
#        deviceid: testDeviceId
#        reqid: testReqId
#
#      ws.on 'message', (msg) ->
#        msg = JSON.parse(msg)
#        msg.method.should.equal 'RESPONSE'
#        msg.reqid.should.equal testReqId
#        msg.success.should.be.false
#        msg.err.should.contain 'Unknown'
#        done()
#
#      ws.send JSON.stringify(message)
#
#    it 'should deregister all upstreams on disconnect', (done) ->
#      registerUpstream ->
#        ws.on 'close', ->
#          # need to delay a bit to let the server rundown the connection
#          callback = ->
#            app.upstreams.should.be.empty()
#            done()
#          setTimeout callback, 100
#
#        ws.close()

  describe 'Application-Originated APIs', ->
    testDevice = null
    testDeviceId = 'test-device-id'
    testReqId = 456
    testPropName = 'test-prop-name'
    testMethodName = 'test-method-name'
    testMethodResult = { someVal: 'equals this thing' }
    connId = null

    beforeEach (done) ->
      # Locally-register a test device that we will access via the application
      # APIs.
      testDevice =
        get: (prop) -> return { prop: prop, value: '1234' }
        set: (prop, val) ->
        invoke: (method, args) -> return { method: method, args: args }
        subscribe: (event) -> return true
        config: (sel, args) -> return { prop: sel, args: args }
        describe: (prop) -> return { events: ['a','b'] }

      testDevice.spyGet = sinon.spy testDevice, 'get'
      testDevice.spySet = sinon.spy testDevice, 'set'
      testDevice.spyInvoke = sinon.spy testDevice, 'invoke'
      testDevice.spyConfig = sinon.spy testDevice, 'config'
      testDevice.spyDescribe = sinon.spy testDevice, 'describe'

      app.register testDeviceId, testDevice

      ws.once 'message', (msg) ->
        msg = JSON.parse(msg)
        connId = msg.res
        done()

      message =
        method: 'CONNECT'
        deviceid: testDeviceId
        reqid: testReqId

      ws.send JSON.stringify(message)


    it 'should handle GET', (done) ->
      message =
        method: 'GET'
        deviceid: testDeviceId
        connid: connId
        identifier: 'test-identifier'
        reqid: testReqId

      ws.on 'message', (msg) ->
        testDevice.spyGet.should.have.been.calledWith 'test-identifier'
        msg = JSON.parse(msg)
        msg.method.should.equal 'RESPONSE'
        msg.reqid.should.equal testReqId
        msg.success.should.be.true
        msg.res.should.deep.equal { prop: 'test-identifier', value: '1234' }
        done()

      ws.send JSON.stringify(message)

    it 'should handle SET', (done) ->
      message =
        method: 'SET'
        deviceid: testDeviceId
        connid: connId
        identifier: 'test-identifier'
        value: 'my-value'
        reqid: testReqId

      ws.on 'message', (msg) ->
        msg = JSON.parse(msg)
        msg.method.should.equal 'RESPONSE'
        msg.reqid.should.equal testReqId
        msg.success.should.be.true
        done()

      ws.send JSON.stringify(message)

    it 'should handle INVOKE', (done) ->
      message =
        method: 'INVOKE'
        deviceid: testDeviceId
        connid: connId
        identifier: 'test-method'
        value: [ apple: 'red', banana: 'yellow' ]
        reqid: testReqId

      ws.on 'message', (msg) ->
        msg = JSON.parse(msg)
        msg.method.should.equal 'RESPONSE'
        msg.reqid.should.equal testReqId
        msg.success.should.be.true
        msg.res.should.deep.equal { method: message.identifier, args: message.value }
        done()

      ws.send JSON.stringify(message)
