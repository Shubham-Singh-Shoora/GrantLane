// Generated from contracts/out/DisputeRegistry.sol/DisputeRegistry.json — do not edit by hand.
// Regenerate with: npm run gen:abi (after `npm run contracts:build`).

export const disputeRegistryAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "escrow_",
        "type": "address",
        "internalType": "contract GrantEscrow"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "dispute",
    "inputs": [
      {
        "name": "grantId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "milestoneId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "reasonHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "reasonURI",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [
      {
        "name": "assertionId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "disputesFor",
    "inputs": [
      {
        "name": "grantId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "milestoneId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple[]",
        "internalType": "struct DisputeRegistry.Dispute[]",
        "components": [
          {
            "name": "assertionId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "disputer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "filedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "reasonHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "reasonURI",
            "type": "string",
            "internalType": "string"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "escrow",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract GrantEscrow"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "oracle",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IOptimisticOracleV3"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "usdc",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IERC20"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "DisputeFiled",
    "inputs": [
      {
        "name": "grantId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "milestoneId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "assertionId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "disputer",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "reasonHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "reasonURI",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "EmptyReason",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotOpenToDispute",
    "inputs": [
      {
        "name": "status",
        "type": "uint8",
        "internalType": "enum GrantEscrow.MilestoneStatus"
      }
    ]
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnknownMilestone",
    "inputs": [
      {
        "name": "grantId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "milestoneId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  }
] as const;
