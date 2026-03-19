import { HttpException, HttpStatus } from "@nestjs/common";
import { CustomHttpException } from "./CustomBase.exception";

export class TokenExpiredException extends HttpException implements CustomHttpException {
  constructor(
    message: string,
    status: number = HttpStatus.UNAUTHORIZED,
  ) {
    super(message, status);
  }
}