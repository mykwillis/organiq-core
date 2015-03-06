organiq = require '../..'

app = organiq()

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

    testDevice.spyGet = sinon.spy testDevice, 'get'
    testDevice.spySet = sinon.spy testDevice, 'set'
    testDevice.spyInvoke = sinon.spy testDevice, 'invoke'
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

