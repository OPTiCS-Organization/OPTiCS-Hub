import { HttpException, HttpStatus } from "@nestjs/common";

export class AgentNotConnectedException extends HttpException {
  constructor(message: string = 'Agent is not connected with requested workspace.') {
    super(message, 430, { cause: "Agent is not connected with requested workspace." });
  }
}
