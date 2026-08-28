export const PROTOCOL_RESULT_CODE = {
  OK: 'ok',

  INVALID_SIGNATURE: 'invalid_signature',

  DEPRECATED_PROTOCOL_VERSION: 'deprecated_protocol_version',
  UNKNOWN_PROTOCOL_VERSION: 'unknown_protocol_version',
  REGISTRATION_FAILED: 'registration_failed',
} as const;
export type ProtocolResultCode = typeof PROTOCOL_RESULT_CODE[keyof typeof PROTOCOL_RESULT_CODE];

