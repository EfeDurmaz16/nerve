# Groq Live Comparison

Generated: 2026-05-30T15:02:58.444Z
Model: llama-3.3-70b-versatile

## Hypothesis

- Direct Groq repeats burn provider compute twice.
- TokenOps serves the second identical request from exact cache.

## Result

- Direct provider calls: 2
- Direct total tokens: 96
- TokenOps provider calls observed: 1
- TokenOps exact hits: false, true
- Content matches: true

## Assertions

- directMadeTwoCalls: true
- tokenopsObservedOneProviderCall: true
- secondGatewayCallExactHit: true
- contentMatches: true
