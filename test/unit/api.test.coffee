Organiq = require '../../'
EventEmitter = require('events').EventEmitter

describe 'Organiq', ->
  testDeviceId = 'test-device-id'
  # @type {Organiq}
  o = null
  beforeEach ->
    o = new Organiq()

  describe 'constructor', ->
    it 'should return an instance of Organiq', ->
      req = new Organiq()
      req.should.be.an.instanceof Organiq

    it 'should return an instance of Organiq when invoked without `new`', ->
      req = Organiq()
      req.should.be.an.instanceof Organiq

  describe 'isAuthoritative', ->
    it 'should return true if no gateway has been registered', ->
      o.isAuthoritative(testDeviceId).should.be.true

    it 'should return false if gateway has been registered', ->
      g = {}
      o.registerGateway(g)
      o.isAuthoritative(testDeviceId).should.be._false

    it 'should return true if gateway has been registered and unregistered', ->
      g = {}
      o.registerGateway(g)
      o.deregisterGateway()
      o.isAuthoritative(testDeviceId).should.be.true

  describe 'register', ->
    it 'registers `notify` and `put` handlers on EventEmitter devices', ->
      d = new EventEmitter()
      o.register 'test-device-id', d
      d.listeners('notify').should.have.length.above 0
      d.listeners('put').should.have.length.above 0

    it 'registers `notify` and `put` handlers on non-EventEmitter devices with `on`', ->
      d =
        on: (ev, fn) ->
      spy = sinon.spy d, 'on'
      o.register 'test-device-id', d
      spy.should.have.been.calledWith 'notify'
      spy.should.have.been.calledWith 'put'

  describe 'deregister', ->
    it 'should return null for unregistered device', ->
      (o.deregister(testDeviceId) == null).should.be.true

