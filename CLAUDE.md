# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```shell
forge build          # compile contracts
forge test           # run all tests
forge test -vvv      # run tests with verbose output (used in CI)
forge test --match-test <test_name>   # run a single test
forge fmt            # format Solidity files
forge fmt --check    # check formatting without writing (used in CI)
forge build --sizes  # build and report contract sizes (used in CI)
forge snapshot       # generate gas snapshots
forge script script/Counter.s.sol:CounterScript --rpc-url <rpc_url> --private-key <key>  # deploy
anvil                # start a local EVM node
```

## Architecture

This is a Foundry project for Ethereum/EVM smart contract development.

- `src/` — production Solidity contracts (Solidity ^0.8.13, UNLICENSED)
- `test/` — test contracts inheriting from `forge-std/Test.sol`; test functions are prefixed `test_` (unit) or `testFuzz_` (fuzz)
- `script/` — deployment scripts inheriting from `forge-std/Script.sol`; use `vm.startBroadcast()` / `vm.stopBroadcast()` to wrap deployments
- `lib/forge-std` — forge-std git submodule; provides `Test`, `Script`, `vm` cheatcodes, and assertion helpers
- `out/` — compiled artifacts (git-ignored)

CI runs `forge fmt --check`, `forge build --sizes`, and `forge test -vvv` on every push and PR.
