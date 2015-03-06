organiq = require '../..'
when_ = require 'when'

describe 'LocalDeviceProxy', ->
  testDeviceId = 'test-device-id'
  app = null
  spy = null
  beforeEach ->
    app = organiq()
    app.dispatch = (req) -> when_(true)
    spy = sinon.spy app, 'dispatch'

  it 'should send `get` request', ->
    proxy = app.connect testDeviceId
    proxy.get 'test'
    spy.should.have.been.calledWith(app.request.get(testDeviceId, 'test'));

  it 'should send `set` request', ->
    proxy = app.connect testDeviceId
    proxy.set 'test', { val: 'someval' }
    spy.should.have.been.calledWith( app.request.set(testDeviceId, 'test', { val: 'someval' }) )

  it 'should send `invoke` request', ->
    proxy = app.connect testDeviceId
    proxy.invoke 'test', ['1', '2']
    spy.should.have.been.calledWith( app.request.invoke(testDeviceId, 'test', ['1', '2']) )


describe 'Organiq connect and disconnect', ->
  testDeviceId = 'test-device-id'
  app = null
  spy = null
  beforeEach ->
    app = organiq()
    app.dispatch = (req) -> when_(true)
    spy = sinon.spy app, 'dispatch'

  it 'connect() should return an instance of LocalDeviceProxy', ->
    proxy = app.connect testDeviceId
    proxy.should.be.an.instanceof organiq._LocalDeviceProxy

  it 'connect() should save proxy in proxies array', ->
    proxy = app.connect testDeviceId
    app.proxies.should.have.property testDeviceId
    proxies = app.proxies[testDeviceId]
    proxies.should.include proxy


  it 'disconnect() should remove LocalDeviceProxy', ->
    proxy = app.connect testDeviceId
    app.disconnect proxy
    app.proxies.should.not.have.property testDeviceId

