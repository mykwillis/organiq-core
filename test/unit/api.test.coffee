Organiq = require '../../'
EventEmitter = require('events').EventEmitter

describe 'Organiq', ->
  testDeviceId = 'example.com:test-device-id'
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

  describe 'getDeviceAuthority', ->
    it 'isLocal should be true if no gateway has been registered', ->
      authority = o.getDeviceAuthority testDeviceId
      authority.should.exist
      authority.isLocal.should.be.true

    it 'isLocal should be false if gateway has been registered', ->
      g = {}
      o.registerGateway('example.com', g)
      authority = o.getDeviceAuthority testDeviceId
      authority.isLocal.should.be.false

    it 'isLocal should be true if gateway registered and unregistered', ->
      g = {}
      o.registerGateway('example.com', g)
      o.deregisterGateway('example.com')
      authority = o.getDeviceAuthority testDeviceId
      authority.isLocal.should.be.true

    it 'domain should parse correctly', ->
      authority = o.getDeviceAuthority testDeviceId
      authority.domain.should.equal 'example.com'

    it 'should lowercase domain', ->
      authority = o.getDeviceAuthority 'EXAMPLE.COM:test-device-id'
      authority.domain.should.equal 'example.com'

    it 'should lowercase deviceid', ->
      d = 'example.com:TEST-DEVICE-ID'
      authority = o.getDeviceAuthority d
      authority.deviceid.should.equal d.toLowerCase()

    it 'should match wildcard domain', ->
      g = { test: 'marker' }
      o.registerGateway('*', g)
      authority = o.getDeviceAuthority testDeviceId
      authority.gateway.should.deep.equal g

    it 'should match specific domain before wildcard', ->
      g1 = { test: 'marker1' }
      g2 = { test: 'marker2' }
      o.registerGateway('*', g1)
      o.registerGateway('example.com', g2)

      authority = o.getDeviceAuthority testDeviceId
      authority.gateway.should.deep.equal g2

    it 'should use defaultDomain if no domain specified', ->
      o = new Organiq({ defaultDomain: 'test.default.domain' })
      authority = o.getDeviceAuthority 'not-fully-qualified-device-id'
      authority.domain.should.equal 'test.default.domain'


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
    it 'should reject for unregistered device', ->
      o.deregister(testDeviceId).should.be.rejectedWith Error

