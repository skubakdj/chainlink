import {
  contract,
  matchers,
  helpers as h,
  setup,
} from '@chainlink/test-helpers'
import { assert } from 'chai'
import { HistoricDeviationValidatorFactory } from '../../ethers/v0.6/HistoricDeviationValidatorFactory'
import { FlagsFactory } from '../../ethers/v0.6/FlagsFactory'
import { SimpleWriteAccessControllerFactory } from '../../ethers/v0.6/SimpleWriteAccessControllerFactory'

let personas: setup.Personas
const provider = setup.provider()
const validatorFactory = new HistoricDeviationValidatorFactory()
const flagsFactory = new FlagsFactory()
const acFactory = new SimpleWriteAccessControllerFactory()

beforeAll(async () => {
  personas = await setup.users(provider).then(x => x.personas)
})

describe('HistoricDeviationValidator', () => {
  let validator: contract.Instance<HistoricDeviationValidatorFactory>
  let flags: contract.Instance<FlagsFactory>
  let ac: contract.Instance<SimpleWriteAccessControllerFactory>
  const flaggingThreshold = 10000 // 10%
  const previousRoundId = 2
  const previousValue = 1000000
  const currentRoundId = 3
  const currentValue = 1000000

  const deployment = setup.snapshot(provider, async () => {
    ac = await acFactory.connect(personas.Carol).deploy()
    flags = await flagsFactory.connect(personas.Carol).deploy(ac.address)
    validator = await validatorFactory
      .connect(personas.Carol)
      .deploy(flags.address, ac.address, flaggingThreshold)
    await ac.connect(personas.Carol).addAccess(personas.Nelly.address)
    await ac.connect(personas.Carol).addAccess(validator.address)
  })

  beforeEach(async () => {
    await deployment()
  })

  it('has a limited public interface', () => {
    matchers.publicAbi(validatorFactory, [
      'THRESHOLD_MULTIPLIER',
      'accessController',
      'flaggingThreshold',
      'flags',
      'validate',
      // Owned methods:
      'acceptOwnership',
      'owner',
      'transferOwnership',
    ])
  })

  describe('#constructor', () => {
    it('sets the arguments passed in', async () => {
      assert.equal(flags.address, await validator.flags())
      assert.equal(ac.address, await validator.accessController())
      matchers.bigNum(flaggingThreshold, await validator.flaggingThreshold())
    })
  })

  describe('#validate', () => {
    describe('when the deviation is greater than the threshold', () => {
      const currentValue = 1100010

      it('does raises a flag for the calling address', async () => {
        const tx = await validator
          .connect(personas.Nelly)
          .validate(
            previousRoundId,
            previousValue,
            currentRoundId,
            currentValue,
          )
        const receipt = await tx.wait()
        const event = matchers.eventExists(
          receipt,
          flags.interface.events.FlagOn,
        )

        assert.equal(flags.address, event.address)
        assert.equal(
          personas.Nelly.address,
          h.evmWordToAddress(event.topics[1]),
        )
      })

      it('uses less than the gas alotted by the aggregator', async () => {
        const tx = await validator
          .connect(personas.Nelly)
          .validate(
            previousRoundId,
            previousValue,
            currentRoundId,
            currentValue,
          )
        const receipt = await tx.wait()
        assert(receipt)
        if (receipt && receipt.gasUsed) {
          assert.isAbove(100000, receipt.gasUsed.toNumber())
        }
      })
    })

    describe('when the deviation is less than or equal to the threshold', () => {
      const currentValue = 1100009

      it('does raises a flag for the calling address', async () => {
        const tx = await validator
          .connect(personas.Nelly)
          .validate(
            previousRoundId,
            previousValue,
            currentRoundId,
            currentValue,
          )
        const receipt = await tx.wait()
        matchers.eventDoesNotExist(receipt, flags.interface.events.FlagOn)
      })

      it('uses less than the gas alotted by the aggregator', async () => {
        const tx = await validator
          .connect(personas.Nelly)
          .validate(
            previousRoundId,
            previousValue,
            currentRoundId,
            currentValue,
          )
        const receipt = await tx.wait()
        assert(receipt)
        if (receipt && receipt.gasUsed) {
          assert.isAbove(27500, receipt.gasUsed.toNumber())
        }
      })
    })

    describe('when called with a previous value of zero', () => {
      const previousValue = 0

      it('does not raise any flags', async () => {
        const tx = await validator
          .connect(personas.Nelly)
          .validate(
            previousRoundId,
            previousValue,
            currentRoundId,
            currentValue,
          )
        const receipt = await tx.wait()
        assert.equal(0, receipt.events?.length)
      })
    })

    describe('when called by an unpermissioned address', () => {
      it('reverts', async () => {
        await matchers.evmRevert(
          validator.connect(personas.Neil).validate(0, 0, 0, 0),
          'Access denied',
        )
      })
    })
  })
})
