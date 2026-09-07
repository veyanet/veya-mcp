# Tools Reference — VEYA MCP

Complete catalog of MCP tools registered by `@veyanet/mcp`. Argument schemas are enforced with Zod on the server.

---

## Public tools (no Bearer required)

### `veya_describe`

**Purpose:** Honesty card for clients and diligence.

**Args:** none

**Returns (JSON text):** package name/version, `publicUrl`, settlement object (network, chainId, contract, explorer, rpc), product API URL, sealed claim (AES-256-GCM, not FHE), mainnet deferral, write policy string, stdio sibling path.

**When to use:** First call after connecting. Always safe.

---

### `veya_ping_chain`

**Purpose:** Live RPC connectivity and chain id check via `@veyanet/sdk`.

**Args:** none

**Returns:** ping fields including `chainId` (stringified bigint), block metadata, `expectedChainId`, resolved client config summary.

**Failure:** RPC unreachable or chain id mismatch throws / errors in tool result.

---

### `veya_hash_blake3`

**Purpose:** Compute BLAKE3-256 hex digest.

**Args:**

| Name | Type | Constraint |
|------|------|------------|
| `data` | string | min length 1 |

**Returns:** `{ "hash": "<64 hex chars>" }`

**Notes:** Commitment helper. Does not write on-chain.

---

### `veya_verify_transaction`

**Purpose:** Parse Veya.sol events from a mined transaction.

**Args:**

| Name | Type | Constraint |
|------|------|------------|
| `txHash` | string | min length 66 (0x-prefixed hash) |

**Returns:** Parsed proof object from SDK `verifyTransaction` (event name, digest, explorer URL, etc.) or nullish if no Veya event.

**Notes:** Transaction `to` must be the configured `Veya.sol` address or SDK raises mismatch.

---

### `veya_api_health`

**Purpose:** Probe product API honesty endpoint.

**Args:** none

**Returns:** `{ httpStatus, body }` from `GET {VEYA_API_URL}/health`.

**Notes:** `degraded` on the API is allowed and informative. Does not imply MCP process failure.

---

### `veya_writes_status`

**Purpose:** Explicit “writes off” tool when keys are not configured.

**Args:** none

**Returns:** `{ writesEnabled: false, reason: "..." }`

**Notes:** Not registered when writes are enabled; write tools are registered instead.

---

## Authenticated write tools

**Server requirements:** `MCP_API_KEY` and `VEYA_RELAYER_PRIVATE_KEY` (or `VEYA_DEPLOYER_PRIVATE_KEY`) both set.

**Request requirement:**

```http
Authorization: Bearer <MCP_API_KEY>
```

All write tools call `assertWriteAuthorized` then SDK `EvmAnchor` methods (chain id guard on submit).

### `veya_store_commitment`

| Arg | Type | Meaning |
|-----|------|---------|
| `environmentUuidHex` | string | 16-byte UUID as hex |
| `commitmentHex` | string | 32-byte commitment as hex |

**On-chain:** `storeCommitment`  
**Returns:** `{ txHash, explorer }`

---

### `veya_attest_execution`

| Arg | Type | Meaning |
|-----|------|---------|
| `environmentUuidHex` | string | 16-byte env UUID hex |
| `blake3HashHex` | string | 32-byte execution hash hex |
| `mldsaSigHex` | string | ML-DSA signature bytes as hex |

**On-chain:** `attestExecution`  
**Returns:** `{ txHash, explorer }`

---

### `veya_register_environment`

| Arg | Type | Meaning |
|-----|------|---------|
| `environmentUuidHex` | string | 16-byte UUID hex |
| `pqPubkeyHashHex` | string | 32-byte PQ pubkey hash hex |
| `envType` | number | `0` Execution, `1` SecureEnclave, `2` Governance (Veya.sol enum) |

**On-chain:** `registerEnvironment`  
**Returns:** `{ txHash, explorer }`

---

## Tool surface vs product API

| Concern | Prefer |
|---------|--------|
| Guest Use stamp / UI verify | Product site + `api.veyanet.tech` |
| Agent paste-URL read/verify | This MCP |
| Full Build rooms / spend in product | Product API + wallet session |
| Library integration in your backend | `@veyanet/sdk` directly |

MCP write tools are an operator/agent convenience over the same contract methods; they are not a replacement for product auth (guest JWT / wallet SIWE).
