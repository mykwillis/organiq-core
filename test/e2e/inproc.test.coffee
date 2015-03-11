organiq = require '../..'
EventEmitter = require('events').EventEmitter

app = organiq()

#
# LocalDeviceProxy integration tests.
#
# Test that the LocalDeviceProxy returned by connect() for a local native
# device behaves as expected. In particular, downstream messages should round-
# trip correctly, and upstream notifications should be surfaced to the proxy.
#
# The setup is a local node, no networking, with a native device registered to
# which we connect() and get a proxy.
#
describe 'Local Device Path', ->
  testDevice = null
  testDeviceId = 'test-device-id'
  app = null
  proxy = null

  expectedGetValue = { Iam: 'a property value' }
  expectedSetValue = true
  expectedMethodValue = { ret: 'a method value' }

  beforeEach ->
    app = new organiq()
    testDevice =
      get: (prop) -> expectedGetValue
      set: (prop, val) ->
      invoke: (method, args) -> expectedMethodValue
      subscribe: (event) -> return true
      config: (sel, args) -> return true
      describe: (prop) -> return { events: ['a','b'] }

      # emits 'notify' and 'put'
      __emitter: new EventEmitter
      on: (ev, fn) -> return this.__emitter.on(ev, fn)

    testDevice.spyGet = sinon.spy testDevice, 'get'
    testDevice.spySet = sinon.spy testDevice, 'set'
    testDevice.spyInvoke = sinon.spy testDevice, 'invoke'
    testDevice.spySubscribe = sinon.spy testDevice, 'subscribe'
    testDevice.spyConfig = sinon.spy testDevice, 'config'
    testDevice.spyDescribe = sinon.spy testDevice, 'describe'

    app.register testDeviceId, testDevice
    proxy = app.connect testDeviceId

  it 'gets proxy for locally-registered device', ->
    proxy.should.be.instanceOf organiq._LocalDeviceProxy

  it 'invokes device `get` via proxy', ->
    res = proxy.get('prop')
    return res.then (res) ->
      testDevice.spyGet.should.have.been.calledWith 'prop'
      res.should.equal expectedGetValue

  it 'invokes device `set` via proxy', ->
    res = proxy.set 'setprop', 'newval'
    return res.then (res) ->
      testDevice.spySet.should.have.been.calledWith 'setprop', 'newval'
      res.should.equal expectedSetValue

  it 'invokes device `invoke` via proxy', ->
    res = proxy.invoke 'methodname', { params: 'here' }
    return res.then (res) ->
      testDevice.spyInvoke.should.have.been.calledWith 'methodname', { params: 'here' }
      res.should.equal expectedMethodValue

  it 'invokes device `subscribe` via proxy', ->
    res = proxy.subscribe 'eventname'
    return res.then (res) ->
      testDevice.spySubscribe.should.have.been.calledWith 'eventname'

  it 'invokes device `describe` via proxy', ->
    res = proxy.describe 'methodname'
    return res.then (res) ->
      testDevice.spyDescribe.should.have.been.calledWith 'methodname'
      res.should.deep.equal { events: ['a', 'b'] }

  it 'invokes device `config` via proxy', ->
    res = proxy.config 'propname', { params: 'here' }
    return res.then (res) ->
      testDevice.spyConfig.should.have.been.calledWith 'propname', { params: 'here' }
      res.should.equal true

  it 'receives `notify` when event raised', (done) ->
    proxy.on 'notify', (ev, a) ->
      ev.should.equal 'event'
      a.should.deep.equal [ 'a1', 'a2' ]
      done()
    testDevice.__emitter.emit('notify', 'event', [ 'a1', 'a2' ])

  it 'receives `put` when event raised', (done) ->
    proxy.on 'put', (ev, v) ->
      ev.should.equal 'metric'
      v.should.deep.equal { value: '1.0' }
      done()
    testDevice.__emitter.emit('put', 'metric', { value: '1.0' })

