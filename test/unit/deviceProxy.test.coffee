organiq = require '../..'
when_ = require 'when'

#
# LocalDeviceProxy unit tests
#
# We create a LocalDeviceProxy with organiq.connect() and verify that the
# interface interacts with organiq.dispatch() as expected.
#
describe 'LocalDeviceProxy', ->
  testDeviceId = 'test-device-id'
  app = null
  proxy = null
  spy = null
  beforeEach ->
    app = organiq()
    app.__dispatch = app.dispatch   # save off original impl
    app.dispatch = (req) -> when_(true)
    spy = sinon.spy app, 'dispatch'
    proxy = app.connect testDeviceId

  it 'should send `get` request', ->
    proxy.get 'test'
    spy.should.have.been.calledWith(app.request.get(testDeviceId, 'test'));

  it 'should send `set` request', ->
    proxy.set 'test', { val: 'someval' }
    spy.should.have.been.calledWith( app.request.set(testDeviceId, 'test', { val: 'someval' }) )

  it 'should send `invoke` request', ->
    proxy.invoke 'test', ['1', '2']
    spy.should.have.been.calledWith( app.request.invoke(testDeviceId, 'test', ['1', '2']) )

  it 'should send `config` request', ->
    proxy.config 'unused', { setting: 'value' }
    spy.should.have.been.calledWith( app.request.config(testDeviceId, 'unused', { setting: 'value' } ) )

  it 'should send `subscribe` request', ->
    proxy.subscribe 'test'
    spy.should.have.been.calledWith( app.request.subscribe(testDeviceId, 'test') )

  it 'should send `describe` request', ->
    proxy.describe 'test'
    spy.should.have.been.calledWith( app.request.describe(testDeviceId, 'test') )

  it 'should implement `notify` event', (done) ->
    proxy.on 'notify', (id, params) ->
      id.should.equal 'test-event'
      params.should.deep.equal { test: 'args' }
      done()
    req = app.request.notify testDeviceId, 'test-event', { test: 'args' }
    app.__dispatch req

  it 'should implement `put` event', (done) ->
    proxy.on 'put', (id, value) ->
      id.should.equal 'test-metric'
      value.should.deep.equal { test: 'value' }
      done()
    req = app.request.put testDeviceId, 'test-metric', { test: 'value' }
    app.__dispatch req

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

