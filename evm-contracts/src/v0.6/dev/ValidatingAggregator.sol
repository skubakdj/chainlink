pragma solidity 0.6.6;


import './../FluxAggregator.sol';
import './AnswerValidatorInterface.sol';


/**
 * @title FlaggingAggregator
 * @notice This contract adds validation capabilities on write to the
 * FluxAggregator, by allowing a validating contract to be configured.
 */
contract ValidatingAggregator is FluxAggregator {
  AnswerValidatorInterface public answerValidator;

  uint256 private constant VALIDATOR_GAS_LIMIT = 100000;

  event AnswerValidatorUpdated(
    address indexed previous,
    address indexed current
  );

  constructor(
    address _link,
    uint128 _payment,
    uint32 _timeout,
    uint32 _answerValidator,
    int256 _minSubVal,
    int256 _maxSubVal,
    uint8 _decimals,
    string memory _description
  )
    public
    FluxAggregator(_link, _payment, _timeout, _minSubVal, _maxSubVal, _decimals, _description)
  {
    answerValidator = AnswerValidatorInterface(_answerValidator);
  }

  function setAnswerValidator(address _newValidator)
    external
    onlyOwner()
  {
    address previous = address(answerValidator);

    if (previous != _newValidator) {
      answerValidator = AnswerValidatorInterface(_newValidator);

      emit AnswerValidatorUpdated(previous, _newValidator);
    }
  }

  function updateRoundAnswer(uint32 _roundId)
    internal
    override
  {
    if (rounds[_roundId].details.submissions.length < rounds[_roundId].details.minSubmissions) return;

    int256 newAnswer = Median.calculateInplace(rounds[_roundId].details.submissions);
    rounds[_roundId].answer = newAnswer;
    rounds[_roundId].updatedAt = uint64(block.timestamp);
    rounds[_roundId].answeredInRound = _roundId;
    latestRoundId = _roundId;

    validateAnswer(_roundId, newAnswer);

    emit AnswerUpdated(newAnswer, _roundId, now);
  }

  function validateAnswer(
    uint32 _roundId,
    int256 _newAnswer
  )
    private
  {
    AnswerValidatorInterface av = answerValidator; // cache storage reads
    if (address(av) == address(0)) return;

    uint32 prevAnswerRoundId = rounds[_roundId - 1].answeredInRound;
    int256 prevRoundAnswer = rounds[_roundId - 1].answer;
   try av.validate.gas(VALIDATOR_GAS_LIMIT)(
      prevAnswerRoundId,
      prevRoundAnswer,
      _roundId,
      _newAnswer
    ) returns (bool _) {
      return;
    } catch {
      return;
    }
  }

}

