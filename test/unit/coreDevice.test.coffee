Organiq = require '../../'
OrganiqCoreDevice = require '../../lib/coreDevice.js'
EventEmitter = require('events').EventEmitter

describe 'CoreDevice', ->
  # @type {OrganiqCoreDevice}
  cd = null
  o = null
  beforeEach ->
    stub_getAttachedDeviceInfo = sinon.stub().returns { stuff: 'here' }
    o =
      getAttachedDeviceInfo: stub_getAttachedDeviceInfo
    cd = new OrganiqCoreDevice(o)

  describe 'constructor', ->
    it 'should return an instance of OrganiqCoreDevice', ->
      cd = new OrganiqCoreDevice(o)
      cd.should.be.an.instanceof OrganiqCoreDevice

    it 'should return an instance of Organiq when invoked without `new`', ->
      cd = OrganiqCoreDevice()
      cd.should.be.an.instanceof OrganiqCoreDevice

  describe 'schema', ->
    schema = null
    beforeEach ->
      schema = cd.describe()

    it 'should return valid schema object', ->
      schema.should.exist
      schema.should.have.property 'methods'
      schema.should.have.property 'events'
      schema.should.have.property 'properties'

    it 'should support ConnectedDevices property', ->
      properties = schema.properties
      properties.should.have.property 'ConnectedDevices'

