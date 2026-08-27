export interface Agent {
  code: string | null;
  uuid: string | null;
  parentWorkspace: number | null;
  protocolVersion: number;
  signingSecret: string | null;
  ip: string;
}
