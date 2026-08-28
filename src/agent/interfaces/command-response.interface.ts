import { ProtocolResultCode } from "../types/ResultCode.type";

// 양쪽이 공유하는 타입 (Hub·Agent에 각각 복사)
// export interface CommandResponse<D = unknown> {
//   code: ProtocolResultCode;
//   data: D;
//   args: unknown[];
// }

// interface HubToAgentEvents {
//   command: (payload: Command) => void;
//   'tunnel-connect': (payload: TunnelConnectPayload) => void;
// }

// interface AgentToHubEvents {
//   response: (payload: CommandResponse) => void;
//   register: (payload: RegisterPayload) => void;
// }

// Agent
// private socket: Socket<HubToAgentEvents, AgentToHubEvents>;
